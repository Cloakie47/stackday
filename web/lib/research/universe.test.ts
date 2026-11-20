import { test } from "node:test";
import assert from "node:assert/strict";
import deployment from "../deployment.json" with { type: "json" };
import { UNIVERSE, universeAsset, searchUniverse, checkResearchable, researchableUniverse, isBorrowable, deployedLltv } from "./universe.ts";
import { VIEWS, CHART_INTERVALS, RESEARCH_DISCLAIMER, BETA_LABEL, PLANS } from "./types.ts";

const dep = deployment as Record<string, unknown>;

test("the universe is the six assets in the founder spec", () => {
  assert.deepEqual(UNIVERSE.map((a) => a.assetId).sort(), ["mAAPL", "mNVDA", "mPAXG", "mSPX", "mWETH", "mcbBTC"].sort());
});

test("every research asset is deployed, borrowable, and has the deployed liquidation limit", () => {
  const deployed = new Set(dep.assetSymbols as string[]);
  for (const a of UNIVERSE) {
    assert.ok(deployed.has(a.assetId), `${a.assetId} is not deployed`);
    assert.ok(isBorrowable(a.assetId, dep), `${a.assetId} is not borrowable`);
    assert.equal(deployedLltv(a.assetId, dep), a.lltv, `${a.assetId} LLTV`);
  }
  assert.deepEqual(researchableUniverse(dep).refused, []);
});

test("checkResearchable refuses invest-only, excluded and unknown assets", () => {
  assert.equal(checkResearchable("mAAPL", dep).ok, true);
  for (const id of ["mMSFT", "mTSLA", "mSGOV", "mSPCX", "mGOOGL", "nope"]) {
    assert.equal(checkResearchable(id, dep).ok, false, id);
  }
  // An asset in the universe whose market disappears from the deployment is refused too.
  const noMarket = { ...dep, mAAPLLendingAdapter: "0x0000000000000000000000000000000000000000" };
  const c = checkResearchable("mAAPL", noMarket);
  assert.equal(c.ok, false);
  if (!c.ok) assert.match(c.reason, /not borrowable/);
  assert.equal(researchableUniverse(noMarket).assets.length, 5);
  assert.equal(isBorrowable("mMSFT", dep), false);
});

test("stocks have an SEC id", () => {
  assert.equal(new Set(UNIVERSE.map((a) => a.assetId)).size, UNIVERSE.length);
  for (const a of UNIVERSE) if (a.assetClass === "stock") assert.match(a.cik ?? "", /^\d{10}$/, a.assetId);
});

test("lookup and search", () => {
  assert.equal(universeAsset("mAAPL")?.underlying, "AAPL");
  assert.equal(universeAsset("mMSFT"), undefined);
  assert.deepEqual(searchUniverse("bitcoin").map((a) => a.assetId), ["mcbBTC"]);
  assert.equal(searchUniverse("").length, UNIVERSE.length);
});

test("fixed option lists and wording stay as agreed", () => {
  assert.deepEqual([...VIEWS], ["accumulate", "hold", "reduce", "avoid-new-buys"]);
  assert.deepEqual([...CHART_INTERVALS], ["1d", "1w", "1mo"]);
  assert.deepEqual([...PLANS], ["free", "weekly-single", "monthly"]);
  assert.match(RESEARCH_DISCLAIMER, /not financial advice/);
  for (const s of [RESEARCH_DISCLAIMER, BETA_LABEL]) assert.doesNotMatch(s, /—/);
});
