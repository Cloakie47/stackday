import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateBars, cleanBars, fetchPriceHistory, parseCoinbaseCandles, parseTwelveData, PRICE_SOURCES, STOCK_PROVIDERS } from "./prices.ts";
import { UNIVERSE, universeAsset } from "../universe.ts";
import type { DataDeps } from "./deps.ts";
import type { PriceBar } from "../types.ts";

const noNetwork: DataDeps = {
  fetch: async () => {
    throw new Error("must not fetch");
  },
  env: {},
  now: () => new Date("2026-11-19T12:00:00Z"),
  sleep: async () => {},
};

test("every research asset has a price source: Coinbase for crypto and gold, the stock switch for the rest", () => {
  for (const a of UNIVERSE) assert.ok(a.assetId in PRICE_SOURCES, a.assetId);
  for (const a of UNIVERSE) assert.equal(PRICE_SOURCES[a.assetId].provider, a.calendar === "CRYPTO" ? "coinbase" : "stock", a.assetId);
  assert.deepEqual(Object.keys(PRICE_SOURCES).sort(), UNIVERSE.map((a) => a.assetId).sort());
});

test("Coinbase candles: [time, low, high, open, close, volume], newest first", () => {
  const bars = cleanBars(parseCoinbaseCandles([[1795046400, 1, 4, 2, 3, 10], [1794960000, 5, 8, 6, 7, 20]]));
  assert.deepEqual(bars, [
    { t: "2026-11-18T00:00:00.000Z", o: 6, h: 8, l: 5, c: 7, v: 20 },
    { t: "2026-11-19T00:00:00.000Z", o: 2, h: 4, l: 1, c: 3, v: 10 },
  ]);
  assert.throws(() => parseCoinbaseCandles({ message: "NotFound" }), /NotFound/);
});

test("Twelve Data: daily bars stamped at the 9:30 New York open, intraday in UTC", () => {
  const daily = parseTwelveData({ values: [{ datetime: "2026-11-18", open: "1", high: "2", low: "0.5", close: "1.5", volume: "100" }] });
  assert.equal(daily[0].t, "2026-11-18T14:30:00.000Z");
  const hourly = parseTwelveData({ values: [{ datetime: "2026-11-18 20:30:00", open: "1", high: "2", low: "0.5", close: "1.5" }] });
  assert.equal(hourly[0].t, "2026-11-18T20:30:00.000Z");
  assert.throws(() => parseTwelveData({ status: "error", code: 401, message: "bad key" }), /401/);
});

test("weekly and monthly bars are built from daily bars", () => {
  const day = (iso: string, o: number, h: number, l: number, c: number): PriceBar => ({ t: `${iso}T00:00:00.000Z`, o, h, l, c, v: 1 });
  const daily = [
    day("2026-11-27", 10, 12, 9, 11), // Friday, week of 2026-11-23
    day("2026-11-30", 11, 15, 10, 14), // Monday, new week, new month
    day("2026-12-01", 14, 16, 13, 15),
    day("2026-12-04", 15, 15, 8, 9),
  ];
  assert.deepEqual(aggregateBars(daily, "1w"), [
    { t: "2026-11-27T00:00:00.000Z", o: 10, h: 12, l: 9, c: 11, v: 1 },
    { t: "2026-11-30T00:00:00.000Z", o: 11, h: 16, l: 8, c: 9, v: 3 },
  ]);
  assert.deepEqual(aggregateBars(daily, "1mo"), [
    { t: "2026-11-27T00:00:00.000Z", o: 10, h: 15, l: 9, c: 14, v: 2 },
    { t: "2026-12-01T00:00:00.000Z", o: 14, h: 16, l: 8, c: 9, v: 2 },
  ]);
});

test("no key: stocks are reported in problems and nothing is fetched or faked", async () => {
  const r = await fetchPriceHistory(universeAsset("mAAPL")!, noNetwork);
  assert.deepEqual(r.series, {});
  assert.match(r.problems[0], /RESEARCH_PRICE_API_KEY not set/);
  const off = await fetchPriceHistory(universeAsset("mSPX")!, { ...noNetwork, env: { RESEARCH_PRICE_PROVIDER: "none", RESEARCH_PRICE_API_KEY: "k" } });
  assert.deepEqual(off.series, {});
  assert.match(off.problems[0], /RESEARCH_PRICE_PROVIDER=none/);
  const bad = await fetchPriceHistory(universeAsset("mSPX")!, { ...noNetwork, env: { RESEARCH_PRICE_PROVIDER: "yahoo" } });
  assert.match(bad.problems[0], /not a known provider/);
  assert.equal(STOCK_PROVIDERS.twelvedata.display, false);
});

test("a failing source is reported without leaking the API key", async () => {
  const deps: DataDeps = { ...noNetwork, env: { RESEARCH_PRICE_API_KEY: "SECRET123" }, fetch: async () => ({ ok: false, status: 500, text: async () => "" }) };
  const r = await fetchPriceHistory(universeAsset("mNVDA")!, deps);
  assert.deepEqual(r.series, {});
  assert.equal(r.problems.length, 2);
  for (const p of r.problems) assert.ok(!p.includes("SECRET123"), p);
});
