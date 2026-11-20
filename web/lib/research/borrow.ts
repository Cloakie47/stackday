import type { BorrowNote } from "./types.ts";

/**
 * Borrowing note (founder spec section 3.8), computed in code. A loan's "limit use" is the loan
 * divided by the most that can be borrowed before liquidation (collateral value x LLTV). When the
 * price falls by `drop`, limit use grows to `use / (1 - drop)`; at 100% the loan can be liquidated.
 */

export const DEFAULT_DROPS = [0.1, 0.2, 0.3] as const;

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export function limitUseAfterDrop(limitUse: number, drop: number): number {
  if (drop >= 1) return Infinity;
  return limitUse / (1 - drop);
}

/** Fall from today's price at which a loan at `limitUse` reaches the limit. */
export function dropToLimit(limitUse: number): number {
  return limitUse <= 0 ? 1 : Math.max(0, 1 - limitUse);
}

export function borrowNote(assetId: string, name: string, lltv: number, limitUse = 0.5, drops: readonly number[] = DEFAULT_DROPS): BorrowNote {
  const examples = drops.map((drop) => ({ drop, fromLimitUse: limitUse, toLimitUse: limitUseAfterDrop(limitUse, drop) }));
  const twenty = limitUseAfterDrop(limitUse, 0.2);
  const ltvNow = limitUse * lltv;
  const text =
    `${name} can be borrowed against up to ${pct(lltv)} of its value. ` +
    `A loan at ${pct(limitUse)} of the limit (${pct(ltvNow)} of the collateral value) moves to ${pct(twenty)} of the limit after a 20% fall` +
    (twenty >= 1 ? ", which can be liquidated." : ".") +
    ` It reaches the limit after a ${pct(dropToLimit(limitUse))} fall. ` +
    "Stackday's optional emergency rule sends the whole next SIP share to collateral when a loan gets close to the limit.";
  return { assetId, lltv, examples, dropToLimitAtHalfUse: dropToLimit(0.5), text };
}
