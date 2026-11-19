import { test } from "node:test";
import assert from "node:assert/strict";
import { assetHistory, publicSnapshot, sampleSnapshot } from "./snapshot.ts";
import { snapshotProblems } from "./validate.ts";
import { memoryStore, type ResearchStore } from "./store.ts";
import { runResearch } from "./run.ts";
import { fakeModel, goodReading, makeInput } from "./fixtures.test-helpers.ts";
import { trackRecord } from "./history.ts";
import { UNIVERSE } from "../universe.ts";
import type { ResearchNote } from "../types.ts";

test("the sample snapshot is valid, labelled, covers all 15 assets and has no prices", () => {
  const s = sampleSnapshot();
  assert.deepEqual(snapshotProblems(s), []);
  assert.equal(s.kind, "sample");
  assert.deepEqual(new Set(s.notes.map((n) => n.assetId)), new Set(UNIVERSE.map((a) => a.assetId)));
  for (const n of s.notes) {
    assert.equal(n.levels, null, n.assetId);
    assert.match(n.summary, /^Sample data, not real research\./, n.assetId);
    assert.ok(n.summary.length <= 420 && n.summary.split("\n").length >= 2 && n.summary.split("\n").length <= 3);
    for (const f of n.facts) {
      assert.ok(f.kind !== "price" && f.kind !== "indicator", `${n.assetId} has a price fact`);
      assert.equal(typeof f.value, "string", `${n.assetId} has a numeric fact`);
      assert.match(f.source.name, /sample/i);
    }
    const text = [n.summary, ...n.reasons.map((r) => r.text), ...n.risks.map((r) => r.text), ...n.opportunities.map((r) => r.text)].join(" ");
    const name = UNIVERSE.find((a) => a.assetId === n.assetId)!.name;
    assert.doesNotMatch(text.split(name).join(""), /\d/, `${n.assetId} text has a number`);
    assert.doesNotMatch(text, /\u2014/);
  }
  assert.match(s.market.summary, /Sample data/);
});

test("no store or an empty store serves the sample; a broken store too", async () => {
  assert.equal((await publicSnapshot(null)).kind, "sample");
  assert.equal((await publicSnapshot(memoryStore().store)).kind, "sample");
  const broken = { latestSnapshot: async () => { throw new Error("down"); } } as unknown as ResearchStore;
  assert.equal((await publicSnapshot(broken)).kind, "sample");
});

test("after a run the live snapshot and history are served", async () => {
  const { store } = memoryStore();
  await runResearch({ gather: async (a, d) => makeInput(a, d), model: fakeModel(() => goodReading()).fn, store, maxRunCostUsd: 2, now: () => new Date("2026-11-19T22:30:00Z") });
  assert.equal((await publicSnapshot(store)).kind, "live");
  const h = await assetHistory(store, "mAAPL");
  assert.equal(h.kind, "live");
  assert.equal(h.notes.length, 1);
  assert.equal((await assetHistory(null, "mAAPL")).kind, "sample");
});

function note(date: string, action: ResearchNote["action"], price: number): ResearchNote {
  const s = sampleSnapshot().notes[0];
  return {
    ...s,
    assetId: "mAAPL",
    date,
    action,
    status: "ok",
    facts: [{ id: "px.last", kind: "price", label: "last close", value: price, source: { name: "Test fixture" }, asOf: `${date}T21:00:00Z` }],
  };
}

test("track record scores buy and sell a week later and compares with plain weekly buying", () => {
  const notes = [note("2026-11-02", "buy", 100), note("2026-11-09", "sell", 110), note("2026-11-16", "hold", 99), note("2026-11-23", "watch", 120)];
  const t = trackRecord("mAAPL", notes);
  assert.equal(t.outcomes[0].verdict, "right"); // buy at 100, 110 a week later
  assert.equal(t.outcomes[1].verdict, "right"); // sell at 110, 99 a week later
  assert.equal(t.outcomes[2].verdict, "not-scored");
  assert.equal(t.outcomes[3].changePct, null);
  assert.equal(t.plainWeekly?.buys, 4);
  assert.equal(t.followSuggestions?.buys, 2); // sell and watch weeks stay in cash
  assert.equal(t.plainWeekly?.investedUsd, 400);
  assert.match(t.note, /no claim/i);
});

test("a recent buy is too early to score; notes without a price have no outcome", () => {
  const t = trackRecord("mAAPL", [note("2026-11-16", "buy", 100), note("2026-11-18", "hold", 101)]);
  assert.equal(t.outcomes[0].verdict, "too-early");
  const noPrice = { ...note("2026-11-16", "buy", 1), facts: [], levels: null };
  assert.equal(trackRecord("mAAPL", [noPrice]).plainWeekly, null);
});
