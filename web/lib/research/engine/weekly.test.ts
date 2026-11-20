import { test } from "node:test";
import assert from "node:assert/strict";
import { RESEARCH_MODELS } from "../flags.ts";
import type { GatherFn } from "./daily.ts";
import { memoryStore } from "./store.ts";
import { fakeModel, goodDraft, makeInput, makeMarket, weeklyAnswers } from "./test-helpers.ts";
import { isWeeklyReport } from "./validate.ts";
import { exampleSplit, mondayOf, runWeekly } from "./weekly.ts";
import { rescaleProbabilities } from "./review.ts";
import { UNIVERSE } from "../universe.ts";

const MONDAY = () => new Date("2026-11-23T12:00:00Z");
const gather: GatherFn = async (assetId, date) => makeInput(assetId, date);
const gatherMarket = async (date: string) => makeMarket(date);
const caps = { maxRunCostUsd: 4, maxDayCostUsd: 6 };

test("mondayOf finds the Monday of the week", () => {
  assert.equal(mondayOf("2026-11-23"), "2026-11-23");
  assert.equal(mondayOf("2026-11-26"), "2026-11-23");
  assert.equal(mondayOf("2026-11-29"), "2026-11-23");
});

test("the weekly run goes analysts, debate, editor, reviewer, summary on the strongest model", async () => {
  const { store, runs } = memoryStore();
  const model = fakeModel(weeklyAnswers());
  const out = await runWeekly({ gather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY });
  assert.equal(out.status, "ok", out.problems.join("\n"));
  assert.ok(out.report && isWeeklyReport(out.report));
  const report = out.report!;
  assert.equal(report.weekOf, "2026-11-23");
  assert.equal(report.assets.length, 6);
  assert.equal(report.beta, true);
  assert.equal(report.kind, "live");
  assert.ok(model.calls.every((c) => c.model === RESEARCH_MODELS.weekly));

  // Per asset: 4 analysts, bull, bear, 2 rebuttals, editor, review; then one summary.
  const steps = model.calls.map((c) => c.step);
  assert.equal(steps.filter((s) => s.startsWith("weekly.analyst.")).length, 24);
  assert.equal(steps.filter((s) => s === "weekly.bull" || s === "weekly.bear").length, 12);
  assert.equal(steps.filter((s) => s.endsWith(".rebuttal")).length, 12);
  assert.equal(steps.filter((s) => s === "weekly.editor").length, 6);
  assert.equal(steps.filter((s) => s === "weekly.review").length, 6);
  assert.equal(steps.filter((s) => s === "weekly.revise").length, 0);
  assert.equal(steps.filter((s) => s === "weekly.summary").length, 1);
  assert.equal(new Set(model.calls.map((c) => c.system)).size, 1);

  const a = report.assets.find((x) => x.assetId === "mPAXG")!;
  assert.equal(a.status, "ok");
  assert.equal(a.scenarios.bull.probability + a.scenarios.base.probability + a.scenarios.bear.probability, 100);
  assert.deepEqual(a.view.levels?.buyZone, { low: 97, high: 98 });
  assert.match(a.borrowing.text, /emergency rule/);
  assert.equal(a.weekAhead[0].id, "cal.2026-11-26.pce");
  assert.ok(a.chart["1d"]?.text.length);
  assert.ok(a.debate?.bull.length && a.debate.bear.length);
  assert.equal(report.review.approved, true);
  assert.equal(report.review.sentBack, 0);
  assert.equal(report.review.removedClaims, 0);
  for (const sp of report.ideas.exampleSplits) assert.ok(Math.abs(sp.slices.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);
  assert.equal(report.ideas.ranked.length, 6);
  assert.equal(report.ideas.ranked[0].assetId, "mSPX"); // fake summary ranks in reverse order
  const run = [...runs.values()][0];
  assert.equal(run.kind, "weekly");
  assert.equal(run.models.editor, RESEARCH_MODELS.weekly);
  assert.ok(run.dataHash);
  assert.equal((await store.weekly("2026-11-23"))?.approved, false);
});

test("each analyst sees only its own fact kinds", async () => {
  const { store } = memoryStore();
  const model = fakeModel(weeklyAnswers());
  await runWeekly({ gather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY, assets: [UNIVERSE[0]] });
  const ctx = (role: string) => model.calls.find((c) => c.step === `weekly.analyst.${role}`)!.context!;
  const has = (role: string, id: string) => ctx(role).includes(`[${id}]`);
  assert.ok(has("technical", "px.1d.last") && !has("technical", "news.1") && !has("technical", "macro.dgs10"));
  assert.match(ctx("technical"), /CHART READ/);
  assert.ok(has("macro", "macro.dgs10") && has("macro", "cal.2026-11-26.pce") && has("macro", "news.geo") && !has("macro", "news.1") && !has("macro", "px.1d.last"));
  assert.ok(has("news", "news.1") && has("news", "filing.1") && !has("news", "fund.pe"));
  assert.ok(has("fundamentals", "fund.pe") && has("fundamentals", "flow.etf") && has("fundamentals", "filing.1") && !has("fundamentals", "news.1"));
  // The debate and editor share one cached context with every fact.
  const bull = model.calls.find((c) => c.step === "weekly.bull")!;
  const editor = model.calls.find((c) => c.step === "weekly.editor")!;
  assert.equal(bull.context, editor.context);
  assert.match(bull.context!, /<untrusted_news>/);
});

test("the risk reviewer sends a section back once and the revision is used", async () => {
  const { store } = memoryStore();
  const model = fakeModel(
    weeklyAnswers({
      "weekly.editor": () => goodDraft({}, [35, 45, 30]),
      "weekly.review": () => ({ approve: false, sendBack: "scenarios", notes: ["Probabilities do not add up."] }),
      "weekly.revise": () => goodDraft({}, [30, 45, 25]),
    }),
  );
  const out = await runWeekly({ gather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY, assets: [UNIVERSE[0]] });
  assert.equal(out.status, "ok", out.problems.join("\n"));
  assert.equal(model.calls.filter((c) => c.step === "weekly.revise").length, 1);
  const revise = model.calls.find((c) => c.step === "weekly.revise")!;
  assert.match(revise.user, /SEND BACK: scenarios/);
  assert.match(revise.user, /add up to 110/);
  const a = out.report!.assets[0];
  assert.deepEqual([a.scenarios.bull.probability, a.scenarios.base.probability, a.scenarios.bear.probability], [30, 45, 25]);
  assert.equal(out.report!.review.sentBack, 1);
  assert.equal(out.report!.review.approved, true);
});

test("code checks send back even when the model reviewer approves, and fix what still fails", async () => {
  const { store } = memoryStore();
  const model = fakeModel(
    weeklyAnswers({
      "weekly.editor": () => goodDraft({ view: { view: "accumulate", conviction: "high", reasons: [{ text: "Momentum is firm.", factIds: ["px.1d.last"] }] } }, [20, 40, 50]),
      "weekly.review": () => ({ approve: true, sendBack: "none", notes: [] }),
      "weekly.revise": () => goodDraft({ view: { view: "accumulate", conviction: "high", reasons: [{ text: "Momentum is firm.", factIds: ["px.1d.last"] }] } }, [20, 40, 50]),
    }),
  );
  const out = await runWeekly({ gather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY, assets: [UNIVERSE[0]] });
  assert.equal(out.status, "ok", out.problems.join("\n"));
  assert.equal(model.calls.filter((c) => c.step === "weekly.revise").length, 1);
  const a = out.report!.assets[0];
  // Accumulate with bear more likely than bull does not match the evidence: corrected in code.
  assert.equal(a.view.view, "hold");
  assert.equal(a.view.conviction, "low");
  assert.equal(out.report!.review.approved, false);
  assert.ok(out.report!.review.removedClaims >= 1);
  assert.ok(out.report!.review.notes.some((n) => /corrected in code/.test(n)));
});

test("the risk reviewer removes uncited claims, banned phrases, unbacked numbers and levels not from code", async () => {
  const { store } = memoryStore();
  const bad = goodDraft({
    recap: [
      { text: "Price rose over the week on results news.", factIds: ["px.1d.last"] },
      { text: "Price will reach new highs soon.", factIds: ["px.1d.last"] },
      { text: "Insiders bought heavily.", factIds: ["made.up"] },
      { text: "Price traded at 555 on Friday.", factIds: ["px.1d.last"] },
      { text: "You should buy more now.", factIds: ["news.1"] },
    ],
  });
  (bad.scenarios as { bull: { levels: number[] } }).bull.levels = [104, 123.45];
  const model = fakeModel(weeklyAnswers({ "weekly.editor": () => bad, "weekly.revise": () => bad }));
  const out = await runWeekly({ gather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY, assets: [UNIVERSE[0]] });
  assert.equal(out.status, "ok", out.problems.join("\n"));
  const a = out.report!.assets[0];
  assert.deepEqual(a.recap.map((r) => r.text), ["Price rose over the week on results news."]);
  assert.deepEqual(a.scenarios.bull.levels, [104]);
  assert.equal(out.report!.review.removedClaims, 5);
  // Every claim left cites a fact of the section.
  const ids = new Set(a.facts.map((f) => f.id));
  for (const r of [...a.recap, ...a.market, ...a.news, ...a.view.reasons]) assert.ok(r.factIds.every((id) => ids.has(id)));
});

test("a weekly run that would pass its cap aborts and writes nothing", async () => {
  const { store, writes, runs } = memoryStore();
  const out = await runWeekly({ gather, gatherMarket, model: fakeModel(weeklyAnswers()).fn, store, maxRunCostUsd: 0.1, maxDayCostUsd: 6, now: MONDAY });
  assert.equal(out.status, "aborted-cost");
  assert.equal(writes.weekly, 0);
  assert.equal([...runs.values()][0].status, "aborted-cost");
  assert.equal(await store.latestWeekly(false), null);
});

test("weekly failure policy: three failed assets write nothing", async () => {
  const { store, writes } = memoryStore();
  const model = fakeModel(weeklyAnswers({ "weekly.editor": (req) => (/mAAPL|mNVDA|mSPX/.test(req.context ?? "") ? "not json" : goodDraft()) }));
  const out = await runWeekly({ gather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY });
  assert.equal(out.status, "failed");
  assert.equal(writes.weekly, 0);
});

test("two failed analysts make that asset a no-reading section, the rest is written", async () => {
  const { store } = memoryStore();
  const model = fakeModel(
    weeklyAnswers({
      "weekly.analyst.macro": (req) => (req.context?.includes("mAAPL") ? new Error("timeout") : weeklyAnswers()(req)),
      "weekly.analyst.news": (req) => (req.context?.includes("mAAPL") ? "{}" : weeklyAnswers()(req)),
    }),
  );
  const out = await runWeekly({ gather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY });
  assert.equal(out.status, "ok", out.problems.join("\n"));
  assert.equal(out.report!.assets.find((a) => a.assetId === "mAAPL")!.status, "no-reading");
  assert.equal(out.report!.ideas.ranked.length, 5);
});

test("example splits come from code: risk bucket times view, 5% steps adding to 100%", () => {
  const items = UNIVERSE.map((asset) => ({ asset, view: asset.assetId === "mWETH" ? ("avoid-new-buys" as const) : ("hold" as const) }));
  for (const p of ["cautious", "growth"] as const) {
    const s = exampleSplit(p, items);
    assert.ok(Math.abs(s.reduce((t, x) => t + x.share, 0) - 1) < 1e-9);
    assert.ok(s.every((x) => Math.round(x.share * 100) % 5 === 0));
    assert.ok(!s.some((x) => x.assetId === "mWETH"));
  }
  const cautious = exampleSplit("cautious", items);
  const growth = exampleSplit("growth", items);
  const share = (s: typeof cautious, id: string) => s.find((x) => x.assetId === id)?.share ?? 0;
  assert.ok(share(cautious, "mSPX") > share(growth, "mSPX"));
});

test("probabilities are rescaled to multiples of 5 adding to 100", () => {
  assert.deepEqual(rescaleProbabilities([35, 45, 30]), [30, 40, 30]);
  assert.deepEqual(rescaleProbabilities([0, 0, 0]), [30, 40, 30]);
  const r = rescaleProbabilities([10, 10, 10]);
  assert.equal(r[0] + r[1] + r[2], 100);
});
