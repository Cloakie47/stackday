import { test } from "node:test";
import assert from "node:assert/strict";
import { priceProblem } from "./facts.ts";
import type { Fact } from "../types.ts";

const px = (asOf: string): Fact => ({ id: "px.1d.last", kind: "price", label: "Last daily close", value: 100, unit: "USD", source: { name: "test" }, asOf });

test("a note needs a fresh price: none, or one older than a long weekend (stocks) or two days (crypto), is a problem", () => {
  assert.match(priceProblem([], "2026-11-30", false)!, /no price could be read/);
  assert.equal(priceProblem([px("2026-11-27T21:00:00Z")], "2026-11-30", false), null, "Friday close for a Monday run");
  assert.equal(priceProblem([px("2026-11-25T21:00:00Z")], "2026-11-30", false), null, "Thanksgiving week: Wednesday close is still fine");
  assert.match(priceProblem([px("2026-11-20T21:00:00Z")], "2026-11-30", false)!, /too old/);
  assert.equal(priceProblem([px("2026-11-29T00:00:00Z")], "2026-11-30", true), null);
  assert.match(priceProblem([px("2026-11-26T00:00:00Z")], "2026-11-30", true)!, /too old/);
});
