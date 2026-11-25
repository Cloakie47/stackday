import { test } from "node:test";
import assert from "node:assert/strict";
import type { MarketResearchInput } from "../types.ts";
import { dailyCutAt, gatherMarketCached, marketCacheKey } from "./gather.ts";

// Issue #80, points 4 and 5: the daily note's macro and news use its real run time, and a warm
// instance never reuses the 12:00 weekly market input for the 22:30 daily note.

test("the daily note cuts at its real time on the run date, and at 12:00 UTC for an older date", () => {
  const now = new Date("2026-11-30T22:31:05Z");
  assert.equal(dailyCutAt("2026-11-30", now), "2026-11-30T22:31:05.000Z");
  assert.equal(dailyCutAt("2026-11-27", now), undefined);
});

test("market cache: keyed by date and cut hour, so the weekly 12:00 input never reaches the daily note", async () => {
  const calls: { date: string; cutAt?: string }[] = [];
  const fake = (async (date: string, _deps?: unknown, opts: { cutAt?: string } = {}) => {
    calls.push({ date, ...(opts.cutAt ? { cutAt: opts.cutAt } : {}) });
    return { date, facts: [], calendar: [], problems: [] } as unknown as MarketResearchInput;
  }) as Parameters<typeof gatherMarketCached>[2];
  const date = "2031-01-06"; // a date no other test uses, so the module cache starts empty for it
  assert.notEqual(marketCacheKey(date), marketCacheKey(date, `${date}T22:30:00Z`));
  // Weekly slots (no cut time) share one input.
  await gatherMarketCached(date, undefined, fake);
  await gatherMarketCached(date, undefined, fake);
  assert.deepEqual(calls, [{ date }]);
  // The daily note at 22:30 gets its own input, cut at its run time; its assets a few minutes later share it.
  await gatherMarketCached(date, `${date}T22:30:10Z`, fake);
  await gatherMarketCached(date, `${date}T22:34:50Z`, fake);
  assert.deepEqual(calls, [{ date }, { date, cutAt: `${date}T22:30:10Z` }]);
  // A failed fetch is not cached.
  const bad = (async () => {
    throw new Error("down");
  }) as unknown as Parameters<typeof gatherMarketCached>[2];
  await assert.rejects(gatherMarketCached("2031-01-07", undefined, bad));
  await gatherMarketCached("2031-01-07", undefined, fake);
  assert.equal(calls.at(-1)!.date, "2031-01-07");
});
