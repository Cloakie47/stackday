import { erc20Abi } from "viem";
import { factoryAbi, routerAbi, vaultAbi } from "./abis.ts";
import { ADDR, MAX_UINT, type Address, type Asset } from "./contracts.ts";
import type { Leg } from "./basket.ts";
import { assetValue, fmtUsdc } from "./format.ts";
import type { Position } from "./usePortfolio.ts";
import type { Call } from "./useTx.ts";

/**
 * The calls behind Invest and Borrow, shared by those pages and the chat assistant (lib/chat/buildCalls.ts),
 * so a buy, plan, borrow or repay prepared in chat is exactly what the page would send. Pure functions,
 * no hooks, unit tested in actions.test.ts. Approvals are passed in (the caller reads the allowance).
 */

/** A manual buy refuses to fill more than 1% below the oracle price (Invest page and chat). */
export const MAX_BUY_SLIPPAGE_BPS = 100n;
/** Slippage allowed on each recurring buy, in basis points (SipRouter.setPlan). */
export const PLAN_SLIPPAGE_BPS = 100;
export const MAX_APPROVAL = 2n ** 256n - 1n;

/** The least an order may return: the oracle quote less the allowed slippage. */
export const minOutAfterSlippage = (quote: bigint, slippageBps: bigint) => (quote * (10_000n - slippageBps)) / 10_000n;

export const investCall = (asset: Asset, usdc: bigint, minOut: bigint): Call => ({
  label: `Buy ${asset.name} into your vault`,
  address: ADDR.router,
  abi: routerAbi,
  functionName: "invest",
  args: [asset.token, usdc, minOut],
});

/**
 * Raise the router's USDC allowance by `extra`. Recurring buys spend that allowance, so it is what
 * ends a plan: N buys approved means N buys run. MAX_APPROVAL means "until I stop".
 */
export function approveMoreCall(currentAllowance: bigint, extra: bigint, label: string): Call {
  const next = extra === MAX_APPROVAL || currentAllowance + extra > MAX_APPROVAL - 1n ? MAX_APPROVAL : currentAllowance + extra;
  return { label, address: ADDR.usdc, abi: erc20Abi, functionName: "approve", args: [ADDR.router, next] };
}

/** Number of buys a plan of `weeks` makes at one buy every `intervalDays`; 0 weeks means until stopped (0). */
export const buysFor = (weeks: number, intervalDays: number) => (weeks === 0 ? 0 : Math.max(1, Math.ceil((weeks * 7) / intervalDays)));

export const setPlanCall = (asset: Asset, usdcPerBuy: bigint, intervalSeconds: number, slippageBps: number, firstBuyAt: number): Call => ({
  label: "Save your recurring plan",
  address: ADDR.router,
  abi: routerAbi,
  functionName: "setPlan",
  args: [asset.token, usdcPerBuy, intervalSeconds, slippageBps, firstBuyAt],
});

export const cancelPlanCall = (asset: Asset): Call => ({
  label: `Cancel the ${asset.name} plan`,
  address: ADDR.router,
  abi: routerAbi,
  functionName: "cancelPlan",
  args: [asset.token],
});

/** Withdraw from the vault. `to` is always the connected wallet; callers never take it from user text. */
export const withdrawCall = (vault: Address, asset: Asset, amount: bigint, to: Address): Call => ({
  label: `Withdraw ${asset.name} to your wallet`,
  address: vault,
  abi: vaultAbi,
  functionName: "withdraw",
  args: [asset.token, amount, to],
});

export const createVaultCall = (owner: Address): Call => ({
  label: "Create your vault",
  address: ADDR.factory,
  abi: factoryAbi,
  functionName: "createVault",
  args: [owner],
});

/**
 * Lock one asset as collateral: tokens already idle in the vault first, then tokens from the wallet
 * (moved in with depositStock after `approval`). Deposits never lock themselves (issue #29).
 */
export function lockCalls(vault: Address, asset: Asset, fromIdle: bigint, fromWallet: bigint, approval: Call[]): Call[] {
  const calls: Call[] = [];
  if (fromWallet > 0n) {
    calls.push(...approval);
    calls.push({ label: `Move ${asset.name} from your wallet into your vault`, address: vault, abi: vaultAbi, functionName: "depositStock", args: [asset.token, fromWallet] });
  }
  const toLock = fromIdle + fromWallet;
  if (toLock > 0n) calls.push({ label: `Lock ${asset.name} as collateral`, address: vault, abi: vaultAbi, functionName: "addCollateral", args: [asset.token, toLock] });
  return calls;
}

/**
 * Borrow presets as a share of the liquidation limit (the loan size at which Morpho liquidates).
 * Borrowing that share leaves the loan safe until prices fall by the rest: 30% survives a 70% drop.
 * Research behind the numbers is in components/collateral-basket.tsx. The vault default cap is 50%
 * (Mid); High raises it to 65% only when the amount needs it.
 */
export const LEVELS = [
  { key: "low", label: "Low risk", pct: 30n, tone: "text-grow" },
  { key: "mid", label: "Mid risk", pct: 50n, tone: "text-warn" },
  { key: "high", label: "High risk", pct: 65n, tone: "text-danger" },
] as const;
export type Level = (typeof LEVELS)[number]["key"];
export const HIGH_CAP_BPS = 6500n;

export const raiseCapCall = (vault: Address): Call => ({
  label: "Raise your vault's safety cap to 65%",
  address: vault,
  abi: vaultAbi,
  functionName: "setBorrowCapBps",
  args: [Number(HIGH_CAP_BPS)],
});

/** One borrow call per market with an amount. The USDC always goes to `to`, the connected wallet. */
export function borrowCalls(vault: Address, parts: { asset: Asset; usdc: bigint }[], to: Address, raiseCap: boolean): Call[] {
  const calls: Call[] = parts
    .filter((p) => p.usdc > 0n)
    .map((p) => ({ label: `Borrow $${fmtUsdc(p.usdc)} against your ${p.asset.name}`, address: vault, abi: vaultAbi, functionName: "borrow", args: [p.asset.token, 0n, p.usdc, to] }));
  // Owner-only setting of the person's own vault, within the contract's 85% maximum.
  if (raiseCap) calls.unshift(raiseCapCall(vault));
  return calls;
}

/**
 * USDC to approve for a repayment. Repaying all covers each loan plus its Stackday fee (paid first),
 * with room for interest that builds up until the transaction lands.
 */
export const repayApprovalAmount = (total: bigint, all: boolean) => (all ? total + total / 100n + 1000n : total);

/** One repay call per market with an amount; `all` sends the maximum so the contract closes the loan exactly. */
export function repayCalls(vault: Address, parts: { asset: Asset; usdc: bigint }[], all: boolean): Call[] {
  return parts
    .filter((p) => p.usdc > 0n)
    .map((p) => ({ label: `Repay the ${p.asset.name} part`, address: vault, abi: vaultAbi, functionName: "repay", args: [p.asset.token, all ? MAX_UINT : p.usdc] }));
}

/** One lending market as the basket maths sees it (lib/basket.ts): locked value, limit, debt and cash. */
export function legOf(pos: Pick<Position, "asset" | "price" | "collateral" | "debt" | "liquidity">, extraValue = 0n, extraDebt = 0n): Leg {
  const value = pos.price ? assetValue(pos.collateral, pos.price, pos.asset.decimals) : 0n;
  return { value: value + extraValue, lltv: pos.asset.lltv, debt: pos.debt + extraDebt, liquidity: pos.liquidity };
}

/** An approval step only when the current allowance is too small (same rule as useTx.withApproval). */
export function approvalIfNeeded(token: Address, spender: Address, amount: bigint, allowance: bigint, label: string): Call[] {
  if (amount === 0n || allowance >= amount) return [];
  return [{ label, address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] }];
}
