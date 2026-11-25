import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, type Abi } from "viem";
import { vaultAbi } from "../abis.ts";
import { ADDR, ASSETS, MAX_UINT, SIP_FEE_BPS } from "../contracts.ts";
import { assetValue, WAD } from "../format.ts";
import type { Call } from "../useTx.ts";
import { buildPlan, checkCalls, CARD_TTL_SEC, minHealthFor, type Plan } from "./buildCalls.ts";
import type { Intent } from "./intent.ts";
import { addressArgs, ATTACKER, ctx, ME, positions, tokens, usd, VAULT } from "./test-fixtures.ts";

const asset = (s: string) => ASSETS.find((a) => a.symbol === s)!;
const ok = (r: ReturnType<typeof buildPlan>): Plan => {
  assert.equal(r.ok, true, r.ok ? "" : (r as { reason: string }).reason);
  return r as Plan;
};
const refused = (r: ReturnType<typeof buildPlan>, match: RegExp) => {
  assert.equal(r.ok, false, "expected a refusal");
  assert.match((r as { reason: string }).reason, match);
};

/** Vault multicalls unpacked, so tests see every inner call. */
function flatten(calls: Call[]): { address: string; functionName: string; args: readonly unknown[] }[] {
  return calls.flatMap((c) => {
    if (c.functionName !== "multicall") return [{ address: c.address.toLowerCase(), functionName: c.functionName, args: c.args ?? [] }];
    return (c.args![0] as `0x${string}`[]).map((data) => {
      const d = decodeFunctionData({ abi: vaultAbi as Abi, data });
      return { address: c.address.toLowerCase(), functionName: d.functionName, args: (d.args ?? []) as readonly unknown[] };
    });
  });
}

/** The only non-contract address any card may contain is the connected wallet. */
function assertOnlyMine(calls: Call[]) {
  const contracts = new Set([ADDR.usdc, ADDR.router, ADDR.factory, ADDR.sellDesk, VAULT, ...ASSETS.map((a) => a.token)].map((x) => x.toLowerCase()));
  for (const c of flatten(calls)) {
    assert.ok(contracts.has(c.address), `call to ${c.address}`);
    for (const a of addressArgs(c.args)) assert.ok(a === ME.toLowerCase() || contracts.has(a), `foreign address ${a} in ${c.functionName}`);
  }
}

test("buy: approval then SipRouter.invest, minOut is the oracle quote less 1%, no fee, receiver is the wallet", () => {
  const quote = tokens(0.056, 8);
  const plan = ok(buildPlan({ action: "buy", params: { asset: "mAAPL", usdc: "20" } }, ctx({ quotes: { oracleOut: quote } })));
  assert.equal(plan.calls.length, 2);
  assert.deepEqual(plan.calls[0].args, [ADDR.router, usd(20)]);
  assert.equal(plan.calls[1].functionName, "invest");
  assert.deepEqual(plan.calls[1].args, [asset("mAAPL").token, usd(20), (quote * 9900n) / 10_000n]);
  assert.equal(plan.receiver, ME);
  assert.match(plan.fee, /free/);
  // Plain words with the price: 20 USDC buys 0.056 AAPL, so about 357.14 per token.
  assert.match(plan.rows.find((r) => r.label === "You buy")!.value, /^\$20\.00 of .+ at \$357\.14 each$/);
  assert.equal(plan.expiresAt, 1_800_000_000 + CARD_TTL_SEC);
  assertOnlyMine(plan.calls);
});

test("buy: no approval step when the allowance already covers it; refused without a quote or without the USDC", () => {
  const plan = ok(buildPlan({ action: "buy", params: { asset: "mNVDA", usdc: "10" } }, ctx({ routerAllowance: usd(10), quotes: { oracleOut: 1000n } })));
  assert.equal(plan.calls.length, 1);
  refused(buildPlan({ action: "buy", params: { asset: "mNVDA", usdc: "10" } }, ctx()), /oracle price/);
  refused(buildPlan({ action: "buy", params: { asset: "mNVDA", usdc: "10" } }, ctx({ walletUsdc: usd(5), quotes: { oracleOut: 1000n } })), /wallet has 5\.00/);
});

test("recurring buy: approval for exactly the planned buys, setPlan with 1% slippage, fee shown", () => {
  const plan = ok(buildPlan({ action: "recurring_buy", params: { asset: "mNVDA", usdc: "10", every: "weekly", weeks: 12 } }, ctx({ routerAllowance: usd(3) })));
  assert.deepEqual(plan.calls[0].args, [ADDR.router, usd(3) + usd(120)]);
  const [token, perBuy, interval, slippage, first] = plan.calls[1].args as [string, bigint, number, number, number];
  assert.equal(token, asset("mNVDA").token);
  assert.equal(perBuy, usd(10));
  assert.equal(interval, 7 * 86400);
  assert.equal(slippage, 100);
  assert.ok(first > 1_800_000_000);
  assert.ok(plan.fee.includes(`${Number(SIP_FEE_BPS) / 100}%`));
  assert.equal(plan.registerKeeper, asset("mNVDA").token);
});

test("recurring buy: refused when the whole plan is over the 500 USDC card cap", () => {
  refused(buildPlan({ action: "recurring_buy", params: { asset: "mNVDA", usdc: "10", every: "weekly", weeks: 52 } }, ctx()), /520\.00 USDC in total/);
  ok(buildPlan({ action: "recurring_buy", params: { asset: "mNVDA", usdc: "125", every: "weekly", weeks: 4 } }, ctx()));
});

test("cancel plan: only when a plan exists", () => {
  refused(buildPlan({ action: "cancel_plan", params: { asset: "mAAPL" } }, ctx()), /no recurring plan/);
  const c = ctx({ positions: positions({ mAAPL: { recurring: { usdcPerBuy: usd(5), interval: 604800, nextBuyAt: 0, slippageBps: 100 } } }) });
  const plan = ok(buildPlan({ action: "cancel_plan", params: { asset: "mAAPL" } }, c));
  assert.deepEqual(plan.calls.map((x) => x.functionName), ["cancelPlan"]);
});

test("sell half: withdraw to my wallet, approve the desk, swap with the USDC to my wallet; 18-decimal gold", () => {
  const gold = asset("mPAXG");
  assert.equal(gold.decimals, 18);
  const held = tokens(0.1, 18); // about 406 USDC at the start price
  const c = ctx({ positions: positions({ mPAXG: { idle: held } }), quotes: { deskSpreadBps: 50n, deskReserve: usd(10_000) } });
  const plan = ok(buildPlan({ action: "sell", params: { asset: "mPAXG", amount: "50", unit: "percent" } }, c));
  const half = held / 2n;
  assert.deepEqual(plan.calls.map((x) => x.functionName), ["withdraw", "approve", "swapExactStockForUsdc"]);
  assert.deepEqual(plan.calls[0].args, [gold.token, half, ME]);
  assert.deepEqual(plan.calls[1].args, [ADDR.sellDesk, half]);
  const value = assetValue(half, gold.startPrice, 18);
  assert.deepEqual(plan.calls[2].args, [gold.token, half, (value * (10_000n - 150n)) / 10_000n, ME]);
  assert.ok(plan.notes.some((n) => n.startsWith("You could borrow against it instead")));
  assert.match(plan.rows.find((r) => r.label === "You sell")!.value, /^0\.05 mPAXG \(Gold\) at \$4,060\.00 each$/);
  assert.match(plan.rows.find((r) => r.label === "You get about")!.value, /^\$[\d,]+\.\d\d \(.+ USDC to your wallet\)$/);
  assertOnlyMine(plan.calls);
});

test("sell: refused over the cap, over what is free, when the desk reserve is low, or with locked stock under a loan", () => {
  const held = tokens(1, 18); // about 4,060 USDC of gold
  const q = { deskSpreadBps: 50n, deskReserve: usd(10_000) };
  refused(buildPlan({ action: "sell", params: { asset: "mPAXG", amount: "50", unit: "percent" } }, ctx({ positions: positions({ mPAXG: { idle: held } }), quotes: q })), /at most 500 test USDC/);
  refused(buildPlan({ action: "sell", params: { asset: "mAAPL", amount: "5", unit: "tokens" } }, ctx({ positions: positions({ mAAPL: { idle: tokens(1, 8) } }), quotes: q })), /You have 1 mAAPL/);
  refused(buildPlan({ action: "sell", params: { asset: "mAAPL", amount: "100", unit: "usdc" } }, ctx({ positions: positions({ mAAPL: { idle: tokens(1, 8) } }), quotes: { deskSpreadBps: 50n, deskReserve: usd(20) } })), /holds only 20\.00/);
  const locked = positions({ mAAPL: { idle: 0n, collateral: tokens(1, 8), debt: usd(50) } });
  refused(buildPlan({ action: "sell", params: { asset: "mAAPL", amount: "1", unit: "tokens" } }, ctx({ positions: locked, quotes: q })), /locked for your loan/);
});

test("withdraw: one vault call to the connected wallet, cap applies", () => {
  const plan = ok(buildPlan({ action: "withdraw", params: { asset: "mWETH", amount: "0.01", unit: "tokens" } }, ctx({ positions: positions({ mWETH: { idle: tokens(1, 18) } }) })));
  assert.deepEqual(plan.calls[0].args, [asset("mWETH").token, tokens(0.01, 18), ME]);
  refused(buildPlan({ action: "withdraw", params: { asset: "mWETH", amount: "1", unit: "tokens" } }, ctx({ positions: positions({ mWETH: { idle: tokens(1, 18) } }) })), /at most 500/);
});

test("borrow: locks what the chosen risk level needs, borrows to my wallet, shows health and liquidation price", () => {
  const a = asset("mAAPL"); // 357 USD, 62.5% limit
  const c = ctx({ positions: positions({ mAAPL: { idle: tokens(2, 8) } }) });
  const plan = ok(buildPlan({ action: "borrow", params: { asset: "mAAPL", usdc: "100", risk: "mid" } }, c));
  const inner = flatten(plan.calls);
  assert.deepEqual(inner.map((x) => x.functionName), ["addCollateral", "borrow"]);
  const locked = inner[0].args[1] as bigint;
  const maxDebt = (assetValue(locked, a.startPrice, 8) * a.lltv) / WAD;
  assert.ok((maxDebt * WAD) / usd(100) >= minHealthFor("mid"), "health after is at least 2.0");
  assert.deepEqual(inner[1].args, [a.token, 0n, usd(100), ME]);
  assert.ok(plan.rows.some((r) => r.label === "Liquidation price"));
  assert.ok(plan.rows.some((r) => r.label === "Health after"));
  assertOnlyMine(plan.calls);
});

test("borrow: refused, not warned, when the risk level cannot be met; invest-only assets refused", () => {
  const c = ctx({ positions: positions({ mAAPL: { idle: tokens(0.5, 8) } }) }); // about 178 USDC of Apple
  refused(buildPlan({ action: "borrow", params: { asset: "mAAPL", usdc: "100", risk: "low" } }, c), /At Low risk/);
  refused(buildPlan({ action: "borrow", params: { asset: "mTSLA", usdc: "10", risk: "mid" } }, c), /invest only/);
  refused(buildPlan({ action: "borrow", params: { asset: "mAAPL", usdc: "10", risk: "mid" } }, ctx({ positions: positions({ mAAPL: { idle: tokens(1, 8), liquidity: usd(5) } }) })), /can lend only 5\.00/);
});

test("borrow at High risk raises the vault cap to 65% only when the amount needs it", () => {
  const c = ctx({ positions: positions({ mAAPL: { collateral: tokens(1, 8) } }) }); // limit 223.125, cap 50% = 111.56
  const plan = ok(buildPlan({ action: "borrow", params: { asset: "mAAPL", usdc: "140", risk: "high" } }, c));
  assert.deepEqual(flatten(plan.calls).map((x) => x.functionName), ["setBorrowCapBps", "borrow"]);
  const small = ok(buildPlan({ action: "borrow", params: { asset: "mAAPL", usdc: "50", risk: "high" } }, c));
  assert.deepEqual(flatten(small.calls).map((x) => x.functionName), ["borrow"]);
});

test("borrow with wallet stock: approve the vault, deposit, lock, borrow (8 vs 18 decimals)", () => {
  const c = ctx({ positions: positions({ mWETH: { wallet: tokens(1, 18) } }) });
  const plan = ok(buildPlan({ action: "borrow", params: { asset: "mWETH", usdc: "200", risk: "mid" } }, c));
  const fns = flatten(plan.calls).map((x) => x.functionName);
  assert.deepEqual(fns, ["approve", "depositStock", "addCollateral", "borrow"]);
  assertOnlyMine(plan.calls);
});

test("repay all: covers loan and fee with headroom, sends MAX so the contract closes the loan", () => {
  const c = ctx({ positions: positions({ mAAPL: { collateral: tokens(1, 8), debt: usd(50), fee: usd(0.01) } }) });
  const plan = ok(buildPlan({ action: "repay", params: { asset: "every_loan", usdc: "0", all: true } }, c));
  const inner = flatten(plan.calls);
  const total = usd(50.01);
  assert.deepEqual(inner[0].args, [VAULT, total + total / 100n + 1000n]);
  assert.deepEqual(inner[1].args, [asset("mAAPL").token, MAX_UINT]);
  refused(buildPlan({ action: "repay", params: { asset: "mNVDA", usdc: "5", all: false } }, c), /no loan against NVIDIA/);
  refused(buildPlan({ action: "repay", params: { asset: "every_loan", usdc: "0", all: true } }, ctx({ ...c, walletUsdc: usd(10) })), /wallet has 10\.00/);
});

test("repay part across two loans uses the Borrow page split", () => {
  const c = ctx({ positions: positions({ mAAPL: { collateral: tokens(1, 8), debt: usd(60) }, mNVDA: { collateral: tokens(2, 8), debt: usd(40) } }) });
  const plan = ok(buildPlan({ action: "repay", params: { asset: "every_loan", usdc: "30", all: false } }, c));
  const repays = flatten(plan.calls).filter((x) => x.functionName === "repay");
  assert.equal(repays.reduce((s, r) => s + (r.args[1] as bigint), 0n), usd(30));
});

test("repay over the card cap is refused", () => {
  const c = ctx({ walletUsdc: usd(5000), positions: positions({ mcbBTC: { collateral: tokens(0.05, 8), debt: usd(800) } }) });
  refused(buildPlan({ action: "repay", params: { asset: "every_loan", usdc: "0", all: true } }, c), /at most 500/);
});

test("gift is validated but hands off to the Gifts page (no calls)", () => {
  const plan = ok(buildPlan({ action: "gift", params: { recipient_id: "SD-ABCD1234", usdc: "5", box: "one_stock" } }, ctx()));
  assert.equal(plan.calls.length, 0);
  assert.match(plan.handoff!, /Open the Gifts page to send/);
});

test("checkCalls refuses a foreign receiver or a foreign contract", () => {
  const good: Call = { label: "x", address: VAULT, abi: vaultAbi, functionName: "withdraw", args: [asset("mAAPL").token, 1n, ME] };
  assert.equal(checkCalls([good], ctx()), null);
  assert.match(checkCalls([{ ...good, args: [asset("mAAPL").token, 1n, ATTACKER] }], ctx())!, /outside the allowlist/);
  assert.match(checkCalls([{ ...good, address: ATTACKER }], ctx())!, /outside the allowlist/);
});

test("every card from every intent names only the connected wallet as receiver", () => {
  const rich = ctx({
    walletUsdc: usd(1000),
    positions: positions({ mAAPL: { idle: tokens(1, 8), collateral: tokens(1, 8), debt: usd(20), recurring: { usdcPerBuy: usd(5), interval: 604800, nextBuyAt: 0, slippageBps: 100 } }, mWETH: { wallet: tokens(1, 18) } }),
    quotes: { oracleOut: 1000n, deskSpreadBps: 50n, deskReserve: usd(10_000) },
  });
  const intents: Intent[] = [
    { action: "buy", params: { asset: "mAAPL", usdc: "20" } },
    { action: "recurring_buy", params: { asset: "mAAPL", usdc: "5", every: "every_2_weeks", weeks: 26 } },
    { action: "cancel_plan", params: { asset: "mAAPL" } },
    { action: "sell", params: { asset: "mAAPL", amount: "0.5", unit: "tokens" } },
    { action: "withdraw", params: { asset: "mAAPL", amount: "10", unit: "usdc" } },
    { action: "borrow", params: { asset: "mWETH", usdc: "100", risk: "low" } },
    { action: "repay", params: { asset: "mAAPL", usdc: "10", all: false } },
  ];
  for (const i of intents) {
    const plan = ok(buildPlan(i, rich));
    assert.equal(plan.receiver, ME);
    assertOnlyMine(plan.calls);
  }
});

test("borrow locks a 1% buffer so interest before the transaction lands cannot cross the cap", () => {
  const a = asset("mAAPL");
  const c = ctx({ positions: positions({ mAAPL: { idle: tokens(2, 8) } }) });
  const plan = ok(buildPlan({ action: "borrow", params: { asset: "mAAPL", usdc: "100", risk: "mid" } }, c));
  const locked = flatten(plan.calls)[0].args[1] as bigint;
  const capLimit = (((assetValue(locked, a.startPrice, 8) * a.lltv) / WAD) * 5000n) / 10_000n;
  assert.ok(capLimit >= usd(101), `cap limit ${capLimit} leaves room for 1% interest`);
});

test("gift hand-off links to the Gifts page without the recipient in the address bar", () => {
  const plan = ok(buildPlan({ action: "gift", params: { recipient_id: "maya_k", usdc: "5", box: "surprise" } }, ctx()));
  assert.equal(plan.link!.href, "/gifts?usdc=5&box=surprise");
});
