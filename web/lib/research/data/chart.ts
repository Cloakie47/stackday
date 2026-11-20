import type { ChartInterval, ChartRead, Confidence, Pattern, PatternKind, PriceBar, TrendStructure, VolatilityRegime } from "../types.ts";
import { atrSeries, macdLineSeries, periodsPerYear, rollingVolatility, rsiSeries, smaSeries } from "./indicators.ts";

/**
 * Chart read in code (spec section 3.2 and 4.1): swing points, trend structure, support and
 * resistance by clustering swing levels, position in range, chart patterns and the volatility
 * regime. Pure functions: bars in (oldest first), numbers out. No network, no clock, no model.
 *
 * Every rule is spelled out next to its function so a reader can check a detected pattern by hand,
 * and chart.test.ts builds synthetic bars for each one. All distances are measured in ATR (14) of
 * the same series, so the same rules work for Bitcoin at 90,000 and a stock at 200.
 *
 * Each pattern carries a confidence and an invalidation price: the price that, on a close beyond
 * it, would prove the pattern wrong. Confidence rules are simple and stated per detector; they are
 * a rough grade of how textbook the shape is, not a probability.
 */

export type Swing = { i: number; t: string; price: number; type: "high" | "low" };

/** Window sizes per timeframe, in bars. */
export type ChartParams = {
  /** Bars on each side for a swing point. */
  k: number;
  /** Prior-high/low window for breakouts and breakdowns. */
  breakLookback: number;
  /** A breakout must have happened within this many latest bars. */
  breakRecent: number;
  /** How far back multi-swing patterns (double tops, head and shoulders, divergences) may start. */
  patternWindow: number;
  /** The last swing of a pattern must be within this many latest bars. */
  patternRecent: number;
  /** A moving-average cross must be this recent. */
  crossRecent: number;
  /** Bars used for support and resistance. */
  levelWindow: number;
  /** Bars used for the range test. */
  rangeWindow: number;
  /** Window of returns for realized volatility. */
  volWindow: number;
};

export const CHART_PARAMS: Record<ChartInterval, ChartParams> = {
  "1d": { k: 3, breakLookback: 20, breakRecent: 3, patternWindow: 60, patternRecent: 20, crossRecent: 10, levelWindow: 250, rangeWindow: 20, volWindow: 20 },
  "1w": { k: 2, breakLookback: 20, breakRecent: 2, patternWindow: 52, patternRecent: 12, crossRecent: 6, levelWindow: 156, rangeWindow: 16, volWindow: 13 },
  "1mo": { k: 2, breakLookback: 12, breakRecent: 1, patternWindow: 36, patternRecent: 8, crossRecent: 3, levelWindow: 60, rangeWindow: 10, volWindow: 6 },
};

/** Fewest bars for a chart read at all. Below this the timeframe is "no reading". */
export const MIN_CHART_BARS = 30;

export const PATTERN_LABEL: Record<PatternKind, string> = {
  breakout: "Breakout",
  breakdown: "Breakdown",
  range: "Range",
  "bull-flag": "Bull flag",
  "bear-flag": "Bear flag",
  "double-top": "Double top",
  "double-bottom": "Double bottom",
  "head-and-shoulders": "Head and shoulders",
  "inverse-head-and-shoulders": "Inverse head and shoulders",
  "golden-cross": "Golden cross (50 over 200)",
  "death-cross": "Death cross (50 under 200)",
  "rsi-bullish-divergence": "Bullish RSI divergence",
  "rsi-bearish-divergence": "Bearish RSI divergence",
  "macd-bullish-divergence": "Bullish MACD divergence",
  "macd-bearish-divergence": "Bearish MACD divergence",
};

const round = (x: number) => (Math.abs(x) >= 1 ? Math.round(x * 100) / 100 : Number(x.toPrecision(6)));
/** Prices for detail lines: 92,100 or 187.25 or 0.000123. */
export function fmt(x: number): string {
  if (Math.abs(x) >= 1000) return Math.round(x).toLocaleString("en-US");
  if (Math.abs(x) >= 1) return x.toFixed(2);
  return String(Number(x.toPrecision(4)));
}

// ---------------------------------------------------------------------------------------------
// Swings, trend and levels
// ---------------------------------------------------------------------------------------------

/**
 * Swing points: bar i is a swing high when its high is above the highs of the `k` bars after it
 * and not below the highs of the `k` bars before it (so a flat top counts once, at its last bar).
 * Swing lows likewise. The newest `k` bars cannot be swings yet.
 */
export function findSwings(bars: PriceBar[], k: number): Swing[] {
  const out: Swing[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let hi = true;
    let lo = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (j < i ? bars[j].h > bars[i].h : bars[j].h >= bars[i].h) hi = false;
      if (j < i ? bars[j].l < bars[i].l : bars[j].l <= bars[i].l) lo = false;
    }
    if (hi) out.push({ i, t: bars[i].t, price: bars[i].h, type: "high" });
    if (lo) out.push({ i, t: bars[i].t, price: bars[i].l, type: "low" });
  }
  return out;
}

/** Levels closer than this count as the same level: half an ATR, at least 1% of price. */
export const levelTolerance = (price: number, atr: number) => Math.max(0.5 * atr, 0.01 * price);

/**
 * Trend structure from the last two swing highs and the last two swing lows: both higher (by more
 * than the level tolerance) is higher highs and higher lows, both lower is lower highs and lower
 * lows, anything else (or fewer than two of each) is a range.
 */
export function trendStructure(swings: Swing[], tol: number): TrendStructure {
  const highs = swings.filter((s) => s.type === "high").slice(-2);
  const lows = swings.filter((s) => s.type === "low").slice(-2);
  if (highs.length < 2 || lows.length < 2) return "range";
  const dh = highs[1].price - highs[0].price;
  const dl = lows[1].price - lows[0].price;
  if (dh > tol && dl > tol) return "higher-highs-higher-lows";
  if (dh < -tol && dl < -tol) return "lower-highs-lower-lows";
  return "range";
}

export type Level = { price: number; touches: number };

/**
 * Support and resistance by clustering: every swing high and low in the window is a candidate
 * level; candidates within `tol` of the first price of a cluster join it, and the cluster's level
 * is the mean. Clusters below the last close are support, above are resistance, nearest first, at
 * most `max` each. A swing high below price counts as support (old resistance turned support).
 */
export function clusterLevels(swings: Swing[], last: number, tol: number, max = 3): { support: Level[]; resistance: Level[] } {
  const prices = swings.map((s) => s.price).sort((a, b) => a - b);
  const clusters: { first: number; sum: number; n: number }[] = [];
  for (const p of prices) {
    const c = clusters[clusters.length - 1];
    if (c && p - c.first <= tol) {
      c.sum += p;
      c.n += 1;
    } else clusters.push({ first: p, sum: p, n: 1 });
  }
  const levels = clusters.map((c) => ({ price: c.sum / c.n, touches: c.n }));
  return {
    support: levels.filter((l) => l.price < last).sort((a, b) => b.price - a.price).slice(0, max),
    resistance: levels.filter((l) => l.price > last).sort((a, b) => a.price - b.price).slice(0, max),
  };
}

/** Where the last close sits between nearest support (0) and nearest resistance (1). */
export function positionInRange(last: number, support: number | undefined, resistance: number | undefined): number | null {
  if (support === undefined || resistance === undefined || resistance <= support) return null;
  return Math.min(1, Math.max(0, (last - support) / (resistance - support)));
}

// ---------------------------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------------------------

type Ctx = {
  bars: PriceBar[];
  closes: number[];
  n: number;
  last: number;
  atr: number;
  swings: Swing[];
  iv: ChartInterval;
  p: ChartParams;
};

function pattern(ctx: Ctx, kind: PatternKind, direction: Pattern["direction"], confidence: Confidence, invalidation: number, at: number, detail: string): Pattern {
  return { id: `pat.${ctx.iv}.${kind}`, kind, interval: ctx.iv, direction, confidence, invalidation: round(invalidation), asOf: ctx.bars[at].t, detail };
}

const maxOf = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), -Infinity);
const minOf = (xs: number[]) => xs.reduce((a, b) => Math.min(a, b), Infinity);

function avgVolume(bars: PriceBar[], from: number, to: number): number | undefined {
  const v = bars.slice(Math.max(0, from), to).map((b) => b.v).filter((x): x is number => typeof x === "number" && x > 0);
  return v.length >= 5 ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
}

/**
 * Breakout: within the last `breakRecent` bars a close crossed above the highest high of the
 * `breakLookback` bars before it, and the last close is still above that level.
 * Confidence by how far the last close is past the level: 0.5 ATR or more and volume on the
 * breakout bar at least 1.2x its prior average is high; 0.2 ATR or more is medium (also the cap
 * when there is no volume); less is low. Invalidation: a close 0.5 ATR back below the level.
 * Breakdown is the mirror image.
 */
export function detectBreak(ctx: Ctx, up: boolean): Pattern | null {
  const { bars, closes, n, p, atr, last } = ctx;
  for (let j = n - 1; j >= Math.max(p.breakLookback + 1, n - p.breakRecent); j--) {
    const window = bars.slice(j - p.breakLookback, j);
    const level = up ? maxOf(window.map((b) => b.h)) : minOf(window.map((b) => b.l));
    const crossed = up ? closes[j] > level && closes[j - 1] <= level : closes[j] < level && closes[j - 1] >= level;
    if (!crossed) continue;
    const still = up ? last > level : last < level;
    if (!still) return null;
    const margin = (up ? last - level : level - last) / atr;
    const vAvg = avgVolume(bars, j - 20, j);
    const vOk = vAvg !== undefined && (bars[j].v ?? 0) >= 1.2 * vAvg;
    const conf: Confidence = margin >= 0.5 && vOk ? "high" : margin >= 0.2 ? "medium" : "low";
    const inv = up ? level - 0.5 * atr : level + 0.5 * atr;
    const detail = `close ${fmt(closes[j])} ${up ? "above" : "below"} the prior ${p.breakLookback}-bar ${up ? "high" : "low"} ${fmt(level)}${vAvg === undefined ? "" : vOk ? ", on above-average volume" : ", without a volume pickup"}`;
    return pattern(ctx, up ? "breakout" : "breakdown", up ? "bullish" : "bearish", conf, inv, j, detail);
  }
  return null;
}

/**
 * Range: over the last `rangeWindow` bars the high-to-low span is at most 6 ATR and both edges
 * were tested at least twice (bars whose high or low comes within 15% of the span from the edge),
 * with the last close inside. Confidence: span of 4 ATR or less with 3 or more tests of each edge
 * is high, 3 or more tests of one edge is medium, otherwise low. Invalidation: a close 0.5 ATR
 * below the floor (a close above the ceiling is reported as a breakout instead).
 */
export function detectRange(ctx: Ctx): Pattern | null {
  const { bars, n, p, atr, last } = ctx;
  if (n < p.rangeWindow) return null;
  const w = bars.slice(n - p.rangeWindow);
  const hi = maxOf(w.map((b) => b.h));
  const lo = minOf(w.map((b) => b.l));
  const span = hi - lo;
  if (span <= 0 || span > 6 * atr || last > hi || last < lo) return null;
  const band = 0.15 * span;
  const top = w.filter((b) => b.h >= hi - band).length;
  const bottom = w.filter((b) => b.l <= lo + band).length;
  if (top < 2 || bottom < 2) return null;
  const conf: Confidence = span <= 4 * atr && top >= 3 && bottom >= 3 ? "high" : top >= 3 || bottom >= 3 ? "medium" : "low";
  const detail = `range ${fmt(lo)} to ${fmt(hi)} over the last ${p.rangeWindow} bars (${(span / atr).toFixed(1)} ATR wide), ceiling tested ${top} times, floor ${bottom} times`;
  return pattern(ctx, "range", "neutral", conf, lo - 0.5 * atr, n - 1, detail);
}

/** Least-squares slope of y against its index. */
export function slope(y: number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  y.forEach((v, i) => {
    num += (i - mx) * (v - my);
    den += (i - mx) ** 2;
  });
  return num / den;
}

/**
 * Bull flag: a pole of 3 to 10 bars that rose at least 3 ATR (from its lowest low to the pole top,
 * which is the highest high since), then a flag of 3 to 12 bars that gives back at most half the
 * pole, spans at most 60% of it, and drifts sideways or down (closing slope at most +0.1 ATR per
 * bar). The last close must still be inside the flag. Confidence: give-back at most 38% and a
 * pole of 5 ATR or more is high, give-back at most 38% is medium, otherwise low. Invalidation: a
 * close below the flag low. Bear flag is the mirror image.
 */
export function detectFlag(ctx: Ctx, bull: boolean): Pattern | null {
  const { bars, closes, n, atr } = ctx;
  let best: { top: number; poleEnd: number; base: number; rise: number; conLow: number; conHigh: number; give: number } | null = null;
  for (let L = 3; L <= 12; L++) {
    const pe = n - 1 - L;
    if (pe < 10) break;
    const after = bars.slice(pe + 1);
    const top = bull ? bars[pe].h : bars[pe].l;
    // The pole top must be the extreme of everything since it.
    if (bull ? maxOf(after.map((b) => b.h)) > top : minOf(after.map((b) => b.l)) < top) continue;
    for (let P = 3; P <= 10; P++) {
      const ps = pe - P;
      if (ps < 0) break;
      const pole = bars.slice(ps, pe);
      const base = bull ? minOf(pole.map((b) => b.l)) : maxOf(pole.map((b) => b.h));
      const rise = bull ? top - base : base - top;
      if (rise < 3 * atr) continue;
      const conLow = minOf(after.map((b) => b.l));
      const conHigh = maxOf(after.map((b) => b.h));
      const give = bull ? (top - conLow) / rise : (conHigh - top) / rise;
      if (give > 0.5 || conHigh - conLow > 0.6 * rise) continue;
      const s = slope(closes.slice(pe + 1)) / atr;
      if (bull ? s > 0.1 : s < -0.1) continue;
      const last = closes[n - 1];
      if (last > conHigh || last < conLow) continue;
      if (!best || rise > best.rise) best = { top, poleEnd: pe, base, rise, conLow, conHigh, give };
    }
  }
  if (!best) return null;
  const conf: Confidence = best.give <= 0.38 && best.rise >= 5 * atr ? "high" : best.give <= 0.38 ? "medium" : "low";
  const flagBars = n - 1 - best.poleEnd;
  const detail = `pole ${fmt(best.base)} to ${fmt(best.top)} (${(best.rise / atr).toFixed(1)} ATR), then ${flagBars} bars between ${fmt(best.conLow)} and ${fmt(best.conHigh)} giving back ${Math.round(best.give * 100)}%`;
  return pattern(ctx, bull ? "bull-flag" : "bear-flag", bull ? "bullish" : "bearish", conf, bull ? best.conLow : best.conHigh, n - 1, detail);
}

/**
 * Double top: the last swing high (within `patternRecent` bars) and an earlier swing high at
 * least 5 bars before it (3 on monthly bars), inside `patternWindow`, are within the level
 * tolerance of each other with no higher high between them, and the lowest low between them (the
 * neckline) is at least 1.5 ATR below the lower top. Confirmed when a close after the second top
 * went below the neckline: medium, or high when the dip was 3 ATR or more and the last close is
 * still below the neckline. Not yet confirmed but already 0.5 ATR off the second top: low
 * ("forming"). Invalidation: a close above the higher top. Double bottom is the mirror image.
 */
export function detectDouble(ctx: Ctx, top: boolean): Pattern | null {
  const { bars, closes, n, p, atr, swings, last } = ctx;
  const type = top ? "high" : "low";
  const pts = swings.filter((s) => s.type === type && s.i >= n - p.patternWindow);
  if (pts.length < 2) return null;
  const b = pts[pts.length - 1];
  if (b.i < n - p.patternRecent) return null;
  const minGap = ctx.iv === "1mo" ? 3 : 5;
  for (let ai = pts.length - 2; ai >= 0; ai--) {
    const a = pts[ai];
    if (b.i - a.i < minGap) continue;
    const tol = levelTolerance(b.price, atr);
    if (Math.abs(a.price - b.price) > tol) continue;
    const between = bars.slice(a.i + 1, b.i);
    if (between.length === 0) continue;
    const extreme = top ? Math.max(a.price, b.price) : Math.min(a.price, b.price);
    if (top ? maxOf(between.map((x) => x.h)) > extreme : minOf(between.map((x) => x.l)) < extreme) continue;
    const neck = top ? minOf(between.map((x) => x.l)) : maxOf(between.map((x) => x.h));
    const depth = top ? Math.min(a.price, b.price) - neck : neck - Math.max(a.price, b.price);
    if (depth < 1.5 * atr) continue;
    let brokeAt = -1;
    for (let j = b.i + 1; j < n; j++) if (top ? closes[j] < neck : closes[j] > neck) { brokeAt = j; break; }
    let conf: Confidence;
    let state: string;
    if (brokeAt >= 0) {
      const holding = top ? last < neck : last > neck;
      conf = depth >= 3 * atr && holding ? "high" : "medium";
      state = `neckline ${fmt(neck)} broken${holding ? "" : ", price back above it"}`;
    } else if (top ? last < b.price - 0.5 * atr : last > b.price + 0.5 * atr) {
      conf = "low";
      state = `forming, neckline ${fmt(neck)} not broken yet`;
    } else continue;
    const kind = top ? "double-top" : "double-bottom";
    const detail = `two ${top ? "highs" : "lows"} near ${fmt(a.price)} and ${fmt(b.price)}, ${state}`;
    return pattern(ctx, kind, top ? "bearish" : "bullish", conf, extreme, brokeAt >= 0 ? brokeAt : b.i, detail);
  }
  return null;
}

/**
 * Head and shoulders: the last three swing highs (the right one within `patternRecent` bars) where
 * the middle one (head) is at least 1 ATR above both shoulders and the shoulders are within 1.5x
 * the level tolerance of each other. The neckline is the mean of the lowest lows between left
 * shoulder and head and between head and right shoulder. Confirmed when the last close is below
 * the neckline: medium, or high when the head stands 2 ATR or more above both shoulders. Not
 * confirmed but 0.5 ATR off the right shoulder: low ("forming"). Invalidation: a close above the
 * head. The inverse pattern is the mirror image on swing lows.
 */
export function detectHeadShoulders(ctx: Ctx, inverse: boolean): Pattern | null {
  const { bars, n, p, atr, swings, last } = ctx;
  const type = inverse ? "low" : "high";
  const pts = swings.filter((s) => s.type === type && s.i >= n - Math.round(p.patternWindow * 1.5));
  if (pts.length < 3) return null;
  const [l, h, r] = pts.slice(-3);
  if (r.i < n - p.patternRecent) return null;
  const sign = inverse ? -1 : 1;
  const prominence = Math.min(sign * (h.price - l.price), sign * (h.price - r.price));
  if (prominence < atr) return null;
  if (Math.abs(l.price - r.price) > 1.5 * levelTolerance(r.price, atr)) return null;
  const seg1 = bars.slice(l.i + 1, h.i);
  const seg2 = bars.slice(h.i + 1, r.i);
  if (!seg1.length || !seg2.length) return null;
  const t1 = inverse ? maxOf(seg1.map((b) => b.h)) : minOf(seg1.map((b) => b.l));
  const t2 = inverse ? maxOf(seg2.map((b) => b.h)) : minOf(seg2.map((b) => b.l));
  const neck = (t1 + t2) / 2;
  const broken = inverse ? last > neck : last < neck;
  let conf: Confidence;
  if (broken) conf = prominence >= 2 * atr ? "high" : "medium";
  else if (inverse ? last > r.price + 0.5 * atr : last < r.price - 0.5 * atr) conf = "low";
  else return null;
  const kind = inverse ? "inverse-head-and-shoulders" : "head-and-shoulders";
  const detail = `shoulders ${fmt(l.price)} and ${fmt(r.price)}, head ${fmt(h.price)}, neckline ${fmt(neck)} ${broken ? "broken" : "not broken yet (forming)"}`;
  return pattern(ctx, kind, inverse ? "bullish" : "bearish", conf, h.price, broken ? n - 1 : r.i, detail);
}

/**
 * Golden or death cross: the 50-bar average crossed the 200-bar average within the last
 * `crossRecent` bars (the newest cross wins). Golden: high when price is above the 50-bar average
 * and the 200-bar average is rising over 10 bars, medium when price is above the 200-bar average,
 * otherwise low. Death cross mirrors it. Invalidation: a close back across the 200-bar average.
 */
export function detectCross(ctx: Ctx): Pattern | null {
  const { closes, n, p, last } = ctx;
  if (n < 211) return null;
  const s50 = smaSeries(closes, 50);
  const s200 = smaSeries(closes, 200);
  for (let j = n - 1; j >= n - p.crossRecent && j > 0; j--) {
    const a0 = s50[j - 1], b0 = s200[j - 1], a1 = s50[j], b1 = s200[j];
    if (a0 === undefined || b0 === undefined || a1 === undefined || b1 === undefined) return null;
    const golden = a0 <= b0 && a1 > b1;
    const death = a0 >= b0 && a1 < b1;
    if (!golden && !death) continue;
    const m200 = s200[n - 1]!;
    const m50 = s50[n - 1]!;
    const rising = m200 > (s200[n - 11] ?? m200);
    const conf: Confidence = golden
      ? last > m50 && rising ? "high" : last > m200 ? "medium" : "low"
      : last < m50 && !rising ? "high" : last < m200 ? "medium" : "low";
    const detail = `50-bar average ${fmt(a1)} crossed ${golden ? "above" : "below"} the 200-bar average ${fmt(b1)} ${n - 1 - j} bars ago`;
    return pattern(ctx, golden ? "golden-cross" : "death-cross", golden ? "bullish" : "bearish", conf, m200, j, detail);
  }
  return null;
}

/**
 * Divergence between price and an oscillator on the last two swing lows (bullish) or highs
 * (bearish): the newer swing is within `patternRecent` bars, at least 5 bars after the older one,
 * both inside `patternWindow`. Bullish: price makes a lower low while the oscillator makes a
 * higher low. Bearish: price makes a higher high while the oscillator makes a lower high.
 *   RSI: needs a gap of 3 points or more; high with 8 or more points and the older RSI at or
 *   beyond 30 (bullish) or 70 (bearish), medium with 5 or more or the older RSI beyond 35 or 65.
 *   MACD line: the older reading must be below zero (bullish) or above zero (bearish); gap of
 *   0.05 ATR or more, medium from 0.15 ATR, high from 0.3 ATR.
 * Invalidation: a close beyond the newer swing (the lower low or the higher high).
 */
export function detectDivergence(ctx: Ctx, osc: "rsi" | "macd", bullish: boolean): Pattern | null {
  const { n, p, atr, swings, closes } = ctx;
  const series = osc === "rsi" ? rsiSeries(closes, 14) : macdLineSeries(closes);
  const pts = swings.filter((s) => s.type === (bullish ? "low" : "high") && s.i >= n - p.patternWindow);
  if (pts.length < 2) return null;
  const b = pts[pts.length - 1];
  const a = pts[pts.length - 2];
  if (b.i < n - p.patternRecent || b.i - a.i < 5) return null;
  const oa = series[a.i];
  const ob = series[b.i];
  if (oa === undefined || ob === undefined) return null;
  const priceOk = bullish ? b.price < a.price : b.price > a.price;
  const gap = bullish ? ob - oa : oa - ob;
  if (!priceOk || gap <= 0) return null;
  let conf: Confidence;
  if (osc === "rsi") {
    if (gap < 3) return null;
    const extreme = bullish ? oa <= 30 : oa >= 70;
    const near = bullish ? oa <= 35 : oa >= 65;
    conf = gap >= 8 && extreme ? "high" : gap >= 5 || near ? "medium" : "low";
  } else {
    if (bullish ? oa >= 0 : oa <= 0) return null;
    const g = gap / atr;
    if (g < 0.05) return null;
    conf = g >= 0.3 ? "high" : g >= 0.15 ? "medium" : "low";
  }
  const name = osc === "rsi" ? "RSI" : "MACD";
  const kind = `${osc}-${bullish ? "bullish" : "bearish"}-divergence` as PatternKind;
  const v = (x: number) => (osc === "rsi" ? x.toFixed(1) : Number(x.toPrecision(3)).toString());
  const detail = `price ${bullish ? "lower low" : "higher high"} ${fmt(a.price)} to ${fmt(b.price)} while ${name} ${bullish ? "rose" : "fell"} ${v(oa)} to ${v(ob)}`;
  return pattern(ctx, kind, bullish ? "bullish" : "bearish", conf, b.price, b.i, detail);
}

// ---------------------------------------------------------------------------------------------
// Volatility regime
// ---------------------------------------------------------------------------------------------

/** Share of `values` at or below `x`, 0 to 1. */
export function percentileRank(values: number[], x: number): number {
  if (!values.length) return NaN;
  return values.filter((v) => v <= x).length / values.length;
}

/** Days of history the regime is compared against, per timeframe. */
export const REGIME_LOOKBACK_DAYS: Record<ChartInterval, number> = { "1d": 365, "1w": 3 * 365, "1mo": 5 * 366 };

/**
 * Volatility regime: today's ATR as a share of price (so a higher price alone does not look more
 * volatile) and today's realized volatility, each ranked against their own values over the
 * lookback (last year for daily bars, three years for weekly, five for monthly). At least 20
 * values are needed for a percentile. Regime from the mean of the available percentiles: 0.8 or
 * more is high, 0.2 or less is low, otherwise normal; none available is unknown.
 */
export function volatilityRegime(bars: PriceBar[], iv: ChartInterval, crypto: boolean): VolatilityRegime {
  const n = bars.length;
  if (n < 20) return { regime: "unknown" };
  const closes = bars.map((b) => b.c);
  const from = Date.parse(bars[n - 1].t) - REGIME_LOOKBACK_DAYS[iv] * 86_400_000;
  const inWindow = (i: number) => Date.parse(bars[i].t) > from;
  const atrS = atrSeries(bars, 14);
  const volS = rollingVolatility(closes, CHART_PARAMS[iv].volWindow, periodsPerYear(iv, crypto));
  const rank = (s: (number | undefined)[], norm: boolean): number | undefined => {
    const vals: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = s[i];
      if (v !== undefined && inWindow(i)) vals.push(norm ? v / closes[i] : v);
    }
    const cur = s[n - 1];
    if (vals.length < 20 || cur === undefined) return undefined;
    return percentileRank(vals, norm ? cur / closes[n - 1] : cur);
  };
  const atrPercentile = rank(atrS, true);
  const volPercentile = rank(volS, false);
  const ps = [atrPercentile, volPercentile].filter((x): x is number => x !== undefined);
  const out: VolatilityRegime = { regime: "unknown" };
  if (atrPercentile !== undefined) out.atrPercentile = Math.round(atrPercentile * 100) / 100;
  if (volPercentile !== undefined) out.volPercentile = Math.round(volPercentile * 100) / 100;
  if (ps.length) {
    const m = ps.reduce((s, x) => s + x, 0) / ps.length;
    out.regime = m >= 0.8 ? "high" : m <= 0.2 ? "low" : "normal";
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Whole read
// ---------------------------------------------------------------------------------------------

export type ChartReadDetail = ChartRead & {
  /** Touch counts for each level, same order as support and resistance. */
  supportTouches: number[];
  resistanceTouches: number[];
  /** ATR (14) used for every distance in this read, in USD. */
  atr: number;
};

/**
 * Reads one timeframe. Returns null with fewer than MIN_CHART_BARS bars or no ATR. `factIds` is
 * left empty: the gatherer fills it with the ids of the facts it publishes for this read.
 */
export function readChart(rawBars: PriceBar[], iv: ChartInterval, opts: { crypto: boolean }): ChartReadDetail | null {
  const bars = rawBars.filter((b) => [b.o, b.h, b.l, b.c].every(Number.isFinite));
  const n = bars.length;
  if (n < MIN_CHART_BARS) return null;
  const atr = atrSeries(bars, 14)[n - 1];
  if (atr === undefined || !(atr > 0)) return null;
  const p = CHART_PARAMS[iv];
  const swings = findSwings(bars, p.k);
  const last = bars[n - 1].c;
  const tol = levelTolerance(last, atr);
  const ctx: Ctx = { bars, closes: bars.map((b) => b.c), n, last, atr, swings, iv, p };

  const levelSwings = swings.filter((s) => s.i >= n - p.levelWindow);
  const lv = clusterLevels(levelSwings, last, tol);
  const support = lv.support.map((l) => round(l.price));
  const resistance = lv.resistance.map((l) => round(l.price));

  const found = [
    detectBreak(ctx, true),
    detectBreak(ctx, false),
    detectFlag(ctx, true),
    detectFlag(ctx, false),
    detectDouble(ctx, true),
    detectDouble(ctx, false),
    detectHeadShoulders(ctx, false),
    detectHeadShoulders(ctx, true),
    detectCross(ctx),
    detectDivergence(ctx, "rsi", true),
    detectDivergence(ctx, "rsi", false),
    detectDivergence(ctx, "macd", true),
    detectDivergence(ctx, "macd", false),
  ].filter((x): x is Pattern => x !== null);
  // A range is only reported when price has not just broken out of it.
  if (!found.some((f) => f.kind === "breakout" || f.kind === "breakdown")) {
    const r = detectRange(ctx);
    if (r) found.push(r);
  }

  return {
    interval: iv,
    trend: trendStructure(swings.filter((s) => s.i >= n - p.levelWindow), tol),
    support,
    resistance,
    positionInRange: positionInRange(last, support[0], resistance[0]),
    patterns: found,
    volatility: volatilityRegime(bars, iv, opts.crypto),
    factIds: [],
    supportTouches: lv.support.map((l) => l.touches),
    resistanceTouches: lv.resistance.map((l) => l.touches),
    atr,
  };
}
