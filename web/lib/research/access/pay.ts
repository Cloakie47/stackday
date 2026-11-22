import { erc20Abi, formatUnits, getAddress, isAddress, parseEventLogs, zeroAddress, type Log } from "viem";
import type { Entitlement } from "../types.ts";
import { applyPayment, priceUnits } from "./entitlement.ts";
import { MIN_CONFIRMATIONS, PRICE_LIST, USDC_DECIMALS, type Purpose } from "./prices.ts";
import type { AccessStore, Loaded } from "./store.ts";

/**
 * Checks a research payment on Base Sepolia and grants what it bought.
 * No framework code, so it is unit tested with a mocked chain reader (pay.test.ts).
 *
 * A payment counts only if ALL of these hold:
 * - the chain node reports chain id 84532 (Base Sepolia), never mainnet;
 * - the transaction succeeded and has at least MIN_CONFIRMATIONS confirmations;
 * - it holds USDC `Transfer` logs from the token contract in web/lib/deployment.json, from the
 *   signed-in wallet to RESEARCH_TREASURY_ADDRESS, adding up to at least the price;
 * - it was mined at or after RESEARCH_PAY_FROM_BLOCK, so transfers made to the treasury before
 *   research payments opened can never be redeemed;
 * - the tx hash was never stored before (the `research_payments` primary key rejects replays).
 * The treasury must be a wallet used for research payments only: it may not be the token or any
 * Stackday contract in deployment.json (payroll, router, vault factory and so on).
 * The server only reads the chain. It never holds a key and never sends a transaction.
 */

export const TESTNET_CHAIN_ID = 84532;
export const TX_HASH_RULE = /^0x[0-9a-f]{64}$/;

/** The few chain calls we need. A viem public client fits; tests pass a mock. */
export interface ChainReader {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getTransactionReceipt(args: { hash: `0x${string}` }): Promise<{
    transactionHash: `0x${string}`;
    status: "success" | "reverted";
    blockNumber: bigint;
    logs: Log[];
  }>;
}

export type PaymentConfig = {
  usdc: `0x${string}`;
  treasury: `0x${string}`;
  minConfirmations: number;
  /** First block a research payment may be in (RESEARCH_PAY_FROM_BLOCK). */
  fromBlock: bigint;
};

export type Failure = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Failure => ({ ok: false, status, error });

/**
 * Reads RESEARCH_TREASURY_ADDRESS and RESEARCH_PAY_FROM_BLOCK. Returns null (payments switched off)
 * when the treasury is missing, not an address, the zero address, the USDC contract or any known
 * Stackday contract, or when the start block is missing or not a whole number.
 */
export function paymentConfig(env: Record<string, string | undefined>, usdc: string, knownContracts: readonly string[] = []): PaymentConfig | null {
  const t = env.RESEARCH_TREASURY_ADDRESS?.trim();
  if (!t || !isAddress(t, { strict: false }) || !isAddress(usdc, { strict: false })) return null;
  const treasury = getAddress(t);
  if (treasury === zeroAddress || treasury === getAddress(usdc)) return null;
  const known = new Set(knownContracts.filter((a) => isAddress(a, { strict: false })).map((a) => getAddress(a)));
  if (known.has(treasury)) return null;
  const from = env.RESEARCH_PAY_FROM_BLOCK?.trim();
  if (!from || !/^\d{1,15}$/.test(from)) return null;
  return { usdc: getAddress(usdc), treasury, minConfirmations: MIN_CONFIRMATIONS, fromBlock: BigInt(from) };
}

/** Sum of USDC sent from `wallet` to the treasury in these logs. Other tokens and recipients are ignored. */
export function paidToTreasury(logs: Log[], cfg: PaymentConfig, wallet: string): bigint {
  const usdc = cfg.usdc.toLowerCase();
  const fromToken = logs.filter((l) => l.address?.toLowerCase() === usdc);
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: fromToken, strict: true });
  let total = BigInt(0);
  for (const t of transfers) {
    if (t.args.from.toLowerCase() === wallet && t.args.to.toLowerCase() === cfg.treasury.toLowerCase()) total += t.args.value;
  }
  return total;
}

export type Verified = { ok: true; amount: bigint };

/** Checks the transaction on chain. Does not touch the database. */
export async function verifyPayment(p: {
  txHash: string;
  wallet: string;
  reader: ChainReader;
  cfg: PaymentConfig;
}): Promise<Verified | Failure> {
  const hash = p.txHash.toLowerCase();
  if (!TX_HASH_RULE.test(hash)) return fail(400, "That is not a transaction hash.");

  let chainId: number;
  try {
    chainId = await p.reader.getChainId();
  } catch {
    return fail(502, "Could not reach the Base Sepolia node. Try again.");
  }
  if (chainId !== TESTNET_CHAIN_ID) return fail(500, "Payments are checked on Base Sepolia only.");

  let receipt: Awaited<ReturnType<ChainReader["getTransactionReceipt"]>>;
  let head: bigint;
  try {
    receipt = await p.reader.getTransactionReceipt({ hash: hash as `0x${string}` });
    head = await p.reader.getBlockNumber();
  } catch (e) {
    if (e instanceof Error && /not.?found|could not be found/i.test(`${e.name} ${e.message}`))
      return fail(409, "That transaction is not on Base Sepolia yet. Wait a few seconds and try again.");
    return fail(502, "Could not reach the Base Sepolia node. Try again.");
  }
  if (!receipt || receipt.transactionHash?.toLowerCase() !== hash) return fail(502, "The node returned a different transaction.");
  if (receipt.status !== "success") return fail(400, "That transaction failed on chain, so nothing was paid.");
  if (receipt.blockNumber < p.cfg.fromBlock) return fail(400, "That transaction is from before research payments opened, so it cannot be used.");

  const confirmations = head >= receipt.blockNumber ? head - receipt.blockNumber + BigInt(1) : BigInt(0);
  if (confirmations < BigInt(p.cfg.minConfirmations))
    return fail(409, `Waiting for ${p.cfg.minConfirmations} confirmations (has ${confirmations}). Try again in a few seconds.`);

  const amount = paidToTreasury(receipt.logs, p.cfg, p.wallet);
  if (amount === BigInt(0)) return fail(400, "That transaction has no test USDC transfer from your wallet to the Stackday research address.");
  return { ok: true, amount };
}

export type PaymentResult = { ok: true; entitlement: Entitlement; amountUsdc: string; summary: string } | Failure;

/**
 * The whole payment flow: check on chain, check the price, then store the tx hash AND grant in one
 * database transaction (`recordPaymentAndGrant`). Either both happen or neither does, so a crash
 * can never lose a payment and a retry can never grant twice. A clash with a parallel change to
 * the same entitlement rolls the whole step back and it is tried again on fresh data.
 */
export async function processPayment(p: {
  txHash: string;
  wallet: string;
  purpose: Purpose;
  reader: ChainReader;
  cfg: PaymentConfig;
  store: AccessStore;
  now: Date;
  attempts?: number;
}): Promise<PaymentResult> {
  const wallet = p.wallet.toLowerCase();
  const v = await verifyPayment({ txHash: p.txHash, wallet, reader: p.reader, cfg: p.cfg });
  if (!v.ok) return v;

  const item = PRICE_LIST.items[p.purpose];
  if (v.amount < priceUnits(p.purpose))
    return fail(400, `This transaction paid ${formatUnits(v.amount, USDC_DECIMALS)} test USDC, below the ${item.label} price of ${item.usdc}.`);

  const txHash = p.txHash.toLowerCase();
  const amountUsdc = formatUnits(v.amount, USDC_DECIMALS);
  const row = { txHash, wallet, chainId: TESTNET_CHAIN_ID, amountUsdc, purpose: p.purpose };
  for (let i = 0; i < (p.attempts ?? 8); i++) {
    let prev: Loaded;
    try {
      prev = await p.store.load(wallet);
    } catch {
      return fail(500, "Could not read your plan. Try again.");
    }
    const g = applyPayment(prev.ent, p.purpose, v.amount, p.now);
    if (!g.ok) return fail(400, g.error);
    const next: Entitlement = { ...g.next, owner: wallet };
    let r: "stored" | "duplicate" | "clash";
    try {
      r = await p.store.recordPaymentAndGrant(prev, next, row);
    } catch {
      return fail(500, "Could not record the payment, and nothing was applied. Try again.");
    }
    if (r === "duplicate") return fail(409, "This transaction was already used for a payment.");
    if (r === "stored") return { ok: true, entitlement: next, amountUsdc, summary: g.summary };
  }
  return fail(503, "Your plan is busy. Try again.");
}
