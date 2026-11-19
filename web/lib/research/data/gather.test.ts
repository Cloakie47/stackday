import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gatherAsset } from "./gather.ts";
import { redactUrl, type DataDeps } from "./deps.ts";
import type { AssetResearchInput } from "../types.ts";

/**
 * Replays real responses recorded on 2026-11-19 (see fixtures/*.json `recordedAt` and
 * record-fixtures.ts). The fake fetch throws for any URL that was not recorded, so this test
 * can never reach the network.
 */
type Fixture = { recordedAt: string; responses: Record<string, { status: number; body: string }> };
const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (id: string): Fixture => JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));

function replayDeps(fx: Fixture, env: Record<string, string>): Partial<DataDeps> {
  return {
    fetch: async (url) => {
      const hit = fx.responses[redactUrl(url)];
      if (!hit) throw new Error(`not recorded: ${redactUrl(url)}`);
      return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, text: async () => hit.body };
    },
    env,
    now: () => new Date(fx.recordedAt),
    sleep: async () => {},
  };
}

function checkFacts(input: AssetResearchInput) {
  const ids = input.facts.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "fact ids are unique");
  for (const f of input.facts) {
    assert.ok(f.source.name.length > 0, `${f.id} has a source`);
    assert.ok(Number.isFinite(Date.parse(f.asOf)), `${f.id} has a time`);
    if (typeof f.value === "number") assert.ok(Number.isFinite(f.value), `${f.id} is a finite number`);
    if (f.quote !== undefined) assert.ok(f.quote.split(/\s+/).length <= 25, `${f.id} quote <= 25 words`);
  }
  return new Map(input.facts.map((f) => [f.id, f]));
}

test("bitcoin from recorded Coinbase candles: series, indicators and stable fact ids", async () => {
  const fx = load("mcbBTC");
  const date = fx.recordedAt.slice(0, 10);
  const input = await gatherAsset("mcbBTC", date, replayDeps(fx, {}));
  assert.deepEqual(input.problems, []);
  assert.equal(input.marketOpenToday, true);
  assert.deepEqual(Object.keys(input.series).sort(), ["1d", "1h", "1mo", "1w"]);
  assert.ok(input.series["1d"]!.bars.length > 1800, "about 5 years of daily bars");
  const facts = checkFacts(input);
  for (const id of ["px.last", "px.prevClose", "chg.1h", "chg.1d", "chg.1w", "chg.1m", "chg.1y", "chg.5y", "ind.rsi14.1d", "ind.sma200.1d", "ind.atr14.1d", "ind.vol.1d", "ind.mdd.1d", "ind.high52w.1d", "ind.rsi14.1h", "ind.rsi14.1w", "cal.open"]) {
    assert.ok(facts.has(id), `missing ${id}`);
  }
  const hourly = input.series["1h"]!.bars;
  assert.equal(facts.get("px.last")!.value, Math.round(hourly[hourly.length - 1].c * 100) / 100);
  assert.equal(facts.get("px.last")!.source.name, "Coinbase Exchange public candles (BTC-USD)");
  const rsi = facts.get("ind.rsi14.1d")!.value as number;
  assert.ok(rsi >= 0 && rsi <= 100);
  assert.ok(Date.parse(facts.get("px.last")!.asOf) <= Date.parse(fx.recordedAt), "never dated in the future");
});

test("gold through PAXG: shorter history still works, 5y change is simply absent", async () => {
  const fx = load("mPAXG");
  const input = await gatherAsset("mPAXG", fx.recordedAt.slice(0, 10), replayDeps(fx, {}));
  assert.deepEqual(input.problems, []);
  const facts = checkFacts(input);
  assert.ok(facts.has("chg.1y"));
  assert.ok(!facts.has("chg.5y"));
  assert.match(String(facts.get("px.last")!.label), /PAXG/);
});

test("Apple with keys: Twelve Data prices, Apple Newsroom news and SEC EDGAR filings", async () => {
  const fx = load("mAAPL");
  const date = fx.recordedAt.slice(0, 10);
  const input = await gatherAsset("mAAPL", date, replayDeps(fx, { RESEARCH_PRICE_API_KEY: "test-key", SEC_USER_AGENT: "Test Runner test@example.invalid" }));
  assert.deepEqual(input.problems, []);
  assert.equal(input.marketOpenToday, true); // 2026-11-19 is a Thursday
  const facts = checkFacts(input);
  for (const id of ["px.last", "chg.1h", "chg.1d", "chg.5y", "ind.sma50.1d", "ind.macdHist.1d", "news.0", "filing.0", "filing.1"]) assert.ok(facts.has(id), `missing ${id}`);
  // The last hourly bar starts 15:30 New York and ends at the 16:00 close, not an hour later.
  assert.equal(facts.get("px.last")!.asOf, "2026-11-18T21:00:00.000Z");
  assert.equal(facts.get("px.prevClose")!.asOf, "2026-11-17T21:00:00.000Z");
  assert.equal(facts.get("news.0")!.source.name, "Apple Newsroom");
  assert.ok(facts.get("news.0")!.source.url!.startsWith("https://www.apple.com/newsroom/"));
  assert.equal(facts.get("filing.0")!.source.name, "SEC EDGAR");
  assert.equal(facts.get("filing.0")!.value, "8-K");
  assert.ok([...facts.values()].some((f) => f.id.startsWith("filing.") && f.value === "10-K"));
});

test("Apple without keys: no prices are faked, news still flows, problems say why", async () => {
  const fx = load("mAAPL");
  const input = await gatherAsset("mAAPL", fx.recordedAt.slice(0, 10), replayDeps(fx, {}));
  assert.deepEqual(input.series, {});
  const facts = checkFacts(input);
  assert.ok(!facts.has("px.last"));
  assert.ok(facts.has("news.0"));
  assert.equal(input.problems.length, 2);
  assert.ok(input.problems.some((p) => p.includes("RESEARCH_PRICE_API_KEY")));
  assert.ok(input.problems.some((p) => p.includes("SEC_USER_AGENT")));
});

test("holidays, private assets and unknown ids", async () => {
  const off = { fetch: async () => ({ ok: false, status: 503, text: async () => "" }), env: {}, now: () => new Date("2026-11-26T15:00:00Z"), sleep: async () => {} };
  const thanksgiving = await gatherAsset("mSPCX", "2026-11-26", off);
  assert.equal(thanksgiving.marketOpenToday, false);
  const facts = checkFacts(thanksgiving);
  assert.equal(facts.get("cal.holiday")!.value, "Thanksgiving Day");
  assert.equal(facts.get("cal.lastTradingDay")!.value, "2026-11-25");
  assert.match(thanksgiving.problems.join(" "), /no public market price/);
  const unknown = await gatherAsset("mXYZ", "2026-11-19", off);
  assert.deepEqual(unknown.problems, ["mXYZ: not in the research universe"]);
});
