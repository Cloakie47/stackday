import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, changesSince, PREMIUM_ONLY_TEXT, ReportInputError, summarizeNote, type BuildReportInput } from "./build.ts";
import { makeNote, makeSnapshot } from "../portfolio/fixtures.ts";
import { RESEARCH_DISCLAIMER, TIMEFRAMES, type PortfolioInput } from "../types.ts";

const SNAP = makeSnapshot([
  { assetId: "mAAPL", price: 100, action: "hold" },
  { assetId: "mNVDA", price: 200, action: "buy", stance: "positive" },
  { assetId: "mSPX", price: 50, action: "hold" },
  { assetId: "mcbBTC", price: 1000, action: "watch" },
]);
const PORTFOLIO: PortfolioInput = {
  holdings: [
    { assetId: "mAAPL", amount: 2, origin: "vault" },
    { assetId: "mSPX", amount: 10, origin: "manual" },
  ],
  horizon: "long",
  risk: "medium",
  monthlyNewMoneyUsd: 100,
};
const base = (over: Partial<BuildReportInput> = {}): BuildReportInput => ({
  id: "r1",
  createdAt: "2026-11-19T22:00:00.000Z",
  scope: "market",
  period: "daily",
  owner: null,
  premium: true,
  snapshot: SNAP,
  ...over,
});

test("every report carries the research disclaimer and the snapshot date", () => {
  for (const scope of ["market", "asset", "portfolio", "full"] as const) {
    for (const premium of [true, false]) {
      const r = buildReport(base({ scope, premium, assetId: "mAAPL", portfolio: PORTFOLIO, owner: "0xabc" }));
      assert.equal(r.disclaimer, RESEARCH_DISCLAIMER);
      assert.equal(r.snapshotDate, "2026-11-19");
      assert.equal(r.premium, premium);
    }
  }
});

test("scopes pick the right content", () => {
  const market = buildReport(base({ scope: "market" }));
  assert.equal(market.notes.length, 4);
  assert.ok(market.market);
  assert.equal(market.portfolio, undefined);

  const asset = buildReport(base({ scope: "asset", assetId: "mNVDA" }));
  assert.deepEqual(asset.notes.map((n) => n.assetId), ["mNVDA"]);
  assert.equal(asset.market, undefined);

  const portfolio = buildReport(base({ scope: "portfolio", portfolio: PORTFOLIO, owner: "0xabc" }));
  assert.deepEqual(portfolio.notes.map((n) => n.assetId).sort(), ["mAAPL", "mSPX"]);
  assert.equal(portfolio.portfolio?.totalUsd, 700);
  assert.equal(portfolio.market, undefined);

  const full = buildReport(base({ scope: "full", portfolio: PORTFOLIO, owner: "0xabc" }));
  assert.equal(full.notes.length, 4);
  assert.ok(full.market && full.portfolio);
});

test("missing asset or portfolio input is refused, and an asset with no note says so", () => {
  assert.throws(() => buildReport(base({ scope: "asset" })), ReportInputError);
  assert.throws(() => buildReport(base({ scope: "asset", assetId: "mFAKE" })), ReportInputError);
  assert.throws(() => buildReport(base({ scope: "portfolio" })), ReportInputError);
  const r = buildReport(base({ scope: "asset", assetId: "mTSLA" }));
  assert.equal(r.notes.length, 0);
  assert.ok(r.changes.some((c) => /no research note for Tesla/.test(c.text)));
});

test("premium keeps every timeframe; free keeps the period's timeframe and the daily one", () => {
  const premium = buildReport(base({ period: "weekly", premium: true }));
  for (const tf of TIMEFRAMES) assert.notEqual(premium.notes[0].outlook[tf].text, PREMIUM_ONLY_TEXT);

  const free = buildReport(base({ period: "weekly", premium: false }));
  const o = free.notes[0].outlook;
  assert.notEqual(o["1d"].text, PREMIUM_ONLY_TEXT);
  assert.notEqual(o["1w"].text, PREMIUM_ONLY_TEXT);
  for (const tf of ["1h", "1m", "1y", "5y"] as const) {
    assert.equal(o[tf].text, PREMIUM_ONLY_TEXT);
    assert.equal(o[tf].stance, "no-view");
  }
  assert.equal(free.notes[0].scenarios.bull.text, PREMIUM_ONLY_TEXT);
  // The price fact always survives, and every fact the free note still cites is present.
  for (const n of free.notes) {
    const ids = new Set(n.facts.map((f) => f.id));
    assert.ok(ids.has("px.last"));
    const cited = [...n.reasons, ...n.opportunities, ...n.risks, ...Object.values(n.outlook), n.scenarios.base].flatMap((r) => r.factIds);
    for (const id of cited) assert.ok(ids.has(id), `${n.assetId} cites missing ${id}`);
  }
});

test("free notes keep at most two reasons, one opportunity and one risk", () => {
  const note = makeNote({ assetId: "mAAPL", price: 1 });
  note.reasons = [1, 2, 3, 4].map((i) => ({ text: `r${i}`, factIds: ["ind.rsi14"] }));
  note.risks = [1, 2].map((i) => ({ text: `k${i}`, factIds: [] }));
  const s = summarizeNote(note, "monthly");
  assert.equal(s.reasons.length, 2);
  assert.equal(s.risks.length, 1);
  assert.notEqual(s.outlook["1m"].text, PREMIUM_ONLY_TEXT);
  assert.equal(note.reasons.length, 4, "original note untouched");
});

test("free portfolio reports are summary depth: no per-holding verdicts, one idea, facts trimmed to what is cited", () => {
  const free = buildReport(base({ scope: "portfolio", premium: false, portfolio: PORTFOLIO, owner: "0xabc" }));
  const premium = buildReport(base({ scope: "portfolio", premium: true, portfolio: PORTFOLIO, owner: "0xabc" }));
  assert.equal(free.portfolio!.holdings.length, 0);
  assert.ok(premium.portfolio!.holdings.length > 0);
  assert.equal(free.portfolio!.rebalanceIdeas.length, 1);
  assert.equal(free.portfolio!.health.score, premium.portfolio!.health.score);
  assert.deepEqual(free.portfolio!.byClass, premium.portfolio!.byClass);
  const ids = new Set(free.portfolio!.facts.map((f) => f.id));
  for (const r of [...free.portfolio!.concentration, ...free.portfolio!.overlaps, ...free.portfolio!.rebalanceIdeas]) {
    for (const id of r.factIds) assert.ok(ids.has(id));
  }
});

test("changes: first report, same research day, action changes, big price moves, portfolio moves", () => {
  const first = buildReport(base());
  assert.match(first.changes[first.changes.length - 1].text, /first daily report/);

  const same = buildReport(base({ previous: first }));
  assert.ok(same.changes.some((c) => /same day, so nothing has changed/.test(c.text)));

  const tomorrow = makeSnapshot(
    [
      { assetId: "mAAPL", price: 110, action: "buy" },
      { assetId: "mNVDA", price: 202, action: "buy", stance: "positive" },
      { assetId: "mSPX", price: 50, action: "hold", status: "no-reading" },
      { assetId: "mcbBTC", price: 900, action: "watch" },
    ],
    { date: "2026-11-20" },
  );
  const next = buildReport(base({ snapshot: tomorrow, previous: first }));
  const texts = next.changes.map((c) => c.text);
  assert.ok(texts.some((t) => /Apple: the suggested action changed from Hold to Buy since your last daily report \(research of 2026-11-19\)/.test(t)));
  assert.ok(texts.some((t) => /Apple moved \+10.0%, from \$100.00 to \$110.00/.test(t)));
  assert.ok(texts.some((t) => /Bitcoin moved -10.0%/.test(t)));
  assert.ok(!texts.some((t) => /NVIDIA/.test(t)), "a 1% move with the same action is not news");
  assert.ok(texts.some((t) => /S&P 500 has no research reading today/.test(t)));
  const appleChange = next.changes.find((c) => /Apple: the suggested action/.test(c.text))!;
  assert.deepEqual(appleChange.factIds, ["mAAPL:px.last"]);

  const p1 = buildReport(base({ scope: "portfolio", portfolio: PORTFOLIO, owner: "0xabc", period: "weekly" }));
  const p2 = buildReport(base({ scope: "portfolio", portfolio: PORTFOLIO, owner: "0xabc", period: "weekly", snapshot: tomorrow, previous: p1 }));
  assert.ok(p2.changes.some((c) => /value of your priced holdings went from \$700.00 to \$720.00/.test(c.text)));

  const quiet = changesSince(first, { snapshotDate: "2026-11-20", notes: SNAP.notes, period: "monthly" });
  assert.match(quiet[0].text, /No suggested action changed and no price moved 5% or more since your last monthly report/);
});

test("a report built from the sample snapshot says so first", () => {
  const r = buildReport(base());
  assert.match(r.changes[0].text, /labelled sample snapshot/);
  const live = buildReport(base({ snapshot: { ...SNAP, kind: "live" } }));
  assert.ok(!live.changes.some((c) => /sample/.test(c.text)));
});

test("the builder is deterministic and leaves the snapshot alone", () => {
  const copy = structuredClone(SNAP);
  const a = buildReport(base({ scope: "full", premium: false, portfolio: PORTFOLIO, owner: "0xabc" }));
  const b = buildReport(base({ scope: "full", premium: false, portfolio: PORTFOLIO, owner: "0xabc" }));
  assert.deepEqual(a, b);
  assert.deepEqual(SNAP, copy);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a, "a report survives a JSON round trip (it is stored as jsonb)");
});
