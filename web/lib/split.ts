/**
 * A payday split: how much of a salary goes to work, and how it is spread across assets.
 * Pure maths, no imports, unit tested in split.test.ts. Used by Claim (normal pay) and Collect (private pay).
 */

/** Payroll accepts at most 6 assets in one payday split (MAX_ALLOCATIONS in Payroll.sol). */
export const MAX_SPLIT_ASSETS = 6;

export type Split = {
  /** Share of the salary that goes to work, 0 to 100 percent. */
  pct: number;
  /** Chosen assets, in the order picked. */
  symbols: string[];
  /** Share of the invested part per asset in percent, summing to 100. Missing means split evenly. */
  weights?: Record<string, number>;
};

/** Each chosen asset's share of the invested part, in percent, always summing to 100. */
export function weightsOf(split: Split): Record<string, number> {
  const n = split.symbols.length;
  if (n === 0) return {};
  if (split.weights) {
    const w = split.symbols.map((s) => Math.max(0, split.weights![s] ?? 0));
    const sum = w.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      const out: Record<string, number> = {};
      split.symbols.forEach((s, i) => (out[s] = (w[i] * 100) / sum));
      return out;
    }
  }
  const out: Record<string, number> = {};
  for (const s of split.symbols) out[s] = 100 / n;
  return out;
}

/**
 * Basis points of the salary per asset (what Payroll's setSipPlanMany and claimWithSipMany take).
 * Rounds down per asset and gives the remainder to the first asset, so the total is exactly pct x 100.
 * Assets that would get 0 are dropped.
 */
export function splitToBps(split: Split): { symbols: string[]; bps: number[] } {
  const total = Math.round(Math.max(0, Math.min(100, split.pct)) * 100);
  if (total === 0 || split.symbols.length === 0) return { symbols: [], bps: [] };
  const w = weightsOf(split);
  const bps = split.symbols.map((s) => Math.floor((total * w[s]) / 100));
  bps[0] += total - bps.reduce((a, b) => a + b, 0);
  const keep = split.symbols.map((s, i) => ({ s, b: bps[i] })).filter((x) => x.b > 0);
  return { symbols: keep.map((x) => x.s), bps: keep.map((x) => x.b) };
}

/** USDC per asset for an invested amount (6-decimal units), remainder to the first asset. */
export function splitAmount(amount: bigint, split: Split): { symbols: string[]; amounts: bigint[] } {
  if (amount === 0n || split.symbols.length === 0) return { symbols: [], amounts: [] };
  const w = weightsOf(split);
  const amounts = split.symbols.map((s) => (amount * BigInt(Math.round(w[s] * 100))) / 10_000n);
  amounts[0] += amount - amounts.reduce((a, b) => a + b, 0n);
  const keep = split.symbols.map((s, i) => ({ s, a: amounts[i] })).filter((x) => x.a > 0n);
  return { symbols: keep.map((x) => x.s), amounts: keep.map((x) => x.a) };
}

/** Add or remove an asset. Adding past the limit does nothing; custom weights reset to even. */
export function toggleAsset(split: Split, symbol: string): Split {
  const has = split.symbols.includes(symbol);
  if (!has && split.symbols.length >= MAX_SPLIT_ASSETS) return split;
  const symbols = has ? split.symbols.filter((s) => s !== symbol) : [...split.symbols, symbol];
  return { ...split, symbols, weights: undefined };
}

/** Move one asset's share by `delta` percent, taking it from (or giving it to) the others evenly. */
export function nudgeWeight(split: Split, symbol: string, delta: number): Split {
  const w = weightsOf(split);
  if (!(symbol in w) || split.symbols.length < 2) return split;
  const next = Math.max(0, Math.min(100, Math.round(w[symbol] + delta)));
  const others = split.symbols.filter((s) => s !== symbol);
  const rest = 100 - next;
  const otherSum = others.reduce((a, s) => a + w[s], 0);
  const weights: Record<string, number> = { [symbol]: next };
  for (const s of others) weights[s] = otherSum > 0 ? (w[s] * rest) / otherSum : rest / others.length;
  return { ...split, weights };
}
