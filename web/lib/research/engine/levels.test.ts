import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLevels, roundPrice } from "./levels.ts";
import { universeAsset } from "../universe.ts";

const aapl = universeAsset("mAAPL")!;
const daily = { last: 200, changePct: {}, atr14: 4, support: [193, 180], resistance: [212, 240] };

test("uses nearest support and resistance inside the ATR bands, with a basis", () => {
  const l = computeLevels(aapl, daily, "buy");
  assert.ok(l);
  assert.equal(l.entry, 200);
  assert.equal(l.stop, 192); // 193 less 0.25 x 4
  assert.equal(l.target, 212);
  assert.match(l.basis, /support 193/);
  assert.match(l.basis, /resistance 212/);
});

test("falls back to ATR multiples when no level is in range", () => {
  const l = computeLevels(aapl, { ...daily, support: [150], resistance: [201] }, "hold");
  assert.deepEqual([l?.stop, l?.target], [192, 212]);
  assert.match(l!.basis, /2 x ATR14/);
});

test("null for SpaceX, Treasuries, a sell, or missing data", () => {
  assert.equal(computeLevels(universeAsset("mSPCX")!, daily, "buy"), null);
  assert.equal(computeLevels(universeAsset("mSGOV")!, daily, "buy"), null);
  assert.equal(computeLevels(aapl, daily, "sell"), null);
  assert.equal(computeLevels(aapl, undefined, "buy"), null);
  assert.equal(computeLevels(aapl, { last: 200, changePct: {} }, "buy"), null);
});

test("rounding keeps sensible precision", () => {
  assert.equal(roundPrice(91234.567), 91235);
  assert.equal(roundPrice(182.3456), 182.35);
  assert.equal(roundPrice(0.123456), 0.1235);
});
