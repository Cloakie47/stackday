import { test } from "node:test";
import assert from "node:assert/strict";
import deployment from "../deployment.json" with { type: "json" };
import { UNIVERSE, universeAsset, searchUniverse } from "./universe.ts";
import { TIMEFRAMES, ACTIONS, RESEARCH_DISCLAIMER } from "./types.ts";

test("every deployed asset is in the research universe, and nothing extra", () => {
  const deployed = new Set(deployment.assetSymbols as string[]);
  const universe = new Set(UNIVERSE.map((a) => a.assetId));
  for (const s of deployed) assert.ok(universe.has(s), `${s} is deployed but missing from UNIVERSE`);
  for (const s of universe) assert.ok(deployed.has(s), `${s} is in UNIVERSE but not deployed`);
});

test("asset ids are unique and stocks with a public price have an SEC id", () => {
  assert.equal(new Set(UNIVERSE.map((a) => a.assetId)).size, UNIVERSE.length);
  for (const a of UNIVERSE) {
    if (a.assetClass === "stock" && a.publicPrice) assert.match(a.cik ?? "", /^\d{10}$/, a.assetId);
  }
});

test("lookup and search", () => {
  assert.equal(universeAsset("mAAPL")?.underlying, "AAPL");
  assert.equal(universeAsset("nope"), undefined);
  assert.deepEqual(searchUniverse("bitcoin").map((a) => a.assetId).sort(), ["mMSTR", "mcbBTC"].sort());
  assert.equal(searchUniverse("").length, UNIVERSE.length);
});

test("fixed option lists and disclaimer stay as agreed", () => {
  assert.deepEqual([...TIMEFRAMES], ["1h", "1d", "1w", "1m", "1y", "5y"]);
  assert.deepEqual([...ACTIONS], ["buy", "hold", "sell", "watch"]);
  assert.match(RESEARCH_DISCLAIMER, /not investment advice/);
  assert.doesNotMatch(RESEARCH_DISCLAIMER, /—/);
});
