import { test } from "node:test";
import assert from "node:assert/strict";
import { cronAuthorized, giftDecision, planDecision, refundExpiredGifts, scheduleDecision } from "./keeper.ts";

const plan = { usdcPerBuy: 10_000_000n, nextBuyAt: 1000, allowance: 30_000_000n, walletUsdc: 50_000_000n };

test("a due plan with approval and USDC runs", () => {
  assert.equal(planDecision(plan, 1000), "run");
});

test("a plan is left alone before it is due", () => {
  assert.equal(planDecision(plan, 999), "not-due");
});

test("a cancelled plan is dropped", () => {
  assert.equal(planDecision({ ...plan, usdcPerBuy: 0n }, 2000), "cancelled");
});

test("a plan whose approved buys are used up is finished (its 'how long' ran out)", () => {
  assert.equal(planDecision({ ...plan, allowance: 9_999_999n }, 2000), "finished");
});

test("a plan is skipped when the wallet lacks the USDC", () => {
  assert.equal(planDecision({ ...plan, walletUsdc: 1n }, 2000), "no-usdc");
});

const schedule = { active: true, nextPayAt: 500, total: 100n, employerBalance: 100n };

test("a due, funded schedule runs", () => {
  assert.equal(scheduleDecision(schedule, 500), "run");
});

test("paused, early or underfunded schedules do not run", () => {
  assert.equal(scheduleDecision({ ...schedule, active: false }, 600), "paused");
  assert.equal(scheduleDecision(schedule, 499), "not-due");
  assert.equal(scheduleDecision({ ...schedule, employerBalance: 99n }, 600), "underfunded");
});

test("cron calls need the exact secret, and a short or missing secret never authorizes", () => {
  const secret = "a-long-enough-secret-123";
  assert.equal(cronAuthorized(`Bearer ${secret}`, secret), true);
  assert.equal(cronAuthorized(`Bearer ${secret}x`, secret), false);
  assert.equal(cronAuthorized(null, secret), false);
  assert.equal(cronAuthorized("Bearer short", "short"), false);
  assert.equal(cronAuthorized("Bearer ", undefined), false);
});

test("a pending gift box is refunded only at or after its expiry", () => {
  assert.equal(giftDecision({ status: 1, expiresAt: 1000 }, 999), "not-expired");
  assert.equal(giftDecision({ status: 1, expiresAt: 1000 }, 1000), "refund");
  for (const status of [0, 2, 3, 4, 5]) assert.equal(giftDecision({ status, expiresAt: 1 }, 2000), "not-pending");
});

test("the gift step reads every box in chunks and refunds only expired pending ones", async () => {
  // 250 boxes: every 10th is pending and expired, every 7th pending and not yet expired, the rest closed.
  const boxes = new Map<bigint, { status: number; expiresAt: number }>();
  for (let id = 1n; id <= 250n; id++) {
    const n = Number(id);
    boxes.set(id, n % 10 === 0 ? { status: 1, expiresAt: 500 } : n % 7 === 0 ? { status: 1, expiresAt: 5000 } : { status: 2, expiresAt: 500 });
  }
  const reads: number[] = [];
  const refunded: bigint[] = [];
  const skipped: string[] = [];
  const tried = await refundExpiredGifts(
    {
      nextId: async () => 251n,
      giftsOf: async (ids) => {
        reads.push(ids.length);
        return ids.map((id) => boxes.get(id)!);
      },
      refund: async (id) => {
        refunded.push(id);
      },
      skip: (why) => skipped.push(why),
    },
    1000,
  );
  assert.deepEqual(reads, [100, 100, 50]);
  assert.equal(refunded.length, 25);
  assert.ok(refunded.every((id) => id % 10n === 0n));
  assert.deepEqual(tried, refunded);
  assert.equal(skipped.filter((s) => s === "gift-not-expired").length, 32, "pending but not expired: multiples of 7 that are not multiples of 10");
});

test("the gift step does nothing when no box was ever made", async () => {
  let reads = 0;
  const tried = await refundExpiredGifts({ nextId: async () => 1n, giftsOf: async () => (reads++, []), refund: async () => {}, skip: () => {} }, 1000);
  assert.deepEqual(tried, []);
  assert.equal(reads, 0);
});
