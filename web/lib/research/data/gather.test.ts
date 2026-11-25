import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import deployment from "../../deployment.json" with { type: "json" };
import { NotResearchableError, cutSeries, gatherAsset, gatherRun } from "./gather.ts";
import { redactUrl, type DataDeps } from "./deps.ts";
import { barPeriodEnd } from "./prices.ts";
import { fetchOnchainHistory } from "./onchain.ts";
import { rpcKey, type Fixture } from "./record-fixtures.ts";
import { CHART_INTERVALS, PATTERN_KINDS, isDisplayable, type AssetResearchInput, type Fact, type MarketResearchInput, type PriceSeries } from "../types.ts";

/**
 * Replays recorded responses (see fixtures/*.json `recordedAt`, `note` and record-fixtures.ts).
 * The fake fetch answers HTTP 404 for any URL that was not recorded, so these tests never reach
 * the network and a missing response shows up as a "no reading" problem, as in production.
 */
const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (id: string): Fixture => JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));

function replayDeps(fx: Fixture, env: Record<string, string>, asset?: string): Partial<DataDeps> {
  // Recorded JSON-RPC answers are replayed in order per call; the last one repeats.
  const rpc = asset ? fx.rpcByAsset?.[asset] : fx.rpc;
  const used = new Map<string, number>();
  const answer = (key: string) => {
    const list = rpc?.[key];
    if (!list?.length) return { error: { code: -32000, message: "not recorded" } };
    const i = used.get(key) ?? 0;
    used.set(key, i + 1);
    return list[Math.min(i, list.length - 1)];
  };
  return {
    fetch: async (url, init) => {
      if (init?.method === "POST") {
        // JSON-RPC: answer each call of the batch from the recorded answers; anything else is an error answer.
        if (!rpc) return { ok: false, status: 404, text: async () => "not recorded" };
        const reqs = JSON.parse(init.body ?? "[]") as { id: number; method: string; params: unknown[] }[];
        const body = reqs.map((q) => ({ jsonrpc: "2.0", id: q.id, ...answer(rpcKey(q.method, q.params)) }));
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      }
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
  // S&P 500 and VIX facts stay internal until RESEARCH_SHOW_SP_VIX is set.
  for (const [id, f] of m) if (id.startsWith("macro.vixcls") || id.startsWith("macro.sp500")) assert.equal(f.display, false, id);
  assert.equal(m.get("macro.dgs10")!.display, undefined);
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
      for (const s of Object.values(a.series)) for (const b of s.bars) assert.ok(barPeriodEnd(b.t, s.interval, true) <= Date.parse(fx.recordedAt), `${a.assetId} ${s.interval}: only closed bars`);
      assert.ok(a.facts.every((x) => x.display === undefined || x.id.startsWith("macro.vixcls")), `${a.assetId}: Coinbase facts carry no display restriction`);
      for (const x of a.facts.filter((y) => /^(px|chg|ind|chart|lvl|vol|pat)\./.test(y.id))) assert.equal(x.source.display, true, `${a.assetId} ${x.id}: Coinbase source is display true`);
    } else {
      // This fixture holds no on-chain answers: the read fails, is reported, and nothing is faked.
      assert.deepEqual(a.series, {}, `${a.assetId}: no stock price without the chain, nothing faked`);
      assert.ok(!f.has("px.last"));
      assert.ok(a.problems.some((p) => /on-chain price read failed \(Base RPC answered HTTP 404\)/.test(p)), a.problems.join(" | "));
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

test("Apple newsroom and SEC EDGAR from recorded responses", async () => {
  const fx = load("mAAPL");
  const date = fx.recordedAt.slice(0, 10);
  const input = await gatherAsset("mAAPL", date, replayDeps(fx, { SEC_USER_AGENT: "Test Runner test@example.invalid" }), { market: EMPTY_MARKET(date), onchainBackfill: { note: "", generatedAt: "", assets: {} } });
  for (const p of input.problems) assert.doesNotMatch(p, /SEC EDGAR failed|Newsroom feed failed/, p);
  assert.equal(input.marketOpenToday, true); // 2026-11-19 is a Thursday
  const facts = checkFacts(input.facts);
  for (const id of ["news.0", "filing.0", "filing.1"]) assert.ok(facts.has(id), `missing ${id}`);
  const press = [...facts.values()].find((f) => f.source.name === "Apple Newsroom")!;
  assert.ok(press.tags?.includes("press-release"));
  assert.ok(press.source.url!.startsWith("https://www.apple.com/newsroom/"));
  assert.equal(facts.get("filing.0")!.source.name, "SEC EDGAR");
  assert.ok([...facts.values()].some((f) => f.id.startsWith("filing.") && f.value === "10-K"));
  assert.ok(input.problems.some((p) => /only company press releases/.test(p)), "press releases alone are flagged as one side");
});

test("on-chain stocks from recorded Base responses: current price, daily, weekly and monthly bars, chart read, honest gaps", async () => {
  const fx = load("onchain");
  assert.ok(fx.rpcByAsset && fx.backfill, "fixture holds RPC answers and its backfill");
  assert.match(fx.backfill!.note, /TEST COPY: truncated/, "the backfill copy ends days before the recording, so the run-time tail is replayed");
  const date = fx.recordedAt.slice(0, 10);
  for (const id of ["mAAPL", "mNVDA", "mSPX"]) {
    const input = await gatherAsset(id, date, replayDeps(fx, {}, id), { market: EMPTY_MARKET(date), onchainBackfill: fx.backfill });
    const f = checkFacts(input.facts);
    const why = `${id}: ${input.problems.join(" | ")}`;
    assert.deepEqual(Object.keys(input.series).sort(), ["1d", "1mo", "1w"], why);
    assert.ok(input.problems.some((p) => /no hourly bars from on-chain data/.test(p)));
    const daily = input.series["1d"]!;
    assert.ok(daily.bars.length >= (id === "mSPX" ? 20 : 70), `${id} has ${daily.bars.length} daily bars`);
    for (const b of daily.bars) assert.match(b.t, /T1[34]:30:00\.000Z$/, "stock bars open at 9:30 New York");
    for (const s of Object.values(input.series)) for (const b of s.bars) assert.ok(barPeriodEnd(b.t, s.interval, false) <= Date.parse(fx.recordedAt), `${id} ${s.interval}: only closed bars`);
    // The current price comes from the feed or the oracle and says it is the token's on-chain price.
    const last = f.get("px.last")!;
    assert.match(last.label, /^On-chain price of (AAPLc|NVDAc|deSPXA) on Base \((Chainlink "Coinbase (AAPL|NVDA)" feed, round 2\.\d+|Morpho market oracle, the price Morpho liquidates on)\), not /);
    assert.ok(Date.parse(last.asOf) <= Date.parse(fx.recordedAt));
    assert.match(last.source.name, id === "mSPX" ? /Morpho market oracle 0x98c27f1C7772d66bCF837F0b8A435A31E6e85b6d .* at block \d+, scaled by 1e24/ : /Chainlink "Coinbase (AAPL|NVDA)" feed 0x[0-9a-fA-F]{40} on Base, round 2\.\d+ \(read at block \d+\)/);
    assert.ok(f.has("px.pool.last") && f.has("px.pool.premium"), `${id}: pool price and premium`);
    assert.match(f.get("px.pool.last")!.source.name, /pool 0x[0-9a-f]{40} on Base, slot0 at block \d+/);
    // Daily chart read; short history says "no reading" for long-window detectors instead of guessing.
    assert.ok(input.chart["1d"], why);
    assert.ok(input.problems.some((p) => /golden cross \(50 over 200\), death cross \(50 under 200\) on daily bars need 211 bars, only \d+, no reading/.test(p)), why);
    assert.ok(!f.has("ind.1d.sma200") && !f.has("ind.1d.high52w"));
    assert.ok(input.problems.some((p) => /daily 200-bar average needs 200 bars/.test(p)));
    assert.ok(input.problems.some((p) => /52-week high and low need a year of daily bars/.test(p)));
    assert.ok(input.problems.some((p) => /monthly chart read needs at least 30 bars, no reading/.test(p)), "monthly chart is too thin");
    assert.match(f.get("ind.1d.vol")?.label ?? "Annualised volatility (all ", /less than a year/);
    // Every fact built from the series cites the feed or pool and is display true.
    for (const x of input.facts.filter((y) => /^(px|chg|ind|chart|lvl|vol|pat)\./.test(y.id))) {
      assert.equal(x.source.display, true, `${id} ${x.id}`);
      assert.ok(isDisplayable(x));
      assert.match(x.source.name, /0x[0-9a-fA-F]{40}/, `${id} ${x.id} names a contract`);
    }
    if (id === "mSPX") {
      assert.match(daily.source.name, /deSPXA\/USDC Uniswap v3 pool 0xd08f1fb797bfacded23323178672557034c64cfa \(swaps in blocks \d+ to \d+\)/);
      assert.ok(daily.bars.every((b) => b.v !== undefined && b.v > 0), "pool bars always carry volume");
    } else {
      assert.match(daily.source.name, /rounds 1\.1 to 2\.\d+, daily bars on NYSE sessions built by Stackday; volume in USDC from the (AAPLc|NVDAc)\/USDC/);
      assert.ok(daily.bars.some((b) => b.v !== undefined) && daily.bars.some((b) => b.v === undefined), "volume only where the backfill read the pool");
      assert.ok(input.problems.some((p) => /pool volume after .* is not read at run time/.test(p)));
    }
  }
});

test("on-chain backfill run: the current price and pool facts read today are not used for an earlier date", async () => {
  const fx = load("onchain");
  const input = await gatherAsset("mAAPL", "2026-11-23", replayDeps(fx, {}, "mAAPL"), { market: EMPTY_MARKET("2026-11-23"), onchainBackfill: fx.backfill });
  const f = checkFacts(input.facts);
  assert.ok(!f.has("px.pool.last") && !f.has("px.pool.premium"));
  // Monday's session closes at 21:00 UTC, after the 12:00 cut: the last close is Friday's.
  assert.equal(input.series["1d"]!.bars.at(-1)!.t, "2026-11-20T14:30:00.000Z");
  const last = f.get("px.last")!;
  assert.equal(last.asOf, "2026-11-20T21:00:00.000Z");
  assert.match(last.label, /^Last price \(on-chain price of AAPLc on Base, not Apple's exchange price\)$/);
});

test("on-chain run-time tail: rounds and pool swaps after a days-old backfill, within the time budget", async () => {
  const fx = load("onchain");
  const date = fx.recordedAt.slice(0, 10);
  const bf = fx.backfill!;
  for (const id of ["mAAPL", "mNVDA", "mSPX"]) {
    const deps = { ...replayDeps(fx, {}, id), now: () => new Date(fx.recordedAt) } as DataDeps;
    const h = await fetchOnchainHistory(id, deps, bf);
    assert.ok(h.daily && h.daily.length > 20, `${id}: ${h.problems.join(" | ")}`);
    assert.ok(h.requests <= 10, `${id}: ${h.requests} requests`);
    assert.ok(!h.problems.some((p) => /not read|budget/.test(p) && !/pool volume after/.test(p)), `${id}: ${h.problems.join(" | ")}`);
    if (id === "mSPX") {
      // 7 days of pool logs after the backfill: about 61 ranges of 50,000 blocks in batches of 10.
      const ranges = Object.keys(fx.rpcByAsset![id]).filter((k) => k.startsWith("eth_getLogs")).length;
      assert.ok(ranges > 50, `${ranges} getLogs ranges replayed`);
      const lastBf = Math.max(...bf.assets.mSPX.pool!.hours.map((r) => r[0]!));
      assert.ok(Date.parse(h.daily!.at(-1)!.t) > lastBf * 1000, "bars continue after the backfill");
    } else {
      const lastBfRound = bf.assets[id].feed!.lastRound["2"];
      const m = h.source!.name.match(/rounds 1\.1 to 2\.(\d+)/);
      assert.ok(m && Number(m[1]) > lastBfRound, `${id}: rounds after 2.${lastBfRound} were read (${h.source!.name.slice(0, 120)})`);
    }
  }
  // A live run that fires a few minutes after 12:00 UTC still uses the current price and pool facts.
  const late = await gatherAsset("mSPX", date, { ...replayDeps(fx, {}, "mSPX"), now: () => new Date(`${date}T12:03:00Z`) }, { market: EMPTY_MARKET(date), onchainBackfill: bf });
  const lf = checkFacts(late.facts);
  assert.match(lf.get("px.last")!.label, /Morpho market oracle/);
  assert.ok(lf.has("px.pool.premium"));
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

test("no look-ahead: bars after the run date and bars still forming are cut, weekly and monthly bars rebuilt", () => {
  const day = (iso: string, c: number) => ({ t: `${iso}T00:00:00.000Z`, o: c, h: c, l: c, c });
  const mk = (interval: PriceSeries["interval"], bars: ReturnType<typeof day>[]): PriceSeries => ({ assetId: "mcbBTC", interval, bars, source: { name: "test" }, fetchedAt: "2026-12-02T00:00:00Z" });
  const daily = [day("2026-10-30", 1), day("2026-11-18", 2), day("2026-11-22", 3), day("2026-11-23", 4), day("2026-12-01", 9)];
  const all = { "1d": mk("1d", daily), "1w": mk("1w", []), "1mo": mk("1mo", []) };
  // Run on Monday 2026-11-23 at 12:00 UTC: Monday's bar, the week so far and November are not closed.
  const cut = cutSeries(all, "2026-11-23", true, new Date("2026-11-23T12:00:00Z"));
  assert.deepEqual(cut["1d"]!.bars.map((b) => b.c), [1, 2, 3]);
  assert.deepEqual(cut["1w"]!.bars.map((b) => [b.t.slice(0, 10), b.c]), [["2026-10-30", 1], ["2026-11-18", 3]]);
  assert.deepEqual(cut["1mo"]!.bars.map((b) => b.c), [1]);
  // A backfill (no clock, or a clock long after the run date) is cut at 12:00 UTC on the run date,
  // like the live run: Monday's bar is still forming then, even though it has closed by now.
  for (const late of [cutSeries(all, "2026-11-23", true), cutSeries(all, "2026-11-23", true, new Date("2026-12-02T00:00:00Z"))]) {
    assert.deepEqual(late["1d"]!.bars.map((b) => b.c), [1, 2, 3]);
    assert.deepEqual(late["1w"]!.bars.map((b) => b.c), [1, 3]);
  }
  // Stocks: Monday's NYSE session closes at 21:00 UTC, after the 12:00 cut, so a backfill never sees it.
  const stock = (d: string, c: number) => ({ t: `${d}T14:30:00.000Z`, o: c, h: c, l: c, c });
  const s = cutSeries({ "1d": { ...mk("1d", []), bars: [stock("2026-11-20", 1), stock("2026-11-23", 2)] } }, "2026-11-23", false, new Date("2026-12-02T00:00:00Z"));
  assert.deepEqual(s["1d"]!.bars.map((b) => b.c), [1]);
});

test("Monday 12:00 UTC run: the still-forming daily and hourly bars never reach changes or patterns", async () => {
  const DAY = 86_400_000;
  const now = new Date("2026-11-23T12:00:00Z");
  const d0 = Date.parse("2026-11-23T00:00:00Z") - 399 * DAY;
  // 400 daily candles; the last (Monday, still forming) spikes to 200, which would read as a breakout.
  const closes = Array.from({ length: 400 }, (_, i) => (i === 399 ? 200 : 100 + i * 0.1));
  const candle = (t: number, c: number) => [t / 1000, c - 0.5, c + 0.5, c, c, 10];
  const dailyCandles = closes.map((c, i) => candle(d0 + i * DAY, c));
  // 300 hourly candles ending with the 12:00 bar that has just opened.
  const h0 = now.getTime() - 299 * 3_600_000;
  const hourlyCandles = Array.from({ length: 300 }, (_, i) => candle(h0 + i * 3_600_000, i === 299 ? 300 : 140));
  const deps: Partial<DataDeps> = {
    fetch: async (url) => {
      if (url.includes("api.exchange.coinbase.com")) return { ok: true, status: 200, text: async () => JSON.stringify(url.includes("granularity=3600") ? hourlyCandles : dailyCandles) };
      return { ok: false, status: 404, text: async () => "" };
    },
    env: {},
    now: () => now,
    sleep: async () => {},
  };
  const input = await gatherAsset("mcbBTC", "2026-11-23", deps, { market: EMPTY_MARKET("2026-11-23") });
  const f = checkFacts(input.facts);
  assert.equal(input.series["1d"]!.bars.at(-1)!.t, "2026-11-22T00:00:00.000Z");
  assert.equal(input.series["1h"]!.bars.at(-1)!.t, "2026-11-23T11:00:00.000Z");
  assert.equal(input.series["1w"]!.bars.at(-1)!.t.slice(0, 10), "2026-11-16");
  assert.equal(input.series["1mo"]!.bars.at(-1)!.t.slice(0, 7), "2026-10");
  assert.equal(f.get("px.last")!.value, 140);
  const c = (i: number) => 100 + i * 0.1;
  assert.equal(f.get("chg.1d.bar1")!.value, Math.round((c(398) / c(397) - 1) * 10000) / 100);
  // Last full week closed Sunday 22 November (index 398); the week before closed on index 391.
  assert.equal(f.get("chg.1w.bar1")!.value, Math.round((c(398) / c(391) - 1) * 10000) / 100);
  assert.ok(!f.has("pat.1d.breakout"), "the unclosed spike is not a breakout");
  assert.ok(!input.chart["1d"]!.patterns.some((p) => p.asOf === "2026-11-23T00:00:00.000Z"));
});

test("cutAt: a 22:30 UTC run includes the day's closed NYSE bar and crypto hours up to 22:00; a 12:00 run does not; early close", () => {
  const src = { name: "test" };
  const mk = (interval: PriceSeries["interval"], bars: { t: string; o: number; h: number; l: number; c: number }[]): PriceSeries => ({ assetId: "x", interval, bars, source: src, fetchedAt: "2026-12-02T00:00:00Z" });
  const bar = (t: string, c: number) => ({ t, o: c, h: c, l: c, c });
  const late = new Date("2026-12-02T00:00:00Z");
  // Crypto, Tuesday 2026-11-24: hourly bars 00:00 to 23:00 (close = the hour), daily bars for the 23rd and 24th.
  const hours = Array.from({ length: 24 }, (_, h) => bar(`2026-11-24T${String(h).padStart(2, "0")}:00:00.000Z`, h));
  const crypto = { "1h": mk("1h", hours), "1d": mk("1d", [bar("2026-11-23T00:00:00.000Z", 23), bar("2026-11-24T00:00:00.000Z", 24)]) };
  const evening = cutSeries(crypto, "2026-11-24", true, new Date("2026-11-24T22:31:00Z"), "2026-11-24T22:30:00Z");
  assert.equal(evening["1h"]!.bars.at(-1)!.t, "2026-11-24T21:00:00.000Z", "the 21:00 hour closed at 22:00 and is in");
  assert.equal(evening["1d"]!.bars.at(-1)!.c, 23, "the UTC day of the 24th is still open at 22:30");
  const noon = cutSeries(crypto, "2026-11-24", true, late);
  assert.equal(noon["1h"]!.bars.at(-1)!.t, "2026-11-24T11:00:00.000Z");
  assert.equal(noon["1d"]!.bars.at(-1)!.c, 23);
  // Capped at the end of the run date: a cut on the next morning never takes the 24th's UTC day or later hours.
  const nextDay = cutSeries(crypto, "2026-11-24", true, late, "2026-11-25T05:00:00Z");
  assert.equal(nextDay["1d"]!.bars.at(-1)!.c, 23);
  assert.equal(nextDay["1h"]!.bars.at(-1)!.t, "2026-11-24T22:00:00.000Z");
  // A cut time that is not a time falls back to 12:00 instead of dropping every bar.
  assert.deepEqual(cutSeries(crypto, "2026-11-24", true, late, "tonight"), noon);

  // Stocks: Tuesday's NYSE session closes at 21:00 UTC (16:00 New York, winter time).
  const stock = { "1d": mk("1d", [bar("2026-11-23T14:30:00.000Z", 1), bar("2026-11-24T14:30:00.000Z", 2)]) };
  assert.equal(cutSeries(stock, "2026-11-24", false, late, "2026-11-24T22:30:00Z")["1d"]!.bars.at(-1)!.c, 2, "22:30 run: today's close is in");
  assert.equal(cutSeries(stock, "2026-11-24", false, late, "2026-11-24T20:59:00Z")["1d"]!.bars.at(-1)!.c, 1, "before the close");
  assert.equal(cutSeries(stock, "2026-11-24", false, late)["1d"]!.bars.at(-1)!.c, 1, "default 12:00 run: previous close");
  assert.equal(cutSeries(stock, "2026-11-24", false, new Date("2026-11-24T20:00:00Z"), "2026-11-24T22:30:00Z")["1d"]!.bars.at(-1)!.c, 1, "never later than now");
  // Early close: Friday 2026-11-27 closes at 13:00 New York, 18:00 UTC.
  const friday = { "1d": mk("1d", [bar("2026-11-25T14:30:00.000Z", 1), bar("2026-11-27T14:30:00.000Z", 2)]) };
  assert.equal(cutSeries(friday, "2026-11-27", false, late, "2026-11-27T18:00:00Z")["1d"]!.bars.at(-1)!.c, 2);
  assert.equal(cutSeries(friday, "2026-11-27", false, late, "2026-11-27T17:59:00Z")["1d"]!.bars.at(-1)!.c, 1);
  assert.equal(cutSeries(friday, "2026-11-27", false, late)["1d"]!.bars.at(-1)!.c, 1);
});

test("cutAt end to end: the daily note's entry price is today's close for on-chain stocks and the 21:00 hourly close for crypto", async () => {
  const fx = load("onchain");
  const date = "2026-11-24";
  for (const id of ["mAAPL", "mNVDA"]) {
    const run = (cutAt?: string) => gatherAsset(id, date, replayDeps(fx, {}, id), { market: EMPTY_MARKET(date), onchainBackfill: fx.backfill, ...(cutAt ? { cutAt } : {}) });
    const evening = await run(`${date}T22:30:00Z`);
    const noon = await run();
    const daily = evening.series["1d"]!.bars;
    assert.equal(daily.at(-1)!.t, `${date}T14:30:00.000Z`, `${id}: ${evening.problems.join(" | ")}`);
    assert.equal(noon.series["1d"]!.bars.at(-1)!.t, "2026-11-23T14:30:00.000Z");
    // The engine scores a note from the last daily close (px.1d.last = indicators 1d last).
    assert.equal(evening.indicators["1d"]!.last, daily.at(-1)!.c);
    assert.equal(checkFacts(evening.facts).get("px.1d.prevClose")!.value, Math.round(daily.at(-2)!.c * 100) / 100);
    const bad = await run("after the close");
    assert.equal(bad.series["1d"]!.bars.at(-1)!.t, "2026-11-23T14:30:00.000Z");
    assert.ok(bad.problems.some((p) => /cut time "after the close" is not an ISO time/.test(p)));
  }

  // Crypto at 22:30 UTC: hourly bars through the 21:00 hour, daily bars through yesterday's UTC day.
  const DAY = 86_400_000;
  const now = new Date(`${date}T22:31:00Z`);
  const d0 = Date.parse(`${date}T00:00:00Z`) - 399 * DAY;
  const candle = (t: number, c: number) => [t / 1000, c - 0.5, c + 0.5, c, c, 10];
  const dailyCandles = Array.from({ length: 400 }, (_, i) => candle(d0 + i * DAY, 100 + i * 0.1));
  const h0 = Date.parse(`${date}T22:00:00Z`) - 299 * 3_600_000;
  const hourlyCandles = Array.from({ length: 300 }, (_, i) => candle(h0 + i * 3_600_000, 1000 + i));
  const deps: Partial<DataDeps> = {
    fetch: async (url) => (url.includes("api.exchange.coinbase.com") ? { ok: true, status: 200, text: async () => JSON.stringify(url.includes("granularity=3600") ? hourlyCandles : dailyCandles) } : { ok: false, status: 404, text: async () => "" }),
    env: {},
    now: () => now,
    sleep: async () => {},
  };
  const btc = await gatherAsset("mcbBTC", date, deps, { market: EMPTY_MARKET(date), cutAt: `${date}T22:30:00Z` });
  assert.equal(btc.series["1h"]!.bars.at(-1)!.t, `${date}T21:00:00.000Z`);
  assert.equal(btc.series["1d"]!.bars.at(-1)!.t, "2026-11-23T00:00:00.000Z");
  assert.equal(checkFacts(btc.facts).get("px.last")!.value, 1000 + 298, "last price is the 21:00 hourly close");
  const btcNoon = await gatherAsset("mcbBTC", date, deps, { market: EMPTY_MARKET(date) });
  assert.equal(btcNoon.series["1h"]!.bars.at(-1)!.t, `${date}T11:00:00.000Z`);
});

test("deSPXA: a partial pool read that also loses the block time keeps the backfill's coverage instead of dropping the series", async () => {
  // Fixture: the recorded mSPX answers (fixtures/onchain.json) with the first batch of 10
  // eth_getLogs ranges answered with no swaps and every later range unrecorded (an error answer),
  // so the tail read stops after the first batch. The block lookup for its last block is not
  // recorded either, so the block time fails too.
  const fx = load("onchain");
  const bf = fx.backfill!;
  const answers = fx.rpcByAsset!.mSPX;
  const logKeys = Object.keys(answers).filter((k) => k.startsWith("eth_getLogs"));
  const partial = (keepSwaps: boolean): Fixture => {
    const rpc: NonNullable<Fixture["rpc"]> = {};
    for (const [k, v] of Object.entries(answers)) {
      if (!k.startsWith("eth_getLogs")) rpc[k] = v;
      else if (logKeys.indexOf(k) < 10) rpc[k] = keepSwaps ? v : [{ result: [] }];
    }
    return { ...fx, rpcByAsset: { mSPX: rpc } };
  };
  const deps = (f: Fixture) => ({ ...replayDeps(f, {}, "mSPX"), now: () => new Date(fx.recordedAt) }) as DataDeps;
  const bfEnd = bf.assets.mSPX.pool!.toTime * 1000;

  const none = await fetchOnchainHistory("mSPX", deps(partial(false)), bf);
  const why = none.problems.join(" | ");
  assert.ok(none.daily && none.daily.length >= 20, `series kept: ${why}`);
  assert.ok(none.problems.some((p) => /pool swaps after block \d+ not read/.test(p)), why);
  assert.ok(none.problems.some((p) => /time of block \d+ not read; pool coverage ends at the backfill's end/.test(p)), why);
  assert.ok(!none.problems.some((p) => /no on-chain daily bars/.test(p)), why);
  assert.ok(none.daily!.every((b) => barPeriodEnd(b.t, "1d", false) <= bfEnd), "no bar after the backfill's coverage");

  // With swaps in the batch that was read, coverage reaches the newest swap read, never less than the backfill.
  const some = await fetchOnchainHistory("mSPX", deps(partial(true)), bf);
  assert.ok(some.problems.some((p) => /time of block \d+ not read; pool coverage ends at the last swap read/.test(p)), some.problems.join(" | "));
  assert.ok(some.daily!.length >= none.daily!.length);
  assert.ok(some.daily!.at(-1)!.t >= none.daily!.at(-1)!.t);
});
