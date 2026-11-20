import type { BarInterval, Indicators, PriceBar } from "../types.ts";

/**
 * Pure technical indicators computed from a price series. No network, no clock: every function
 * takes bars (oldest first) and returns numbers or undefined when there is not enough history.
 * Formulas are the textbook ones and are spelled out next to each function so a reader can check
 * them by hand (see indicators.test.ts).
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Length of one bar, used to decide which timeframes a series can answer. */
export const BAR_MS: Record<BarInterval, number> = { "1h": HOUR, "1d": DAY, "1w": 7 * DAY, "1mo": 28 * DAY };

/** Bars per year, for annualising volatility. Stocks trade about 252 days of 6.5 hours. */
export function periodsPerYear(interval: BarInterval, crypto: boolean): number {
  switch (interval) {
    case "1h":
      return crypto ? 365 * 24 : 252 * 6.5;
    case "1d":
      return crypto ? 365 : 252;
    case "1w":
      return 52;
    case "1mo":
      return 12;
  }
}

const finite = (x: number) => Number.isFinite(x);
const ms = (t: string) => Date.parse(t);

/** Simple moving average of the last `n` closes. */
export function sma(closes: number[], n: number): number | undefined {
  if (n <= 0 || closes.length < n) return undefined;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}

/**
 * Exponential moving average series, seeded with the SMA of the first `n` values, then
 * EMA_t = a * x_t + (1 - a) * EMA_(t-1) with a = 2 / (n + 1). Index i of the result matches
 * index i + n - 1 of the input.
 */
export function emaSeries(values: number[], n: number): number[] {
  if (n <= 0 || values.length < n) return [];
  const a = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += values[i];
  e /= n;
  const out = [e];
  for (let i = n; i < values.length; i++) {
    e = a * values[i] + (1 - a) * e;
    out.push(e);
  }
  return out;
}

/**
 * Relative strength index with Wilder's smoothing. The first average gain and loss are plain
 * means of the first `n` changes; after that avg = (prev * (n - 1) + current) / n.
 * RSI = 100 - 100 / (1 + avgGain / avgLoss), and 100 when there were no losses.
 */
export function rsi(closes: number[], n = 14): number | undefined {
  if (closes.length < n + 1) return undefined;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/** MACD (12, 26, 9): EMA12 - EMA26, its 9-period EMA as the signal, and the difference. */
export function macd(closes: number[], fast = 12, slow = 26, signal = 9): Indicators["macd"] {
  const slowE = emaSeries(closes, slow);
  if (slowE.length < signal) return undefined;
  const fastE = emaSeries(closes, fast);
  // Align: slowE[i] is at input index i + slow - 1, fastE[j] at j + fast - 1.
  const line = slowE.map((s, i) => fastE[i + slow - fast] - s);
  const sig = emaSeries(line, signal);
  const m = line[line.length - 1];
  const s = sig[sig.length - 1];
  return { macd: m, signal: s, histogram: m - s };
}

/** True range of a bar given the previous close. */
export const trueRange = (bar: PriceBar, prevClose: number) =>
  Math.max(bar.h - bar.l, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose));

/** Average true range with Wilder's smoothing: first value is the mean of the first `n` true ranges. */
export function atr(bars: PriceBar[], n = 14): number | undefined {
  if (bars.length < n + 1) return undefined;
  let a = 0;
  for (let i = 1; i <= n; i++) a += trueRange(bars[i], bars[i - 1].c);
  a /= n;
  for (let i = n + 1; i < bars.length; i++) a = (a * (n - 1) + trueRange(bars[i], bars[i - 1].c)) / n;
  return a;
}

/** Annualised volatility: sample standard deviation of log returns times sqrt(periods per year). */
export function volatility(closes: number[], perYear: number): number | undefined {
  if (closes.length < 21) return undefined;
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0 && closes[i] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 20) return undefined;
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const v = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(perYear);
}

/** Largest fall from a running peak close, as a positive fraction (0.4 = a 40% fall). */
export function maxDrawdown(closes: number[]): number | undefined {
  if (closes.length < 2) return undefined;
  let peak = closes[0];
  let worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    if (peak > 0) worst = Math.max(worst, (peak - c) / peak);
  }
  return worst;
}

/**
 * Close at or before a target time, from bars sorted oldest first. Undefined when the series does
 * not reach back that far, so a timeframe is never answered from too little history.
 */
export function closeAtOrBefore(bars: PriceBar[], targetMs: number): number | undefined {
  if (bars.length === 0 || ms(bars[0].t) > targetMs) return undefined;
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ms(bars[mid].t) <= targetMs) lo = mid;
    else hi = mid - 1;
  }
  return bars[lo].c;
}

/**
 * Change over 1, 5 and 20 bars of this series: last close / close n bars earlier - 1, as a
 * fraction (0.05 = +5%). A lookback the series cannot reach is left out.
 */
export function changePct(bars: PriceBar[]): Indicators["changePct"] {
  const out: Indicators["changePct"] = {};
  const n = bars.length;
  if (n < 2) return out;
  const last = bars[n - 1].c;
  for (const [k, back] of [["bar1", 1], ["bar5", 5], ["bar20", 20]] as const) {
    if (n - 1 - back < 0) continue;
    const prev = bars[n - 1 - back].c;
    if (prev > 0) out[k] = last / prev - 1;
  }
  return out;
}

/**
 * Simple support and resistance from swing points: a bar is a swing low when its low is the lowest
 * of the `k` bars on each side, a swing high likewise. Support = up to 3 swing lows below the last
 * close, nearest first; resistance = up to 3 swing highs above it, nearest first. Levels within
 * 0.5% of an already chosen level are merged.
 */
export function supportResistance(bars: PriceBar[], k = 5, maxLevels = 3): { support: number[]; resistance: number[] } {
  const lows: number[] = [];
  const highs: number[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let isLow = true;
    let isHigh = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j].l < bars[i].l) isLow = false;
      if (bars[j].h > bars[i].h) isHigh = false;
    }
    if (isLow) lows.push(bars[i].l);
    if (isHigh) highs.push(bars[i].h);
  }
  const last = bars.length ? bars[bars.length - 1].c : NaN;
  const pick = (levels: number[]) => {
    const chosen: number[] = [];
    for (const lv of levels) {
      if (chosen.length >= maxLevels) break;
      if (!chosen.some((c) => Math.abs(c - lv) / c <= 0.005)) chosen.push(lv);
    }
    return chosen;
  };
  return {
    support: pick(lows.filter((x) => x < last).sort((a, b) => b - a)),
    resistance: pick(highs.filter((x) => x > last).sort((a, b) => a - b)),
  };
}

/** Bars whose start lies within 365 days of the last bar, oldest first. */
export function lastYear(bars: PriceBar[]): PriceBar[] {
  if (bars.length === 0) return bars;
  const from = ms(bars[bars.length - 1].t) - 365 * DAY;
  return bars.filter((b) => ms(b.t) > from);
}

/** True when the series reaches back at least 364 days, so 52-week figures are real. */
export function spansYear(bars: PriceBar[]): boolean {
  return bars.length > 1 && ms(bars[bars.length - 1].t) - ms(bars[0].t) >= 364 * DAY;
}

/**
 * All indicators for one series. Volatility and max drawdown use the last 365 days of bars (or all bars when the series is shorter); 52-week high and low are only given
 * when the series covers a full year.
 */
export function computeIndicators(bars: PriceBar[], interval: BarInterval, opts: { crypto: boolean }): Indicators | null {
  const clean = bars.filter((b) => [b.o, b.h, b.l, b.c].every(finite) && finite(ms(b.t)));
  if (clean.length === 0) return null;
  const closes = clean.map((b) => b.c);
  const year = lastYear(clean);
  const yearCloses = year.map((b) => b.c);
  const out: Indicators = {
    last: closes[closes.length - 1],
    changePct: changePct(clean),
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    atr14: atr(clean, 14),
    volatility: volatility(yearCloses, periodsPerYear(interval, opts.crypto)),
    maxDrawdown: maxDrawdown(yearCloses),
  };
  if (spansYear(clean)) {
    out.high52w = Math.max(...year.map((b) => b.h));
    out.low52w = Math.min(...year.map((b) => b.l));
  }
  for (const k of Object.keys(out) as (keyof Indicators)[]) if (out[k] === undefined) delete out[k];
  return out;
}

// ---------------------------------------------------------------------------------------------
// Full series, aligned to the input (undefined where there is not enough history yet). Used by
// the chart read in ./chart.ts for divergences, crosses and the volatility regime.
// ---------------------------------------------------------------------------------------------

/** Simple moving average at every bar. */
export function smaSeries(closes: number[], n: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(closes.length).fill(undefined);
  let s = 0;
  for (let i = 0; i < closes.length; i++) {
    s += closes[i];
    if (i >= n) s -= closes[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

/** RSI (Wilder) at every bar, same formula as `rsi`. */
export function rsiSeries(closes: number[], n = 14): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(closes.length).fill(undefined);
  if (closes.length < n + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  const val = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = val();
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = val();
  }
  return out;
}

/** MACD line (EMA12 - EMA26) at every bar. */
export function macdLineSeries(closes: number[], fast = 12, slow = 26): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(closes.length).fill(undefined);
  const slowE = emaSeries(closes, slow);
  const fastE = emaSeries(closes, fast);
  slowE.forEach((s, i) => {
    out[i + slow - 1] = fastE[i + slow - fast] - s;
  });
  return out;
}

/** ATR (Wilder) at every bar, same formula as `atr`. */
export function atrSeries(bars: PriceBar[], n = 14): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(bars.length).fill(undefined);
  if (bars.length < n + 1) return out;
  let a = 0;
  for (let i = 1; i <= n; i++) a += trueRange(bars[i], bars[i - 1].c);
  a /= n;
  out[n] = a;
  for (let i = n + 1; i < bars.length; i++) {
    a = (a * (n - 1) + trueRange(bars[i], bars[i - 1].c)) / n;
    out[i] = a;
  }
  return out;
}

/** Annualised volatility of the last `window` log returns at every bar. */
export function rollingVolatility(closes: number[], window: number, perYear: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(closes.length).fill(undefined);
  for (let i = window; i < closes.length; i++) {
    const r: number[] = [];
    for (let j = i - window + 1; j <= i; j++) if (closes[j - 1] > 0 && closes[j] > 0) r.push(Math.log(closes[j] / closes[j - 1]));
    if (r.length < window) continue;
    const mean = r.reduce((s, x) => s + x, 0) / r.length;
    const v = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1);
    out[i] = Math.sqrt(v) * Math.sqrt(perYear);
  }
  return out;
}
