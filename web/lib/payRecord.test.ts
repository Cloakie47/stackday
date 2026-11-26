import { test } from "node:test";
import assert from "node:assert/strict";
import { recordLabel } from "./payRecord.ts";

test("a normal payroll payment is labelled Paid, not Paid privately", () => {
  assert.equal(recordLabel({ kind: "paid", private: false }), "Paid");
});

test("a private payment, and an older record without the flag, stay Paid privately", () => {
  assert.equal(recordLabel({ kind: "paid", private: true }), "Paid privately");
  assert.equal(recordLabel({ kind: "paid" }), "Paid privately");
});

test("collected and invested lines keep their labels", () => {
  assert.equal(recordLabel({ kind: "collected" }), "Collected");
  assert.equal(recordLabel({ kind: "invested" }), "Invested");
});
