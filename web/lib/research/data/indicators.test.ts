import { test } from "node:test";
import assert from "node:assert/strict";
import type { PriceBar } from "../types.ts";
import { atr, atrSeries, changePct, computeIndicators, emaSeries, macd, macdLineSeries, maxDrawdown, rollingVolatility, rsi, rsiSeries, sma, smaSeries, supportResistance, volatility } from "./indicators.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`);
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
/** Daily bars at UTC midnight from 2026-01-01, high = close + 1, low = close - 1. */
const dailyBars = (closes: number[], start = T0): PriceBar[] =>
  closes.map((c, i) => ({ t: new Date(start + i * DAY).toISOString(), o: c, h: c + 1, l: c - 1, c }));

test("sma averages the last n closes", () => {
  assert.equal(sma([1, 2, 3, 4, 5], 5), 3);
  assert.equal(sma([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3), 9);
  assert.equal(sma([1, 2], 3), undefined);
});

test("ema is seeded with the sma, then a = 2 / (n + 1)", () => {
  // n = 3, a = 0.5: seed (1+2+3)/3 = 2, then 0.5*4 + 0.5*2 = 3, then 0.5*5 + 0.5*3 = 4.
  assert.deepEqual(emaSeries([1, 2, 3, 4, 5], 3), [2, 3, 4]);
});

test("rsi14 by hand: 7 gains of 2 and 7 losses of 1 give RS 2, RSI 66.67", () => {
  const closes = [100];
  for (let i = 0; i < 7; i++) closes.push(closes[closes.length - 1] + 2, closes[closes.length - 1] + 2 - 1);
  assert.equal(closes.length, 15);
  close(rsi(closes)!, 100 - 100 / 3);
  // One more change of +3, Wilder smoothing: gain (1*13+3)/14, loss (0.5*13)/14, RS = 16/6.5.
  closes.push(closes[closes.length - 1] + 3);
  close(rsi(closes)!, 100 - 100 / (1 + 16 / 6.5));
  assert.equal(rsi(Array.from({ length: 15 }, (_, i) => i)), 100);
  assert.equal(rsi(Array(15).fill(5)), 50);
  assert.equal(rsi([1, 2, 3]), undefined);
});

test("macd of a straight line is constant: EMA lag (n-1)/2 gives 12.5 - 5.5 = 7", () => {
  const m = macd(Array.from({ length: 80 }, (_, i) => i + 1))!;
  close(m.macd, 7, 1e-9);
  close(m.signal, 7, 1e-9);
  close(m.histogram, 0, 1e-9);
  assert.equal(macd(Array.from({ length: 30 }, (_, i) => i)), undefined);
});

test("atr14 with Wilder smoothing", () => {
  const bars = dailyBars(Array(15).fill(10)); // every true range is 2
  assert.equal(atr(bars), 2);
  // Next bar gaps up: prev close 10, high 26, low 24 -> TR = max(2, 16, 14) = 16, ATR = (2*13 + 16)/14 = 3.
  bars.push({ t: new Date(T0 + 15 * DAY).toISOString(), o: 25, h: 26, l: 24, c: 25 });
  assert.equal(atr(bars), 3);
  assert.equal(atr(bars.slice(0, 14)), undefined);
});

test("volatility: alternating +-ln(1.1) returns", () => {
  const closes = Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 100 : 110));
  const r = Math.log(1.1);
  // mean ~0 (10 ups, 10 downs), sample variance 20 r^2 / 19, annualised with 252.
  close(volatility(closes, 252)!, r * Math.sqrt(20 / 19) * Math.sqrt(252), 1e-12);
  assert.equal(volatility(closes.slice(0, 10), 252), undefined);
});

test("max drawdown is the worst fall from a running peak", () => {
  assert.equal(maxDrawdown([100, 120, 90, 130, 117]), 0.25); // 120 -> 90
  assert.equal(maxDrawdown([1, 2, 3]), 0);
});

test("change over 1, 5 and 20 bars, as a fraction, skipping lookbacks the series cannot reach", () => {
  const bars = dailyBars(Array.from({ length: 21 }, (_, i) => 100 + i)); // last close 120
  const c = changePct(bars);
  close(c.bar1!, 120 / 119 - 1);
  close(c.bar5!, 120 / 115 - 1);
  close(c.bar20!, 120 / 100 - 1);
  const short = changePct(dailyBars([100, 110, 121]));
  close(short.bar1!, 0.1);
  assert.equal(short.bar5, undefined);
  assert.deepEqual(changePct(dailyBars([5])), {});
});

test("full series match the single-value indicators at the last bar", () => {
  const closes = Array.from({ length: 80 }, (_, i) => 100 + 10 * Math.sin(i / 5) + i * 0.2);
  const bars = dailyBars(closes);
  close(rsiSeries(closes).at(-1)!, rsi(closes)!);
  close(macdLineSeries(closes).at(-1)!, macd(closes)!.macd);
  close(atrSeries(bars).at(-1)!, atr(bars)!);
  close(smaSeries(closes, 20).at(-1)!, sma(closes, 20)!);
  close(rollingVolatility(closes, 20, 365).at(-1)!, volatility(closes.slice(-21), 365)!);
  assert.equal(rsiSeries(closes)[13], undefined);
});

test("support and resistance from swing lows and highs", () => {
  const closes = [10, 9, 8, 9, 10, 11, 12, 11, 10, 11];
  const bars = closes.map((c, i) => ({ t: new Date(T0 + i * DAY).toISOString(), o: c, h: c, l: c, c }));
  assert.deepEqual(supportResistance(bars, 2), { support: [8], resistance: [12] });
});

test("computeIndicators gives 52-week figures only with a full year of bars", () => {
  const short = computeIndicators(dailyBars(Array.from({ length: 60 }, (_, i) => 50 + i)), "1d", { crypto: true })!;
  assert.equal(short.last, 109);
  assert.equal(short.sma20, (90 + 109) / 2);
  assert.equal(short.high52w, undefined);
  const year = computeIndicators(dailyBars(Array.from({ length: 400 }, (_, i) => 50 + (i % 100))), "1d", { crypto: true })!;
  assert.equal(year.high52w, 150); // max close 149 + 1
  assert.equal(year.low52w, 49);
  assert.ok(year.sma200 !== undefined && year.rsi14 !== undefined && year.atr14 !== undefined);
  assert.equal(computeIndicators([], "1d", { crypto: false }), null);
});
