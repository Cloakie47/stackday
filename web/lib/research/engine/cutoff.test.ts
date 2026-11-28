import { test } from "node:test";
import assert from "node:assert/strict";
import type { Fact } from "../types.ts";
import { RUN_TIME_UTC } from "../data/gather.ts";
import { filingKnownAt, selectNews, type FeedItem } from "../data/news.ts";
import { windowEnd } from "../data/flows.ts";
import { cutFacts, cutInput, cutLine, dailyCutoff, noonCutoff, WEEKLY_CUT_UTC } from "./cutoff.ts";
import { runDaily, type GatherFn } from "./daily.ts";
import { calendarFacts } from "./facts.ts";
import { memoryStore } from "./store.ts";
import { fakeModel, goodDaily, makeFacts, makeInput, makeMarket, runWeekFully, weeklyAnswers } from "./test-helpers.ts";
import { UNIVERSE } from "../universe.ts";

// Founder plan item 6: nothing known or published after a run's cut-off reaches a report.

const src = { name: "Test fixture" };
const fact = (id: string, kind: Fact["kind"], asOf: string): Fact => ({ id, kind, label: id, value: kind === "news" ? "headline" : 1, source: src, asOf });
const CUT = Date.parse("2026-11-23T12:00:00Z");
const READ = Date.parse("2026-11-23T15:05:00Z");

test("the weekly cut time is the data step's 12:00 UTC run time", () => {
  assert.equal(WEEKLY_CUT_UTC, RUN_TIME_UTC);
  assert.equal(noonCutoff("2026-11-23", new Date(READ)), CUT);
  // A manual call before noon cuts at its own time.
  assert.equal(noonCutoff("2026-11-23", new Date("2026-11-23T09:00:00Z")), Date.parse("2026-11-23T09:00:00Z"));
  assert.equal(dailyCutoff("2026-11-30", new Date("2026-11-30T22:31:05Z")), Date.parse("2026-11-30T22:31:05Z"));
  assert.equal(dailyCutoff("2026-11-27", new Date("2026-11-30T22:31:05Z")), Date.parse("2026-11-27T12:00:00Z"));
});

test("a headline published one minute after the cut-off is dropped, one at the cut-off is kept", () => {
  const facts = [fact("news.0", "news", "2026-11-23T12:01:00Z"), fact("news.1", "news", "2026-11-23T12:00:00Z")];
  const { kept, dropped } = cutFacts(facts, { cutoffMs: CUT, readAtMs: READ, live: true });
  assert.deepEqual(kept.map((f) => f.id), ["news.1"]);
  assert.deepEqual(dropped.map((d) => d.id), ["news.0"]);
  assert.match(dropped[0].why, /published 2026-11-23T12:01:00Z, after the cut-off 2026-11-23T12:00:00.000Z/);
  const line = cutLine("mAAPL", dropped, CUT)!;
  assert.match(line, /^mAAPL: 1 fact dropped, known or published after the cut-off 2026-11-23T12:00:00.000Z \(news\.0 published/);
  assert.equal(cutLine("mAAPL", [], CUT), null);
});

test("filings and macro use their own publication time; calendar events are never dropped by their date", () => {
  // The week-ahead events carry the event's own date (next week) as asOf: they must survive.
  const events = calendarFacts([{ id: "cal.2026-11-26.pce", date: "2026-11-26", kind: "pce", name: "PCE inflation", assetIds: [], source: src }]);
  assert.equal(events[0].asOf, "2026-11-26T00:00:00Z");
  const facts = [...events, fact("cal.open", "calendar", "2026-11-23T15:05:00Z"), fact("filing.0", "filing", "2026-11-23T13:30:00Z"), fact("filing.1", "filing", "2026-11-20T21:30:40Z"), fact("macro.dgs10", "macro", "2026-11-24T00:00:00Z")];
  const { kept, dropped } = cutFacts(facts, { cutoffMs: CUT, readAtMs: READ, live: true });
  assert.deepEqual(kept.map((f) => f.id), ["cal.2026-11-26.pce", "cal.open", "filing.1"]);
  assert.deepEqual(dropped.map((d) => d.id), ["filing.0", "macro.dgs10"]);
});

test("a live run keeps current readings up to the moment its data was read, a backfill only up to the cut-off", () => {
  const facts = [fact("px.last", "price", "2026-11-23T15:00:00Z"), fact("px.pool.last", "price", "2026-11-23T15:06:00Z"), fact("ind.1d.rsi14", "indicator", "2026-11-20T21:00:00Z")];
  const live = cutFacts(facts, { cutoffMs: CUT, readAtMs: READ, live: true });
  assert.deepEqual(live.kept.map((f) => f.id), ["px.last", "ind.1d.rsi14"]);
  assert.match(live.dropped[0].why, /after the data was read/);
  const backfill = cutFacts(facts, { cutoffMs: CUT, readAtMs: READ, live: false });
  assert.deepEqual(backfill.kept.map((f) => f.id), ["ind.1d.rsi14"]);
});

test("the input's own cut-off is used, never later than the run's", () => {
  const input = { date: "2026-11-23", facts: [fact("news.0", "news", "2026-11-23T11:30:00Z")], cutAt: "2026-11-23T11:00:00Z" };
  assert.equal(cutInput(input, CUT, new Date(READ)).dropped.length, 1);
  const later = { ...input, cutAt: "2026-11-23T18:00:00Z" };
  assert.equal(cutInput(later, CUT, new Date(READ)).dropped.length, 0);
  assert.equal(cutInput(later, CUT, new Date(READ)).cutoffMs, CUT);
  // Unchanged input object when nothing is dropped.
  assert.equal(cutInput(later, CUT, new Date(READ)).input, later);
});

test("news fetchers end their window at the cut-off; filings use the SEC acceptance time; funding stops at the cut-off", () => {
  const items: FeedItem[] = [
    { title: "Before the cut", url: "https://example.com/a", publishedAt: "2026-11-23T11:59:00.000Z", summary: "" },
    { title: "One minute after", url: "https://example.com/b", publishedAt: "2026-11-23T12:01:00.000Z", summary: "" },
  ];
  const now = new Date("2026-11-23T15:05:00Z");
  assert.deepEqual(selectNews(items, "2026-11-23", now, [], "t").map((i) => i.url), ["https://example.com/b", "https://example.com/a"]);
  assert.deepEqual(selectNews(items, "2026-11-23", now, [], "t", 7, 8, CUT).map((i) => i.url), ["https://example.com/a"]);
  assert.equal(filingKnownAt({ form: "8-K", filingDate: "2026-11-23", acceptedAt: "2026-11-23T13:30:00.000Z", items: [], url: "https://x" }), Date.parse("2026-11-23T13:30:00Z"));
  assert.equal(filingKnownAt({ form: "8-K", filingDate: "2026-11-23", items: [], url: "https://x" }), Date.parse("2026-11-23T00:00:00Z"));
  assert.equal(windowEnd("2026-11-23", now, CUT), CUT);
  assert.equal(windowEnd("2026-11-23", now), Date.parse("2026-11-23T15:00:00Z"));
});

const MONDAY_SLOT = () => new Date("2026-11-23T13:05:00Z");

test("weekly run: a headline from after 12:00 UTC never reaches a model or the report; the Week ahead calendar stays", async () => {
  const late: Fact = { id: "news.late", kind: "news", label: "Late headline after the cut", value: "headline", source: { name: "Reuters" }, asOf: "2026-11-23T12:01:00Z" };
  const gather: GatherFn = async (assetId, date) => {
    const base = makeInput(assetId, date);
    return { ...base, facts: [...base.facts, late] };
  };
  const gatherMarket = async (date: string) => {
    const m = makeMarket(date);
    return { ...m, facts: [...m.facts, { ...late, id: "news.marketLate" }] };
  };
  const { store } = memoryStore();
  const model = fakeModel(weeklyAnswers());
  const { last } = await runWeekFully({ gather, gatherMarket, model: model.fn, store, maxRunCostUsd: 4, maxDayCostUsd: 6, now: MONDAY_SLOT, assets: [UNIVERSE[0]] });
  assert.equal(last.status, "ok", last.problems.join("\n"));
  assert.ok(model.calls.length > 0);
  assert.ok(model.calls.every((c) => !`${c.context ?? ""}${c.user}`.includes("news.late") && !`${c.context ?? ""}${c.user}`.includes("news.marketLate")));
  const report = (await store.weekly("2026-11-23"))!.report;
  const section = report.assets[0];
  assert.equal(section.status, "ok");
  assert.ok(!section.facts.some((f) => f.id === "news.late"));
  // The week-ahead event (dated Thursday, after the cut-off) is still in the section and was citable.
  assert.ok(section.weekAhead.some((e) => e.id === "cal.2026-11-26.pce"));
  assert.ok(model.calls.some((c) => c.step === "weekly.analyst.macro" && `${c.context ?? ""}${c.user}`.includes("cal.2026-11-26.pce")));
  assert.ok(report.review.notes.some((n) => /news\.late published 2026-11-23T12:01:00Z/.test(n)), report.review.notes.join("\n"));
});

test("daily run: a headline stamped after the note's run time is dropped and logged, the note still goes out", async () => {
  const { store } = memoryStore();
  const future: Fact = { id: "news.future", kind: "news", label: "Headline from the future", value: "headline", source: { name: "Reuters" }, asOf: "2026-11-19T22:31:00Z" };
  const gather: GatherFn = async (assetId, date) => makeInput(assetId, date, { facts: [...makeFacts(100, "2026-11-18T21:00:00Z", "2026-11-18T21:00:00Z"), future] });
  const model = fakeModel(() => goodDaily());
  const out = await runDaily({ gather, model: model.fn, store, maxRunCostUsd: 2, maxDayCostUsd: 6, now: () => new Date("2026-11-19T22:30:00Z") });
  assert.equal(out.status, "ok");
  assert.equal(out.counts.ok, 6);
  assert.ok(model.calls.every((c) => !c.user.includes("news.future")));
  assert.ok(out.problems.some((p) => /after the cut-off 2026-11-19T22:30:00.000Z \(news\.future published 2026-11-19T22:31:00Z\)/.test(p)), out.problems.join("\n"));
});
