import { test } from "node:test";
import assert from "node:assert/strict";
import { binanceFundingUrl, fetchFlows, fetchStablecoins, parseBinanceFunding, parseDeribitFunding, parseStablecoins, windowEnd } from "./flows.ts";
import type { DataDeps } from "./deps.ts";

const NOW = new Date("2026-11-20T12:34:00Z");
const END = windowEnd("2026-11-20", NOW);
const H8 = 8 * 3_600_000;

const binance = Array.from({ length: 21 }, (_, i) => ({ symbol: "BTCUSDT", fundingTime: END - (20 - i) * H8, fundingRate: "0.0001", markPrice: "1" }));
const deribit = { jsonrpc: "2.0", result: Array.from({ length: 168 }, (_, i) => ({ timestamp: END - (167 - i) * 3_600_000, interest_8h: 0.0002, interest_1h: 0.00001, index_price: 1 })) };
const llama = {
  peggedAssets: [
    { symbol: "USDT", pegType: "peggedUSD", circulating: { peggedUSD: 180e9 }, circulatingPrevDay: { peggedUSD: 179e9 }, circulatingPrevWeek: { peggedUSD: 178e9 }, circulatingPrevMonth: { peggedUSD: 170e9 } },
    { symbol: "USDC", pegType: "peggedUSD", circulating: { peggedUSD: 80e9 }, circulatingPrevDay: { peggedUSD: 80e9 }, circulatingPrevWeek: { peggedUSD: 82e9 }, circulatingPrevMonth: { peggedUSD: 80e9 } },
    { symbol: "EURC", pegType: "peggedEUR", circulating: { peggedEUR: 1e8 } },
  ],
};

function deps(routes: Record<string, unknown>): DataDeps {
  return {
    fetch: async (url) => {
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key || routes[key] === 451) return { ok: false, status: 451, text: async () => "" };
      return { ok: true, status: 200, text: async () => JSON.stringify(routes[key]) };
    },
    env: {},
    now: () => NOW,
    sleep: async () => {},
  };
}

test("parsers read Binance, Deribit and DefiLlama shapes", () => {
  assert.equal(parseBinanceFunding(binance).length, 21);
  assert.equal(parseDeribitFunding(deribit).length, 168);
  const s = parseStablecoins(llama);
  assert.equal(s.total, 260e9);
  assert.equal(s.count, 2, "only USD-pegged coins count");
  assert.throws(() => parseBinanceFunding({ code: 0 }), /unexpected shape/);
  assert.equal(END, Date.parse("2026-11-20T12:00:00Z"));
  assert.match(binanceFundingUrl("BTCUSDT", END), /endTime=\d+&limit=21$/);
});

test("Binance funding: latest 8h rate and the 7-day average annualised", async () => {
  const r = await fetchFlows("mcbBTC", "2026-11-20", deps({ "fapi.binance.com": binance, "stablecoins.llama.fi": llama }));
  const f = new Map(r.facts.map((x) => [x.id, x]));
  assert.equal(f.get("flow.funding.last")!.value, 0.01);
  assert.equal(f.get("flow.funding.avg7d")!.value, 10.95); // 0.0001 x 3 x 365 x 100
  assert.match(f.get("flow.funding.last")!.source.name, /Binance/);
  assert.equal(f.get("flow.stablecoins.total")!.value, 260);
  assert.equal(f.get("flow.stablecoins.chg30d")!.value, 4); // 260 / 250
  assert.ok(r.problems.some((p) => /ETF flows: no free public source/.test(p)), "ETF flows are a no-reading line, never invented");
});

test("Binance refused (HTTP 451): Deribit fallback; both refused: no reading", async () => {
  const r = await fetchFlows("mWETH", "2026-11-20", deps({ "fapi.binance.com": 451, "deribit.com": deribit, "stablecoins.llama.fi": llama }));
  const f = new Map(r.facts.map((x) => [x.id, x]));
  assert.match(f.get("flow.funding.last")!.source.name, /Deribit/);
  assert.equal(f.get("flow.funding.last")!.value, 0.02);
  assert.equal(f.get("flow.funding.avg7d")!.value, 8.76); // 0.00001 x 24 x 365 x 100
  const none = await fetchFlows("mWETH", "2026-11-20", deps({}));
  assert.ok(!none.facts.some((x) => x.id.startsWith("flow.funding")));
  assert.ok(none.problems.some((p) => /funding rate failed on every venue, no reading/.test(p)));
  assert.ok(none.problems.some((p) => /Stablecoin supply failed, no reading/.test(p)));
  assert.deepEqual(await fetchFlows("mAAPL", "2026-11-20", deps({})), { facts: [], problems: [] });
});

test("stablecoin supply for a past date is no reading, not today's number", async () => {
  const r = await fetchStablecoins("2026-11-01", deps({ "stablecoins.llama.fi": llama }));
  assert.deepEqual(r.facts, []);
  assert.match(r.problems[0], /only current figures/);
});
