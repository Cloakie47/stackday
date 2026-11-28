import { test } from "node:test";
import assert from "node:assert/strict";
import sampleWeeklyJson from "../sample-weekly.json" with { type: "json" };
import type { Fact, WeeklyReport } from "../types.ts";
import { lowerCertainty } from "../types.ts";
import { UNIVERSE } from "../universe.ts";
import type { GatherFn } from "./daily.ts";
import { applyCertaintyProposals, codeCertainty, PRICED_IN, pricedInCheck, pricedInLine, prepareFacts } from "./facts.ts";
import type { ModelRequest } from "./model.ts";
import { Ctx } from "./parse.ts";
import { parseReview } from "./review.ts";
import { memoryStore } from "./store.ts";
import { fakeModel, goodDraft, goodSummary, makeFacts, makeInput, makeMarket, runWeekFully, weeklyAnswers } from "./test-helpers.ts";
import { isWeeklyReport, weeklyProblems, wrongAboutProblems } from "./validate.ts";
import { wrongAboutFromSections } from "./weekly.ts";

/**
 * Items 1 to 3 of the founder's research improvements (docs/research/IMPROVEMENTS.md, PR #98):
 * "What could we be wrong about?", catalyst labels, and the two new risk reviewer checks.
 */

const MONDAY = () => new Date("2026-11-23T12:00:00Z");
const gather: GatherFn = async (assetId, date) => makeInput(assetId, date);
const gatherMarket = async (date: string) => makeMarket(date);
const caps = { maxRunCostUsd: 4, maxDayCostUsd: 6 };
const sample = () => structuredClone(sampleWeeklyJson) as unknown as WeeklyReport;
const steps = (calls: ModelRequest[], s: string) => calls.filter((c) => c.step === s);

// ---------------------------------------------------------------------------------------------
// 1. What could we be wrong about?
// ---------------------------------------------------------------------------------------------

test("wrong about: a new report carries the summary step's 2 to 3 items, each citing report facts and assets", async () => {
  const { store } = memoryStore();
  const model = fakeModel(weeklyAnswers());
  const { last } = await runWeekFully({ gather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY });
  assert.equal(last.status, "ok", last.problems.join("\n"));
  const r = last.report!;
  assert.equal(r.wrongAbout?.length, 2);
  assert.equal(r.wrongAbout![0].text, "A jump in yields would hurt every constructive view at once.");
  assert.deepEqual(weeklyProblems(r, { requireWrongAbout: true }), []);
  // The summary schema asks for it last, after the views and ideas.
  const schema = steps(model.calls, "weekly.summary")[0].schema as { properties: Record<string, unknown> };
  assert.equal(Object.keys(schema.properties).at(-1), "wrongAbout");
});

test("wrong about: too few valid items from the summary step are rebuilt in code from the sections, with a note", async () => {
  const { store } = memoryStore();
  const model = fakeModel(
    weeklyAnswers({
      "weekly.summary": (req) => {
        const ids = (req.schema as { properties: { ranking: { items: { enum: string[] } } } }).properties.ranking.items.enum;
        return {
          ...goodSummary(ids),
          wrongAbout: [
            { text: "Yields could jump.", factIds: ["macro.dgs10"], assetIds: ids },
            { text: "Cites a fact that does not exist.", factIds: ["macro.nothing"], assetIds: ids },
            { text: "You should sell before the data.", factIds: ["macro.dgs10"], assetIds: ids },
          ],
        };
      },
    }),
  );
  const { last } = await runWeekFully({ gather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY });
  assert.equal(last.status, "ok", last.problems.join("\n"));
  const r = last.report!;
  assert.ok(r.wrongAbout && r.wrongAbout.length >= 2 && r.wrongAbout.length <= 3);
  // Built from the opposing scenario of each section (all fixtures are accumulate: the bear case).
  assert.ok(r.wrongAbout.every((w) => w.text === "Weak data pushes price below support." && w.assetIds.length === 1 && w.factIds.every((id) => id.startsWith(`${w.assetIds[0]}:`))));
  assert.ok(r.review.notes.some((n) => /what could we be wrong about: the summary step gave 1 valid items .* built in code/.test(n)));
  assert.deepEqual(weeklyProblems(r, { requireWrongAbout: true }), []);
});

test("wrong about: when the summary step fails, the report is still written with the list built in code", async () => {
  const { store } = memoryStore();
  const model = fakeModel(weeklyAnswers({ "weekly.summary": () => "not json" }));
  const { last } = await runWeekFully({ gather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY });
  assert.equal(last.status, "ok", last.problems.join("\n"));
  assert.ok(last.written);
  assert.ok((last.report!.wrongAbout?.length ?? 0) >= 2);
  assert.ok(last.report!.review.notes.some((n) => /the summary step did not run or failed, built in code/.test(n)));
});

test("wrong about: a report with no researched section has no list and is still written", async () => {
  const { store } = memoryStore();
  const failing: GatherFn = async () => {
    throw new Error("feed down");
  };
  const { last } = await runWeekFully({ gather: failing, gatherMarket, model: fakeModel(weeklyAnswers()).fn, store, ...caps, now: () => new Date("2026-11-23T20:30:00Z"), slot: 9 });
  assert.equal(last.step, "final");
  assert.ok(last.written, last.problems.join("\n"));
  assert.equal(last.report!.wrongAbout, undefined);
});

test("wrong about: the whole-report check fails a missing or invalid list on a new report, and accepts old stored reports without it", () => {
  const r = sample();
  assert.ok(r.wrongAbout && r.wrongAbout.length >= 2, "the sample shows the section");
  assert.deepEqual(weeklyProblems(r, { requireWrongAbout: true }), []);

  // Old stored report (before this field): fine on read, refused only as a new report.
  const old = sample();
  delete old.wrongAbout;
  assert.deepEqual(weeklyProblems(old), []);
  assert.ok(isWeeklyReport(old));
  assert.ok(weeklyProblems(old, { requireWrongAbout: true }).includes("wrongAbout missing"));

  const bad = (edit: (w: NonNullable<WeeklyReport["wrongAbout"]>) => void) => {
    const x = sample();
    edit(x.wrongAbout!);
    return weeklyProblems(x, { requireWrongAbout: true });
  };
  assert.ok(bad((w) => w.splice(1)).some((p) => /wrongAbout has 1 items, needs 2 to 3/.test(p)));
  assert.ok(bad((w) => w.push(w[0])).some((p) => /wrongAbout has 4 items/.test(p)));
  assert.ok(bad((w) => (w[0].factIds = ["mAAPL:no.such.fact"])).some((p) => /wrongAbout\[0\]: cites unknown fact/.test(p)));
  assert.ok(bad((w) => (w[0].factIds = [])).some((p) => /wrongAbout\[0\]: cites no fact/.test(p)));
  assert.ok(bad((w) => (w[0].assetIds = ["mTSLA"])).some((p) => /wrongAbout\[0\]: names an asset not in the report/.test(p)));
  assert.ok(bad((w) => (w[0].assetIds = [])).some((p) => /wrongAbout\[0\]: names no asset/.test(p)));
  assert.ok(bad((w) => (w[0].text = "We recommend selling before the data.")).some((p) => /personal advice wording/.test(p)));
  // Same rule when given directly.
  assert.deepEqual(wrongAboutProblems(undefined, new Set(), new Set(), false), []);
});

test("wrong about: the code fallback picks the scenario against each view, round robin, at most 3", () => {
  const r = sample();
  const items = wrongAboutFromSections(r.assets);
  assert.equal(items.length, 3);
  const first = r.assets[0];
  const against = first.view.view === "accumulate" || first.view.view === "hold" ? first.scenarios.bear : first.scenarios.bull;
  assert.equal(items[0].text, against.text);
  assert.deepEqual(items[0].assetIds, [first.assetId]);
  assert.ok(items.every((i) => i.factIds.length > 0));
});

// ---------------------------------------------------------------------------------------------
// 2. Catalyst labels
// ---------------------------------------------------------------------------------------------

test("labels: a label can only be lowered; an upgrade attempt is ignored", () => {
  assert.equal(lowerCertainty("reported", "speculation"), "speculation");
  assert.equal(lowerCertainty("confirmed", "reported"), "reported");
  assert.equal(lowerCertainty("speculation", "confirmed"), "speculation");
  assert.equal(lowerCertainty("reported", "confirmed"), "reported");

  const facts = prepareFacts(makeFacts()).facts;
  assert.equal(facts.find((f) => f.id === "news.1")?.certainty, "reported");
  assert.equal(facts.find((f) => f.id === "filing.1")?.certainty, "confirmed");
  assert.equal(facts.find((f) => f.id === "px.1d.last")?.certainty, undefined);
  const out = applyCertaintyProposals(facts, [
    { factId: "news.1", certainty: "speculation" },
    { factId: "news.geo", certainty: "confirmed" },
    { factId: "filing.1", certainty: "confirmed" },
    { factId: "px.1d.last", certainty: "speculation" },
    { factId: "news.1", certainty: "sure" },
  ]);
  const by = new Map(out.facts.map((f) => [f.id, f]));
  assert.equal(by.get("news.1")?.certainty, "speculation");
  assert.equal(by.get("news.geo")?.certainty, "reported");
  assert.equal(by.get("filing.1")?.certainty, "confirmed");
  assert.equal(by.get("px.1d.last")?.certainty, undefined);
  assert.deepEqual(out.lowered, ["news.1 reported to speculation"]);
  assert.equal(out.ignored.length, 4);
});

test("labels: code sets them from the source; untagged or outlet news is never confirmed", () => {
  const base: Fact = { id: "news.9", kind: "news", label: "Fed holds rates steady", value: "x", source: { name: "Reuters" }, asOf: "2026-11-20T12:00:00Z" };
  assert.equal(codeCertainty(base), "reported");
  assert.equal(codeCertainty({ ...base, tags: ["official"] }), "confirmed");
  assert.equal(codeCertainty({ ...base, tags: ["press-release"] }), "confirmed");
  assert.equal(codeCertainty({ ...base, tags: ["reputable-outlet"], label: "Fed may cut rates in December, sources say" }), "speculation");
  assert.equal(codeCertainty({ ...base, kind: "calendar" }), "confirmed");
  assert.equal(codeCertainty({ ...base, kind: "macro" }), undefined);
  // A label already set by the data layer is kept.
  assert.equal(codeCertainty({ ...base, certainty: "speculation", tags: ["official"] }), "speculation");
});

test("labels: in a weekly run the news analyst lowers one label, its upgrade is ignored, and the section facts keep the labels", async () => {
  const { store } = memoryStore();
  const model = fakeModel(
    weeklyAnswers({
      "weekly.analyst.news": () => ({
        stance: "neutral",
        points: [{ text: "Results were firm.", factIds: ["news.1"] }],
        injectionFactIds: [],
        certainty: [
          { factId: "news.1", certainty: "speculation" },
          { factId: "news.geo", certainty: "confirmed" },
        ],
      }),
    }),
  );
  const { last } = await runWeekFully({ gather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY, assets: [UNIVERSE[0]] });
  assert.equal(last.status, "ok", last.problems.join("\n"));
  const s = last.report!.assets[0];
  assert.equal(s.status, "ok");
  const by = new Map(s.facts.map((f) => [f.id, f]));
  assert.equal(by.get("news.1")?.certainty, "speculation");
  assert.equal(by.get("news.geo")?.certainty, "reported");
  assert.ok(s.weekAhead.length > 0);
  assert.ok(last.report!.review.notes.some((n) => /lowered 1 catalyst labels/.test(n)));
  assert.ok(last.report!.review.notes.some((n) => /1 catalyst label proposals ignored/.test(n)));
  // The editor sees the lowered label.
  assert.match(steps(model.calls, "weekly.editor")[0].context ?? "", /\[news\.1\][^\n]*certainty: speculation/);
});

// ---------------------------------------------------------------------------------------------
// 3. Risk reviewer: already priced in, real or reward driven
// ---------------------------------------------------------------------------------------------

test("priced in: computed in code from the 5-bar change and ATR, fires at 3 ATR", () => {
  // last 100, ATR 2: +8% over 5 bars is a move of 7.41, 3.7 ATR.
  const jumped = pricedInCheck(makeInput("mAAPL", "2026-11-23", { bar5: 0.08 }))!;
  assert.equal(jumped.moveAtr, 3.7);
  assert.equal(jumped.fired, true);
  assert.equal(jumped.fact.id, PRICED_IN.factId);
  assert.match(pricedInLine(jumped), /FIRED/);
  const calm = pricedInCheck(makeInput("mAAPL", "2026-11-23", { bar5: 0.03 }))!;
  assert.equal(calm.fired, false);
  assert.match(pricedInLine(calm), /not fired/);
  const fell = pricedInCheck(makeInput("mAAPL", "2026-11-23", { bar5: -0.07 }))!;
  assert.equal(fell.fired, true);
  assert.ok(fell.moveAtr <= -3);
  assert.equal(pricedInCheck(makeInput("mAAPL", "2026-11-23")), null);
  assert.match(pricedInLine(null), /no reading/);
});

const jumpGather: GatherFn = async (assetId, date) => makeInput(assetId, date, { bar5: 0.08 });
const pricedInReason = { text: "The price already moved 3.7 ATR in five days, so part of the good news may be priced in.", factIds: [PRICED_IN.factId] };

test("priced in: when the price already jumped and the view does not say so, the reviewer path sends the view back", async () => {
  const { store } = memoryStore();
  // The model reviewer approves and sends nothing back: the code check still sends the view back.
  const model = fakeModel(
    weeklyAnswers({
      "weekly.review": () => ({ approve: true, sendBack: "none", notes: [], rewardCheck: "not-crypto", rewardFactIds: [] }),
      "weekly.revise": () => {
        const d = goodDraft();
        return { ...d, view: { ...d.view, reasons: [...d.view.reasons, pricedInReason] } };
      },
    }),
  );
  const { last } = await runWeekFully({ gather: jumpGather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY, assets: [UNIVERSE[4]] });
  assert.equal(last.status, "ok", last.problems.join("\n"));
  assert.match(steps(model.calls, "weekly.editor")[0].user, /PRICED-IN CHECK \(computed in code\): FIRED/);
  assert.match(steps(model.calls, "weekly.review")[0].user, /PRICED-IN CHECK \(computed in code\): FIRED/);
  const revise = steps(model.calls, "weekly.revise");
  assert.equal(revise.length, 1);
  assert.match(revise[0].user, /SEND BACK: view/);
  assert.match(revise[0].user, /priced-in check fired/);
  const s = last.report!.assets[0];
  assert.ok(s.view.reasons.some((x) => x.factIds.includes(PRICED_IN.factId)));
  assert.ok(s.facts.some((f) => f.id === PRICED_IN.factId));
  assert.ok(last.report!.review.notes.some((n) => /priced-in check fired .*the view says so/.test(n)));
  assert.equal(last.report!.review.sentBack, 1);
});

test("priced in: a view that still does not say so after the send-back stays a note and is not auto-approved, never a no-reading", async () => {
  const { store } = memoryStore();
  const model = fakeModel(weeklyAnswers());
  const { last } = await runWeekFully({ gather: jumpGather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY, assets: [UNIVERSE[4]] });
  assert.equal(last.status, "ok", last.problems.join("\n"));
  assert.equal(steps(model.calls, "weekly.revise").length, 1);
  const r = last.report!;
  assert.equal(r.assets[0].status, "ok");
  assert.equal(r.review.approved, false);
  assert.ok(r.review.notes.some((n) => /still does not say so/.test(n)));
});

test("priced in: no jump, no send-back", async () => {
  const { store } = memoryStore();
  const calm: GatherFn = async (assetId, date) => makeInput(assetId, date, { bar5: 0.02 });
  const model = fakeModel(weeklyAnswers());
  const { last } = await runWeekFully({ gather: calm, gatherMarket, model: model.fn, store, ...caps, now: MONDAY, assets: [UNIVERSE[4]] });
  assert.equal(last.status, "ok", last.problems.join("\n"));
  assert.equal(steps(model.calls, "weekly.revise").length, 0);
  assert.match(steps(model.calls, "weekly.review")[0].user, /PRICED-IN CHECK \(computed in code\): not fired/);
  assert.equal(last.report!.review.approved, true);
});

test("reward check: crypto answers no data unless a cited fact shows it; other assets are not crypto", () => {
  const ctx = new Ctx(prepareFacts(makeFacts()).facts);
  const answer = (o: Record<string, unknown>) => JSON.stringify({ approve: true, sendBack: "none", notes: [], ...o });
  // Flagged without a fact behind it: no data (no invented emission figures).
  assert.equal(parseReview(answer({ rewardCheck: "reward-driven", rewardFactIds: [] }), ctx, true).rewardCheck, "no-data");
  assert.equal(parseReview(answer({ rewardCheck: "reward-driven", rewardFactIds: ["made.up"] }), ctx, true).rewardCheck, "no-data");
  assert.equal(parseReview(answer({ rewardCheck: "not-crypto", rewardFactIds: [] }), ctx, true).rewardCheck, "no-data");
  const flagged = parseReview(answer({ rewardCheck: "reward-driven", rewardFactIds: ["flow.etf"] }), ctx, true);
  assert.equal(flagged.rewardCheck, "reward-driven");
  assert.deepEqual(flagged.rewardFactIds, ["flow.etf"]);
  assert.equal(parseReview(answer({ rewardCheck: "reward-driven", rewardFactIds: ["flow.etf"] }), ctx, false).rewardCheck, "not-crypto");
  // An older answer shape without the fields still parses.
  assert.equal(parseReview(answer({}), ctx, true).rewardCheck, "no-data");
});

test("reward check: a crypto section's review note says no data", async () => {
  const { store } = memoryStore();
  const btc = UNIVERSE.find((a) => a.assetClass === "crypto")!;
  const model = fakeModel(weeklyAnswers({ "weekly.review": () => ({ approve: true, sendBack: "none", notes: [], rewardCheck: "reward-driven", rewardFactIds: [] }) }));
  const { last } = await runWeekFully({ gather, gatherMarket, model: model.fn, store, ...caps, now: MONDAY, assets: [btc] });
  assert.equal(last.status, "ok", last.problems.join("\n"));
  assert.ok(last.report!.review.notes.includes(`${btc.assetId} reviewer: real or reward driven: no data`));
});
