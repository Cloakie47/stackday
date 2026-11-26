import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_TTL_SEC } from "./buildCalls.ts";
import type { Intent } from "./intent.ts";
import { leadIn } from "./leadIn.ts";
import { makeCard, type CardReads } from "./plan.ts";
import { ATTACKER, ctx, ME, positions, tokens, usd } from "./test-fixtures.ts";

/** The code-written sentence above a card, and "Refresh numbers" going through the same build path. */

const INTENTS: Intent[] = [
  { action: "buy", params: { asset: "mAAPL", usdc: "123.45" } },
  { action: "recurring_buy", params: { asset: "mNVDA", usdc: "12.34", every: "weekly", weeks: 12 } },
  { action: "cancel_plan", params: { asset: "mNVDA" } },
  { action: "sell", params: { asset: "mPAXG", amount: "37.5", unit: "percent" } },
  { action: "withdraw", params: { asset: "mWETH", amount: "0.123", unit: "tokens" } },
  { action: "borrow", params: { asset: "mAAPL", usdc: "77.7", risk: "low" } },
  { action: "repay", params: { asset: "every_loan", usdc: "0", all: true } },
  { action: "repay", params: { asset: "mAAPL", usdc: "41.5", all: false } },
  { action: "gift", params: { recipient_id: "SD-ABCDEFGH", usdc: "9.99", box: "surprise" } },
];

test("lead-in: one plain sentence per action, from code, with no amounts, IDs or addresses", () => {
  for (const intent of INTENTS) {
    const s = leadIn(intent);
    assert.ok(s.length > 20 && s.length < 200, s);
    for (const v of Object.values(intent.params)) if (typeof v === "string" && /\d/.test(v)) assert.ok(!s.includes(v), `${s} repeats ${v}`);
    assert.doesNotMatch(s, /0x|SD-/);
    assert.ok(!s.includes(String.fromCharCode(0x2014)), "no em dash");
    if (intent.action === "gift") assert.match(s, /Gifts page/);
    else assert.match(s, /Nothing happens until you confirm in your wallet\.$/);
  }
  assert.match(leadIn(INTENTS[0]), /^Here is a card to buy Apple\./);
  assert.match(leadIn(INTENTS[5]), /at Low risk/);
  assert.match(leadIn(INTENTS[6]), /repay your loans/);
});

const p = (over: Partial<ReturnType<typeof ctx>> = {}) => {
  const c = ctx(over);
  return { vault: c.vault, predictedVault: c.predictedVault, positions: c.positions, borrowCapBps: c.borrowCapBps, walletUsdc: c.walletUsdc, routerAllowance: c.routerAllowance };
};
const reads = (over: Partial<CardReads> = {}): CardReads => ({ quotes: { oracleOut: tokens(0.3, 8), deskSpreadBps: 50n, deskReserve: usd(10_000) }, toVault: 0n, toDesk: 0n, vaultUsdcAllowance: 0n, ...over });

test("refresh: the same intent rebuilt later gets a fresh expiry and the same calls, receiver is still the wallet", () => {
  const intent = INTENTS[0];
  const t = 1_800_000_000;
  const first = makeCard(intent, p(), ME, reads(), t);
  const again = makeCard(intent, p(), ME, reads(), t + 300);
  assert.ok(first.ok && again.ok);
  if (!first.ok || !again.ok) return;
  assert.equal(first.expiresAt, t + CARD_TTL_SEC);
  assert.equal(again.expiresAt, t + 300 + CARD_TTL_SEC);
  assert.equal(again.receiver, ME);
  assert.deepEqual(again.calls.map((c) => [c.address, c.functionName]), first.calls.map((c) => [c.address, c.functionName]));
});

test("refresh keeps buildPlan's limits: the 500 USDC cap still refuses, the wallet stays the receiver", () => {
  // Over the cap: selling 2 Apple (about 714 test USDC) is refused on the first build and on refresh.
  const rich = p({ positions: positions({ mAAPL: { idle: tokens(2, 8) } }) });
  const sell: Intent = { action: "sell", params: { asset: "mAAPL", amount: "100", unit: "percent" } };
  for (const now of [1_800_000_000, 1_800_000_500]) {
    const r = makeCard(sell, rich, ME, reads(), now);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /at most 500 test USDC/);
  }
  // Fresh reads with a lower desk reserve refuse on refresh what passed before (numbers really are re-read).
  const some = p({ positions: positions({ mAAPL: { idle: tokens(0.02, 8) } }) });
  const half: Intent = { action: "sell", params: { asset: "mAAPL", amount: "50", unit: "percent" } };
  assert.equal(makeCard(half, some, ME, reads(), 1_800_000_000).ok, true);
  const dry = makeCard(half, some, ME, reads({ quotes: { deskSpreadBps: 50n, deskReserve: usd(1) } }), 1_800_000_200);
  assert.equal(dry.ok, false);
  if (!dry.ok) assert.match(dry.reason, /sell desk holds only/);
  // And a refreshed sell still pays only the connected wallet, never another address.
  const small = makeCard({ action: "sell", params: { asset: "mAAPL", amount: "50", unit: "percent" } }, p({ positions: positions({ mAAPL: { idle: tokens(0.02, 8) } }) }), ME, reads(), 1_800_000_900);
  assert.ok(small.ok);
  if (small.ok) assert.ok(!JSON.stringify(small.calls, (_, v) => (typeof v === "bigint" ? v.toString() : v)).toLowerCase().includes(ATTACKER.slice(2).toLowerCase()));
});

test("lead-in: lock and unlock cards get their own sentence, with no amount from the intent", () => {
  const lock = leadIn({ action: "lock", params: { asset: "mAAPL", amount: "50", unit: "percent" } } as Intent);
  const unlock = leadIn({ action: "unlock", params: { asset: "mAAPL", amount: "50", unit: "percent" } } as Intent);
  assert.match(lock, /lock Apple in your vault as collateral/);
  assert.match(unlock, /unlock Apple in your vault/);
  for (const s of [lock, unlock]) assert.doesNotMatch(s, /50/);
});
