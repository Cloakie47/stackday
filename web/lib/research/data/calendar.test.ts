import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarCovers, isEarlyClose, isMarketOpen, isTradingDay, lastTradingDay, newYorkTimeToUtc, NYSE_HOLIDAYS } from "./calendar.ts";

test("NYSE holidays and weekends are closed, crypto never closes", () => {
  assert.equal(isTradingDay("XNYS", "2026-11-26"), false); // Thanksgiving
  assert.equal(isTradingDay("XNYS", "2026-11-21"), false); // Saturday
  assert.equal(isTradingDay("XNYS", "2026-11-19"), true);
  assert.equal(isTradingDay("XNYS", "2027-07-05"), false); // Independence Day observed
  assert.equal(isTradingDay("CRYPTO", "2026-11-26"), true);
  assert.equal(isTradingDay("CRYPTO", "2026-11-21"), true);
  assert.equal(Object.keys(NYSE_HOLIDAYS).length, 20);
  for (const d of Object.keys(NYSE_HOLIDAYS)) assert.ok(![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()), `${d} is a weekend`);
});

test("early closes and calendar coverage", () => {
  assert.equal(isEarlyClose("XNYS", "2026-11-27"), true);
  assert.equal(isEarlyClose("XNYS", "2026-12-24"), true);
  assert.equal(isEarlyClose("XNYS", "2026-12-23"), false);
  assert.equal(calendarCovers("XNYS", "2027-03-01"), true);
  assert.equal(calendarCovers("XNYS", "2028-03-01"), false);
  assert.equal(calendarCovers("CRYPTO", "2030-01-01"), true);
});

test("lastTradingDay steps back over weekends and holidays", () => {
  assert.equal(lastTradingDay("XNYS", "2026-11-29"), "2026-11-27"); // Sunday -> Friday
  assert.equal(lastTradingDay("XNYS", "2026-11-27", false), "2026-11-25"); // skips Thanksgiving
  assert.equal(lastTradingDay("XNYS", "2027-07-05"), "2027-07-02");
  assert.equal(lastTradingDay("XNYS", "2026-01-01"), "2025-12-31");
  assert.equal(lastTradingDay("CRYPTO", "2026-11-29"), "2026-11-29");
  assert.throws(() => lastTradingDay("XNYS", "2026-13-01"));
});

test("New York time to UTC follows daylight saving", () => {
  assert.equal(newYorkTimeToUtc("2026-03-06", 9, 30).toISOString(), "2026-03-06T14:30:00.000Z"); // EST
  assert.equal(newYorkTimeToUtc("2026-03-09", 9, 30).toISOString(), "2026-03-09T13:30:00.000Z"); // EDT from 2026-03-08
  assert.equal(newYorkTimeToUtc("2026-11-02", 16, 0).toISOString(), "2026-11-02T21:00:00.000Z"); // EST from 2026-11-01
});

test("isMarketOpen checks regular hours, including early closes", () => {
  assert.equal(isMarketOpen("XNYS", "2026-11-19T15:00:00Z"), true); // 10:00 New York
  assert.equal(isMarketOpen("XNYS", "2026-11-19T21:00:00Z"), false); // 16:00, closed
  assert.equal(isMarketOpen("XNYS", "2026-11-19T14:29:00Z"), false); // 9:29
  assert.equal(isMarketOpen("XNYS", "2026-11-27T17:30:00Z"), true); // 12:30 on an early close
  assert.equal(isMarketOpen("XNYS", "2026-11-27T18:30:00Z"), false); // 13:30, closed early
  assert.equal(isMarketOpen("XNYS", "2026-07-01T13:30:00Z"), true); // 9:30 EDT
  assert.equal(isMarketOpen("XNYS", "2026-07-01T13:29:00Z"), false);
  assert.equal(isMarketOpen("XNYS", new Date("2026-11-26T16:00:00Z")), false); // Thanksgiving
  assert.equal(isMarketOpen("XNYS", "2026-11-26"), false); // date form = trading day check
  assert.equal(isMarketOpen("CRYPTO", "2026-11-26T03:00:00Z"), true);
});
