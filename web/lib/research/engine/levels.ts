import type { ChartRead, Indicators, Levels, View } from "../types.ts";

/**
 * Buy zone and invalidation, computed in code from the daily chart read (support and resistance)
 * and the daily ATR. The model never writes a level.
 * - accumulate: zone = nearest daily support (within 3 ATR below the close) up to +0.5 ATR, capped
 *   at the close; without such a support, 1 ATR below the close up to the close. Invalidation =
 *   1.5 ATR below the bottom of the zone.
 * - hold: no zone. Invalidation = 1 ATR below the nearest support, or 2 ATR below the close.
 * - reduce and avoid new buys: no zone. Invalidation = 1 ATR above the nearest resistance, or
 *   2 ATR above the close (a close above it proves the cautious view wrong).
 * Null when the close or the ATR is missing or makes no sense.
 */

export function roundPrice(x: number): number {
  if (!Number.isFinite(x)) return x;
  const abs = Math.abs(x);
  const decimals = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

const valid = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const fmt = (x: number) => String(roundPrice(x));

export function computeLevels(view: View, daily: Indicators | undefined, chart: ChartRead | undefined): Levels | null {
  if (!daily) return null;
  const last = daily.last;
  const atr = daily.atr14;
  if (!valid(last) || !valid(atr) || atr >= last / 2) return null;

  const support = (chart?.support ?? []).filter((s) => valid(s) && s < last).sort((a, b) => b - a);
  const resistance = (chart?.resistance ?? []).filter((r) => valid(r) && r > last).sort((a, b) => a - b);
  const near = support.find((s) => s >= last - 3 * atr);
  const res = resistance[0];

  let buyZone: Levels["buyZone"] = null;
  let invalidation: number;
  let basis: string;
  if (view === "accumulate") {
    const low = near ?? last - atr;
    const high = Math.min(last, low + 0.5 * atr);
    buyZone = { low: roundPrice(low), high: roundPrice(Math.max(high, low)) };
    invalidation = low - 1.5 * atr;
    basis =
      near !== undefined
        ? `zone = nearest daily support ${fmt(near)} to +0.5 ATR (ATR14 ${fmt(atr)}), capped at the close ${fmt(last)}; invalidation = 1.5 ATR below the zone`
        : `zone = 1 ATR (ATR14 ${fmt(atr)}) below the close ${fmt(last)} up to +0.5 ATR; invalidation = 1.5 ATR below the zone`;
  } else if (view === "hold") {
    invalidation = support[0] !== undefined ? support[0] - atr : last - 2 * atr;
    basis = support[0] !== undefined ? `invalidation = 1 ATR (ATR14 ${fmt(atr)}) below the nearest daily support ${fmt(support[0])}` : `invalidation = 2 ATR (ATR14 ${fmt(atr)}) below the close ${fmt(last)}`;
  } else {
    invalidation = res !== undefined ? res + atr : last + 2 * atr;
    basis = res !== undefined ? `invalidation = 1 ATR (ATR14 ${fmt(atr)}) above the nearest daily resistance ${fmt(res)}` : `invalidation = 2 ATR (ATR14 ${fmt(atr)}) above the close ${fmt(last)}`;
  }
  if (!valid(invalidation)) return null;
  return { buyZone, invalidation: roundPrice(invalidation), support: support.slice(0, 3).map(roundPrice), resistance: resistance.slice(0, 3).map(roundPrice), basis };
}

/** Every number a Levels object contains (allowed in model text that talks about them). */
export function levelNumbers(l: Levels | null): number[] {
  if (!l) return [];
  return [l.invalidation, ...l.support, ...l.resistance, ...(l.buyZone ? [l.buyZone.low, l.buyZone.high] : [])];
}
