import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, encodeAbiParameters, encodeFunctionData, type Abi } from "viem";
import { giftBoxAbi } from "../abis.ts";
import { boughtParts, buildCreateCalls, buildDeclineCall, buildOpenCall, buildRefundCall, buildRevokeCall, createdGiftId, type CreateInput } from "./calls.ts";
import { KIND, OPEN_SLIPPAGE_BPS, type Hex } from "./mix.ts";

const BOX = "0x190A4F54AAC173F4386823AC5709b8689849C8E1" as Hex;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Hex;
const ME = "0x00000000000000000000000000000000000000a1" as Hex;
const FRIEND = "0x00000000000000000000000000000000000000b2" as Hex;
const AAPL = "0x033BF490C18977bC8a36Bebc84973641888C1F7b" as Hex;
const NVDA = "0x00000000000000000000000000000000000000C3" as Hex;

const base: CreateInput = {
  giftBox: BOX,
  usdc: USDC,
  sender: ME,
  recipient: FRIEND,
  amount: 5_000_000n,
  expiresAt: 1_800_000_000,
  mix: [
    { token: AAPL, weightBps: 6000 },
    { token: NVDA, weightBps: 4000 },
  ],
  allowance: 0n,
};

test("create with too little allowance is approve then create, and both encode", () => {
  const calls = buildCreateCalls(base);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].functionName, "approve");
  assert.equal(calls[0].address, USDC);
  assert.deepEqual(calls[0].args, [BOX, 5_000_000n]);
  assert.equal(calls[1].functionName, "create");
  assert.deepEqual(calls[1].args, [FRIEND, 5_000_000n, 1_800_000_000, KIND.Fixed, [AAPL, NVDA], [6000, 4000]]);
  for (const c of calls) encodeFunctionData({ abi: c.abi as Abi, functionName: c.functionName, args: c.args });
});

test("create with enough allowance skips the approval", () => {
  const calls = buildCreateCalls({ ...base, allowance: 5_000_000n });
  assert.deepEqual(calls.map((c) => c.functionName), ["create"]);
});

test("a research box is created with empty arrays and kind Research", () => {
  const [, create] = buildCreateCalls({ ...base, mix: "research" });
  assert.deepEqual(create.args, [FRIEND, 5_000_000n, 1_800_000_000, KIND.Research, [], []]);
});

test("create refuses a bad mix, a self gift and the zero address before the wallet opens", () => {
  assert.throws(() => buildCreateCalls({ ...base, mix: [{ token: AAPL, weightBps: 9000 }] }), /90%/);
  assert.throws(() => buildCreateCalls({ ...base, recipient: ME }), /yourself/);
  assert.throws(() => buildCreateCalls({ ...base, recipient: "0x0000000000000000000000000000000000000000" }), /not valid/);
  assert.throws(() => buildCreateCalls({ ...base, recipient: BOX }), /not valid/);
});

test("open, decline, revoke and refund calls carry the right arguments", () => {
  assert.deepEqual(buildOpenCall(BOX, 7n).args, [7n, OPEN_SLIPPAGE_BPS, [], []]);
  assert.deepEqual(buildOpenCall(BOX, 7n, [{ token: AAPL, weightBps: 10_000 }]).args, [7n, OPEN_SLIPPAGE_BPS, [AAPL], [10_000]]);
  assert.throws(() => buildOpenCall(BOX, 7n, [{ token: AAPL, weightBps: 5000 }]));
  assert.equal(buildDeclineCall(BOX, 7n).functionName, "decline");
  assert.equal(buildRevokeCall(BOX, 7n).functionName, "revoke");
  assert.equal(buildRefundCall(BOX, 7n).functionName, "refundExpired");
  for (const c of [buildOpenCall(BOX, 7n), buildDeclineCall(BOX, 7n), buildRevokeCall(BOX, 7n), buildRefundCall(BOX, 7n)]) {
    assert.equal(c.address, BOX);
    encodeFunctionData({ abi: c.abi as Abi, functionName: c.functionName, args: c.args });
  }
});

function createdLog(id: bigint, address: Hex = BOX) {
  return {
    address,
    topics: encodeEventTopics({ abi: giftBoxAbi, eventName: "GiftCreated", args: { id, sender: ME, recipient: FRIEND } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint8" }, { type: "uint256" }], [5_000_000n, 0, 1_800_000_000n]),
  };
}

function boughtLog(id: bigint, asset: Hex, usdcIn: bigint, assetOut: bigint, address: Hex = BOX) {
  return {
    address,
    topics: encodeEventTopics({ abi: giftBoxAbi, eventName: "GiftPartBought", args: { id, asset } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [usdcIn, assetOut]),
  };
}

test("the new gift id is read from the receipt's GiftCreated log", () => {
  assert.equal(createdGiftId(BOX, [createdLog(12n)]), 12n);
  assert.equal(createdGiftId(BOX, [createdLog(12n, USDC)]), null, "a log from another contract does not count");
  assert.equal(createdGiftId(BOX, []), null);
});

test("opened amounts come from GiftPartBought logs for that box only", () => {
  const logs = [boughtLog(3n, AAPL, 3_000_000n, 840_336n), boughtLog(3n, NVDA, 2_000_000n, 1_052_631n), boughtLog(4n, AAPL, 1n, 1n), boughtLog(3n, AAPL, 9n, 9n, USDC)];
  assert.deepEqual(boughtParts(BOX, 3n, logs), [
    { asset: AAPL, usdcIn: 3_000_000n, assetOut: 840_336n },
    { asset: NVDA, usdcIn: 2_000_000n, assetOut: 1_052_631n },
  ]);
});
