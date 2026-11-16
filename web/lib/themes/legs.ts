import type { Plan } from "./basket.ts";
import { MAX_LEGS } from "./policy.ts";

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
