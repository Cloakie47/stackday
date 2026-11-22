import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateBars, barPeriodEnd, cleanBars, closedBars, fetchPriceHistory, parseCoinbaseCandles, parseTwelveData, PRICE_SOURCES, STOCK_PROVIDERS } from "./prices.ts";
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

test("stock provider: none by default (even with a key), nothing fetched or faked; no key is reported", async () => {
  for (const env of [{}, { RESEARCH_PRICE_API_KEY: "k" }]) {
    const r = await fetchPriceHistory(universeAsset("mAAPL")!, { ...noNetwork, env });
    assert.deepEqual(r.series, {});
    assert.match(r.problems[0], /RESEARCH_PRICE_PROVIDER not set \(default none: no stock provider that allows display and commercial use/);
  }
  const off = await fetchPriceHistory(universeAsset("mSPX")!, { ...noNetwork, env: { RESEARCH_PRICE_PROVIDER: "none", RESEARCH_PRICE_API_KEY: "k" } });
  assert.deepEqual(off.series, {});
  assert.match(off.problems[0], /RESEARCH_PRICE_PROVIDER=none/);
  const noKey = await fetchPriceHistory(universeAsset("mAAPL")!, { ...noNetwork, env: { RESEARCH_PRICE_PROVIDER: "twelvedata" } });
  assert.match(noKey.problems[0], /RESEARCH_PRICE_API_KEY not set/);
  const bad = await fetchPriceHistory(universeAsset("mSPX")!, { ...noNetwork, env: { RESEARCH_PRICE_PROVIDER: "yahoo" } });
  assert.match(bad.problems[0], /not a known provider/);
  assert.equal(STOCK_PROVIDERS.twelvedata.display, false);
  assert.equal(STOCK_PROVIDERS.twelvedata.commercial, false);
});

test("Twelve Data (internal only): the history is flagged display false for AAPL, NVDA and SPY", async () => {
  const body = JSON.stringify({ values: [{ datetime: "2026-11-18", open: "1", high: "2", low: "0.5", close: "1.5", volume: "100" }] });
  const deps: DataDeps = { ...noNetwork, env: { RESEARCH_PRICE_PROVIDER: "twelvedata", RESEARCH_PRICE_API_KEY: "k" }, fetch: async () => ({ ok: true, status: 200, text: async () => body }) };
  for (const id of ["mAAPL", "mNVDA", "mSPX"]) {
    const r = await fetchPriceHistory(universeAsset(id)!, deps);
    assert.ok(r.series["1d"], id);
    assert.equal(r.display, false, id);
    assert.ok(r.problems.some((p) => /internal only .* marked display false/.test(p)), id);
  }
  // Coinbase has no recorded restriction, so its history carries no flag.
  const btc = await fetchPriceHistory(universeAsset("mcbBTC")!, { ...noNetwork, fetch: async () => ({ ok: true, status: 200, text: async () => "[[1795046400, 1, 4, 2, 3, 10]]" }) });
  assert.equal(btc.display, undefined);
});

test("a failing source is reported without leaking the API key", async () => {
  const deps: DataDeps = { ...noNetwork, env: { RESEARCH_PRICE_PROVIDER: "twelvedata", RESEARCH_PRICE_API_KEY: "SECRET123" }, fetch: async () => ({ ok: false, status: 500, text: async () => "" }) };
  const r = await fetchPriceHistory(universeAsset("mNVDA")!, deps);
  assert.deepEqual(r.series, {});
  assert.equal(r.problems.filter((p) => /prices failed/.test(p)).length, 2);
  for (const p of r.problems) assert.ok(!p.includes("SECRET123"), p);
});

test("bar periods: crypto in UTC, stocks by NYSE session (early closes included)", () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  // Crypto: an hour, a day, Monday 00:00 UTC, the first of the next month.
  assert.equal(iso(barPeriodEnd("2026-11-23T11:00:00.000Z", "1h", true)), "2026-11-23T12:00:00.000Z");
  assert.equal(iso(barPeriodEnd("2026-11-23T00:00:00.000Z", "1d", true)), "2026-11-24T00:00:00.000Z");
  assert.equal(iso(barPeriodEnd("2026-11-18T00:00:00.000Z", "1w", true)), "2026-11-23T00:00:00.000Z");
  assert.equal(iso(barPeriodEnd("2026-11-02T00:00:00.000Z", "1mo", true)), "2026-12-01T00:00:00.000Z");
  // Stocks: the 15:30 hourly bar ends at the 16:00 close; a daily bar at the close.
  assert.equal(iso(barPeriodEnd("2026-11-20T20:30:00.000Z", "1h", false)), "2026-11-20T21:00:00.000Z");
  assert.equal(iso(barPeriodEnd("2026-11-20T14:30:00.000Z", "1d", false)), "2026-11-20T21:00:00.000Z");
  // Day after Thanksgiving closes at 1:00 p.m., which also ends that week.
  assert.equal(iso(barPeriodEnd("2026-11-27T14:30:00.000Z", "1d", false)), "2026-11-27T18:00:00.000Z");
  assert.equal(iso(barPeriodEnd("2026-11-23T14:30:00.000Z", "1w", false)), "2026-11-27T18:00:00.000Z");
  // November 2026 ends with Monday 30 November's close.
  assert.equal(iso(barPeriodEnd("2026-11-02T14:30:00.000Z", "1mo", false)), "2026-11-30T21:00:00.000Z");
});

test("closed bars only: at a Monday 12:00 UTC run the day, week and month so far are dropped", () => {
  const at = Date.parse("2026-11-23T12:00:00Z"); // Monday
  const day = (d: string, c: number): PriceBar => ({ t: `${d}T00:00:00.000Z`, o: c, h: c, l: c, c });
  const daily = ["2026-10-30", "2026-10-31", "2026-11-16", "2026-11-21", "2026-11-22", "2026-11-23"].map((d, i) => day(d, i + 1));
  assert.deepEqual(closedBars(daily, "1d", true, at).map((b) => b.t.slice(0, 10)), ["2026-10-30", "2026-10-31", "2026-11-16", "2026-11-21", "2026-11-22"]);
  const weekly = aggregateBars(daily, "1w");
  assert.deepEqual(closedBars(weekly, "1w", true, at).map((b) => b.t.slice(0, 10)), ["2026-10-30", "2026-11-16"]);
  assert.deepEqual(closedBars(aggregateBars(daily, "1mo"), "1mo", true, at).map((b) => b.t.slice(0, 10)), ["2026-10-30"]);
  // Stocks: Monday's daily bar (opens 14:30 UTC) is closed only after the 16:00 New York close.
  const stock = [{ t: "2026-11-20T14:30:00.000Z", o: 1, h: 1, l: 1, c: 1 }, { t: "2026-11-23T14:30:00.000Z", o: 2, h: 2, l: 2, c: 2 }];
  assert.deepEqual(closedBars(stock, "1d", false, at).map((b) => b.c), [1]);
  assert.deepEqual(closedBars(stock, "1d", false, Date.parse("2026-11-23T21:00:00Z")).map((b) => b.c), [1, 2]);
});
