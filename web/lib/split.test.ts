import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SPLIT_ASSETS, nudgeWeight, splitAmount, splitToBps, toggleAsset, weightsOf, type Split } from "./split.ts";

test("an even split across three assets gives exact basis points of the salary", () => {
  const s: Split = { pct: 20, symbols: ["A", "B", "C"] };
  const r = splitToBps(s);
  assert.deepEqual(r.symbols, ["A", "B", "C"]);
  assert.equal(r.bps.reduce((a, b) => a + b, 0), 2000);
  assert.deepEqual(r.bps, [668, 666, 666]);
});

test("no share or no assets means nothing is invested", () => {
  assert.deepEqual(splitToBps({ pct: 0, symbols: ["A"] }), { symbols: [], bps: [] });
  assert.deepEqual(splitToBps({ pct: 10, symbols: [] }), { symbols: [], bps: [] });
});

test("custom weights are respected and always sum to 100", () => {
  const s: Split = { pct: 10, symbols: ["A", "B"], weights: { A: 75, B: 25 } };
  assert.deepEqual(splitToBps(s).bps, [750, 250]);
  const w = weightsOf({ pct: 10, symbols: ["A", "B"], weights: { A: 3, B: 1 } });
  assert.equal(w.A + w.B, 100);
});

test("nudging one asset takes the difference from the others", () => {
  let s: Split = { pct: 20, symbols: ["A", "B", "C"] };
  s = nudgeWeight(s, "A", 10);
  const w = weightsOf(s);
  assert.equal(w.A, 43, "33.3% + 10 rounds to a whole 43%");
  assert.ok(Math.abs(w.A + w.B + w.C - 100) < 1e-9);
  assert.equal(splitToBps(s).bps.reduce((a, b) => a + b, 0), 2000);
});

test("an asset nudged to zero is left out of the plan", () => {
  const s = nudgeWeight({ pct: 20, symbols: ["A", "B"] }, "B", -50);
  assert.deepEqual(splitToBps(s).symbols, ["A"]);
});

test("toggling adds, removes and stops at the 6-asset limit", () => {
  let s: Split = { pct: 10, symbols: [] };
  for (const x of ["A", "B", "C", "D", "E", "F", "G"]) s = toggleAsset(s, x);
  assert.equal(s.symbols.length, MAX_SPLIT_ASSETS);
  s = toggleAsset(s, "A");
  assert.deepEqual(s.symbols, ["B", "C", "D", "E", "F"]);
});

test("an invested amount is spread to the last unit", () => {
  const r = splitAmount(1_000_001n, { pct: 20, symbols: ["A", "B", "C"] });
  assert.equal(r.amounts.reduce((a, b) => a + b, 0n), 1_000_001n);
  assert.equal(r.symbols.length, 3);
});
