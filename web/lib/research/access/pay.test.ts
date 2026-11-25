import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Log } from "viem";
import { priceUnits } from "./entitlement.ts";
import { paidToTreasury, paymentConfig, processPayment, stackdayContracts, verifyPayment, type ChainReader, type PaymentConfig } from "./pay.ts";
import { memoryAccessStore } from "./store.ts";

// Circle test USDC on Base Sepolia (web/lib/deployment.json). Treasury and wallets are made up.
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TREASURY = "0x00000000000000000000000000000000000Fee01";
const ALICE = "0x00000000000000000000000000000000000a11ce";
const MALLORY = "0x0000000000000000000000000000000000000bad";
const OTHER_TOKEN = "0x0000000000000000000000000000000000007777";
const NOW = new Date("2026-11-19T12:00:00Z");
const HASH = `0x${"ab".repeat(32)}` as const;
const hashN = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

const ENV = { RESEARCH_TREASURY_ADDRESS: TREASURY, RESEARCH_PAY_FROM_BLOCK: "50" };
const cfg: PaymentConfig = paymentConfig(ENV, USDC)!;

function transferLog(p: { token?: string; from?: string; to?: string; value: bigint }): Log {
  return {
    address: (p.token ?? USDC) as `0x${string}`,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: (p.from ?? ALICE) as `0x${string}`, to: (p.to ?? TREASURY) as `0x${string}` } }) as Log["topics"],
    data: encodeAbiParameters([{ type: "uint256" }], [p.value]),
    blockHash: null,
    blockNumber: null,
    logIndex: null,
    transactionHash: null,
    transactionIndex: null,
    removed: false,
  };
}

type Tx = { status?: "success" | "reverted"; block?: bigint; logs: Log[] };

/** A fake Base Sepolia node: a map of tx hash to receipt, a head block, and a chain id. */
function mockChain(txs: Record<string, Tx>, opts: { head?: bigint; chainId?: number; down?: boolean } = {}) {
  const calls = { receipts: 0 };
  const reader: ChainReader = {
    async getChainId() {
      if (opts.down) throw new Error("fetch failed");
      return opts.chainId ?? 84532;
    },
    async getBlockNumber() {
      return opts.head ?? BigInt(110);
    },
    async getTransactionReceipt({ hash }) {
      calls.receipts++;
      const tx = txs[hash];
      if (!tx) {
        const e = new Error(`Transaction receipt with hash "${hash}" could not be found.`);
        e.name = "TransactionReceiptNotFoundError";
        throw e;
      }
      return { transactionHash: hash, status: tx.status ?? "success", blockNumber: tx.block ?? BigInt(100), logs: tx.logs };
    },
  };
  return { reader, calls };
}

const pay = (reader: ChainReader, store = memoryAccessStore(), o: Partial<{ txHash: string; wallet: string; purpose: "weekly-single" | "monthly" }> = {}) =>
  processPayment({ txHash: HASH, wallet: ALICE, purpose: "weekly-single", reader, cfg, store, now: NOW, ...o });

test("paymentConfig needs a real, dedicated treasury address and a start block", () => {
  assert.equal(paymentConfig({}, USDC), null);
  assert.equal(paymentConfig({ RESEARCH_TREASURY_ADDRESS: TREASURY }, USDC), null, "no start block, no payments");
  assert.equal(paymentConfig({ ...ENV, RESEARCH_PAY_FROM_BLOCK: "-1" }, USDC), null);
  assert.equal(paymentConfig({ ...ENV, RESEARCH_PAY_FROM_BLOCK: "12abc" }, USDC), null);
  assert.equal(paymentConfig(ENV, USDC, ["0x00000000000000000000000000000000000fee01"]), null, "treasury must not be a Stackday contract");
  assert.equal(cfg.fromBlock, BigInt(50));
  assert.equal(paymentConfig({ RESEARCH_TREASURY_ADDRESS: "nope" }, USDC), null);
  assert.equal(paymentConfig({ RESEARCH_TREASURY_ADDRESS: "0x0000000000000000000000000000000000000000" }, USDC), null);
  assert.equal(paymentConfig({ RESEARCH_TREASURY_ADDRESS: USDC.toLowerCase() }, USDC), null, "treasury must not be the token");
  assert.equal(cfg.treasury.toLowerCase(), TREASURY.toLowerCase());
  assert.equal(cfg.minConfirmations >= 1, true);
});

test("stackdayContracts lists every address in a deployment file, so GET and POST refuse the same treasuries", () => {
  const deployment = { chainId: 84532, payroll: "0x00000000000000000000000000000000000fee01", vaults: { a: "0x1" }, note: "0xnot-an-address" };
  assert.deepEqual(stackdayContracts(deployment), ["0x00000000000000000000000000000000000fee01"]);
  assert.deepEqual(stackdayContracts(null), []);
  assert.equal(paymentConfig({ ...ENV, RESEARCH_TREASURY_ADDRESS: "0x00000000000000000000000000000000000fee01" }, USDC, stackdayContracts(deployment)), null);
});

test("receipt parsing counts only USDC transfers from the wallet to the treasury", () => {
  const logs = [
    transferLog({ value: BigInt(1_000_000) }),
    transferLog({ value: BigInt(500_000) }),
    transferLog({ token: OTHER_TOKEN, value: BigInt(99_000_000) }), // fake token with the same event
    transferLog({ from: MALLORY, value: BigInt(7_000_000) }), // someone else paying
    transferLog({ to: MALLORY, value: BigInt(8_000_000) }), // paid to the wrong place
    { ...transferLog({ value: BigInt(1) }), topics: [transferLog({ value: BigInt(1) }).topics[0]!] as Log["topics"] }, // malformed
  ];
  assert.equal(paidToTreasury(logs, cfg, ALICE), BigInt(1_500_000));
  assert.equal(paidToTreasury(logs, cfg, MALLORY), BigInt(7_000_000));
  assert.equal(paidToTreasury([], cfg, ALICE), BigInt(0));
});

test("verifyPayment rejects bad hashes, wrong chain, pending, reverted and unconfirmed transactions", async () => {
  const good = { logs: [transferLog({ value: priceUnits("weekly-single") })] };
  const v = (reader: ChainReader, txHash: string = HASH) => verifyPayment({ txHash, wallet: ALICE, reader, cfg });

  assert.deepEqual(await v(mockChain({ [HASH]: good }).reader), { ok: true, amount: priceUnits("weekly-single") });
  assert.equal((await v(mockChain({}).reader, "0x1234")) .ok, false);
  const mainnet = await v(mockChain({ [HASH]: good }, { chainId: 8453 }).reader);
  assert.deepEqual([mainnet.ok, !mainnet.ok && mainnet.status], [false, 500]);
  const down = await v(mockChain({ [HASH]: good }, { down: true }).reader);
  assert.deepEqual([down.ok, !down.ok && down.status], [false, 502]);
  const pending = await v(mockChain({}).reader);
  assert.deepEqual([pending.ok, !pending.ok && pending.status], [false, 409]);
  const reverted = await v(mockChain({ [HASH]: { ...good, status: "reverted" } }).reader);
  assert.deepEqual([reverted.ok, !reverted.ok && reverted.status], [false, 400]);
  // Mined at 100, head 101 = 2 confirmations, needs 3.
  const young = await v(mockChain({ [HASH]: good }, { head: BigInt(101) }).reader);
  assert.deepEqual([young.ok, !young.ok && young.status], [false, 409]);
  assert.equal((await v(mockChain({ [HASH]: good }, { head: BigInt(102) }).reader)).ok, true, "exactly 3 confirmations is enough");
  const nothing = await v(mockChain({ [HASH]: { logs: [transferLog({ from: MALLORY, value: BigInt(9e6) })] } }).reader);
  assert.deepEqual([nothing.ok, !nothing.ok && nothing.status], [false, 400]);
  // Upper-case hash is accepted and normalised.
  assert.equal((await v(mockChain({ [HASH]: good }).reader, HASH.toUpperCase().replace("0X", "0x"))).ok, true);
});

test("processPayment grants credits once and rejects a replay of the same tx hash", async () => {
  const { reader } = mockChain({ [HASH]: { logs: [transferLog({ value: priceUnits("weekly-single") * BigInt(2) })] } });
  const store = memoryAccessStore();
  const first = await pay(reader, store);
  assert.ok(first.ok);
  assert.equal(first.entitlement.weeklyCredits, 2);
  assert.equal(first.amountUsdc, "2");
  assert.equal(store.payments.get(HASH)?.purpose, "weekly-single");
  assert.equal(store.payments.get(HASH)?.chainId, 84532);

  const again = await pay(reader, store);
  assert.deepEqual([again.ok, !again.ok && again.status], [false, 409]);
  const upper = await pay(reader, store, { txHash: HASH.toUpperCase().replace("0X", "0x") });
  assert.equal(upper.ok, false, "case changes do not get around the replay check");
  assert.equal(store.peek(ALICE)?.weeklyCredits, 2);
});

test("a replay sent many times at once is granted exactly once", async () => {
  const { reader } = mockChain({ [HASH]: { logs: [transferLog({ value: priceUnits("weekly-single") })] } });
  const store = memoryAccessStore();
  const results = await Promise.all(Array.from({ length: 10 }, () => pay(reader, store)));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(store.peek(ALICE)?.weeklyCredits, 1);
});

test("parallel different payments all land (no lost update)", async () => {
  const txs: Record<string, Tx> = {};
  for (let i = 1; i <= 6; i++) txs[hashN(i)] = { logs: [transferLog({ value: priceUnits("weekly-single") })] };
  const { reader } = mockChain(txs);
  const store = memoryAccessStore();
  const results = await Promise.all(Object.keys(txs).map((txHash) => pay(reader, store, { txHash })));
  assert.ok(results.every((r) => r.ok));
  assert.equal(store.peek(ALICE)?.weeklyCredits, 6);
});

test("someone else cannot claim another wallet's payment", async () => {
  const { reader } = mockChain({ [HASH]: { logs: [transferLog({ value: priceUnits("monthly") })] } });
  const store = memoryAccessStore();
  const stolen = await pay(reader, store, { wallet: MALLORY, purpose: "monthly" });
  assert.equal(stolen.ok, false);
  assert.equal(store.payments.size, 0, "a refused claim does not burn the hash");
  const own = await pay(reader, store, { purpose: "monthly" });
  assert.ok(own.ok);
  assert.equal(own.entitlement.plan, "monthly");
});

test("underpaying for the chosen purpose is refused and the hash stays usable", async () => {
  const { reader } = mockChain({ [HASH]: { logs: [transferLog({ value: priceUnits("weekly-single") })] } });
  const store = memoryAccessStore();
  const r = await pay(reader, store, { purpose: "monthly" });
  assert.deepEqual([r.ok, !r.ok && r.status], [false, 400]);
  assert.equal(store.payments.size, 0);
  assert.ok((await pay(reader, store, { purpose: "weekly-single" })).ok);
});

test("a monthly payment grants 30 days and is stored with its purpose", async () => {
  const { reader } = mockChain({ [HASH]: { logs: [transferLog({ value: priceUnits("monthly") })] } });
  const store = memoryAccessStore();
  const r = await pay(reader, store, { purpose: "monthly" });
  assert.ok(r.ok);
  assert.equal(r.entitlement.plan, "monthly");
  assert.equal(r.entitlement.validUntil, "2026-12-19T12:00:00.000Z");
  assert.equal(store.payments.get(HASH)?.purpose, "monthly");
});

test("storing and granting is one step: a failure stores nothing and grants nothing, so a retry works once", async () => {
  const { reader } = mockChain({ [HASH]: { logs: [transferLog({ value: priceUnits("weekly-single") })] } });
  const store = memoryAccessStore();
  const broken = { ...store, recordPaymentAndGrant: async () => { throw new Error("db down"); } };
  const r = await pay(reader, broken);
  assert.deepEqual([r.ok, !r.ok && r.status], [false, 500]);
  assert.equal(store.payments.size, 0);
  assert.equal(store.peek(ALICE), undefined, "nothing granted either");
  assert.ok((await pay(reader, store)).ok);
  assert.equal((await pay(reader, store)).ok, false, "the retry cannot grant twice");
  assert.equal(store.peek(ALICE)?.weeklyCredits, 1);
});

test("a transfer mined before research payments opened cannot be redeemed", async () => {
  const { reader } = mockChain({ [HASH]: { block: BigInt(49), logs: [transferLog({ value: priceUnits("weekly-single") })] } });
  const store = memoryAccessStore();
  const r = await pay(reader, store);
  assert.deepEqual([r.ok, !r.ok && r.status], [false, 400]);
  assert.equal(store.payments.size, 0);
});

test("paying for more Monday reports than one payment can buy is refused, not silently kept", async () => {
  const { reader } = mockChain({ [HASH]: { logs: [transferLog({ value: priceUnits("weekly-single") * BigInt(11) })] } });
  const store = memoryAccessStore();
  const r = await pay(reader, store);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /more than 10 Monday reports/);
  assert.equal(store.payments.size, 0, "not stored, so the team can return it");
});
