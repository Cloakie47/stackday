import { mockSellDeskAbi, vaultAbi } from "../abis.ts";
import {
  HIGH_CAP_BPS,
  LEVELS,
  MAX_BUY_SLIPPAGE_BPS,
  PLAN_SLIPPAGE_BPS,
  approvalIfNeeded,
  approveMoreCall,
  borrowCalls,
  buysFor,
  cancelPlanCall,
  createVaultCall,
  investCall,
  legOf,
  lockCalls,
  minOutAfterSlippage,
  repayApprovalAmount,
  repayCalls,
  setPlanCall,
  withdrawCall,
} from "../actions.ts";
import { splitRepay } from "../basket.ts";
import { vaultBatch } from "../batch.ts";
import { BRAND } from "../brand.ts";
import { ADDR, ASSETS, BORROW_FEE_BPS, SIP_FEE_BPS, type Address, type Asset } from "../contracts.ts";
import { assetForUsdc, assetValue, fmtAsset, fmtHealth, fmtPct, fmtPrice, fmtUsdc, parseAmount, parseUsdc, WAD } from "../format.ts";
import { DEFAULT_SLOT, nextSlot, slotLabel } from "../slots.ts";
import type { Position } from "../usePortfolio.ts";
import type { Call } from "../useTx.ts";
import { CARD_CAP_UNITS, type Intent } from "./intent.ts";

/**
 * Turns a validated intent into the exact calls the Invest and Borrow pages make (shared helpers in
 * lib/actions.ts), plus the card that shows them. Pure: every input is passed in, nothing is read here.
 *
 * - The card rows and the calls come from the same numbers in one function, so they cannot disagree.
 * - The receiver is always `ctx.me`, the connected wallet. No intent carries an address.
 * - minOut comes from the on-chain oracle quote and the slippage setting, never from the model.
 * - Each asset's own decimals are used everywhere; nothing assumes 8.
 * - checkCalls() refuses any call to, or address argument for, anything outside the allowlist.
 */

export const CARD_TTL_SEC = 120;
export const CARD_CAP_LABEL = `${fmtUsdc(CARD_CAP_UNITS, 0)} test USDC`;

export type PositionLike = Pick<Position, "asset" | "price" | "idle" | "wallet" | "collateral" | "debt" | "fee" | "liquidity" | "transfersPaused" | "recurring">;

export type BuildContext = {
  /** The connected wallet. The only receiver any call may name. */
  me: Address;
  vault?: Address;
  /** The vault's address before it exists (factory.predictVault). */
  predictedVault?: Address;
  positions: PositionLike[];
  borrowCapBps: bigint;
  walletUsdc: bigint;
  /** USDC the person allowed the SipRouter to take. */
  routerAllowance: bigint;
  /** USDC the person allowed their vault to take (repayments). */
  vaultUsdcAllowance: bigint;
  /** Allowances of the intent's asset: to the vault (lock from wallet) and to the sell desk. */
  assetAllowance: { toVault: bigint; toDesk: bigint };
  /** On-chain reads: SipRouter.quoteAtOracle for a buy, the sell desk's spread and USDC reserve for a sell. */
  quotes: { oracleOut?: bigint; deskSpreadBps?: bigint; deskReserve?: bigint };
  nowSec: number;
};

export type Row = { label: string; value: string };

export type Plan = {
  ok: true;
  action: Intent["action"];
  title: string;
  rows: Row[];
  /** Stackday fee line, always shown. */
  fee: string;
  /** Where the money ends up: always the connected wallet (or its own vault). */
  receiver: Address;
  receiverLabel: string;
  notes: string[];
  calls: Call[];
  /** USDC moved or valued by this card, checked against the cap. */
  usdcValue: bigint;
  doneMessage: string;
  expiresAt: number;
  /** After a recurring plan is saved, let the trigger bot know (as the Invest page does). */
  registerKeeper?: Address;
  /** Set when the action cannot be signed from chat yet; the card shows this instead of a button. */
  handoff?: string;
  /** Page that can finish a handed-off action. */
  link?: { href: string; label: string };
  /**
   * On a sell: the most the person could borrow against the same asset instead (`usdc`, the "you could
   * borrow against it instead" note), and `offer`, the largest amount a Mid risk borrow card accepts
   * right now (0 if none). Only used for the "Borrow instead" option chip.
   */
  borrowInstead?: { asset: string; usdc: bigint; offer: bigint };
  /** On a gift: the recipient's Stackday ID or username as asked, so the card can show their name. */
  giftRecipient?: string;
};
export type Refusal = { ok: false; reason: string };
export type BuildResult = Plan | Refusal;

const refuse = (reason: string): Refusal => ({ ok: false, reason });
const usd = (v: bigint) => `${fmtUsdc(v)} USDC`;
const amt = (v: bigint, a: Asset) => `${fmtAsset(v, a.decimals)} ${a.symbol}`;
/** Dollars for a USDC amount (6 decimals), for plain-language card lines, for example "$5.00". */
const dollars = (v: bigint) => "$" + fmtUsdc(v);
/** Price of one whole token in USDC units, from a USDC amount and the tokens it buys or sells for. */
const perToken = (usdcUnits: bigint, tokenUnits: bigint, a: Asset) => (tokenUnits > 0n ? (usdcUnits * 10n ** BigInt(a.decimals)) / tokenUnits : 0n);
const RISK_LABEL = { low: "Low", mid: "Mid", high: "High" } as const;

export const assetBySymbol = (symbol: string) => ASSETS.find((a) => a.symbol === symbol);

/** Health (WAD) a level keeps: borrowing pct% of the liquidation limit leaves health 100 / pct. */
export const minHealthFor = (risk: keyof typeof RISK_LABEL) => (100n * WAD) / LEVELS.find((l) => l.key === risk)!.pct;

/** Assets free to sell or withdraw from the vault: idle, plus locked only when there is no loan on it. */
const freeInVault = (p: PositionLike) => (p.debt > 0n ? p.idle : p.idle + p.collateral);

function resolveAmount(params: { amount: string; unit: "percent" | "tokens" | "usdc" }, pos: PositionLike): bigint | string {
  const a = pos.asset;
  const free = freeInVault(pos);
  let out: bigint;
  if (params.unit === "percent") {
    const bps = parseAmount(params.amount, 2); // "50" -> 5000, "12.5" -> 1250
    if (bps <= 0n || bps > 10_000n) return "The percent must be between 0 and 100.";
    out = (free * bps) / 10_000n;
  } else if (params.unit === "tokens") {
    out = parseAmount(params.amount, a.decimals);
  } else {
    if (!pos.price) return `There is no price for ${a.name} right now.`;
    const want = parseUsdc(params.amount);
    out = assetForUsdc(want, pos.price, a.decimals);
    if (assetValue(out, pos.price, a.decimals) < want) out += 1n;
  }
  if (out <= 0n) return `You have no free ${a.name} in your vault.`;
  if (out > free) {
    return pos.debt > 0n && pos.collateral > 0n
      ? `Only ${amt(free, a)} is free. The rest is locked for your loan: repay first to take it out.`
      : `You have ${amt(free, a)} in your vault.`;
  }
  return out;
}

/** Every address a chat card may call, and every address argument it may contain besides the wallet. */
function allowlist(ctx: BuildContext) {
  const contracts = new Set([ADDR.usdc, ADDR.router, ADDR.factory, ADDR.sellDesk, ...ASSETS.map((a) => a.token)].map((x) => x.toLowerCase()));
  if (ctx.vault) contracts.add(ctx.vault.toLowerCase());
  if (ctx.predictedVault) contracts.add(ctx.predictedVault.toLowerCase());
  return contracts;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Last check before a card is shown: each call goes to an allowlisted contract, and every address in
 * its arguments is an allowlisted contract or the connected wallet. Returns the first problem found.
 */
export function checkCalls(calls: Call[], ctx: BuildContext): string | null {
  const ok = allowlist(ctx);
  const me = ctx.me.toLowerCase();
  const walk = (v: unknown): string | null => {
    if (typeof v === "string" && ADDRESS_RE.test(v)) return ok.has(v.toLowerCase()) || v.toLowerCase() === me ? null : v;
    if (Array.isArray(v)) {
      for (const x of v) {
        const bad = walk(x);
        if (bad) return bad;
      }
    }
    return null;
  };
  for (const c of calls) {
    if (!ok.has(c.address.toLowerCase())) return `call to an address outside the allowlist (${c.label})`;
    const bad = walk(c.args ?? []);
    if (bad) return `an address outside the allowlist in "${c.label}"`;
  }
  return null;
}

function finish(plan: Omit<Plan, "ok" | "expiresAt" | "receiver">, ctx: BuildContext): BuildResult {
  if (plan.usdcValue > CARD_CAP_UNITS) return refuse(`A chat card can move at most ${CARD_CAP_LABEL}. Use a smaller amount, or the page itself.`);
  const problem = checkCalls(plan.calls, ctx);
  if (problem) return refuse(`Stopped for safety: ${problem}.`);
  return { ok: true, receiver: ctx.me, expiresAt: ctx.nowSec + CARD_TTL_SEC, ...plan };
}

function buy(params: { asset: string; usdc: string }, ctx: BuildContext): BuildResult {
  const a = assetBySymbol(params.asset);
  if (!a) return refuse("That asset is not available.");
  const usdc = parseUsdc(params.usdc);
  if (usdc <= 0n) return refuse("Enter an amount above zero.");
  if (usdc > ctx.walletUsdc) return refuse(`Your wallet has ${usd(ctx.walletUsdc)}, less than ${usd(usdc)}.`);
  const quote = ctx.quotes.oracleOut;
  if (!quote || quote <= 0n) return refuse(`There is no oracle price for ${a.name} right now. Try again later.`);
  const minOut = minOutAfterSlippage(quote, MAX_BUY_SLIPPAGE_BPS);
  const calls = [...approvalIfNeeded(ADDR.usdc, ADDR.router, usdc, ctx.routerAllowance, `Allow ${BRAND.name} to take the USDC`), investCall(a, usdc, minOut)];
  return finish(
    {
      action: "buy",
      title: `Buy ${a.name}`,
      rows: [
        { label: "You buy", value: `${dollars(usdc)} of ${a.name} at ${dollars(perToken(usdc, quote, a))} each` },
        { label: "You get about", value: amt(quote, a) },
        { label: "At least", value: `${amt(minOut, a)} (${fmtPct(MAX_BUY_SLIPPAGE_BPS)} slippage floor)` },
        { label: "Paid from", value: `${usd(usdc)} in your wallet` },
      ],
      fee: "None: one-time buys are free.",
      receiverLabel: "Goes into your own vault, controlled only by your wallet",
      notes: ["Bought assets land in your vault as free, not locked."],
      calls,
      usdcValue: usdc,
      doneMessage: `Bought. The ${a.name} is in your vault.`,
    },
    ctx,
  );
}

const INTERVAL_DAYS = { weekly: 7, every_2_weeks: 14, every_4_weeks: 28 } as const;
const INTERVAL_LABEL = { weekly: "every week", every_2_weeks: "every 2 weeks", every_4_weeks: "every 4 weeks" } as const;

function recurring(params: { asset: string; usdc: string; every: keyof typeof INTERVAL_DAYS; weeks: number }, ctx: BuildContext): BuildResult {
  const a = assetBySymbol(params.asset);
  if (!a) return refuse("That asset is not available.");
  const perBuy = parseUsdc(params.usdc);
  if (perBuy <= 0n) return refuse("Enter an amount above zero.");
  const days = INTERVAL_DAYS[params.every];
  const count = buysFor(params.weeks, days);
  if (count <= 0) return refuse("Choose how many weeks the plan runs.");
  const total = perBuy * BigInt(count);
  if (total > CARD_CAP_UNITS)
    return refuse(`That plan is ${usd(total)} in total (${count} buys). A chat card can set up at most ${CARD_CAP_LABEL}: use fewer weeks, a smaller amount, or the Invest page.`);
  const feePerBuy = (perBuy * SIP_FEE_BPS) / 10_000n;
  const first = nextSlot(DEFAULT_SLOT.day, DEFAULT_SLOT.time, ctx.nowSec);
  const pos = ctx.positions.find((p) => p.asset.symbol === a.symbol);
  const calls = [approveMoreCall(ctx.routerAllowance, total, `Allow ${count} recurring buys`), setPlanCall(a, perBuy, days * 86400, PLAN_SLIPPAGE_BPS, first)];
  return finish(
    {
      action: "recurring_buy",
      title: `Recurring buy: ${a.name}`,
      rows: [
        { label: "Each buy", value: `${usd(perBuy)} from your wallet, ${INTERVAL_LABEL[params.every]}` },
        { label: "Buys", value: `${count}, ${usd(total)} in total, then it stops` },
        { label: "First buy", value: `${slotLabel(DEFAULT_SLOT.day, DEFAULT_SLOT.time)} New York time` },
        { label: "Slippage limit", value: fmtPct(PLAN_SLIPPAGE_BPS) },
      ],
      fee: `${fmtPct(SIP_FEE_BPS)} on each buy: ${usd(feePerBuy)} per buy, ${usd(feePerBuy * BigInt(count))} in total.`,
      receiverLabel: "Each buy goes into your own vault, controlled only by your wallet",
      notes: [
        ...(pos?.recurring ? [`This replaces your current ${a.name} plan.`] : []),
        "The approval covers exactly these buys. You can cancel any time.",
      ],
      calls,
      usdcValue: total,
      doneMessage: "Recurring plan saved.",
      registerKeeper: a.token,
    },
    ctx,
  );
}

function cancel(params: { asset: string }, ctx: BuildContext): BuildResult {
  const a = assetBySymbol(params.asset);
  if (!a) return refuse("That asset is not available.");
  const pos = ctx.positions.find((p) => p.asset.symbol === a.symbol);
  if (!pos?.recurring) return refuse(`You have no recurring plan for ${a.name}.`);
  return finish(
    {
      action: "cancel_plan",
      title: `Stop the ${a.name} plan`,
      rows: [{ label: "Plan", value: `${usd(pos.recurring.usdcPerBuy)} per buy into ${a.name}` }],
      fee: "None.",
      receiverLabel: "Nothing is sent anywhere",
      notes: ["No more buys run for this plan. What you already bought stays in your vault."],
      calls: [cancelPlanCall(a)],
      usdcValue: 0n,
      doneMessage: "Recurring plan cancelled.",
    },
    ctx,
  );
}

/** "You could borrow against it instead": the most the person could borrow against this asset at their vault cap. */
function borrowInstead(pos: PositionLike, cap: bigint): bigint {
  if (!pos.asset.borrowable || !pos.price) return 0n;
  const value = assetValue(pos.idle + pos.collateral, pos.price, pos.asset.decimals);
  const limit = (((value * pos.asset.lltv) / WAD) * cap) / 10_000n;
  return limit > pos.debt ? limit - pos.debt : 0n;
}

/** A USDC amount (6 decimals) floored to cents, as the plain decimal text an intent carries: 3.5 -> "3.50". */
export function usdcText(units: bigint): string {
  const c = units / 10_000n;
  return `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;
}

/**
 * For the "Borrow instead" chip on a sell card: the largest amount, to the cent and at most one card,
 * that a Mid risk borrow card against this asset accepts right now (the same borrow() below decides,
 * with its 1% buffer, the vault cap and what the market can lend). 0 when none does.
 */
function midRiskOffer(pos: PositionLike, ctx: BuildContext): bigint {
  const a = pos.asset;
  if (!a.borrowable || !pos.price) return 0n;
  const midBps = LEVELS.find((l) => l.key === "mid")!.pct * 100n;
  const limitBps = midBps < ctx.borrowCapBps ? midBps : ctx.borrowCapBps;
  const held = pos.collateral + (pos.transfersPaused ? 0n : pos.idle + pos.wallet);
  const maxDebt = (((assetValue(held, pos.price, a.decimals) * a.lltv) / WAD) * limitBps) / 10_000n;
  const room = (maxDebt * 100n) / 101n;
  let usdc = room > pos.debt ? room - pos.debt : 0n;
  if (usdc > CARD_CAP_UNITS) usdc = CARD_CAP_UNITS;
  if (pos.liquidity !== undefined && usdc > pos.liquidity) usdc = pos.liquidity;
  usdc = (usdc / 10_000n) * 10_000n;
  // Rounding of the collateral can make the estimate a hair too high: step down until borrow() accepts it.
  for (let i = 0; i < 8 && usdc >= 10_000n; i++) {
    if (borrow({ asset: a.symbol, usdc: usdcText(usdc), risk: "mid" }, ctx).ok) return usdc;
    usdc = ((usdc * 98n) / 100n / 10_000n) * 10_000n;
  }
  return 0n;
}

function withdrawOrSell(kind: "sell" | "withdraw", params: { asset: string; amount: string; unit: "percent" | "tokens" | "usdc" }, ctx: BuildContext): BuildResult {
  const a = assetBySymbol(params.asset);
  if (!a) return refuse("That asset is not available.");
  if (!ctx.vault) return refuse("You have no vault yet, so there is nothing to take out.");
  const pos = ctx.positions.find((p) => p.asset.symbol === a.symbol);
  if (!pos) return refuse("That asset is not available.");
  if (pos.transfersPaused) return refuse(`Transfers of ${a.name} are paused right now.`);
  if (!pos.price) return refuse(`There is no price for ${a.name} right now.`);
  const amount = resolveAmount(params, pos);
  if (typeof amount === "string") return refuse(amount);
  const value = assetValue(amount, pos.price, a.decimals);
  const out = withdrawCall(ctx.vault, a, amount, ctx.me);

  if (kind === "withdraw") {
    return finish(
      {
        action: "withdraw",
        title: `Withdraw ${a.name}`,
        rows: [
          { label: "Take out", value: amt(amount, a) },
          { label: "Worth about", value: `${usd(value)} at the test price` },
        ],
        fee: "None.",
        receiverLabel: "Goes to your wallet",
        notes: [],
        calls: [out],
        usdcValue: value,
        doneMessage: `${a.name} sent to your wallet.`,
      },
      ctx,
    );
  }

  const spread = ctx.quotes.deskSpreadBps;
  const reserve = ctx.quotes.deskReserve;
  if (spread === undefined || reserve === undefined) return refuse("Could not read the sell desk right now. Try again.");
  // Same maths as MockSellDesk.quote: the oracle value less the desk's fixed spread.
  const expected = (value * (10_000n - spread)) / 10_000n;
  const minUsdcOut = (value * (10_000n - spread - MAX_BUY_SLIPPAGE_BPS)) / 10_000n;
  if (expected <= 0n) return refuse("That amount is too small to sell.");
  if (expected > reserve) return refuse(`The testnet sell desk holds only ${usd(reserve)} right now. Try a smaller amount.`);
  const calls: Call[] = [
    out,
    ...approvalIfNeeded(a.token, ADDR.sellDesk, amount, ctx.assetAllowance.toDesk, `Allow the sell desk to take your ${a.name}`),
    { label: `Sell ${a.name} for USDC to your wallet`, address: ADDR.sellDesk, abi: mockSellDeskAbi, functionName: "swapExactStockForUsdc", args: [a.token, amount, minUsdcOut, ctx.me] },
  ];
  const instead = borrowInstead(pos, ctx.borrowCapBps);
  return finish(
    {
      action: "sell",
      title: `Sell ${a.name}`,
      rows: [
        { label: "You sell", value: `${amt(amount, a)} (${a.name}) at ${dollars(perToken(value, amount, a))} each` },
        { label: "You get about", value: `${dollars(expected)} (${usd(expected)} to your wallet)` },
        { label: "At least", value: `${usd(minUsdcOut)} (${fmtPct(MAX_BUY_SLIPPAGE_BPS)} slippage floor)` },
      ],
      fee: `No ${BRAND.name} fee. The mock sell desk pays the test price less ${fmtPct(spread)}.`,
      receiverLabel: "USDC goes to your wallet",
      notes: [
        ...(instead > 0n ? [`You could borrow against it instead: up to ${usd(instead)} against your ${a.name} at your vault's safety cap, and keep the position.`] : []),
        "Testnet: a MOCK sell desk stands in for a real exchange route.",
      ],
      calls,
      usdcValue: value,
      doneMessage: `Sold. The USDC is in your wallet.`,
      ...(instead > 0n ? { borrowInstead: { asset: a.symbol, usdc: instead, offer: midRiskOffer(pos, ctx) } } : {}),
    },
    ctx,
  );
}

function borrow(params: { asset: string; usdc: string; risk: "low" | "mid" | "high" }, ctx: BuildContext): BuildResult {
  const a = assetBySymbol(params.asset);
  if (!a) return refuse("That asset is not available.");
  if (!a.borrowable) return refuse(`${a.name} is invest only: there is no lending market to borrow against it.`);
  const vault = ctx.vault ?? ctx.predictedVault;
  if (!vault) return refuse("Could not find your vault address. Try again.");
  const pos = ctx.positions.find((p) => p.asset.symbol === a.symbol);
  if (!pos?.price) return refuse(`There is no price for ${a.name} right now.`);
  const usdc = parseUsdc(params.usdc);
  if (usdc <= 0n) return refuse("Enter an amount above zero.");
  if (pos.liquidity !== undefined && usdc > pos.liquidity) return refuse(`The ${a.name} market can lend only ${usd(pos.liquidity)} right now.`);

  const level = LEVELS.find((l) => l.key === params.risk)!;
  const levelBps = level.pct * 100n;
  const debtAfter = pos.debt + usdc;
  // Collateral needed so the loan stays inside `limitBps` of the liquidation limit, rounded up, with a
  // 1% buffer: interest keeps building on an open loan until the transaction lands.
  const target = debtAfter + debtAfter / 100n;
  const collateralFor = (limitBps: bigint) => {
    const value = (target * 10_000n * WAD + limitBps * a.lltv - 1n) / (limitBps * a.lltv);
    let tokens = assetForUsdc(value, pos.price!, a.decimals);
    while (assetValue(tokens, pos.price!, a.decimals) < value) tokens += 1n;
    return tokens;
  };
  // The vault's own cap is the person's earlier choice; High raises it to 65% only when needed (as on the Borrow page).
  let raiseCap = false;
  let limitBps = levelBps < ctx.borrowCapBps ? levelBps : ctx.borrowCapBps;
  if (params.risk === "high" && ctx.borrowCapBps < HIGH_CAP_BPS && collateralFor(limitBps) > pos.collateral) {
    raiseCap = true;
    limitBps = HIGH_CAP_BPS;
  }
  const needed = collateralFor(limitBps);
  const extra = needed > pos.collateral ? needed - pos.collateral : 0n;
  const free = pos.transfersPaused ? 0n : pos.idle + pos.wallet;
  if (extra > free)
    return refuse(
      `At ${RISK_LABEL[params.risk]} risk, borrowing ${usd(usdc)} needs ${amt(needed, a)} locked; you have ${amt(pos.collateral, a)} locked and ${amt(free, a)} free. Borrow less or add more ${a.name}.`,
    );
  const collateralAfter = pos.collateral + extra;
  const maxDebtAfter = (assetValue(collateralAfter, pos.price, a.decimals) * a.lltv) / WAD;
  const healthAfter = (maxDebtAfter * WAD) / debtAfter;
  // Refuse, not warn, below the chosen level (guardrail 5).
  if (healthAfter < minHealthFor(params.risk)) return refuse(`That would leave health at ${fmtHealth(healthAfter)}, below your ${RISK_LABEL[params.risk]} risk level.`);
  const liquidationPrice = (pos.price * debtAfter) / maxDebtAfter;
  const dropPct = 100n - (liquidationPrice * 100n) / pos.price;

  const fromIdle = extra < pos.idle ? extra : pos.idle;
  const fromWallet = extra - fromIdle;
  const steps: Call[] = [];
  if (!ctx.vault) steps.push(createVaultCall(ctx.me));
  if (extra > 0n) steps.push(...lockCalls(vault, a, fromIdle, fromWallet, approvalIfNeeded(a.token, vault, fromWallet, ctx.assetAllowance.toVault, `Allow your vault to take your ${a.name}`)));
  steps.push(...borrowCalls(vault, [{ asset: a, usdc }], ctx.me, raiseCap));
  const problem = checkCalls(steps, ctx);
  if (problem) return refuse(`Stopped for safety: ${problem}.`);
  return finish(
    {
      action: "borrow",
      title: `Borrow against ${a.name}`,
      rows: [
        { label: "Borrow", value: usd(usdc) },
        ...(extra > 0n ? [{ label: "Lock first", value: `${amt(extra, a)}${fromWallet > 0n ? ` (${amt(fromWallet, a)} from your wallet)` : ""}` }] : []),
        { label: "Loan after", value: usd(debtAfter) },
        { label: "Health after", value: `${fmtHealth(healthAfter)} (${RISK_LABEL[params.risk]} risk keeps it at ${fmtHealth(minHealthFor(params.risk))} or more)` },
        { label: "Liquidation price", value: `$${fmtPrice(liquidationPrice)} per ${a.symbol} (now $${fmtPrice(pos.price)}, a ${dropPct}% fall)` },
        ...(raiseCap ? [{ label: "Vault safety cap", value: "Raised to 65% (your High risk choice)" }] : []),
      ],
      fee: `${fmtPct(BORROW_FEE_BPS)} a year on the loan, paid when you repay. You receive the full amount. The lending market also charges variable interest.`,
      receiverLabel: "USDC goes to your wallet",
      notes: ["If prices fall far enough, part of the collateral can be sold to repay the loan. Not investment advice."],
      calls: vaultBatch(vault, steps, `Borrow ${usd(usdc)} against your ${a.name}`),
      usdcValue: usdc,
      doneMessage: "Borrowed. The USDC is in your wallet.",
    },
    ctx,
  );
}

function repay(params: { asset: string; usdc: string; all: boolean }, ctx: BuildContext): BuildResult {
  if (!ctx.vault) return refuse("You have no loan to repay.");
  const loans = ctx.positions.filter((p) => p.asset.borrowable && p.debt > 0n);
  const scope = params.asset === "every_loan" ? loans : loans.filter((p) => p.asset.symbol === params.asset);
  if (!scope.length) return refuse(params.asset === "every_loan" ? "You have no loan to repay." : `You have no loan against ${assetBySymbol(params.asset)?.name ?? params.asset}.`);
  const owed = scope.reduce((s, p) => s + p.debt + p.fee, 0n);
  const wanted = params.all ? owed : parseUsdc(params.usdc);
  if (wanted <= 0n) return refuse("Enter an amount above zero.");
  const all = params.all || wanted >= owed;
  let parts: { asset: Asset; usdc: bigint }[];
  if (all) parts = scope.map((p) => ({ asset: p.asset, usdc: p.debt + p.fee }));
  else if (scope.length === 1) parts = [{ asset: scope[0].asset, usdc: wanted }];
  else {
    const borrowable = ctx.positions.filter((p) => p.asset.borrowable);
    const split = splitRepay(wanted, borrowable.map((p) => legOf(p)), ctx.borrowCapBps);
    parts = borrowable.map((p, i) => ({ asset: p.asset, usdc: split[i] }));
  }
  const total = parts.reduce((s, p) => s + p.usdc, 0n);
  if (total > ctx.walletUsdc) return refuse(`Your wallet has ${usd(ctx.walletUsdc)}; this repayment needs ${usd(total)}.`);
  const approve = repayApprovalAmount(total, all);
  const steps = [...approvalIfNeeded(ADDR.usdc, ctx.vault, approve, ctx.vaultUsdcAllowance, "Allow your vault to take the USDC"), ...repayCalls(ctx.vault, parts, all)];
  const problem = checkCalls(steps, ctx);
  if (problem) return refuse(`Stopped for safety: ${problem}.`);
  const fees = scope.reduce((s, p) => s + p.fee, 0n);
  return finish(
    {
      action: "repay",
      title: all ? "Repay in full" : "Repay part of your loan",
      rows: [
        { label: "You pay", value: `${all ? "about " : ""}${usd(total)} from your wallet` },
        { label: "Owed now", value: usd(owed) },
        { label: `${BRAND.name} fee owed`, value: `${usd(fees)} (paid first)` },
        { label: "Owed after", value: all ? "0 USDC" : usd(owed > total ? owed - total : 0n) },
      ],
      fee: `${fmtPct(BORROW_FEE_BPS)} a year on the loan, built up so far and paid first. Included above.`,
      receiverLabel: "Paid from your wallet into your own vault's loan",
      notes: all ? ["Repaying all also covers interest that builds up until the transaction lands."] : [],
      calls: vaultBatch(ctx.vault, steps, all ? "Repay every loan" : "Repay your loans"),
      usdcValue: total,
      doneMessage: all ? "Loan fully repaid." : "Repayment made.",
    },
    ctx,
  );
}

function gift(params: { recipient_id: string; usdc: string; box: string }, ctx: BuildContext): BuildResult {
  return finish(
    {
      action: "gift",
      title: "Send a gift box",
      rows: [
        { label: "To", value: params.recipient_id },
        { label: "Amount", value: usd(parseUsdc(params.usdc)) },
        { label: "Box", value: params.box.replace(/_/g, " ") },
      ],
      fee: "None: gifts have no fee.",
      receiverLabel: "The recipient's own vault, found by their Stackday ID",
      notes: [],
      calls: [],
      usdcValue: parseUsdc(params.usdc),
      doneMessage: "",
      handoff: "Open the Gifts page to send. Sending a gift from chat is not connected yet.",
      giftRecipient: params.recipient_id,
      // Amount and box only: the recipient's ID is not put in the address bar.
      link: { href: `/gifts?usdc=${encodeURIComponent(params.usdc)}&box=${encodeURIComponent(params.box)}`, label: "Open the Gifts page" },
    },
    ctx,
  );
}

/**
 * Lock free assets in the vault as collateral, or unlock locked ones back to free. One vault call,
 * one signature. Only borrowable assets. An unlock that would leave a loan above the vault's own
 * safety cap is refused (the vault would refuse it too).
 */
function lockOrUnlock(kind: "lock" | "unlock", params: { asset: string; amount: string; unit: "percent" | "tokens" | "usdc" }, ctx: BuildContext): BuildResult {
  const a = assetBySymbol(params.asset);
  if (!a) return refuse("That asset is not available.");
  if (!a.borrowable) return refuse(`${a.name} is invest only: it cannot be locked as collateral.`);
  if (!ctx.vault) return refuse("You have no vault yet. Buy something first, then lock it.");
  const pos = ctx.positions.find((p) => p.asset.symbol === a.symbol);
  if (!pos?.price) return refuse(`There is no price for ${a.name} right now.`);
  const base = kind === "lock" ? pos.idle : pos.collateral;
  if (base <= 0n) return refuse(kind === "lock" ? `You have no free ${a.name} in your vault to lock.` : `You have no ${a.name} locked.`);
  let amount: bigint;
  if (params.unit === "percent") {
    const bps = parseAmount(params.amount, 2);
    if (bps <= 0n || bps > 10_000n) return refuse("The percent must be between 0 and 100.");
    amount = (base * bps) / 10_000n;
  } else if (params.unit === "tokens") {
    amount = parseAmount(params.amount, a.decimals);
  } else {
    const want = parseUsdc(params.amount);
    amount = assetForUsdc(want, pos.price, a.decimals);
    if (assetValue(amount, pos.price, a.decimals) < want) amount += 1n;
  }
  if (amount <= 0n) return refuse("Enter an amount above zero.");
  if (amount > base) return refuse(`You have ${amt(base, a)} ${kind === "lock" ? "free" : "locked"}.`);
  const value = assetValue(amount, pos.price, a.decimals);
  const collateralAfter = kind === "lock" ? pos.collateral + amount : pos.collateral - amount;
  const rows: Row[] = [
    { label: kind === "lock" ? "You lock" : "You unlock", value: `${amt(amount, a)} (${a.name}), worth about ${dollars(value)}` },
    { label: "Locked after", value: amt(collateralAfter, a) },
  ];
  if (pos.debt > 0n) {
    const maxDebtAfter = (assetValue(collateralAfter, pos.price, a.decimals) * a.lltv) / WAD;
    if (kind === "unlock" && pos.debt + pos.fee > (maxDebtAfter * ctx.borrowCapBps) / 10_000n)
      return refuse(`Unlocking that much would leave your ${a.name} loan above your vault's safety cap. Repay first, or unlock less.`);
    rows.push({ label: "Health after", value: fmtHealth((maxDebtAfter * WAD) / pos.debt) });
  }
  const call: Call = {
    label: kind === "lock" ? `Lock ${a.name} as collateral` : `Unlock ${a.name}`,
    address: ctx.vault,
    abi: vaultAbi,
    functionName: kind === "lock" ? "addCollateral" : "removeCollateral",
    args: [a.token, amount],
  };
  return finish(
    {
      action: kind,
      title: kind === "lock" ? `Lock ${a.name} as collateral` : `Unlock ${a.name}`,
      rows,
      fee: "None.",
      receiverLabel: "Stays in your own vault, controlled only by your wallet",
      notes: [
        kind === "lock"
          ? "Locked assets can back a loan. They stay yours and in your vault; unlock them any time the loan allows."
          : "Unlocked assets are free again: you can sell, withdraw or gift them.",
      ],
      calls: [call],
      usdcValue: value,
      doneMessage: kind === "lock" ? `Locked. Your ${a.name} can now back a loan.` : `Unlocked. Your ${a.name} is free again.`,
    },
    ctx,
  );
}

/** Intent to card and calls. Refuses instead of guessing. */
export function buildPlan(intent: Intent, ctx: BuildContext): BuildResult {
  switch (intent.action) {
    case "buy":
      return buy(intent.params, ctx);
    case "recurring_buy":
      return recurring(intent.params, ctx);
    case "cancel_plan":
      return cancel(intent.params, ctx);
    case "sell":
      return withdrawOrSell("sell", intent.params, ctx);
    case "withdraw":
      return withdrawOrSell("withdraw", intent.params, ctx);
    case "borrow":
      return borrow(intent.params, ctx);
    case "repay":
      return repay(intent.params, ctx);
    case "lock":
      return lockOrUnlock("lock", intent.params, ctx);
    case "unlock":
      return lockOrUnlock("unlock", intent.params, ctx);
    case "gift":
      return gift(intent.params, ctx);
  }
}
