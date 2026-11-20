import { test } from "node:test";
import assert from "node:assert/strict";
import type { DailyScore, ResearchNote, WeeklyReport } from "../types.ts";
import { calibration, calibrationClearlyOff, directionRight, initialScore, levelsToScore, qualityBar, updateScores, weeklyScorecard } from "./scores.ts";
import { computeLevels } from "./levels.ts";
import { chartRead } from "./test-helpers.ts";
import { sampleWeekly } from "./snapshot.ts";

const src = { name: "Test fixture" };
function note(date: string, price: number, over: Partial<ResearchNote> = {}): ResearchNote {
  return {
    assetId: "mAAPL",
    date,
    generatedAt: `${date}T22:30:00Z`,
    dataAsOf: `${date}T21:00:00Z`,
    status: "ok",
    summary: "x",
    view: "accumulate",
    conviction: "medium",
    levels: { buyZone: null, invalidation: 90, support: [95], resistance: [110], basis: "test" },
    reasons: [],
    risks: [],
    facts: [
      { id: "px.1d.last", kind: "price", label: "close", value: price, source: src, asOf: `${date}T21:00:00Z` },
      { id: "ind.1d.atr14", kind: "indicator", label: "atr", value: 2, source: src, asOf: `${date}T21:00:00Z` },
    ],
    chart: {},
    model: { triage: "test" },
    ...over,
  };
}

test("direction: accumulate up, cautious down, hold within half an ATR band", () => {
  assert.equal(directionRight("accumulate", 0.01, 0.02, 1), true);
  assert.equal(directionRight("accumulate", -0.01, 0.02, 1), false);
  assert.equal(directionRight("reduce", -0.01, 0.02, 1), true);
  assert.equal(directionRight("avoid-new-buys", 0.01, 0.02, 1), false);
  // Band = 0.5 x 2% = 1% over one day.
  assert.equal(directionRight("hold", 0.009, 0.02, 1), true);
  assert.equal(directionRight("hold", 0.015, 0.02, 1), false);
  // Over 5 days the band widens with the square root of time: 1% x 2.236 = 2.24%.
  assert.equal(directionRight("hold", 0.02, 0.02, 5), true);
  assert.equal(directionRight("hold", 0.03, 0.02, 5), false);
});

test("levels to score: only the side the view relies on, at least one ATR away", () => {
  const lv = { support: [99.5, 97, 90], resistance: [100.5, 104] };
  // ATR 2% of 100 = 2: 99.5 and 100.5 are too close and are skipped.
  assert.deepEqual(levelsToScore("accumulate", lv, 100, 0.02), { support: 97, resistance: undefined });
  assert.deepEqual(levelsToScore("reduce", lv, 100, 0.02), { support: undefined, resistance: 104 });
  assert.deepEqual(levelsToScore("hold", lv, 100, 0.02), { support: 97, resistance: 104 });
  assert.equal(levelsToScore("accumulate", { support: [99.5], resistance: [] }, 100, 0.02), null);
});

test("always Hold no longer looks calibrated", () => {
  const hold = (i: number): DailyScore => ({ assetId: "mAAPL", date: "2026-11-02", view: "hold", conviction: "high", priceAtNote: 1, factsShare: 1, direction5d: i % 2 === 0 });
  assert.deepEqual(calibration([...Array(20)].map((_, i) => hold(i)))[2], { conviction: "high", calls: 0, right: 0 });
});

test("scores fill in after 1 and 5 trading days, levels held or broke", () => {
  const first = note("2026-11-02", 100);
  const s = initialScore(first, 0.75)!;
  assert.deepEqual(s, { assetId: "mAAPL", date: "2026-11-02", view: "accumulate", conviction: "medium", priceAtNote: 100, factsShare: 0.75 });
  const later = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09"].map((d, i) => note(d, [101, 99, 103, 104, 106][i]));
  // After one day only.
  const one = updateScores([s], [first, later[0]]);
  assert.equal(one[0].change1d, 0.01);
  assert.equal(one[0].direction1d, true);
  assert.equal(one[0].change5d, undefined);
  // After five days.
  const five = updateScores(one, [first, ...later]);
  assert.equal(five[0].change5d, 0.06);
  assert.equal(five[0].direction5d, true);
  assert.equal(five[0].levelsHeld, true);
  // A close below support breaks the levels.
  const broke = updateScores([s], [first, ...later.map((n, i) => (i === 2 ? note(n.date, 94) : n))]);
  assert.equal(broke[0].levelsHeld, false);
  // Nothing left to do: no change returned.
  assert.equal(updateScores(five, [first, ...later]).length, 0);
  // Carried and no-reading notes are not trading days with a fresh price.
  const carried = updateScores([s], [first, note("2026-11-03", 120, { status: "carried" })]);
  assert.equal(carried.length, 0);
});

test("calibration by conviction and the clearly-off check", () => {
  const mk = (conviction: DailyScore["conviction"], right: boolean): DailyScore => ({ assetId: "mAAPL", date: "2026-11-02", view: "accumulate", conviction, priceAtNote: 1, factsShare: 1, direction5d: right });
  const scores = [...Array(10)].map((_, i) => mk("high", i < 3)).concat([mk("low", true), mk("low", false), { ...mk("medium", true), direction5d: undefined }]);
  const cal = calibration(scores);
  assert.deepEqual(cal, [
    { conviction: "low", calls: 2, right: 1 },
    { conviction: "medium", calls: 0, right: 0 },
    { conviction: "high", calls: 10, right: 3 },
  ]);
  // 30% right on high conviction calls is clearly off a 75% target.
  assert.equal(calibrationClearlyOff(cal), true);
  assert.equal(calibrationClearlyOff([{ conviction: "high", calls: 10, right: 7 }]), false);
  assert.equal(calibrationClearlyOff([{ conviction: "high", calls: 4, right: 0 }]), false);
});

function liveReport(weekOf: string, over: Partial<WeeklyReport["review"]> = {}): WeeklyReport {
  const r = structuredClone(sampleWeekly());
  return { ...r, kind: "live", weekOf, review: { approved: true, sentBack: 0, removedClaims: 0, notes: [], ...over } };
}

test("the quality bar needs four clean Mondays in a row", () => {
  const weeks = ["2026-11-16", "2026-11-09", "2026-11-02", "2026-10-26"];
  const holds = weeks.map((w): DailyScore => ({ assetId: "mAAPL", date: w, view: "hold", conviction: "medium", priceAtNote: 1, factsShare: 1, humanGrade: 4 }));
  // Ten directional calls before the oldest week, 6 of 10 right at medium conviction (target 60%).
  const calls = [...Array(10)].map((_, i): DailyScore => ({ assetId: "mAAPL", date: "2026-10-20", view: "accumulate", conviction: "medium", priceAtNote: 1, factsShare: 1, direction5d: i < 6 }));
  const grades = [...holds, ...calls];
  const clean = weeks.map((w) => ({ report: liveReport(w), approved: true }));
  assert.equal(qualityBar(clean, grades).met, true);
  // Only Holds: too few directional calls to judge calibration.
  assert.equal(qualityBar(clean, holds).met, false);
  assert.match(qualityBar(clean, holds).weeks[0].why.join(), /too few to judge calibration/);
  assert.equal(qualityBar(clean.slice(0, 3), grades).met, false);
  const corrected = clean.map((w, i) => (i === 2 ? { ...w, report: liveReport(w.report.weekOf, { removedClaims: 1 }) } : w));
  assert.equal(qualityBar(corrected, grades).met, false);
  const lowGrade = grades.map((g, i) => (i === 0 ? { ...g, humanGrade: 2 } : g));
  assert.equal(qualityBar(clean, lowGrade).met, false);
  const gap = clean.map((w, i) => (i === 3 ? { ...w, report: liveReport("2026-10-19") } : w));
  assert.equal(qualityBar(gap, grades).met, false);
  assert.equal(qualityBar(clean, []).met, false);
});

test("the weekly scorecard keeps wrong calls and checks invalidation", () => {
  const prev = liveReport("2026-11-16");
  const btc = prev.assets.find((a) => a.assetId === "mcbBTC")!;
  const price = btc.facts.find((f) => f.id === "px.1d.last")!.value as number;
  const inv = btc.view.levels!.invalidation;
  const later = [
    note("2026-11-17", price * 1.01, { assetId: "mcbBTC" }),
    note("2026-11-18", inv - 1, { assetId: "mcbBTC" }),
    note("2026-11-19", price * 0.99, { assetId: "mcbBTC" }),
  ];
  const card = weeklyScorecard(prev, later, [])!;
  const row = card.rows.find((r) => r.assetId === "mcbBTC")!;
  assert.equal(row.invalidated, true);
  assert.equal(row.result, "wrong");
  assert.equal(card.rows.find((r) => r.assetId === "mAAPL")!.result, "no-data");
  assert.equal(weeklyScorecard(sampleWeekly(), later, []), null);
});

test("levels: zone and invalidation from support, resistance and ATR", () => {
  const daily = { last: 100, atr14: 2, changePct: {} };
  const chart = chartRead("1d", 100);
  const acc = computeLevels("accumulate", daily, chart)!;
  assert.deepEqual(acc.buyZone, { low: 97, high: 98 });
  assert.equal(acc.invalidation, 94);
  assert.match(acc.basis, /support 97/);
  const hold = computeLevels("hold", daily, chart)!;
  assert.equal(hold.buyZone, null);
  assert.equal(hold.invalidation, 95);
  const reduce = computeLevels("reduce", daily, chart)!;
  assert.equal(reduce.invalidation, 106);
  // No support within 3 ATR: zone from the ATR.
  const far = computeLevels("accumulate", daily, chartRead("1d", 100, { support: [80] }))!;
  assert.deepEqual(far.buyZone, { low: 98, high: 99 });
  assert.equal(far.invalidation, 95);
  assert.equal(computeLevels("accumulate", { last: 100, changePct: {} }, chart), null);
  assert.equal(computeLevels("accumulate", undefined, chart), null);
});
