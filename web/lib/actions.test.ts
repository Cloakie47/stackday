import { test } from "node:test";
import assert from "node:assert/strict";
import { approveMoreCall, approvalIfNeeded, borrowCalls, buysFor, lockCalls, MAX_APPROVAL, minOutAfterSlippage, repayApprovalAmount, repayCalls } from "./actions.ts";
import { ADDR, ASSETS, MAX_UINT } from "./contracts.ts";

/** The shared calls behind Invest, Borrow and the chat cards keep what the pages sent before. */

const aapl = ASSETS.find((a) => a.symbol === "mAAPL")!;
const VAULT = "0x2222222222222222222222222222222222222222" as const;
const ME = "0x1111111111111111111111111111111111111111" as const;

test("1% slippage floor matches the Invest page's old x * 99 / 100", () => {
  for (const q of [0n, 1n, 99n, 100n, 12_345_678n, 10n ** 20n + 7n]) assert.equal(minOutAfterSlippage(q, 100n), (q * 99n) / 100n);
});

test("plan length: N weeks at an interval, 0 means until stopped", () => {
  assert.equal(buysFor(12, 7), 12);
  assert.equal(buysFor(12, 14), 6);
  assert.equal(buysFor(4, 28), 1);
  assert.equal(buysFor(0, 7), 0);
});

test("approveMore adds to the current allowance and saturates at the maximum", () => {
  assert.deepEqual(approveMoreCall(5n, 10n, "x").args, [ADDR.router, 15n]);
  assert.deepEqual(approveMoreCall(5n, MAX_APPROVAL, "x").args, [ADDR.router, MAX_APPROVAL]);
  assert.deepEqual(approveMoreCall(MAX_APPROVAL - 3n, 10n, "x").args, [ADDR.router, MAX_APPROVAL]);
});

test("approval only when the allowance is short", () => {
  assert.equal(approvalIfNeeded(ADDR.usdc, VAULT, 10n, 10n, "x").length, 0);
  assert.equal(approvalIfNeeded(ADDR.usdc, VAULT, 0n, 0n, "x").length, 0);
  assert.deepEqual(approvalIfNeeded(ADDR.usdc, VAULT, 10n, 9n, "x")[0].args, [VAULT, 10n]);
});

test("lock: deposit from the wallet only when needed, then lock everything chosen", () => {
  assert.deepEqual(lockCalls(VAULT, aapl, 5n, 0n, []).map((c) => c.functionName), ["addCollateral"]);
  const fromWallet = lockCalls(VAULT, aapl, 5n, 3n, approvalIfNeeded(aapl.token, VAULT, 3n, 0n, "a"));
  assert.deepEqual(fromWallet.map((c) => c.functionName), ["approve", "depositStock", "addCollateral"]);
  assert.deepEqual(fromWallet[2].args, [aapl.token, 8n]);
});

test("borrow: USDC to the given wallet, cap raise first, zero parts skipped", () => {
  const calls = borrowCalls(VAULT, [{ asset: aapl, usdc: 0n }, { asset: aapl, usdc: 7n }], ME, true);
  assert.deepEqual(calls.map((c) => c.functionName), ["setBorrowCapBps", "borrow"]);
  assert.deepEqual(calls[1].args, [aapl.token, 0n, 7n, ME]);
});

test("repay: padding for interest when repaying all, MAX sent per loan", () => {
  assert.equal(repayApprovalAmount(1_000_000n, true), 1_000_000n + 10_000n + 1000n);
  assert.equal(repayApprovalAmount(1_000_000n, false), 1_000_000n);
  assert.deepEqual(repayCalls(VAULT, [{ asset: aapl, usdc: 5n }], true)[0].args, [aapl.token, MAX_UINT]);
  assert.deepEqual(repayCalls(VAULT, [{ asset: aapl, usdc: 5n }], false)[0].args, [aapl.token, 5n]);
});
