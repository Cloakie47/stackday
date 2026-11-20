import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import deployment from "../../deployment.json" with { type: "json" };
import { NotResearchableError, cutSeries, gatherAsset, gatherRun } from "./gather.ts";
import { redactUrl, type DataDeps } from "./deps.ts";
import { CHART_INTERVALS, PATTERN_KINDS, type AssetResearchInput, type Fact, type MarketResearchInput, type PriceSeries } from "../types.ts";

/**
 * Replays recorded responses (see fixtures/*.json `recordedAt`, `note` and record-fixtures.ts).
 * The fake fetch answers HTTP 404 for any URL that was not recorded, so these tests never reach
 * the network and a missing response shows up as a "no reading" problem, as in production.
 */
type Fixture = { recordedAt: string; note: string; responses: Record<string, { status: number; body: string }> };
const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (id: string): Fixture => JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));

function replayDeps(fx: Fixture, env: Record<string, string>): Partial<DataDeps> {
  return {
    fetch: async (url) => {
      const hit = fx.responses[redactUrl(url)];
      if (!hit) return { ok: false, status: 404, text: async () => "not recorded" };
      return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, text: async () => hit.body };
    },
    env,
    now: () => new Date(fx.recordedAt),
    sleep: async () => {},
  };
}

const EMPTY_MARKET = (date: string): MarketResearchInput => ({ date, facts: [], calendar: [], problems: [] });

function checkFacts(facts: Fact[]): Map<string, Fact> {
  const ids = facts.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, `fact ids are unique: ${ids.filter((x, i) => ids.indexOf(x) !== i).join(", ")}`);
  for (const f of facts) {
    assert.ok(f.source.name.length > 0, `${f.id} has a source`);
    assert.ok(Number.isFinite(Date.parse(f.asOf)), `${f.id} has a time`);
    if (typeof f.value === "number") assert.ok(Number.isFinite(f.value), `${f.id} is a finite number`);
    if (f.quote !== undefined) assert.ok(f.quote.split(/\s+/).length <= 25, `${f.id} quote <= 25 words`);
    // Our own wording has no em dashes; headlines are copied from their source as published.
    if (f.kind !== "news" && f.kind !== "filing" && f.kind !== "calendar") for (const s of [f.label, String(f.value), f.source.name]) assert.ok(!s.includes(String.fromCharCode(0x2014)), `${f.id} has no em dash`);
  }
  return new Map(facts.map((f) => [f.id, f]));
}

function checkChart(input: AssetResearchInput) {
  const facts = new Map(input.facts.map((f) => [f.id, f]));
  for (const iv of CHART_INTERVALS) {
    const c = input.chart[iv];
    if (!c) {
      // Allowed only with a stated reason, for example PAXG's short monthly history on Coinbase.
      assert.ok(input.problems.some((p) => /chart read needs at least 30 bars, no reading/.test(p)), `${input.assetId} ${iv}: no chart read and no reason`);
      continue;
    }
    for (const id of c.factIds) assert.ok(facts.has(id), `${input.assetId} chart ${iv} cites ${id}, which exists`);
    assert.ok(facts.has(`chart.${iv}.trend`) && facts.has(`vol.${iv}.regime`));
    for (const p of c.patterns) {
      assert.ok((PATTERN_KINDS as readonly string[]).includes(p.kind));
      assert.equal(facts.get(p.id)?.kind, "pattern");
      assert.equal(facts.get(p.id)?.value, p.invalidation);
    }
    for (let i = 1; i < c.support.length; i++) assert.ok(c.support[i] < c.support[i - 1], "support nearest first");
    for (let i = 1; i < c.resistance.length; i++) assert.ok(c.resistance[i] > c.resistance[i - 1], "resistance nearest first");
  }
}

test("a whole run from recorded responses: market input, every asset, sources and times on every fact", async () => {
  const fx = load("run");
  const date = fx.recordedAt.slice(0, 10);
  const run = await gatherRun(date, replayDeps(fx, {}));
  assert.deepEqual(run.refused, []);
  assert.deepEqual(run.assets.map((a) => a.assetId).sort(), ["mAAPL", "mNVDA", "mPAXG", "mSPX", "mWETH", "mcbBTC"]);

  // Market: FRED macro, the official week ahead, market headlines.
  const m = checkFacts(run.market.facts);
  for (const id of ["macro.dgs2", "macro.dgs10", "macro.dfii10", "macro.dtwexbgs", "macro.vixcls", "macro.dff", "macro.fedTarget", "macro.curve2s10s", "macro.sp500.trend", "macro.payems.chg", "macro.unrate"]) {
    assert.ok(m.has(id), `market has ${id}`);
  }
  // CPI for October 2025 was never published (FRED shows "."), so year over year can be a no-reading line.
  for (const s of ["cpiaucsl", "cpilfesl"]) assert.ok(m.has(`macro.${s}.yoy`) || run.market.problems.some((p) => p.includes(`FRED ${s.toUpperCase()}`)), s);
  assert.ok(!m.has("macro.sp500"), "the S&P 500 level is never published (owner forbids reproduction)");
  assert.ok(run.market.calendar.length > 0);
  for (const e of run.market.calendar) {
    assert.ok(e.date >= date, "week ahead starts at the run date");
    assert.ok(m.has(e.id), `calendar event ${e.id} is also a fact`);
  }
  assert.ok(run.market.problems.some((p) => /Fed funds expectations/.test(p)));

  for (const a of run.assets) {
    const f = checkFacts(a.facts);
    if (a.assetId === "mcbBTC" || a.assetId === "mWETH" || a.assetId === "mPAXG") {
      assert.deepEqual(Object.keys(a.series).sort(), ["1d", "1h", "1mo", "1w"], a.assetId);
      for (const id of ["px.last", "px.1d.prevClose", "chg.1h.bar1", "chg.1d.bar1", "chg.1w.bar1", "chg.1mo.bar1", "ind.1d.rsi14", "ind.1w.rsi14", "ind.1d.high52w", ...(a.assetId === "mPAXG" ? [] : ["ind.1mo.sma20"])]) {
        assert.ok(f.has(id), `${a.assetId} has ${id}`);
      }
      checkChart(a);
      for (const p of a.problems) assert.doesNotMatch(p, /prices failed/, `${a.assetId}: ${p}`);
      assert.ok(a.chart["1d"] && a.chart["1w"], `${a.assetId} has daily and weekly chart reads`);
      assert.ok(Date.parse(f.get("px.last")!.asOf) <= Date.parse(fx.recordedAt), "never dated in the future");
    } else {
      assert.deepEqual(a.series, {}, `${a.assetId}: no stock price without a provider key, nothing faked`);
      assert.ok(!f.has("px.last"));
      assert.ok(a.problems.some((p) => /RESEARCH_PRICE_API_KEY not set/.test(p)));
      assert.ok(a.problems.some((p) => /no daily bars, no chart reading/.test(p)));
    }
    assert.ok(a.calendar.every((e) => e.assetIds.length === 0 || e.assetIds.includes(a.assetId)));
  }
  const btc = run.assets.find((a) => a.assetId === "mcbBTC")!;
  const bf = new Map(btc.facts.map((f) => [f.id, f]));
  assert.ok(bf.has("flow.funding.last") && bf.has("flow.funding.avg7d"), "funding rate from Binance or Deribit");
  assert.ok(bf.has("flow.stablecoins.total"));
  assert.ok(bf.has("macro.dtwexbgs"), "asset input carries the macro facts that matter for it");
  assert.ok(btc.problems.some((p) => /ETF flows: no free public source/.test(p)));
  const gold = run.assets.find((a) => a.assetId === "mPAXG")!;
  assert.ok(gold.facts.some((f) => f.id === "macro.dfii10"), "gold gets real yields from FRED");
  const nvda = run.assets.find((a) => a.assetId === "mNVDA")!;
  const news = nvda.facts.filter((f) => f.kind === "news");
  assert.ok(news.some((f) => f.tags?.includes("reputable-outlet")), "NVIDIA has outlet headlines");
  assert.ok(news.some((f) => f.tags?.includes("export-controls")), "export controls are tagged in code");
  assert.ok(nvda.problems.some((p) => /earnings dates: no official machine-readable source/.test(p)));
});

test("Apple with keys: Twelve Data bars on three timeframes, chart read, newsroom and SEC EDGAR", async () => {
  const fx = load("mAAPL");
  const date = fx.recordedAt.slice(0, 10);
  const input = await gatherAsset("mAAPL", date, replayDeps(fx, { RESEARCH_PRICE_API_KEY: "test-key", SEC_USER_AGENT: "Test Runner test@example.invalid" }), { market: EMPTY_MARKET(date) });
  for (const p of input.problems) assert.doesNotMatch(p, /prices failed|SEC EDGAR failed|Newsroom feed failed|chart read/, p);
  assert.equal(input.marketOpenToday, true); // 2026-11-19 is a Thursday
  const facts = checkFacts(input.facts);
  for (const id of ["px.last", "chg.1h.bar1", "chg.1d.bar20", "ind.1d.sma50", "ind.1d.macdHist", "ind.1w.sma50", "news.0", "filing.0", "filing.1"]) assert.ok(facts.has(id), `missing ${id}`);
  checkChart(input);
  // The last hourly bar starts 15:30 New York and ends at the 16:00 close, not an hour later.
  assert.equal(facts.get("px.last")!.asOf, "2026-11-18T21:00:00.000Z");
  assert.equal(facts.get("px.1d.prevClose")!.asOf, "2026-11-17T21:00:00.000Z");
  const press = [...facts.values()].find((f) => f.source.name === "Apple Newsroom")!;
  assert.ok(press.tags?.includes("press-release"));
  assert.ok(press.source.url!.startsWith("https://www.apple.com/newsroom/"));
  assert.equal(facts.get("filing.0")!.source.name, "SEC EDGAR");
  assert.ok([...facts.values()].some((f) => f.id.startsWith("filing.") && f.value === "10-K"));
  assert.ok(input.problems.some((p) => /only company press releases/.test(p)), "press releases alone are flagged as one side");
});

test("assets that are not researchable are refused", async () => {
  const off: Partial<DataDeps> = { fetch: async () => ({ ok: false, status: 503, text: async () => "" }), env: {}, now: () => new Date("2026-11-19T15:00:00Z"), sleep: async () => {} };
  for (const id of ["mMSFT", "mSPCX", "mXYZ"]) await assert.rejects(gatherAsset(id, "2026-11-19", off), NotResearchableError, id);
  const noMarket = { ...(deployment as Record<string, unknown>), mAAPLLendingAdapter: "0x0000000000000000000000000000000000000000" };
  await assert.rejects(gatherAsset("mAAPL", "2026-11-19", off, { deployment: noMarket }), /not borrowable/);
});

test("holidays and failing sources: closed market, no prices, problems say why", async () => {
  const off: Partial<DataDeps> = { fetch: async () => ({ ok: false, status: 503, text: async () => "" }), env: {}, now: () => new Date("2026-11-26T15:00:00Z"), sleep: async () => {} };
  const input = await gatherAsset("mSPX", "2026-11-26", off, { market: EMPTY_MARKET("2026-11-26") });
  assert.equal(input.marketOpenToday, false);
  const facts = checkFacts(input.facts);
  assert.equal(facts.get("cal.holiday")!.value, "Thanksgiving Day");
  assert.equal(facts.get("cal.lastTradingDay")!.value, "2026-11-25");
  assert.deepEqual(input.chart, {});
  assert.ok(input.problems.some((p) => /no daily bars, no chart reading/.test(p)));
  const btc = await gatherAsset("mcbBTC", "2026-11-26", off);
  assert.ok(btc.problems.some((p) => /1d prices failed/.test(p)));
  assert.ok(btc.problems.some((p) => /funding rate failed on every venue/.test(p)));
  assert.ok(btc.problems.some((p) => /GDELT\) failed, no reading/.test(p)));
  assert.ok(btc.calendar.some((e) => e.kind === "options-expiry"), "computed events still work offline");
});

test("no look-ahead: bars after the run date are cut and weekly and monthly bars rebuilt", () => {
  const day = (iso: string, c: number) => ({ t: `${iso}T00:00:00.000Z`, o: c, h: c, l: c, c });
  const mk = (interval: PriceSeries["interval"], bars: ReturnType<typeof day>[]): PriceSeries => ({ assetId: "mcbBTC", interval, bars, source: { name: "test" }, fetchedAt: "2026-11-30T00:00:00Z" });
  const daily = [day("2026-11-18", 1), day("2026-11-19", 2), day("2026-11-20", 3), day("2026-12-01", 9)];
  const cut = cutSeries({ "1d": mk("1d", daily), "1w": mk("1w", []), "1mo": mk("1mo", []) }, "2026-11-19");
  assert.deepEqual(cut["1d"]!.bars.map((b) => b.c), [1, 2]);
  assert.deepEqual(cut["1w"]!.bars.map((b) => b.c), [2]);
  assert.deepEqual(cut["1mo"]!.bars.map((b) => [b.h, b.c]), [[2, 2]]);
});
