import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSlot } from "./slots.ts";

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

test("next Monday 11:00 New York in winter (UTC-5)", () => {
  // Wednesday November 18, 2026, 15:00 UTC
  assert.equal(nextSlot(1, "11:00", sec("2026-11-18T15:00:00Z")), sec("2026-11-23T16:00:00Z"));
});

test("next Monday 11:00 New York in summer (UTC-4)", () => {
  assert.equal(nextSlot(1, "11:00", sec("2026-07-01T12:00:00Z")), sec("2026-07-06T15:00:00Z"));
});

test("same day, before the slot: today", () => {
  // Monday November 23, 2026, 09:00 New York = 14:00 UTC
  assert.equal(nextSlot(1, "11:00", sec("2026-11-23T14:00:00Z")), sec("2026-11-23T16:00:00Z"));
});

test("same day, after the slot: next week", () => {
  assert.equal(nextSlot(1, "11:00", sec("2026-11-23T17:00:00Z")), sec("2026-11-30T16:00:00Z"));
});

test("Friday 3:00 pm from a Saturday", () => {
  assert.equal(nextSlot(5, "15:00", sec("2026-11-21T12:00:00Z")), sec("2026-11-27T20:00:00Z"));
});

test("across the daylight saving change (November 1, 2026)", () => {
  // Saturday October 31, 2026: next Monday is November 2, after the clocks went back (UTC-5).
  assert.equal(nextSlot(1, "10:00", sec("2026-10-31T12:00:00Z")), sec("2026-11-02T15:00:00Z"));
});
