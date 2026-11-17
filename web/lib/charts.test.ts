import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TIMEFRAME, NO_PUBLIC_CHART, TIMEFRAMES, TV_SYMBOLS, timeframe, tvSymbol } from "./charts.ts";
import d from "./deployment.json" with { type: "json" };

test("every deployed asset has a real market symbol to chart", () => {
  for (const s of d.assetSymbols as string[]) assert.ok(TV_SYMBOLS[s] || NO_PUBLIC_CHART.has(s), `no chart symbol for ${s}`);
  assert.equal(tvSymbol("mcbBTC"), "COINBASE:BTCUSD");
  assert.equal(tvSymbol("unknown"), undefined);
});

test("the founder's timeframes, in order, each with a candle size and a window", () => {
  assert.deepEqual(
    TIMEFRAMES.map((t) => t.label),
    ["1m", "5m", "1H", "1D", "1W", "1M", "1Y", "5Y"],
  );
  for (const t of TIMEFRAMES) assert.ok(t.interval);
  assert.deepEqual(TIMEFRAMES.filter((t) => t.range).map((t) => t.label), ["1Y", "5Y"]);
  assert.equal(new Set(TIMEFRAMES.map((t) => t.id)).size, TIMEFRAMES.length);
  assert.equal(timeframe(DEFAULT_TIMEFRAME).label, "1D");
  assert.equal(timeframe("nope").label, "1D");
});
