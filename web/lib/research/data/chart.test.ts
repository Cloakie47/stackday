import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pattern, PatternKind, PriceBar } from "../types.ts";
import { CHART_PARAMS, clusterLevels, detectorMinBars, findSwings, isInvalidated, levelTolerance, percentileRank, positionInRange, publishPatterns, readChart, slope, trendStructure, volatilityRegime } from "./chart.ts";
import { smaSeries } from "./indicators.ts";

/**
 * Synthetic bars for every detector. Prices follow straight segments; each bar opens at the
 * previous close with a high and low `w` beyond the body, so ATR is about 2w plus the step.
 */
const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);

function bars(closes: number[], w: number | number[] = 1, volume?: number[]): PriceBar[] {
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    const wi = Array.isArray(w) ? w[i] : w;
    return { t: new Date(T0 + i * DAY).toISOString(), o, h: Math.max(o, c) + wi, l: Math.min(o, c) - wi, c, ...(volume ? { v: volume[i] } : {}) };
  });
}

/** `n` closes stepping evenly from just after `from` to `to`. */
const seg = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / n);
const flat = (p: number, n: number) => Array(n).fill(p);
/** A gentle wave so a flat stretch still has swing points. */
const wave = (mid: number, amp: number, n: number, period = 10) => Array.from({ length: n }, (_, i) => mid + amp * Math.sin((2 * Math.PI * i) / period));
/** Mirror image around 100: highs become lows, rallies become falls. */
const mirror = (bs: PriceBar[]): PriceBar[] => bs.map((b) => ({ ...b, o: 200 - b.o, h: 200 - b.l, l: 200 - b.h, c: 200 - b.c }));

const read = (bs: PriceBar[]) => readChart(bs, "1d", { crypto: true })!;
const kinds = (bs: PriceBar[]) => read(bs).patterns.map((p) => p.kind);
const get = (bs: PriceBar[], kind: PatternKind) => {
  const p = read(bs).patterns.find((x) => x.kind === kind);
  assert.ok(p, `expected ${kind}, got ${kinds(bs).join(", ") || "none"}`);
  return p;
};

test("swing points: a peak needs k lower highs on each side, a flat top counts once", () => {
  const line = (cs: number[]): PriceBar[] => cs.map((c, i) => ({ t: new Date(T0 + i * DAY).toISOString(), o: c, h: c, l: c, c }));
  const s = findSwings(line([1, 2, 3, 4, 3, 2, 1, 2, 3]), 2);
  assert.deepEqual(s.map((x) => [x.i, x.type, x.price]), [[3, "high", 4], [6, "low", 1]]);
  assert.deepEqual(findSwings(line([1, 2, 5, 5, 2, 1]), 2).map((x) => x.i), [3]);
  assert.deepEqual(findSwings(line(flat(5, 10)), 2), []);
});

test("trend structure from the last two swing highs and lows", () => {
  const up = bars([...seg(100, 110, 5), ...seg(110, 105, 5), ...seg(105, 118, 5), ...seg(118, 112, 5), ...seg(112, 125, 5), ...seg(125, 120, 5)], 0.5);
  assert.equal(trendStructure(findSwings(up, 2), 1), "higher-highs-higher-lows");
  assert.equal(trendStructure(findSwings(mirror(up), 2), 1), "lower-highs-lower-lows");
  assert.equal(trendStructure(findSwings(bars(wave(100, 3, 60), 0.5), 2), 1.5), "range");
  assert.equal(trendStructure([], 1), "range");
});

test("support and resistance cluster nearby swings and sort nearest first", () => {
  const sw = [95, 95.5, 90, 105, 104.6, 110].map((price, i) => ({ i, t: "", price, type: "low" as const }));
  const lv = clusterLevels(sw, 100, 1);
  assert.deepEqual(lv.support, [{ price: 95.25, touches: 2 }, { price: 90, touches: 1 }]);
  assert.deepEqual(lv.resistance, [{ price: 104.8, touches: 2 }, { price: 110, touches: 1 }]);
  assert.equal(positionInRange(100, 95, 105), 0.5);
  assert.equal(positionInRange(100, undefined, 105), null);
  assert.equal(levelTolerance(100, 4), 2);
  assert.equal(levelTolerance(100, 1), 1);
});

test("too little history is no reading", () => {
  assert.equal(readChart(bars(flat(100, 20)), "1d", { crypto: true }), null);
});

test("breakout above the prior 20-bar high, and its mirror breakdown", () => {
  const closes = [...wave(100, 2, 50), 108];
  const vol = [...Array(50).fill(100), 300];
  const p = get(bars(closes, 1, vol), "breakout");
  assert.equal(p.direction, "bullish");
  assert.equal(p.id, "pat.1d.breakout");
  assert.equal(p.confidence, "high");
  assert.ok(p.invalidation < 103 && p.invalidation > 99, `invalidation ${p.invalidation}`);
  assert.match(p.detail, /above the prior 20-bar high/);
  const d = get(mirror(bars(closes, 1, vol)), "breakdown");
  assert.equal(d.direction, "bearish");
  assert.ok(d.invalidation > 97 && d.invalidation < 101);
  // No volume: confidence is capped at medium.
  assert.equal(get(bars(closes), "breakout").confidence, "medium");
  // A breakout that already failed is not reported.
  assert.ok(!kinds(bars([...closes, 100])).includes("breakout"));
});

test("a tight range is a neutral pattern; it is not reported next to a breakout", () => {
  const bs = bars(wave(100, 2, 60));
  const r = read(bs);
  assert.equal(r.trend, "range");
  const p = r.patterns.find((x) => x.kind === "range")!;
  assert.ok(p, kinds(bs).join());
  assert.equal(p.direction, "neutral");
  assert.ok(p.invalidation < 97);
  assert.ok(r.support.length > 0 && r.resistance.length > 0);
  assert.ok(r.positionInRange !== null && r.positionInRange >= 0 && r.positionInRange <= 1);
  assert.ok(!kinds(bars([...wave(100, 2, 50), 108])).includes("range"));
});

test("bull flag: sharp pole, shallow downward drift; bear flag mirrored", () => {
  const closes = [...wave(100, 0.5, 40), ...seg(100, 130, 6), ...seg(130, 124, 6)];
  const p = get(bars(closes), "bull-flag");
  assert.equal(p.direction, "bullish");
  assert.equal(p.invalidation, 123); // flag low: last close 124 minus w
  assert.match(p.detail, /pole .* then \d+ bars .* giving back \d+%/);
  const b = get(mirror(bars(closes)), "bear-flag");
  assert.equal(b.invalidation, 77);
  // A flag that gives back the whole pole is not a flag.
  assert.ok(!kinds(bars([...wave(100, 0.5, 40), ...seg(100, 130, 6), ...seg(130, 108, 6)])).includes("bull-flag"));
});

test("double top confirmed on the neckline break; double bottom mirrored", () => {
  const closes = [...wave(100, 0.5, 30), ...seg(100, 120, 10), ...seg(120, 108, 6), ...seg(108, 120, 6), ...seg(120, 104, 8)];
  const p = get(bars(closes), "double-top");
  assert.equal(p.direction, "bearish");
  assert.equal(p.invalidation, 121);
  assert.match(p.detail, /neckline 107.00 broken/);
  assert.notEqual(p.confidence, "low");
  const b = get(mirror(bars(closes)), "double-bottom");
  assert.equal(b.direction, "bullish");
  assert.equal(b.invalidation, 79);
  // Before the neckline breaks it is only "forming", low confidence.
  const forming = get(bars(closes.slice(0, closes.length - 4)), "double-top");
  assert.equal(forming.confidence, "low");
  assert.match(forming.detail, /forming/);
});

test("head and shoulders and its inverse", () => {
  const closes = [...wave(100, 0.5, 30), ...seg(100, 115, 5), ...seg(115, 105, 5), ...seg(105, 125, 5), ...seg(125, 105, 5), ...seg(105, 115, 5), ...seg(115, 100, 5)];
  const p = get(bars(closes), "head-and-shoulders");
  assert.equal(p.direction, "bearish");
  assert.equal(p.invalidation, 126); // head high
  assert.match(p.detail, /head 126.00, neckline 104.00 broken/);
  assert.equal(p.confidence, "high");
  const inv = get(mirror(bars(closes)), "inverse-head-and-shoulders");
  assert.equal(inv.direction, "bullish");
  assert.equal(inv.invalidation, 74);
});

test("golden and death crosses of the 50- and 200-bar averages", () => {
  const closes = [...seg(190, 100, 220), ...seg(100, 170, 80)];
  const s50 = smaSeries(closes, 50);
  const s200 = smaSeries(closes, 200);
  const j = s50.findIndex((v, i) => i > 0 && v !== undefined && s200[i] !== undefined && s200[i - 1] !== undefined && s50[i - 1]! <= s200[i - 1]! && v > s200[i]!);
  assert.ok(j > 0, "the synthetic path crosses");
  const bs = bars(closes.slice(0, j + 3));
  const p = get(bs, "golden-cross");
  assert.equal(p.direction, "bullish");
  assert.equal(p.asOf, bs[j].t);
  assert.match(p.detail, /crossed above .* 2 bars ago/);
  assert.equal(get(mirror(bs), "death-cross").direction, "bearish");
  // Too long ago: not reported.
  assert.ok(!kinds(bars(closes.slice(0, j + 30))).includes("golden-cross"));
  // A golden cross whose last close is back below the 200-bar average is already invalidated:
  // not reported (it used to come out as "low" confidence with the invalidation above the price).
  const back = [...closes.slice(0, j + 2), 125];
  const a50 = smaSeries(back, 50).at(-1)!;
  const a200 = smaSeries(back, 200).at(-1)!;
  assert.ok(a50 > a200 && 125 < a200, "the 50-bar average is still above the 200-bar average, the price is below both");
  assert.ok(!kinds(bars(back)).includes("golden-cross"));
  assert.ok(!kinds(mirror(bars(back))).includes("death-cross"));
});

test("no pattern is published once the last close is past its invalidation", () => {
  const p = (direction: Pattern["direction"], invalidation: number): Pattern => ({ id: "pat.1d.x", kind: "golden-cross", interval: "1d", direction, confidence: "low", invalidation, asOf: "", detail: "" });
  // The reviewer's example: last 89.00 under a golden cross invalidated at 89.26.
  assert.equal(isInvalidated(p("bullish", 89.26), 89.0), true);
  assert.equal(isInvalidated(p("bullish", 89.26), 89.26), false);
  assert.equal(isInvalidated(p("bearish", 120), 121), true);
  assert.equal(isInvalidated(p("bearish", 120), 119), false);
  assert.equal(isInvalidated(p("neutral", 95), 94.9), true, "a range breaks below its floor");
  // Double top confirmed, then a rally closes above the higher top (121): no double top.
  const dt = [...wave(100, 0.5, 30), ...seg(100, 120, 10), ...seg(120, 108, 6), ...seg(108, 120, 6), ...seg(120, 104, 8)];
  assert.ok(kinds(bars(dt)).includes("double-top"));
  assert.ok(!kinds(bars([...dt, ...seg(104, 125, 3)])).includes("double-top"));
  // Bullish divergences, then a close below the lower low (77): neither divergence is published.
  const dv = [...wave(100, 0.5, 40), ...seg(100, 80, 4), ...seg(80, 90, 8), ...seg(90, 78, 12), ...seg(78, 82, 4)];
  assert.ok(kinds(bars(dv)).includes("rsi-bullish-divergence"));
  const dropped = kinds(bars([...dv, ...seg(82, 74, 2)]));
  assert.ok(!dropped.includes("rsi-bullish-divergence") && !dropped.includes("macd-bullish-divergence"), dropped.join(", "));
  // Every detector goes through the same check.
  for (const cs of [dt, [...dt, ...seg(104, 125, 3)], dv, [...dv, ...seg(82, 74, 2)]]) {
    const r = read(bars(cs));
    for (const x of r.patterns) assert.equal(isInvalidated(x, cs.at(-1)!), false, x.kind);
  }
});

test("RSI and MACD divergences: lower price low, higher oscillator low (and the mirror)", () => {
  const closes = [...wave(100, 0.5, 40), ...seg(100, 80, 4), ...seg(80, 90, 8), ...seg(90, 78, 12), ...seg(78, 82, 4)];
  const r = get(bars(closes), "rsi-bullish-divergence");
  assert.equal(r.direction, "bullish");
  assert.equal(r.invalidation, 77); // the lower low
  assert.match(r.detail, /lower low 79.00 to 77.00 while RSI rose/);
  get(bars(closes), "macd-bullish-divergence");
  assert.equal(get(mirror(bars(closes)), "rsi-bearish-divergence").invalidation, 123);
  get(mirror(bars(closes)), "macd-bearish-divergence");
  // Price and RSI both making lower lows: no divergence.
  const both = [...wave(100, 0.5, 40), ...seg(100, 90, 6), ...seg(90, 95, 4), ...seg(95, 70, 5), ...seg(70, 73, 4)];
  assert.ok(!kinds(bars(both)).includes("rsi-bullish-divergence"));
});

test("volatility regime ranks ATR and realized volatility against the last year", () => {
  const calm = wave(100, 1, 330, 7);
  const wild = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 ? 8 : -8));
  const high = volatilityRegime(bars([...calm, ...wild], [...Array(330).fill(0.5), ...Array(30).fill(4)]), "1d", true);
  assert.equal(high.regime, "high");
  assert.ok(high.atrPercentile! >= 0.9 && high.volPercentile! >= 0.9);
  const low = volatilityRegime(bars([...Array.from({ length: 330 }, (_, i) => 100 + (i % 2 ? 6 : -6)), ...wave(100, 0.2, 40, 7)], [...Array(330).fill(3), ...Array(40).fill(0.2)]), "1d", true);
  assert.equal(low.regime, "low");
  assert.equal(volatilityRegime(bars(flat(100, 10)), "1d", true).regime, "unknown");
  assert.equal(percentileRank([1, 2, 3, 4], 3), 0.75);
});

test("helpers and parameters", () => {
  assert.equal(slope([1, 2, 3, 4]), 1);
  assert.equal(slope([5]), 0);
  for (const iv of ["1d", "1w", "1mo"] as const) assert.ok(CHART_PARAMS[iv].k >= 2);
  // Pattern ids are unique per timeframe and kind, and every pattern has a finite invalidation.
  const r = read(bars([...wave(100, 0.5, 40), ...seg(100, 80, 4), ...seg(80, 90, 8), ...seg(90, 78, 12), ...seg(78, 82, 4)]));
  const ids = r.patterns.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of r.patterns) assert.ok(Number.isFinite(p.invalidation) && p.detail.length > 0);
});

test("a filtered-out breakout does not hide the range: invalidation is checked before the range rule", () => {
  const pat = (kind: Pattern["kind"], direction: Pattern["direction"], invalidation: number): Pattern => ({ id: `pat.1d.${kind}`, kind, interval: "1d", direction, confidence: "low", invalidation, asOf: "2026-11-20T00:00:00.000Z", detail: "test" });
  const range = pat("range", "neutral", 95);
  // The breakout's invalidation (101) is above the last close (100): it is already proven wrong and dropped.
  const out = publishPatterns([pat("breakout", "bullish", 101)], () => range, 100);
  assert.deepEqual(out.map((p) => p.kind), ["range"]);
  // A breakout that still stands keeps the range out, and the range detector is not even asked.
  let asked = false;
  const kept = publishPatterns([pat("breakout", "bullish", 99)], () => ((asked = true), range), 100);
  assert.deepEqual(kept.map((p) => p.kind), ["breakout"]);
  assert.equal(asked, false);
  // An invalidated range is not published either.
  assert.deepEqual(publishPatterns([], () => pat("range", "neutral", 101), 100), []);
});

test("short history: detectors that need more bars say no reading instead of guessing", () => {
  const short = readChart(bars(wave(100, 3, 80)), "1d", { crypto: false })!;
  assert.equal(short.bars, 80);
  assert.deepEqual(short.noReading.map((x) => [x.kind, x.minBars]), [["golden-cross", 211], ["death-cross", 211]]);
  assert.ok(!short.patterns.some((p) => p.kind === "golden-cross" || p.kind === "death-cross"));
  const tiny = readChart(bars(wave(100, 3, 32)), "1d", { crypto: false })!;
  assert.ok(tiny.noReading.some((x) => x.kind === "macd-bullish-divergence" && x.minBars === 35));
  assert.equal(detectorMinBars("range", "1w"), 30);
  const long = readChart(bars(wave(100, 3, 260)), "1d", { crypto: false })!;
  assert.deepEqual(long.noReading, []);
});
