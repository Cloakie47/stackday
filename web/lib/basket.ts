/**
 * Collateral basket maths. Pure bigint, no imports, unit tested in basket.test.ts.
 *
 * Morpho markets take one collateral asset each, so a "basket" is several markets shown as one:
 * the person locks some of each asset, sees one total and one borrow limit, and every borrow or
 * repay is split so each market sits at the same loan-to-limit ratio (the same health). Each
 * market can still be liquidated on its own if its own price falls; the UI says so.
 *
 * Units: USDC amounts have 6 decimals, lltv and health are WAD (1e18 = 1.0), caps are basis points.
 */
const WAD = 10n ** 18n;
const YEAR = 31_536_000n;

export type Leg = {
  /** USDC value of the collateral locked in this market. */
  value: bigint;
  /** Liquidation loan-to-value of the market, WAD. */
  lltv: bigint;
  /** USDC owed in this market. */
  debt: bigint;
  /** USDC the market can still lend. Undefined means no limit known. */
  liquidity?: bigint;
};

/** Debt at which this leg can be liquidated. */
export const maxDebtOf = (l: Leg) => (l.value * l.lltv) / WAD;

/** Most this leg may owe under the vault's borrow cap. */
export const capLimitOf = (l: Leg, capBps: bigint) => (maxDebtOf(l) * capBps) / 10_000n;

/** USDC this leg can still borrow: under the cap and within the market's cash. */
export function roomOf(l: Leg, capBps: bigint): bigint {
  const lim = capLimitOf(l, capBps);
  let room = lim > l.debt ? lim - l.debt : 0n;
  if (l.liquidity !== undefined && l.liquidity < room) room = l.liquidity;
  return room;
}

export type Summary = {
  locked: bigint;
  maxDebt: bigint;
  limit: bigint;
  debt: bigint;
  available: bigint;
  /** Combined health, WAD. Undefined with no loan. */
  health?: bigint;
  /** Lowest health of any leg with a loan, WAD. This leg is liquidated first. */
  weakest?: bigint;
};

export function summarize(legs: Leg[], capBps: bigint): Summary {
  let locked = 0n, maxDebt = 0n, limit = 0n, debt = 0n, available = 0n;
  let weakest: bigint | undefined;
  for (const l of legs) {
    locked += l.value;
    maxDebt += maxDebtOf(l);
    limit += capLimitOf(l, capBps);
    debt += l.debt;
    available += roomOf(l, capBps);
    if (l.debt > 0n) {
      const h = (maxDebtOf(l) * WAD) / l.debt;
      if (weakest === undefined || h < weakest) weakest = h;
    }
  }
  return { locked, maxDebt, limit, debt, available, health: debt > 0n ? (maxDebt * WAD) / debt : undefined, weakest };
}

/** Hand out `amount` in proportion to `want`, never above `max`, topping up from legs with spare. */
function distribute(amount: bigint, want: bigint[], max: bigint[]): bigint[] {
  const out = want.map((w, i) => (w < max[i] ? w : max[i]));
  const wantSum = out.reduce((a, b) => a + b, 0n);
  if (wantSum > amount) {
    for (let i = 0; i < out.length; i++) out[i] = (out[i] * amount) / wantSum;
  }
  let left = amount - out.reduce((a, b) => a + b, 0n);
  // Rounding dust and anything the targets did not cover: largest spare first.
  const order = out.map((_, i) => i).sort((a, b) => (max[b] - out[b] > max[a] - out[a] ? 1 : -1));
  for (const i of order) {
    if (left === 0n) break;
    const spare = max[i] - out[i];
    const add = spare < left ? spare : left;
    out[i] += add;
    left -= add;
  }
  return out;
}

/**
 * Split a borrow across legs so every leg ends at the same share of its cap.
 * Returns undefined when the basket cannot lend that much.
 */
export function splitBorrow(amount: bigint, legs: Leg[], capBps: bigint): bigint[] | undefined {
  if (amount <= 0n) return legs.map(() => 0n);
  const rooms = legs.map((l) => roomOf(l, capBps));
  if (amount > rooms.reduce((a, b) => a + b, 0n)) return undefined;
  const limits = legs.map((l) => capLimitOf(l, capBps));
  const total = limits.reduce((a, b) => a + b, 0n);
  const after = legs.reduce((a, l) => a + l.debt, 0n) + amount;
  const want = legs.map((l, i) => {
    const target = (limits[i] * after) / total;
    return target > l.debt ? target - l.debt : 0n;
  });
  return distribute(amount, want, rooms);
}

/** Split a repayment so the legs closest to their cap are paid down first. Never above a leg's debt. */
export function splitRepay(amount: bigint, legs: Leg[], capBps: bigint): bigint[] {
  const debts = legs.map((l) => l.debt);
  const owed = debts.reduce((a, b) => a + b, 0n);
  if (amount >= owed) return debts;
  if (amount <= 0n) return legs.map(() => 0n);
  const limits = legs.map((l) => capLimitOf(l, capBps));
  const total = limits.reduce((a, b) => a + b, 0n);
  const after = owed - amount;
  const want = legs.map((l, i) => {
    const target = total > 0n ? (limits[i] * after) / total : 0n;
    return l.debt > target ? l.debt - target : 0n;
  });
  return distribute(amount, want, debts);
}

/**
 * Yearly USDC the basket earns from reinvested dividends and pays in loan interest, at today's
 * values and rates. `dividendBps` is per leg; `ratePerSecond` is Morpho's borrow rate (WAD per second).
 */
export function yearly(legs: (Leg & { dividendBps: number; ratePerSecond?: bigint })[]) {
  let earn = 0n, cost = 0n;
  for (const l of legs) {
    // dividendBps may be fractional (net of fees and tax): keep two more decimals of precision.
    earn += (l.value * BigInt(Math.round(l.dividendBps * 100))) / 1_000_000n;
    if (l.ratePerSecond !== undefined) cost += (l.debt * l.ratePerSecond * YEAR) / WAD;
  }
  return { earn, cost, net: earn - cost };
}
