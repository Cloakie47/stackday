import { test } from "node:test";
import assert from "node:assert/strict";
import { approveReply, gradeReply, historyReply, runScoreUpdate, sampleSnapshot, sampleWeekly, scoresReply, snapshotReply, weeklyReply } from "./snapshot.ts";
import { isReviewer, reviewerList } from "./reviewers.ts";
import { memoryStore } from "./store.ts";
import { runDaily } from "./daily.ts";
import { runWeekly } from "./weekly.ts";
import { fakeModel, goodDaily, makeInput, makeMarket, runWeekFully, weeklyAnswers } from "./test-helpers.ts";
import { snapshotProblems, weeklyProblems } from "./validate.ts";
import { BETA_LABEL } from "../types.ts";

const ME = "0x" + "a".repeat(40);
const allowed = async () => ({ allowed: true as const, consumesCredit: false });

test("both sample files parse, are labelled sample and cover the six assets", () => {
  const snap = sampleSnapshot();
  assert.deepEqual(snapshotProblems(snap), []);
  assert.equal(snap.kind, "sample");
  assert.equal(snap.notes.length, 6);
  const w = sampleWeekly();
  assert.deepEqual(weeklyProblems(w), []);
  assert.equal(w.kind, "sample");
  assert.equal(w.beta, true);
  assert.equal(w.assets.length, 6);
  // Every number in the samples is marked as sample data.
  for (const f of [...snap.notes.flatMap((n) => n.facts), ...w.assets.flatMap((a) => a.facts)]) {
    assert.match(f.label, /^Sample:/);
    assert.match(f.source.name, /^Sample data/);
  }
  assert.ok(BETA_LABEL.length > 0);
});

test("reviewers come from RESEARCH_REVIEWERS, lowercase wallets only", () => {
  const list = reviewerList(` ${ME.toUpperCase().replace("0X", "0x")} , not-a-wallet,`);
  assert.equal(list.size, 1);
  assert.equal(isReviewer(ME, list), true);
  assert.equal(isReviewer("0x" + "b".repeat(40), list), false);
  assert.equal(isReviewer(null, list), false);
});

test("live daily notes are reviewer-only; everyone else gets the sample with internal: true", async () => {
  const { store } = memoryStore();
  await runDaily({ gather: async (a, d) => makeInput(a, d), model: fakeModel(() => goodDaily()).fn, store, maxRunCostUsd: 2, maxDayCostUsd: 6, now: () => new Date("2026-11-19T22:30:00Z") });
  const pub = (await snapshotReply(store, false)).body as { snapshot: { kind: string }; internal: boolean };
  assert.equal(pub.snapshot.kind, "sample");
  assert.equal(pub.internal, true);
  const rev = (await snapshotReply(store, true)).body as { snapshot: { kind: string }; internal: boolean };
  assert.equal(rev.snapshot.kind, "live");
  assert.equal(rev.internal, false);
  // No database: still answers with the sample.
  assert.equal(((await snapshotReply(null, true)).body as { snapshot: { kind: string } }).snapshot.kind, "sample");

  const hPub = (await historyReply(store, "mAAPL", false)).body as { kind: string; notes: unknown[] };
  assert.equal(hPub.kind, "sample");
  const hRev = (await historyReply(store, "mAAPL", true)).body as { kind: string; notes: { view: string; price: number }[]; track: { calls: number } };
  assert.equal(hRev.kind, "live");
  assert.deepEqual(Object.keys(hRev.notes[0]).sort(), ["conviction", "date", "price", "summary", "view"]);
  assert.equal(hRev.notes[0].price, 100);
  assert.equal((await historyReply(store, "mMSFT", true)).status, 400);
});

test("weekly reports are public only after approval; approve and grade are reviewer-only", async () => {
  const { store } = memoryStore();
  const deps = { gather: async (a: string, d: string) => makeInput(a, d), gatherMarket: async (d: string) => makeMarket(d), model: fakeModel(weeklyAnswers()).fn, store, maxRunCostUsd: 4, maxDayCostUsd: 6, now: () => new Date("2026-11-23T12:00:00Z") };
  const { last } = await runWeekFully(deps);
  assert.equal(last.status, "ok", last.problems.join("\n"));
  const runId = last.runId;
  const kind = async (reviewer: boolean, weekOf: string | null = null) => ((await weeklyReply(store, { weekOf, reviewer, access: allowed })).body as { report: { kind: string } }).report.kind;
  assert.equal(await kind(false), "sample");
  assert.equal(await kind(false, "2026-11-23"), "sample");
  assert.equal(await kind(true), "live");
  assert.equal((await weeklyReply(store, { weekOf: "bad", reviewer: false, access: allowed })).status, 400);

  assert.equal((await approveReply(store, null, false, { weekOf: "2026-11-23", runId })).status, 401);
  assert.equal((await approveReply(store, ME, false, { weekOf: "2026-11-23", runId })).status, 403);
  assert.equal((await approveReply(store, ME, true, { weekOf: "2026-11-23" })).status, 400);
  assert.equal((await approveReply(store, ME, true, { weekOf: "2026-11-30", runId })).status, 404);
  // A run id other than the report's (a version the reviewer never read) approves nothing.
  assert.equal((await approveReply(store, ME, true, { weekOf: "2026-11-23", runId: "2026-11-23-weekly-other" })).status, 404);
  assert.equal(await kind(false), "sample");
  assert.deepEqual((await approveReply(store, ME, true, { weekOf: "2026-11-23", runId })).body, { ok: true });
  assert.equal(await kind(false), "live");
  assert.equal(await kind(false, "2026-11-23"), "live");

  // A re-run that week (duplicate cron, manual call) skips and leaves the approved report as it is.
  const again = await runWeekly(deps);
  assert.equal(again.status, "skipped");
  assert.equal(again.step, "skipped");
  assert.equal((await store.weekly("2026-11-23"))?.approved, true);
  assert.equal((await store.weekly("2026-11-23"))?.report.runId, runId);
  // Even a direct second write never replaces it.
  const report = (await store.weekly("2026-11-23"))!.report;
  assert.equal(await store.writeWeekly("2026-11-23-weekly-dup", { ...report, runId: "2026-11-23-weekly-dup" }), false);
  assert.equal((await store.weekly("2026-11-23"))?.approved, true);

  // Paywall answer from the access gate is respected for live reports.
  const paid = await weeklyReply(store, { weekOf: null, reviewer: false, access: async () => ({ allowed: false, reason: "payment-required" }) });
  assert.equal(paid.status, 402);
  assert.equal((paid.body as { report: unknown }).report, null);

  // A paid live report is sent only after its credit was spent; any error there is a 402.
  const spends = async () => ({ allowed: true as const, consumesCredit: true });
  const spent: string[] = [];
  const ok = await weeklyReply(store, { weekOf: null, reviewer: false, access: spends, consume: async (w) => void spent.push(w), paidCheck: true });
  assert.equal(ok.status, 200);
  assert.deepEqual(spent, ["2026-11-23"]);
  assert.ok(!ok.publicCache);
  const broken = await weeklyReply(store, { weekOf: null, reviewer: false, access: spends, consume: async () => Promise.reject(new Error("db down")) });
  assert.equal(broken.status, 402);
  assert.deepEqual(broken.body, { report: null, access: { allowed: false, reason: "payment-required" } });
  assert.equal((await weeklyReply(store, { weekOf: null, reviewer: false, access: spends })).status, 402);
  // Even the free sample is not publicly cached after a paid access check.
  const sampleOnly = await weeklyReply(null, { weekOf: null, reviewer: false, access: allowed, paidCheck: true });
  assert.equal((sampleOnly.body as { report: { kind: string } }).report.kind, "sample");
  assert.ok(!sampleOnly.publicCache);
  assert.ok((await weeklyReply(null, { weekOf: null, reviewer: false, access: allowed })).publicCache);
});

test("scores are public; grading is reviewer-only and the score cron fills results", async () => {
  const { store, scores } = memoryStore();
  const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09"];
  for (const [i, d] of days.entries()) {
    const gather = async (a: string, date: string) => makeInput(a, date, { last: 100 + i });
    await runDaily({ gather, model: fakeModel(() => goodDaily()).fn, store, maxRunCostUsd: 2, maxDayCostUsd: 6, now: () => new Date(`${d}T22:30:00Z`) });
  }
  const res = await runScoreUpdate(store, "2026-11-09");
  assert.ok(res.updated > 0);
  const first = scores.get("2026-11-02|mAAPL")!;
  assert.equal(first.direction1d, true);
  assert.equal(first.change5d, 0.05);
  assert.equal(first.direction5d, true);

  const pub = (await scoresReply(store, "mAAPL", "2026-11-09")).body as { scores: unknown[]; calibration: { conviction: string; calls: number; right: number }[] };
  assert.equal(pub.scores.length, 6);
  assert.deepEqual(pub.calibration.find((c) => c.conviction === "medium"), { conviction: "medium", calls: 1, right: 1 });
  assert.equal((await scoresReply(null, null, "2026-11-09")).status, 200);
  assert.equal((await scoresReply(store, "mXYZ", "2026-11-09")).status, 400);

  const body = { date: "2026-11-02", assetId: "mAAPL", grade: 4 };
  assert.equal((await gradeReply(store, null, false, body)).status, 401);
  assert.equal((await gradeReply(store, ME, false, body)).status, 403);
  assert.equal((await gradeReply(store, ME, true, { ...body, grade: 6 })).status, 400);
  assert.deepEqual((await gradeReply(store, ME, true, body)).body, { ok: true });
  assert.equal(scores.get("2026-11-02|mAAPL")!.humanGrade, 4);
  // A later automatic update keeps the human grade.
  await store.upsertScores([{ ...scores.get("2026-11-02|mAAPL")!, humanGrade: undefined }]);
  assert.equal(scores.get("2026-11-02|mAAPL")!.humanGrade, 4);
});
