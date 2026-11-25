import { test } from "node:test";
import assert from "node:assert/strict";
import type { AssetResearchInput, Fact, MarketResearchInput } from "../types.ts";
import { UNIVERSE } from "../universe.ts";
import { defaultAssets, runDaily, type GatherFn } from "./daily.ts";
import type { ModelRequest } from "./model.ts";
import { weeklyReply } from "./snapshot.ts";
import { memoryStore, type StoredSection } from "./store.ts";
import { chartRead, fakeModel, goodDaily, makeInput, makeMarket, weeklyAnswers } from "./test-helpers.ts";
import { runWeekly, type WeeklyDeps, type WeeklyOutcome } from "./weekly.ts";

/**
 * The whole Monday, simulated with the fake model and the in-memory store: nine hourly slots
 * (12:00 to 20:00 UTC), overlapping calls, killed calls and a budget that runs out. No network.
 */

const WEEK = "2026-11-30";
/** A call in `slot` (1 = 12:xx UTC) at `minute` past the hour. */
const at = (slot: number, minute = 5) => () => new Date(Date.parse(`${WEEK}T12:00:00Z`) + (slot - 1) * 3_600_000 + minute * 60_000);
const gather: GatherFn = async (assetId, date) => makeInput(assetId, date);
const gatherMarket = async (date: string) => makeMarket(date);
const quiet = { alert: async () => {} };
const ids = defaultAssets().map((a) => a.assetId);
const never = <T,>() => new Promise<T>(() => {});
/** Lets an abandoned call run until it is stuck in its model call. */
async function until(cond: () => boolean) {
  for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(cond(), "the call never reached the expected point");
}

async function monday(deps: Omit<WeeklyDeps, "now" | "slot">, slots = 9): Promise<WeeklyOutcome[]> {
  const out: WeeklyOutcome[] = [];
  for (let slot = 1; slot <= slots; slot++) out.push(await runWeekly({ ...deps, now: at(slot), slot }));
  return out;
}

test("Monday: the budget runs out at asset 4 and the report is still written, naming the assets with no reading", async () => {
  const { store, writes, runs } = memoryStore();
  // $0.12 a call: three assets ($3.60) fit in the $4 weekly cap, the fourth cannot start its analysts.
  const model = fakeModel(weeklyAnswers(), 0.12);
  const alerts: string[] = [];
  const out = await monday({ gather, gatherMarket, model: model.fn, store, maxRunCostUsd: 4, maxDayCostUsd: 100, alert: async (m) => void alerts.push(m) });
  assert.deepEqual(out.slice(0, 3).map((o) => [o.step, o.status, o.assetId]), ids.slice(0, 3).map((id) => ["asset", "ok", id]));
  // Slot 4: no budget for mNVDA's analysts, nothing spent on it, the report is written in the same call.
  const final = out[3];
  assert.equal(final.step, "final");
  assert.equal(final.status, "ok", final.problems.join("\n"));
  assert.equal(final.written, true);
  assert.equal(writes.weekly, 1);
  assert.deepEqual(out.slice(4).map((o) => o.status), Array(5).fill("skipped"));
  assert.equal(model.calls.filter((c) => c.context?.includes("Asset: mNVDA")).length, 0);
  const report = final.report!;
  const status = Object.fromEntries(report.assets.map((a) => [a.assetId, a.status]));
  assert.deepEqual(status, { mcbBTC: "ok", mWETH: "ok", mPAXG: "ok", mNVDA: "no-reading", mAAPL: "no-reading", mSPX: "no-reading" });
  for (const id of ["mNVDA", "mAAPL", "mSPX"]) {
    assert.ok(report.review.notes.some((n) => n.startsWith(`${id}: no reading (budget`)), id);
    // Readers see why in the section itself.
    assert.match(report.assets.find((a) => a.assetId === id)!.scenarios.base.text, /budget ran out/);
  }
  assert.ok(alerts.some((a) => /no budget for another asset/.test(a)));
  // The report's cost is all spend of the week, and the cap was never passed.
  const weekSpend = [...runs.values()].reduce((t, r) => t + r.costUsd, 0);
  assert.ok(Math.abs(report.costUsd! - weekSpend) < 1e-6, `${report.costUsd} vs ${weekSpend}`);
  assert.ok(weekSpend <= 4);
});

test("Monday: two overlapping calls on the same slot, only one takes the lease and spends", async () => {
  const { store, runs, sections } = memoryStore();
  const model = fakeModel(weeklyAnswers());
  const deps = { gather, gatherMarket, model: model.fn, store, maxRunCostUsd: 4, maxDayCostUsd: 6, now: at(1), slot: 1, ...quiet };
  const [a, b] = await Promise.all([runWeekly(deps), runWeekly(deps)]);
  const skipped = [a, b].filter((o) => o.status === "skipped");
  const worked = [a, b].filter((o) => o.step === "asset");
  assert.equal(skipped.length, 1);
  assert.equal(worked.length, 1);
  assert.equal(skipped[0].costUsd, 0);
  assert.match(skipped[0].problems[0], /another call .* nothing spent/);
  assert.equal(model.calls.length, 10);
  assert.equal(sections.size, 1);
  // The skipped call's run row spent nothing and is not logged as a failure.
  const row = runs.get(skipped[0].runId)!;
  assert.equal(row.costUsd, 0);
  assert.equal(row.status, "ok");
  // A later call takes the released lease and goes on with the next asset.
  const next = await runWeekly({ ...deps, now: at(2), slot: 2 });
  assert.equal(next.assetId, ids[1]);
});

test("Monday: a call killed in every slot before saving still uses up its attempt, and slot 9 writes the report", async () => {
  const { store, writes, sections, runs } = memoryStore();
  // Every analyst call hangs: the route is killed at 300 s before anything is saved.
  const model = fakeModel(weeklyAnswers());
  const hanging: ModelRequest[] = [];
  const fn = async (req: ModelRequest) => {
    if (req.step.startsWith("weekly.analyst.")) {
      hanging.push(req);
      return never<Awaited<ReturnType<typeof model.fn>>>();
    }
    return model.fn(req);
  };
  const deps = { gather, gatherMarket, model: fn, store, maxRunCostUsd: 100, maxDayCostUsd: 100, ...quiet };
  for (let slot = 1; slot <= 8; slot++) {
    void runWeekly({ ...deps, now: at(slot), slot }); // never settles: the call is "killed"
    await until(() => hanging.length === slot * 4);
  }
  // Six first attempts, then the retries of the first two assets.
  const byId = Object.fromEntries([...sections.values()].map((x: StoredSection) => [x.assetId, x]));
  assert.deepEqual(ids.map((id) => byId[id].attempts), [2, 2, 1, 1, 1, 1]);
  assert.ok(ids.every((id) => byId[id].failed && byId[id].result.cause === "unfinished"));
  // Killed calls keep their reserved spend in the week's total.
  assert.ok([...runs.values()].filter((r) => r.status === "running").every((r) => r.costUsd > 0));

  const last = await runWeekly({ ...deps, now: at(9), slot: 9 });
  assert.equal(last.step, "final");
  assert.equal(last.status, "ok", last.problems.join("\n"));
  assert.equal(writes.weekly, 1);
  const report = last.report!;
  assert.ok(report.assets.every((a) => a.status === "no-reading" && /did not finish in time/.test(a.scenarios.base.text)));
  for (const id of ids) assert.ok(report.review.notes.some((n) => n.startsWith(`${id}: no reading (unfinished`)), id);
});

test("Monday: one asset that always hangs gets two attempts, the rest of the week goes on", async () => {
  const { store, writes } = memoryStore();
  const model = fakeModel(weeklyAnswers());
  let hung = 0;
  const fn = async (req: ModelRequest) => {
    if (req.step === "weekly.analyst.technical" && req.context?.includes("Asset: mPAXG")) {
      hung++;
      return never<Awaited<ReturnType<typeof model.fn>>>();
    }
    return model.fn(req);
  };
  const deps = { gather, gatherMarket, model: fn, store, maxRunCostUsd: 100, maxDayCostUsd: 100, ...quiet };
  const outcomes: (WeeklyOutcome | "killed")[] = [];
  for (let slot = 1; slot <= 9; slot++) {
    const before = hung;
    let settled: WeeklyOutcome | null = null;
    void runWeekly({ ...deps, now: at(slot), slot }).then((o) => (settled = o));
    await until(() => settled !== null || hung > before);
    outcomes.push(settled ?? "killed");
    if (writes.weekly) break;
  }
  assert.equal(writes.weekly, 1);
  assert.equal(hung, 2);
  // Slot 3 and slot 7 (its retry) were killed; slot 8 wrote the report.
  assert.deepEqual(outcomes.map((o) => (o === "killed" ? o : o.step)), ["asset", "asset", "killed", "asset", "asset", "asset", "killed", "final"]);
  const report = (outcomes.at(-1) as WeeklyOutcome).report!;
  assert.equal(report.assets.find((a) => a.assetId === "mPAXG")!.status, "no-reading");
  assert.equal(report.assets.filter((a) => a.status === "ok").length, 5);
});

test("Monday: the last slot waits for a late earlier slot that still holds the lease, then writes the report", async () => {
  const { store, writes } = memoryStore();
  const model = fakeModel(weeklyAnswers());
  const deps = { gather, gatherMarket, model: model.fn, store, maxRunCostUsd: 100, maxDayCostUsd: 100, ...quiet };
  for (let slot = 1; slot <= 5; slot++) await runWeekly({ ...deps, now: at(slot), slot });
  // Slot 8 fires late (19:59) for the sixth asset; slot 9 fires at 20:00 while it still runs.
  const late = runWeekly({ ...deps, now: at(8, 59), slot: 8 });
  const final = await runWeekly({ ...deps, now: at(9, 0), slot: 9, sleep: () => late.then(() => {}) });
  assert.equal((await late).assetId, ids[5]);
  assert.equal(final.step, "final");
  assert.equal(final.status, "ok", final.problems.join("\n"));
  assert.equal(writes.weekly, 1);
  assert.ok(final.report!.assets.every((a) => a.status === "ok"));
});

test("Monday: a call from 19:30 UTC runs the final step even without a slot number", async () => {
  const { store, writes } = memoryStore();
  const model = fakeModel(weeklyAnswers());
  const deps = { gather, gatherMarket, model: model.fn, store, maxRunCostUsd: 100, maxDayCostUsd: 100, ...quiet };
  await runWeekly({ ...deps, now: at(1) });
  const o = await runWeekly({ ...deps, now: () => new Date(`${WEEK}T19:31:00Z`) });
  assert.equal(o.step, "final");
  assert.equal(writes.weekly, 1);
  assert.equal(o.report!.assets.filter((a) => a.status === "ok").length, 1);
  assert.ok(o.report!.review.notes.some((n) => /^mWETH: no reading \(unfinished/.test(n)));
});

test("a failed result never overwrites an ok section", async () => {
  // In the store.
  const { store, sections } = memoryStore();
  const ok = { assetId: "mAAPL", runId: "r1", failed: false, attempts: 1, costUsd: 1, result: { section: {} as never, approved: true, sentBack: 0, removed: 0, notes: ["ok"] } };
  await store.saveWeeklySection(WEEK, ok);
  await store.saveWeeklySection(WEEK, { ...ok, runId: "r2", failed: true, attempts: 2, result: { ...ok.result, notes: ["failed"] } });
  assert.equal(sections.get(`${WEEK}|mAAPL`)!.runId, "r1");

  // In the engine: a stale call that took over an expired lease while the first still ran (forced
  // here) fails after the first saved an ok section.
  const m = memoryStore();
  m.store.takeWeeklyLease = async () => ({ taken: true });
  const good = fakeModel(weeklyAnswers());
  let firstDone!: () => void;
  const done = new Promise<void>((r) => (firstDone = r));
  const bad = fakeModel(weeklyAnswers());
  const slowBad = async (req: ModelRequest) => {
    if (req.step === "weekly.editor") {
      await done;
      return { ...(await bad.fn(req)), text: "not json" };
    }
    return bad.fn(req);
  };
  const deps = { gather, gatherMarket, store: m.store, maxRunCostUsd: 100, maxDayCostUsd: 100, assets: [UNIVERSE[0]], now: at(1), slot: 1, ...quiet };
  const [a, b] = await Promise.all([runWeekly({ ...deps, model: good.fn }).finally(() => firstDone()), runWeekly({ ...deps, model: slowBad })]);
  assert.equal(a.status, "ok");
  assert.equal(b.status, "failed");
  const kept = m.sections.get(`${WEEK}|${UNIVERSE[0].assetId}`)!;
  assert.equal(kept.failed, false);
  assert.equal(kept.runId, a.runId);
});

test("raw model outputs reach the run row as they arrive, so a killed call keeps them", async () => {
  const { store, runs } = memoryStore();
  const model = fakeModel(weeklyAnswers());
  const fn = async (req: ModelRequest) => (req.step === "weekly.bull" ? never<Awaited<ReturnType<typeof model.fn>>>() : model.fn(req));
  void runWeekly({ gather, gatherMarket, model: fn, store, maxRunCostUsd: 100, maxDayCostUsd: 100, assets: [UNIVERSE[0]], now: at(1), slot: 1, ...quiet });
  // Four analysts and the bear case answered; the bull case hangs and the call is never finished.
  await until(() => [...runs.values()].some((r) => Array.isArray(r.outputs) && (r.outputs as unknown[]).length === 5));
  const row = [...runs.values()].find((r) => r.status === "running")!;
  const outs = row.outputs as { step: string; text: string }[];
  assert.equal(outs.filter((c) => c.step.startsWith("weekly.analyst.")).length, 4);
  assert.ok(outs.some((c) => c.step === "weekly.bear"));
  assert.ok(outs.every((c) => c.text.startsWith("{")));
});

test("report cost adds up every call of the week, a failed first attempt included", async () => {
  const { store, runs } = memoryStore();
  let failedOnce = false;
  const model = fakeModel(
    weeklyAnswers({
      "weekly.editor": (req) => {
        if (!failedOnce && req.context?.includes("Asset: mAAPL")) {
          failedOnce = true;
          return "not json";
        }
        return weeklyAnswers()(req);
      },
    }),
    0.01,
  );
  const out = await monday({ gather, gatherMarket, model: model.fn, store, maxRunCostUsd: 100, maxDayCostUsd: 100, ...quiet });
  const final = out.find((o) => o.step === "final")!;
  assert.equal(final.status, "ok", final.problems.join("\n"));
  assert.equal(final.report!.assets.find((a) => a.assetId === "mAAPL")!.status, "ok");
  // 6 assets x 10 calls, the failed mAAPL attempt (editor answer rejected, so no review: 9 calls), 1 summary.
  assert.equal(model.calls.length, 70);
  assert.ok(Math.abs(final.report!.costUsd! - 70 * 0.01) < 1e-9, String(final.report!.costUsd));
  assert.ok(Math.abs([...runs.values()].reduce((t, r) => t + r.costUsd, 0) - 70 * 0.01) < 1e-9);
});

// ---------------------------------------------------------------------------------------------
// Display flag
// ---------------------------------------------------------------------------------------------

const SECRET = ["fund.secret", "777.7", "flow.vendor", "4242", "pat.1w.secret", "93.21", "macro.secret", "31337", "Licensed bars"];
const asOf = `${WEEK}T00:00:00Z`;

function restrictedInput(assetId: string, date: string): AssetResearchInput {
  const base = makeInput(assetId, date);
  const restricted: Fact[] = [
    { id: "fund.secret", kind: "fundamental", label: "Licensed estimate", value: 777.7, source: { name: "Vendor" }, asOf, display: false },
    { id: "flow.vendor", kind: "flow", label: "Vendor flow", value: 4242, source: { name: "Vendor feed", display: false }, asOf },
  ];
  return {
    ...base,
    facts: [...base.facts, ...restricted],
    series: { "1w": { assetId, interval: "1w", bars: [{ t: asOf, o: 1, h: 1, l: 1, c: 1 }], source: { name: "Licensed bars", display: false }, fetchedAt: asOf } },
    chart: {
      ...base.chart,
      "1w": chartRead("1w", 100, { patterns: [{ id: "pat.1w.secret-flag", kind: "bull-flag" as never, interval: "1w", direction: "bullish", confidence: "low", invalidation: 93.21, asOf, detail: "Licensed bars pattern" }] }),
    },
  };
}
const restrictedMarket = (date: string): MarketResearchInput => {
  const m = makeMarket(date);
  return { ...m, facts: [...m.facts, { id: "macro.secret", kind: "macro", label: "Licensed index", value: 31337, source: { name: "Vendor" }, asOf, display: false }] };
};

test("restricted facts and series never reach the model input, the published report or the public API", async () => {
  const { store } = memoryStore();
  const model = fakeModel(weeklyAnswers());
  const deps = { gather: async (id: string, d: string) => restrictedInput(id, d), gatherMarket: async (d: string) => restrictedMarket(d), model: model.fn, store, maxRunCostUsd: 100, maxDayCostUsd: 100, assets: [UNIVERSE[0]], ...quiet };
  await runWeekly({ ...deps, now: at(1), slot: 1 });
  const final = await runWeekly({ ...deps, now: at(2), slot: 2 });
  assert.equal(final.status, "ok", final.problems.join("\n"));
  const sent = JSON.stringify(model.calls);
  for (const s of SECRET) assert.ok(!sent.includes(s), `model input contains ${s}`);
  const report = JSON.stringify(final.report);
  for (const s of SECRET) assert.ok(!report.includes(s), `report contains ${s}`);
  assert.equal(final.report!.assets[0].chart["1w"], undefined);
  // Reviewers can see that something was held back; readers cannot see the notes at all.
  assert.ok(final.report!.review.notes.some((n) => /not for display/.test(n)));
  await store.approveWeekly(WEEK, final.runId, "0xreviewer");
  const reply = await weeklyReply(store, { weekOf: WEEK, reviewer: false, access: async () => ({ allowed: true, consumesCredit: false }) });
  const body = reply.body as { report: { review: { notes: string[] } } };
  assert.deepEqual(body.report.review.notes, []);
  for (const s of SECRET) assert.ok(!JSON.stringify(body).includes(s), `public reply contains ${s}`);
});

test("restricted facts never reach the daily model input or the daily note", async () => {
  const { store } = memoryStore();
  const model = fakeModel(() => goodDaily());
  const out = await runDaily({ gather: async (id, d) => restrictedInput(id, d), model: model.fn, store, maxRunCostUsd: 2, maxDayCostUsd: 6, now: () => new Date("2026-11-19T22:30:00Z") });
  assert.equal(out.status, "ok", out.problems.join("\n"));
  const sent = JSON.stringify(model.calls);
  for (const s of SECRET) assert.ok(!sent.includes(s), `model input contains ${s}`);
  const snap = await store.latestSnapshot();
  for (const s of SECRET) assert.ok(!JSON.stringify(snap).includes(s), `note contains ${s}`);
});
