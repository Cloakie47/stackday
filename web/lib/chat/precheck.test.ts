import { test } from "node:test";
import assert from "node:assert/strict";
import { AbiDecodingZeroDataError, encodeErrorResult, getContractError, RawContractError, type Abi } from "viem";
import { explainTxError } from "../txError.ts";
import { buildPlan, type Plan } from "./buildCalls.ts";
import { confirmAllowed, decidePrecheck, needsPrecheck, precheckLine, type SimOutcome } from "./precheck.ts";
import { ctx, positions, tokens, usd } from "./test-fixtures.ts";

/** The pre-check's decision logic: simulation answer to card state. No network here. */

const ABI = [
  { type: "function", name: "go", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "error", name: "SlippageExceeded", inputs: [] },
  { type: "error", name: "StalePrice", inputs: [] },
] as const satisfies Abi;
const STRING_ERROR = [{ type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }] as const satisfies Abi;

/** A revert as viem's simulateCalls reports it for one call. */
const reverted = (data: `0x${string}` | undefined) =>
  getContractError(data === undefined || data === "0x" ? new AbiDecodingZeroDataError() : new RawContractError({ data }), {
    abi: ABI,
    address: "0x0000000000000000000000000000000000000001",
    functionName: "go",
    args: [],
  });
const custom = (name: "SlippageExceeded" | "StalePrice") => reverted(encodeErrorResult({ abi: ABI, errorName: name }));
const requireMsg = (msg: string) => reverted(encodeErrorResult({ abi: STRING_ERROR, errorName: "Error", args: [msg] }));

const ok = { status: "success" as const };
const fail = (error: unknown) => ({ status: "failure" as const, error });

function sellPlan(): Plan {
  const r = buildPlan(
    { action: "sell", params: { asset: "mAAPL", amount: "50", unit: "percent" } },
    ctx({ positions: positions({ mAAPL: { idle: tokens(0.02, 8) } }), quotes: { deskSpreadBps: 50n, deskReserve: usd(10_000) } }),
  );
  assert.ok(r.ok);
  return r as Plan;
}

test("every call passing shows 'passes' and allows Confirm", () => {
  const plan = sellPlan();
  const s = decidePrecheck({ kind: "results", results: plan.calls.map(() => ok) }, plan);
  assert.deepEqual(s, { status: "passes" });
  assert.equal(confirmAllowed(s), true);
  assert.match(precheckLine(s), /^Pre-checked on Base Sepolia: passes\./);
});

test("a failing call blocks Confirm, names the step, and reuses useTx's wording", () => {
  const plan = sellPlan();
  assert.ok(plan.calls.length >= 2);
  const err = requireMsg("insufficient liquidity");
  const results = plan.calls.map((_, i) => (i === 1 ? fail(err) : ok));
  const s = decidePrecheck({ kind: "results", results }, plan);
  assert.equal(s.status, "blocked");
  assert.equal(confirmAllowed(s), false);
  if (s.status !== "blocked") return;
  assert.ok(s.reason.startsWith(`Step 2 of ${plan.calls.length} (${plan.calls[1].label}) would fail.`));
  // Same text the wallet step would show (useTx uses explainTxError), and readable: not "Error".
  assert.ok(s.reason.endsWith(explainTxError(err)));
  assert.match(s.reason, /The contract refused: insufficient liquidity/);
  // A sell can be retried smaller; the copy says what to try, without advice.
  assert.match(s.hint ?? "", /smaller amount/);
  assert.doesNotMatch(`${s.reason} ${s.hint}`, /should|recommend/i);
});

test("the first failure in call order decides, even if a later call fails too", () => {
  const plan = sellPlan();
  const results = plan.calls.map(() => fail(custom("SlippageExceeded")));
  const s = decidePrecheck({ kind: "results", results }, plan);
  assert.equal(s.status, "blocked");
  if (s.status === "blocked") assert.match(s.reason, /^Step 1 of/);
  if (s.status === "blocked") assert.match(s.reason, /The price moved too much/);
});

test("a single-call card says 'This would fail', and a failure a smaller amount cannot fix has no amount hint", () => {
  const plan = { action: "buy" as const, calls: [sellPlan().calls[0]] };
  const s = decidePrecheck({ kind: "results", results: [fail(custom("StalePrice"))] }, plan);
  assert.equal(s.status, "blocked");
  if (s.status !== "blocked") return;
  assert.match(s.reason, /^This would fail\. The reference price is too old/);
  assert.equal(s.hint, undefined);
});

test("an unreadable revert still blocks, with plain fallback copy", () => {
  const plan = { action: "borrow" as const, calls: [sellPlan().calls[0]] };
  for (const error of [reverted("0x"), undefined]) {
    const s = decidePrecheck({ kind: "results", results: [fail(error)] }, plan);
    assert.equal(s.status, "blocked");
    if (s.status === "blocked") assert.match(s.reason, /would refuse it as it stands/);
    assert.equal(confirmAllowed(s), false);
  }
});

test("an RPC error or a mismatched answer is 'could not pre-check' and does NOT block Confirm", () => {
  const plan = sellPlan();
  const outcomes: SimOutcome[] = [{ kind: "rpc-error" }, { kind: "results", results: [ok] }, { kind: "results", results: [] }];
  for (const o of outcomes) {
    const s = decidePrecheck(o, plan);
    assert.deepEqual(s, { status: "unavailable" });
    assert.equal(confirmAllowed(s), true);
    assert.match(precheckLine(s), /Could not pre-check right now/);
  }
});

test("Confirm is off while checking; no pre-check (and no 'passes') for refusals or hand-offs", () => {
  assert.equal(confirmAllowed({ status: "checking" }), false);
  assert.equal(confirmAllowed(undefined), true);
  assert.equal(needsPrecheck(sellPlan()), true);
  assert.equal(needsPrecheck({ ok: false, reason: "no" }), false);
  const gift = buildPlan({ action: "gift", params: { recipient_id: "SD-ABCDEFGH", usdc: "5", box: "surprise" } }, ctx());
  assert.equal(needsPrecheck(gift), false);
  assert.equal(needsPrecheck(null), false);
});

test("an arithmetic underflow (Panic 0x11) says the balances changed, with no smaller-amount hint", () => {
  const PANIC = [{ type: "error", name: "Panic", inputs: [{ name: "code", type: "uint256" }] }] as const satisfies Abi;
  const panic = (code: bigint) => reverted(encodeErrorResult({ abi: PANIC, errorName: "Panic", args: [code] }));
  const plan = sellPlan();
  const s = decidePrecheck({ kind: "results", results: plan.calls.map((_, i) => (i === 0 ? fail(panic(0x11n)) : ok)) }, plan);
  assert.equal(s.status, "blocked");
  if (s.status !== "blocked") return;
  assert.match(s.reason, /Your balances changed since this card was made\. Close it and ask again\.$/);
  assert.equal(s.hint, undefined);
  assert.equal(explainTxError(panic(0x11n)), "Your balances changed since this card was made. Close it and ask again.");
  // Another panic is not reworded that way.
  assert.notEqual(explainTxError(panic(0x12n)), "Your balances changed since this card was made. Close it and ask again.");
});
