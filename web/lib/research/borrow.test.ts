import { test } from "node:test";
import assert from "node:assert/strict";
import { borrowNote, dropToLimit, limitUseAfterDrop } from "./borrow.ts";

test("limit use after a drop", () => {
  assert.equal(limitUseAfterDrop(0.5, 0.2), 0.625);
  assert.equal(dropToLimit(0.5), 0.5);
  assert.ok(Math.abs(dropToLimit(0.8) - 0.2) < 1e-9);
  assert.equal(limitUseAfterDrop(0.5, 1), Infinity);
});

test("borrow note text and examples", () => {
  const n = borrowNote("mNVDA", "NVIDIA", 0.625);
  assert.equal(n.examples.length, 3);
  assert.equal(n.examples[1].toLimitUse, 0.625);
  assert.match(n.text, /62\.5% of the limit after a 20% fall/);
  assert.match(n.text, /emergency rule/);
  assert.doesNotMatch(n.text, /—/);
  assert.match(borrowNote("mcbBTC", "Bitcoin", 0.86, 0.85).text, /can be liquidated/);
});
