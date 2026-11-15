import type { Plan } from "./basket.ts";
import { assetOf } from "./catalog.ts";
import { DRIFT_ABS, DRIFT_REL, MAX_LEGS } from "./policy.ts";

/**
 * Rebalance proposals with new money only. Stackday's contracts can only buy, never sell, so a
 * "rebalance" in v1 points the next money in (the next payday's investing share through
 * `Payroll.setSipPlanMany`, or the next recurring or one-time USDC buy through SipRouter) at the
 * holdings that are below target. Nothing is ever sold, and nothing moves until the owner signs.
 * Pure TypeScript, deterministic, no network. Policy: docs/themes/policy.md ("Drift bands and
 * rebalancing", "Stackday constraints").
 */

/** The key used for the USDC cushion in drift rows and allocations. */
export const CASH_TICKER = "USDC";

export type DriftRow = {
  ticker: string;
  name: string;
  /** "holding": in the plan. "cash": the USDC cushion. "outside": owned but not in the plan (target 0). */
  kind: "holding" | "cash" | "outside";
  valueUsd: number;
  /** Share of the whole portfolio the plan wants, 0 to 1. */
  targetShare: number;
  /** Share of the whole portfolio it is now, 0 to 1. */
  currentShare: number;
  /** current minus target, in percentage points (negative means under target). */
  diffPts: number;
  /** The 5/25 rule: off by more than 5 points, or by more than 25 percent of its target. */
  outOfBand: boolean;
};

export type ProposalBuy = { ticker: string; usd: number; reason: string };

export type Proposal = {
  /** Assets to buy with the new money, largest first. At most `maxLegs`. */
  buys: ProposalBuy[];
  /** Part of the new money that stays as USDC: the cushion share, small buys and legs that did not fit. */
  cashUsd: number;
  /** The new money this proposal places (buys plus cash). */
  newMoneyUsd: number;
  /** Drift now. */
  before: DriftRow[];
  /** Drift after the proposed buys, at today's prices. */
  after: DriftRow[];
  /** Plain-language explanation, one line each. */
  why: string[];
};

export type ProposeInput = {
  plan: Plan;
  /** USD value of each asset the person holds now, by ticker. */
  holdingsUsd: Record<string, number>;
  /** USDC the person holds now (the cushion). */
  cashUsd: number;
  /** Money coming in: the payday investing share, or the next recurring or one-time buy. */
  newMoneyUsd: number;
  /** Most assets in one proposal. Payroll plans hold at most 6. */
  maxLegs?: number;
  /** Buys below this stay as USDC (policy: skip any trade below $5). */
  minTradeUsd?: number;
};

const EPS = 1e-9;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const usd = (x: number) => `$${x.toFixed(2)}`;
const pts = (x: number) => Math.abs(x).toFixed(1);
const floorCents = (x: number) => Math.floor(x * 100 + 1e-6) / 100;
const roundCents = (x: number) => Math.round(x * 100) / 100;

function checkAmount(label: string, x: number) {
  if (!Number.isFinite(x) || x < 0) throw new Error(`${label} must be a number of 0 or more`);
}

/** Holdings and cash, validated, with any "USDC" entry in holdings folded into cash. */
function normalize(holdingsUsd: Record<string, number>, cashUsd: number) {
  checkAmount("cash", cashUsd);
  const holdings: Record<string, number> = {};
  let cash = cashUsd;
  for (const [t, v] of Object.entries(holdingsUsd)) {
    checkAmount(`${t} value`, v);
    if (t === CASH_TICKER) cash += v;
    else holdings[t] = v;
  }
  return { holdings, cash };
}

/** Target shares from the plan, scaled so they add up to exactly 1. */
function targetsOf(plan: Plan) {
  const total = plan.holdings.reduce((s, h) => s + h.bps, 0) + plan.usdcBps;
  if (total <= 0) return { holdings: plan.holdings.map((h) => ({ h, share: 0 })), cash: 1 };
  return { holdings: plan.holdings.map((h) => ({ h, share: h.bps / total })), cash: plan.usdcBps / total };
}

function isOutOfBand(target: number, current: number) {
  const off = Math.abs(current - target);
  if (off > DRIFT_ABS + EPS) return true;
  // Outside the plan the target is 0, and 25 percent of 0 would flag any stray dollar forever
  // (new money can dilute it but never sell it), so only the 5-point band applies there.
  return target > 0 && off > DRIFT_REL * target + EPS;
}

/**
 * How far each holding, the USDC cushion and anything owned outside the plan is from target.
 * Rows: plan holdings in plan order, then holdings outside the plan (largest first), then the cushion.
 */
export function drift(plan: Plan, holdingsUsd: Record<string, number>, cashUsd: number): DriftRow[] {
  const { holdings, cash } = normalize(holdingsUsd, cashUsd);
  const total = Object.values(holdings).reduce((s, v) => s + v, 0) + cash;
  const share = (v: number) => (total > 0 ? v / total : 0);
  const row = (ticker: string, name: string, kind: DriftRow["kind"], valueUsd: number, targetShare: number): DriftRow => {
    const currentShare = share(valueUsd);
    return {
      ticker,
      name,
      kind,
      valueUsd,
      targetShare,
      currentShare,
      diffPts: (currentShare - targetShare) * 100,
      outOfBand: isOutOfBand(targetShare, currentShare),
    };
  };
  const targets = targetsOf(plan);
  const inPlan = new Set(plan.holdings.map((h) => h.ticker));
  const rows = targets.holdings.map(({ h, share: s }) => row(h.ticker, h.name, "holding", holdings[h.ticker] ?? 0, s));
  const outside = Object.entries(holdings)
    .filter(([t, v]) => !inPlan.has(t) && v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, v]) => row(t, assetOf(t)?.name ?? t, "outside", v, 0));
  rows.push(...outside);
  rows.push(row(CASH_TICKER, "USDC cushion", "cash", cash, targets.cash));
  return rows;
}

/** True when any row is out of band. (The app also shows a weekly proposal when this is false.) */
export function needsProposal(rows: DriftRow[]): boolean {
  return rows.some((r) => r.outOfBand);
}

export type GapEntry = {
  key: string;
  /** How much it can take before reaching target, in USD (0 or more). */
  gap: number;
  /** Plan weight, used only for money left after every gap is closed. */
  weight: number;
  /** Above target: never gets money. */
  overweight: boolean;
};

/**
 * The allocation rule on its own. Each entry gets up to its gap; when the money is short, every
 * gap gets the same fraction. Money left after all gaps are closed follows the plan weights of
 * entries that are not overweight; if none can take it, it is returned as `unplaced`.
 *
 * Note: when targets are measured against (portfolio + new money) and add up to 1, the gaps
 * always add up to at least the new money, so the overflow step is a safety net there.
 */
export function allocateToGaps(entries: GapEntry[], money: number): { amounts: Record<string, number>; unplaced: number } {
  checkAmount("money", money);
  const amounts: Record<string, number> = {};
  for (const e of entries) amounts[e.key] = 0;
  const open = entries.filter((e) => !e.overweight && e.gap > EPS);
  const totalGap = open.reduce((s, e) => s + e.gap, 0);
  if (money <= totalGap + EPS) {
    if (totalGap > EPS) for (const e of open) amounts[e.key] = (money * e.gap) / totalGap;
    return { amounts, unplaced: totalGap > EPS ? 0 : money };
  }
  for (const e of open) amounts[e.key] = e.gap;
  const left = money - totalGap;
  const takers = entries.filter((e) => !e.overweight && e.weight > 0);
  const weights = takers.reduce((s, e) => s + e.weight, 0);
  if (weights <= EPS) return { amounts, unplaced: left };
  for (const e of takers) amounts[e.key] += (left * e.weight) / weights;
  return { amounts, unplaced: 0 };
}

/**
 * Where the next money in should go to bring the portfolio back toward the plan, without selling.
 * Target value of each holding = target share x (portfolio now + new money). Underweight holdings
 * get up to their gap (in proportion to the gap when money is short); overweight ones get nothing;
 * the cushion share stays as USDC; buys under `minTradeUsd` and legs beyond `maxLegs` stay as USDC.
 */
export function proposeNewMoney(input: ProposeInput): Proposal {
  const { plan, newMoneyUsd } = input;
  const maxLegs = input.maxLegs ?? MAX_LEGS;
  const minTradeUsd = input.minTradeUsd ?? 5;
  checkAmount("new money", newMoneyUsd);
  checkAmount("minimum trade", minTradeUsd);
  if (!Number.isInteger(maxLegs) || maxLegs < 0) throw new Error("maxLegs must be a whole number of 0 or more");

  const { holdings, cash } = normalize(input.holdingsUsd, input.cashUsd);
  const before = drift(plan, holdings, cash);
  const byTicker = new Map(before.map((r) => [r.ticker, r]));
  const why: string[] = ["New money only: nothing is sold, and nothing moves until you sign."];

  const now = Object.values(holdings).reduce((s, v) => s + v, 0) + cash;
  const total = now + newMoneyUsd;
  const targets = targetsOf(plan);
  const entries: GapEntry[] = [
    ...targets.holdings.map(({ h, share }) => ({ key: h.ticker, share, value: holdings[h.ticker] ?? 0 })),
    { key: CASH_TICKER, share: targets.cash, value: cash },
  ].map((x) => {
    const target = x.share * total;
    return { key: x.key, gap: Math.max(0, target - x.value), weight: x.share, overweight: x.value > target + EPS };
  });

  const nameOf = (t: string) => byTicker.get(t)?.name ?? t;
  if (newMoneyUsd <= 0) {
    why.push("No new money to place this time.");
    return { buys: [], cashUsd: 0, newMoneyUsd: 0, before, after: before, why };
  }

  const { amounts, unplaced } = allocateToGaps(entries, newMoneyUsd);
  const totalGap = entries.filter((e) => !e.overweight).reduce((s, e) => s + e.gap, 0);
  if (newMoneyUsd < totalGap - 0.005 && entries.filter((e) => !e.overweight && e.gap > EPS).length > 1) {
    why.push("Not enough new money to close every gap, so each holding below target gets a part in proportion to how far below it is.");
  }
  if (unplaced > EPS) why.push(`${usd(unplaced)} could not be placed anywhere, so it stays as USDC.`);

  for (const e of entries) {
    if (e.overweight && e.key !== CASH_TICKER) {
      const r = byTicker.get(e.key)!;
      why.push(`${r.name} is ${pts(r.diffPts)} points over target, so it gets no new money this time.`);
    }
  }
  for (const r of before) {
    if (r.kind === "outside") why.push(`${r.name} is not in your plan. It is kept (nothing is sold) and gets no new money.`);
  }

  let candidates = targets.holdings
    .map(({ h }) => ({ ticker: h.ticker, usd: floorCents(amounts[h.ticker] ?? 0) }))
    .filter((b) => b.usd > 0)
    .sort((a, b) => b.usd - a.usd || a.ticker.localeCompare(b.ticker));

  const small = candidates.filter((b) => b.usd < minTradeUsd - EPS);
  for (const b of small) {
    why.push(`${nameOf(b.ticker)} would get only ${usd(b.usd)}, below the ${usd(minTradeUsd)} minimum, so that stays as USDC.`);
  }
  candidates = candidates.filter((b) => b.usd >= minTradeUsd - EPS);

  const cut = candidates.slice(maxLegs);
  if (cut.length) {
    why.push(`Only ${maxLegs} assets fit in one plan, so the parts for ${cut.map((b) => nameOf(b.ticker)).join(", ")} stay as USDC this time.`);
  }
  const kept = candidates.slice(0, maxLegs);

  const buys: ProposalBuy[] = kept.map((b) => {
    const r = byTicker.get(b.ticker)!;
    const reason =
      r.diffPts <= -0.05
        ? `${r.name} is ${pts(r.diffPts)} points under target`
        : `Keeps ${r.name} near its ${pct(r.targetShare)} target as the portfolio grows`;
    return { ticker: b.ticker, usd: b.usd, reason };
  });
  const spent = buys.reduce((s, b) => s + b.usd, 0);
  const cashOut = roundCents(newMoneyUsd - spent);

  const cushion = floorCents(amounts[CASH_TICKER] ?? 0);
  if (cushion > 0) why.push(`${usd(cushion)} stays as USDC to keep the cushion near its ${pct(targets.cash)} target.`);
  for (const b of buys) why.push(`Buy ${usd(b.usd)} of ${nameOf(b.ticker)}: ${b.reason}.`);

  const afterHoldings = { ...holdings };
  for (const b of buys) afterHoldings[b.ticker] = (afterHoldings[b.ticker] ?? 0) + b.usd;
  const after = drift(plan, afterHoldings, cash + cashOut);

  return { buys, cashUsd: cashOut, newMoneyUsd, before, after, why };
}

export type ProposalLegs = {
  /** Real tickers, at most 6 (Payroll.MAX_ALLOCATIONS). */
  tickers: string[];
  /** Share of the salary for each ticker, in basis points. */
  bps: number[];
  /** Share of the salary paid out as USDC (not invested), in basis points. */
  cashBps: number;
};

/**
 * Turns a proposal into `Payroll.setSipPlanMany(assets, bps)` arguments. The investing share of
 * the salary stands for the proposal's new money: each buy gets the same part of the share as it
 * has of the new money (rounded down), and the proposal's cash part is paid out as USDC.
 *
 * @param shareBps the part of each salary the person chose to invest, in basis points (2000 = 20%).
 */
export function proposalToSipLegs(proposal: Proposal, shareBps: number): ProposalLegs {
  if (!Number.isInteger(shareBps) || shareBps < 0 || shareBps > 10_000) throw new Error("share must be 0 to 10000 bps");
  const money = proposal.buys.reduce((s, b) => s + b.usd, 0) + proposal.cashUsd;
  const tickers: string[] = [];
  const bps: number[] = [];
  if (money > 0) {
    const sorted = [...proposal.buys].sort((a, b) => b.usd - a.usd || a.ticker.localeCompare(b.ticker)).slice(0, MAX_LEGS);
    for (const b of sorted) {
      const leg = Math.floor((shareBps * b.usd) / money + 1e-9);
      if (leg > 0) {
        tickers.push(b.ticker);
        bps.push(leg);
      }
    }
  }
  // Guard against float dust ever pushing the total over the share.
  let invested = bps.reduce((s, b) => s + b, 0);
  while (invested > shareBps && bps.length) {
    const i = bps.length - 1;
    bps[i] -= 1;
    invested -= 1;
    if (bps[i] === 0) {
      bps.pop();
      tickers.pop();
    }
  }
  return { tickers, bps, cashBps: 10_000 - invested };
}
