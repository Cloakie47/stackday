import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUS, expiresIn, giftState, giftsFor, openable, recentIds, type ChainGift } from "./status.ts";

const A = "0x00000000000000000000000000000000000000AA" as const;
const B = "0x00000000000000000000000000000000000000bb" as const;
const g = (id: bigint, over: Partial<ChainGift> = {}): ChainGift => ({ id, sender: A, recipient: B, usdc: 1_000_000n, expiresAt: 1000, kind: 0, status: STATUS.Pending, ...over });

test("chain status maps to a state, and a pending box past expiry reads as expired", () => {
  assert.equal(giftState(g(1n), 999), "pending");
  assert.equal(giftState(g(1n), 1000), "expired");
  assert.equal(giftState(g(1n, { status: STATUS.Opened }), 2000), "opened");
  assert.equal(giftState(g(1n, { status: STATUS.Revoked }), 0), "revoked");
  assert.equal(giftState(g(1n, { status: STATUS.Declined }), 0), "declined");
  assert.equal(giftState(g(1n, { status: STATUS.Refunded }), 0), "refunded");
  assert.equal(giftState(g(1n, { status: STATUS.None }), 0), "none");
});

test("recent ids run newest first and stop at the cap or at id 1", () => {
  assert.deepEqual(recentIds(4n, 10), [3n, 2n, 1n]);
  assert.deepEqual(recentIds(100n, 2), [99n, 98n]);
  assert.deepEqual(recentIds(1n, 10), []);
});

test("received and sent are split by wallet, case-insensitively, newest first", () => {
  const all = [g(1n), g(3n, { sender: B, recipient: A }), g(2n)];
  const forB = giftsFor(all, B.toUpperCase().replace("0X", "0x"));
  assert.deepEqual(forB.received.map((x) => x.id), [2n, 1n]);
  assert.deepEqual(forB.sent.map((x) => x.id), [3n]);
  assert.deepEqual(giftsFor(all, undefined), { received: [], sent: [] });
  assert.deepEqual(openable(forB.received, 999).map((x) => x.id), [2n, 1n]);
  assert.deepEqual(openable(forB.received, 1000), []);
});

test("expiry reads in days, hours or minutes", () => {
  assert.equal(expiresIn(0 + 7 * 86_400, 0), "in 7 days");
  assert.equal(expiresIn(5 * 3_600, 0), "in 5 hours");
  assert.equal(expiresIn(90, 0), "in 1 minute");
  assert.equal(expiresIn(600, 0), "in 10 minutes");
  assert.equal(expiresIn(10, 20), "expired");
});
