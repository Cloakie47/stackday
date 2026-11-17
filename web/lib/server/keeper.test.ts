import { test } from "node:test";
import assert from "node:assert/strict";
import { cronAuthorized, planDecision, scheduleDecision } from "./keeper.ts";

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
