import { test } from "node:test";
import assert from "node:assert/strict";
import { runResearch, costBudget, MAX_NO_READINGS } from "./run.ts";
import { memoryStore } from "./store.ts";
import { fakeModel, goodReading, makeInput } from "./fixtures.test-helpers.ts";
import { UNIVERSE } from "../universe.ts";
import type { GatherFn } from "./run.ts";
import { isSnapshot } from "./validate.ts";

const THURSDAY = () => new Date("2026-11-19T22:30:00Z");
const SATURDAY = () => new Date("2026-11-21T22:30:00Z");
const gather: GatherFn = async (assetId, date) => makeInput(assetId, date);

test("a weekday run researches all 15 assets and writes a valid live snapshot", async () => {
  const { store, runs } = memoryStore();
  const model = fakeModel(() => goodReading());
  const out = await runResearch({ gather, model: model.fn, store, maxRunCostUsd: 2, now: THURSDAY });
  assert.equal(out.status, "ok");
  assert.equal(out.written, true);
  assert.equal(out.counts.ok, UNIVERSE.length);
  assert.ok(model.calls.every((c) => c.tier === "triage"));
  const snap = await store.latestSnapshot();
  assert.ok(snap && isSnapshot(snap));
  assert.equal(snap.notes.length, 15);
  assert.equal(snap.notes.find((n) => n.assetId === "mSPCX")?.levels, null);
  assert.equal(snap.notes.find((n) => n.assetId === "mSGOV")?.levels, null);
  assert.ok(snap.notes.find((n) => n.assetId === "mAAPL")?.levels);
  assert.equal([...runs.values()][0].status, "ok");
  // The cached system prompt is identical on every call.
  assert.equal(new Set(model.calls.map((c) => c.system)).size, 1);
});

test("at the weekend stock notes are carried and only crypto and gold are researched", async () => {
  const { store } = memoryStore();
  await runResearch({ gather, model: fakeModel(() => goodReading()).fn, store, maxRunCostUsd: 2, now: THURSDAY });
  const model = fakeModel(() => goodReading({ action: "watch", materialEvent: false }));
  const out = await runResearch({ gather, model: model.fn, store, maxRunCostUsd: 2, now: SATURDAY });
  assert.equal(out.status, "ok");
  assert.equal(out.counts.carried, 12);
  assert.equal(out.counts.ok, 3);
  const snap = await store.latestSnapshot();
  const aapl = snap!.notes.find((n) => n.assetId === "mAAPL")!;
  assert.equal(aapl.status, "carried");
  assert.equal(aapl.date, "2026-11-21");
});

test("a holiday from the data branch carries the note too", async () => {
  const { store } = memoryStore();
  const holiday: GatherFn = async (assetId, date) => makeInput(assetId, date, { marketOpenToday: !["mAAPL", "mMSFT"].includes(assetId) });
  const out = await runResearch({ gather: holiday, model: fakeModel(() => goodReading()).fn, store, maxRunCostUsd: 2, now: THURSDAY });
  assert.equal(out.counts.noReading, 2); // nothing earlier to carry, not counted as failures
  assert.equal(out.status, "ok");
});

test("material cases are re-read by the escalation model", async () => {
  const { store } = memoryStore();
  const model = fakeModel((req) => goodReading({ materialEvent: req.tier === "triage" && req.user.includes("mNVDA") }));
  const out = await runResearch({ gather, model: model.fn, store, maxRunCostUsd: 2, now: THURSDAY });
  assert.equal(out.counts.escalated, 1);
  const snap = await store.latestSnapshot();
  assert.deepEqual(snap!.notes.find((n) => n.assetId === "mNVDA")!.model, { triage: "claude-haiku-5-5", escalated: "claude-sonnet-5-5" });
});

test("a big one-day move escalates; a failed triage answer gets one retry on the stronger model", async () => {
  const { store } = memoryStore();
  const moving: GatherFn = async (assetId, date) => makeInput(assetId, date, { changePct: assetId === "mTSLA" ? -6 : 0.5 });
  const model = fakeModel((req) => (req.tier === "triage" && req.user.includes("mAMD") ? "not json" : goodReading()));
  const out = await runResearch({ gather: moving, model: model.fn, store, maxRunCostUsd: 2, now: THURSDAY });
  assert.equal(out.status, "ok");
  assert.equal(out.counts.escalated, 2);
  assert.equal(out.counts.noReading, 0);
});

test(`up to ${MAX_NO_READINGS} no-readings are shown; more means nothing is written`, async () => {
  const two = memoryStore();
  const bad2 = fakeModel((req) => (/mAAPL|mMSFT/.test(req.user) ? "garbage" : goodReading()));
  const ok = await runResearch({ gather, model: bad2.fn, store: two.store, maxRunCostUsd: 2, now: THURSDAY });
  assert.equal(ok.status, "ok");
  assert.equal(ok.counts.noReading, 2);
  const snap = await two.store.latestSnapshot();
  assert.equal(snap!.notes.find((n) => n.assetId === "mAAPL")!.status, "no-reading");

  const three = memoryStore();
  const bad3 = fakeModel((req) => (/mAAPL|mMSFT|mAMZN/.test(req.user) ? "garbage" : goodReading()));
  const failed = await runResearch({ gather, model: bad3.fn, store: three.store, maxRunCostUsd: 2, now: THURSDAY });
  assert.equal(failed.status, "failed");
  assert.equal(failed.written, false);
  assert.equal(await three.store.latestSnapshot(), null);
  assert.equal([...three.runs.values()][0].status, "failed");
});

test("data failures count toward the failure policy", async () => {
  const { store } = memoryStore();
  const broken: GatherFn = async (assetId, date) => {
    if (["mAAPL", "mNVDA", "mMETA"].includes(assetId)) throw new Error("price source down");
    return makeInput(assetId, date);
  };
  const out = await runResearch({ gather: broken, model: fakeModel(() => goodReading()).fn, store, maxRunCostUsd: 2, now: THURSDAY });
  assert.equal(out.status, "failed");
  assert.match(out.problems.join("\n"), /price source down/);
});

test("the cost guard aborts the run and writes nothing", async () => {
  const { store, runs } = memoryStore();
  const out = await runResearch({ gather, model: fakeModel(() => goodReading(), 0.5).fn, store, maxRunCostUsd: 1, now: THURSDAY, concurrency: 1 });
  assert.equal(out.status, "aborted-cost");
  assert.equal(out.written, false);
  assert.equal(await store.latestSnapshot(), null);
  assert.equal([...runs.values()][0].status, "aborted-cost");
  assert.ok(out.costUsd <= 1);
});

test("a zero or invalid budget never calls the model", async () => {
  const { store } = memoryStore();
  const model = fakeModel(() => goodReading());
  const out = await runResearch({ gather, model: model.fn, store, maxRunCostUsd: Number.NaN, now: THURSDAY });
  assert.equal(out.status, "aborted-cost");
  assert.equal(model.calls.length, 0);
});

test("budget reserves the worst case of calls in flight", () => {
  const b = costBudget(1);
  b.reserve(0.6);
  assert.throws(() => b.reserve(0.6));
  b.settle(0.6, 0.1);
  b.reserve(0.6);
  assert.equal(b.spent, 0.1);
});

test("previous action is recorded and a change shows in the market overview", async () => {
  const { store } = memoryStore();
  await runResearch({ gather, model: fakeModel(() => goodReading()).fn, store, maxRunCostUsd: 2, now: () => new Date("2026-11-18T22:30:00Z") });
  await runResearch({ gather, model: fakeModel(() => goodReading({ action: "buy" })).fn, store, maxRunCostUsd: 2, now: THURSDAY });
  const snap = await store.latestSnapshot();
  const note = snap!.notes.find((n) => n.assetId === "mAAPL")!;
  assert.equal(note.previousAction, "hold");
  assert.ok(snap!.market.developments.length > 0);
  for (const d of snap!.market.developments) for (const id of d.factIds) assert.ok(snap!.market.facts.some((f) => f.id === id));
});
