import type { Plan } from "./basket.ts";
import { DCA_MAX, DCA_MIN, MAX_LEGS } from "./policy.ts";

/**
 * Turns a plan into what Stackday's existing contracts take. No contract change is needed:
 *
 * - Payroll (employees): `setSipPlanMany(assets, bps)` or `claimWithSipMany(...)`, where each
 *   bps is a share of the SALARY. The person picks their investing share (for example 20 percent);
 *   the plan splits that share; the plan's USDC cushion part is simply not bought and is paid out
 *   with the rest of the salary.
 * - SipRouter (individuals): one `invest` call or one recurring `setPlan` per asset, in USDC.
 */

export type SipLegs = {
  /** Real tickers, at most 6 (Payroll.MAX_ALLOCATIONS). */
  tickers: string[];
  /** Share of the salary for each ticker, in basis points. */
  bps: number[];
  /** Share of the salary paid out as USDC (not invested), in basis points. */
  cashBps: number;
  /** Holdings left out because only 6 fit; their part is paid out as USDC. */
  dropped: string[];
};

/**
 * @param shareBps the part of each salary the person chose to invest, in basis points (2000 = 20%).
 */
export function toSipLegs(plan: Plan, shareBps: number, maxLegs = MAX_LEGS): SipLegs {
  if (!Number.isInteger(shareBps) || shareBps < 0 || shareBps > 10_000) throw new Error("share must be 0 to 10000 bps");
  const sorted = [...plan.holdings].sort((a, b) => b.bps - a.bps || a.ticker.localeCompare(b.ticker));
  const kept = sorted.slice(0, maxLegs);
  const dropped = sorted.slice(maxLegs).map((h) => h.ticker);
  const tickers: string[] = [];
  const bps: number[] = [];
  for (const h of kept) {
    const leg = Math.floor((shareBps * h.bps) / 10_000);
    if (leg > 0) {
      tickers.push(h.ticker);
      bps.push(leg);
    }
  }
  const invested = bps.reduce((s, b) => s + b, 0);
  return { tickers, bps, cashBps: 10_000 - invested, dropped };
}

/** Splits a USDC amount (6 decimals) across the plan. The cushion part and rounding dust stay as cash. */
export function splitAmount(plan: Plan, usdc: bigint): { buys: { ticker: string; usdc: bigint }[]; cash: bigint } {
  if (usdc < 0n) throw new Error("amount must not be negative");
  const buys = plan.holdings
    .map((h) => ({ ticker: h.ticker, usdc: (usdc * BigInt(h.bps)) / 10_000n }))
    .filter((b) => b.usdc > 0n);
  const spent = buys.reduce((s, b) => s + b.usdc, 0n);
  return { buys, cash: usdc - spent };
}

/**
 * Smart DCA: how much of the planned buy to make this time, 0.5x to 1.5x.
 * Cheap and calm news means buy more; expensive or hype means buy less (the rest stays as USDC).
 * Mood changes how fast we buy, never what we buy. Bad news on its own never makes it buy more:
 * an upward push needs a value signal too.
 *
 * @param value portfolio value score, -1 (expensive) to +1 (cheap)
 * @param mood news mood, -1 (fearful) to +1 (euphoric)
 * @param hype a hype flag (mention spike or greed reading above 80)
 * @param materialRisk a material negative event (for example a guidance cut) is open
 */
export function smartDcaMultiplier(p: { value: number; mood: number; hype?: boolean; materialRisk?: boolean }): number {
  const v = clamp(p.value, -1, 1);
  const m = clamp(p.mood, -1, 1);
  if (p.hype) return DCA_MIN;
  let x = 1 + 0.35 * v;
  // Fear about a cheap basket is a discount; fear about an expensive one is not a reason to buy.
  if (v > 0 && m < 0 && !p.materialRisk) x += 0.15 * -m;
  // Euphoria always slows buying.
  if (m > 0) x -= 0.15 * m;
  if (p.materialRisk) x = Math.min(x, 1);
  return Math.round(clamp(x, DCA_MIN, DCA_MAX) * 100) / 100;
}

const clamp = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : 0);
