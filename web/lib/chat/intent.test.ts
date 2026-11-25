import { test } from "node:test";
import assert from "node:assert/strict";
import deployment from "../deployment.json" with { type: "json" };
import { ACTION_SCHEMAS, ASSET_SYMBOLS, parseAction, parseIntent } from "./intent.ts";
import { ACTION_TOOLS } from "./tools.ts";

test("the asset allowlist is exactly the deployed symbols", () => {
  assert.deepEqual([...ASSET_SYMBOLS], (deployment as { assetSymbols: string[] }).assetSymbols);
});

test("valid intents pass", () => {
  assert.equal(parseAction("buy", { asset: "mAAPL", usdc: "20" }).ok, true);
  assert.equal(parseAction("recurring_buy", { asset: "mNVDA", usdc: "10", every: "weekly", weeks: 12 }).ok, true);
  assert.equal(parseAction("sell", { asset: "mPAXG", amount: "50", unit: "percent" }).ok, true);
  assert.equal(parseAction("borrow", { asset: "mPAXG", usdc: "50", risk: "low" }).ok, true);
  assert.equal(parseAction("repay", { asset: "every_loan", usdc: "0", all: true }).ok, true);
  assert.equal(parseAction("gift", { recipient_id: "SD-ABCD1234", usdc: "5", box: "surprise" }).ok, true);
});

test("no intent can carry a receiver, address or to field: unknown fields refuse the whole intent", () => {
  for (const field of ["to", "receiver", "address", "recipient", "wallet", "spender"]) {
    const r = parseAction("buy", { asset: "mAAPL", usdc: "20", [field]: "0x9999999999999999999999999999999999999999" });
    assert.equal(r.ok, false, field);
  }
  assert.equal(parseAction("borrow", { asset: "mAAPL", usdc: "20", risk: "mid", receiver: "0x9999999999999999999999999999999999999999" }).ok, false);
  // No schema even has such a field.
  for (const schema of Object.values(ACTION_SCHEMAS)) {
    const keys = Object.keys(schema.shape);
    for (const bad of ["to", "receiver", "address"]) assert.ok(!keys.includes(bad));
  }
  for (const t of ACTION_TOOLS) for (const bad of ["to", "receiver", "address"]) assert.ok(!(bad in (t.input_schema.properties as object)));
});

test("the 500 test USDC cap per card is in the schema", () => {
  assert.equal(parseAction("buy", { asset: "mAAPL", usdc: "500" }).ok, true);
  assert.equal(parseAction("buy", { asset: "mAAPL", usdc: "500.000001" }).ok, false);
  assert.equal(parseAction("buy", { asset: "mAAPL", usdc: "501" }).ok, false);
  assert.equal(parseAction("borrow", { asset: "mAAPL", usdc: "1000", risk: "high" }).ok, false);
  assert.equal(parseAction("gift", { recipient_id: "maya", usdc: "600", box: "one_stock" }).ok, false);
});

test("amounts are plain decimals: no negatives, exponents, floats or hex", () => {
  for (const usdc of ["-5", "1e3", "0x10", "", " 20", "20 ", "0", "0.0000001", "1,000", 20 as unknown as string]) {
    assert.equal(parseAction("buy", { asset: "mAAPL", usdc }).ok, false, String(usdc));
  }
});

test("unknown, look-alike and address assets are refused (no case folding, no Unicode tricks)", () => {
  const fakes = [
    "AAPL",
    "maapl",
    "mAAPL ",
    "mАAPL", // Cyrillic A
    "mAAPʟ", // small capital L
    "mＡAPL", // fullwidth A
    "mA​APL", // zero-width space
    "0x033BF490C18977bC8a36Bebc84973641888C1F7b", // the real mAAPL token address
    "USDC",
  ];
  for (const asset of fakes) assert.equal(parseAction("buy", { asset, usdc: "1" }).ok, false, JSON.stringify(asset));
});

test("unknown actions are refused, including a send or transfer", () => {
  for (const name of ["send", "transfer", "approve", "withdraw_to", "Buy", "buy "]) assert.equal(parseAction(name, { asset: "mAAPL", usdc: "1" }).ok, false, name);
});

test("a gift recipient is a Stackday ID or username, never an address", () => {
  for (const recipient_id of ["0x9999999999999999999999999999999999999999", "0x99", "vitalik.eth", "Maya Smith", "sd-abcd1234"]) {
    assert.equal(parseAction("gift", { recipient_id, usdc: "5", box: "one_stock" }).ok, false, recipient_id);
  }
});

test("parseIntent (the browser check) refuses extra top-level fields", () => {
  assert.equal(parseIntent({ action: "buy", params: { asset: "mAAPL", usdc: "5" } }).ok, true);
  assert.equal(parseIntent({ action: "buy", params: { asset: "mAAPL", usdc: "5" }, to: "0x9999999999999999999999999999999999999999" }).ok, false);
  assert.equal(parseIntent("buy").ok, false);
  assert.equal(parseIntent(null).ok, false);
});
