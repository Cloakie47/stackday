import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, type Abi } from "viem";
import { vaultAbi } from "../abis.ts";
import { ADDR, ASSETS, GIFT_BOX, MAX_UINT, SIP_FEE_BPS } from "../contracts.ts";
import { assetValue, WAD } from "../format.ts";
import type { Call } from "../useTx.ts";
import { buildPlan, capFor, checkCalls, CARD_TTL_SEC, earnFeeNow, minHealthFor, type Plan } from "./buildCalls.ts";
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

test("withdraw: one vault call to the connected wallet, not capped (it is the person's own money coming home)", () => {
  const plan = ok(buildPlan({ action: "withdraw", params: { asset: "mWETH", amount: "0.01", unit: "tokens" } }, ctx({ positions: positions({ mWETH: { idle: tokens(1, 18) } }) })));
  assert.deepEqual(plan.calls[0].args, [asset("mWETH").token, tokens(0.01, 18), ME]);
  assert.equal(plan.destination.kind, "own_wallet");
  const big = ok(buildPlan({ action: "withdraw", params: { asset: "mWETH", amount: "1", unit: "tokens" } }, ctx({ positions: positions({ mWETH: { idle: tokens(1, 18) } }) })));
  assert.ok(big.usdcValue > usd(500));
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

test("repay is not capped: an 800 USDC loan can be repaid in full from one card", () => {
  const c = ctx({ walletUsdc: usd(5000), positions: positions({ mcbBTC: { collateral: tokens(0.05, 8), debt: usd(800) } }) });
  const plan = ok(buildPlan({ action: "repay", params: { asset: "every_loan", usdc: "0", all: true } }, c));
  assert.ok(plan.usdcValue >= usd(800));
  assert.equal(plan.health!.after, null);
  assert.ok(plan.health!.before! > 1);
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


test("lock: one vault call from free assets; unlock: refused when the loan would pass the safety cap", () => {
  const nv = asset("mNVDA");
  const c = ctx({ positions: positions({ mNVDA: { idle: tokens(0.034, 8), price: 19_000_000_000n } }) });
  const lock = ok(buildPlan({ action: "lock", params: { asset: "mNVDA", amount: "1", unit: "usdc" } }, c));
  assert.deepEqual(lock.calls.map((x) => x.functionName), ["addCollateral"]);
  assert.equal(lock.calls[0].address, VAULT);
  assert.equal((lock.calls[0].args as unknown[])[0], nv.token);
  assert.match(lock.rows[0].value, /^0\.00526\d* mNVDA \(NVIDIA\), worth about \$1\.00$/);
  assertOnlyMine(lock.calls);
  refused(buildPlan({ action: "lock", params: { asset: "mTSLA", amount: "10", unit: "percent" } }, c), /invest only/);
  refused(buildPlan({ action: "lock", params: { asset: "mNVDA", amount: "1", unit: "tokens" } }, c), /free/);

  const locked = ctx({ positions: positions({ mNVDA: { collateral: tokens(0.02, 8), debt: usd(1), price: 19_000_000_000n } }) });
  const small = ok(buildPlan({ action: "unlock", params: { asset: "mNVDA", amount: "10", unit: "percent" } }, locked));
  assert.deepEqual(small.calls.map((x) => x.functionName), ["removeCollateral"]);
  assert.ok(small.rows.some((r) => r.label === "Health after"));
  refused(buildPlan({ action: "unlock", params: { asset: "mNVDA", amount: "100", unit: "percent" } }, locked), /safety cap/);
  refused(buildPlan({ action: "unlock", params: { asset: "mAAPL", amount: "10", unit: "percent" } }, locked), /no Apple locked/);
  assert.ok(small.health!.before! > small.health!.after!);
});

// ---- E1 to E9: earn, USDC withdraw, caps, buy approval, repay nothing owed, gift and send

const YIELD = "0x3333333333333333333333333333333333333333" as const;
const MARIA = "0x7777777777777777777777777777777777777777" as const;
const MARIA_VAULT = "0x7777777777777777777777777777777777777778" as const;
const TYPED = "0x52908400098527886E0F7030069857D2E4169EE7" as const;
const maria = { ok: true as const, typed: false, wallet: MARIA, uid: "SD-7KQ2M9XA", username: "maria", vault: MARIA_VAULT };

test("every card has a headline and a destination", () => {
  const plan = ok(buildPlan({ action: "buy", params: { asset: "mNVDA", usdc: "5" } }, ctx({ quotes: { oracleOut: tokens(0.0274, 8) } })));
  assert.match(plan.headline, /^You buy \$5\.00 of NVIDIA at \$182\.4\d each$/);
  assert.deepEqual(plan.destination, { kind: "own_vault", address: VAULT });
  const borrow = ok(buildPlan({ action: "borrow", params: { asset: "mNVDA", usdc: "1", risk: "mid" } }, ctx({ positions: positions({ mNVDA: { idle: tokens(1, 8) } }) })));
  assert.equal(borrow.headline, "You borrow $1.00 USDC against NVIDIA");
  assert.equal(borrow.destination.kind, "own_wallet");
  assert.equal(borrow.health!.before, null);
  assert.ok(borrow.health!.after! >= 2);
});

test("earn: vault USDC first, approve only the shortfall from the wallet, then vault.earn", () => {
  const c = ctx({ yieldAdapter: YIELD, vaultUsdc: usd(4), vaultUsdcAllowance: 0n });
  const plan = ok(buildPlan({ action: "earn", params: { usdc: "10" } }, c));
  assert.deepEqual(plan.calls.map((x) => x.functionName), ["approve", "earn"]);
  assert.deepEqual(plan.calls[0].args, [VAULT, usd(6)]);
  assert.deepEqual(plan.calls[1].args, [usd(10)]);
  assert.equal(plan.headline, "You put 10.00 USDC to work earning interest");
  assert.equal(plan.destination.kind, "own_vault");
  // All from the vault: no approval.
  assert.deepEqual(ok(buildPlan({ action: "earn", params: { usdc: "3" } }, c)).calls.map((x) => x.functionName), ["earn"]);
  // No vault yet: create it, approve the predicted vault, earn.
  const fresh = ok(buildPlan({ action: "earn", params: { usdc: "3" } }, ctx({ vault: undefined, yieldAdapter: YIELD })));
  assert.deepEqual(fresh.calls.map((x) => x.functionName), ["createVault", "approve", "earn"]);
  assertOnlyMine(fresh.calls);
  refused(buildPlan({ action: "earn", params: { usdc: "10" } }, ctx({ yieldAdapter: "0x0000000000000000000000000000000000000000" })), /not available/);
  refused(buildPlan({ action: "earn", params: { usdc: "10" } }, ctx()), /not available/);
  refused(buildPlan({ action: "earn", params: { usdc: "10" } }, ctx({ yieldAdapter: YIELD, walletUsdc: usd(1) })), /from your wallet/);
});

test("stop earning: all sends MAX to my wallet; a part is checked against the balance less the fee owed", () => {
  const c = ctx({ yieldAdapter: YIELD, earning: { balance: usd(10.5), principal: usd(10), feeOwed: usd(0.1) } });
  const all = ok(buildPlan({ action: "stop_earning", params: { usdc: "all" } }, c));
  assert.deepEqual(all.calls[0].args, [MAX_UINT, ME]);
  assert.equal(all.calls[0].functionName, "stopEarning");
  assert.equal(all.usdcValue, usd(10.4));
  assert.equal(all.destination.kind, "own_wallet");
  const part = ok(buildPlan({ action: "stop_earning", params: { usdc: "10.4" } }, c));
  assert.deepEqual(part.calls[0].args, [usd(10.4), ME]);
  refused(buildPlan({ action: "stop_earning", params: { usdc: "10.45" } }, c), /up to 10\.40/);
  refused(buildPlan({ action: "stop_earning", params: { usdc: "all" } }, ctx({ yieldAdapter: YIELD })), /nothing earning/);
  // Not capped: 2,000 USDC earning comes back on one card.
  ok(buildPlan({ action: "stop_earning", params: { usdc: "all" } }, ctx({ yieldAdapter: YIELD, earning: { balance: usd(2000), principal: usd(2000), feeOwed: 0n } })));
});

test("earnFeeNow builds up the yearly fee the way the vault does", () => {
  const year = 365 * 86_400;
  assert.equal(earnFeeNow(0n, usd(1000), 1_000n, 10n, 1_000 + year), usd(1));
  assert.equal(earnFeeNow(5n, 0n, 1_000n, 10n, 1_000 + year), 5n);
});

test("withdraw USDC: idle USDC in the vault to my wallet, by amount or percent", () => {
  const c = ctx({ vaultUsdc: usd(40) });
  const plan = ok(buildPlan({ action: "withdraw", params: { asset: "USDC", amount: "25", unit: "usdc" } }, c));
  assert.deepEqual(plan.calls.map((x) => [x.address, x.functionName, x.args]), [[VAULT, "withdraw", [ADDR.usdc, usd(25), ME]]]);
  assert.equal(plan.destination.kind, "own_wallet");
  assert.deepEqual(ok(buildPlan({ action: "withdraw", params: { asset: "USDC", amount: "50", unit: "percent" } }, c)).calls[0].args, [ADDR.usdc, usd(20), ME]);
  refused(buildPlan({ action: "withdraw", params: { asset: "USDC", amount: "41", unit: "tokens" } }, c), /40\.00 USDC idle/);
  refused(buildPlan({ action: "withdraw", params: { asset: "USDC", amount: "1", unit: "usdc" } }, ctx()), /no idle USDC/);
});

test("card caps: buy, borrow, earn and gift stay at 500; repay, unlock, withdraw and stop earning are exempt", () => {
  assert.equal(capFor("buy"), usd(500));
  assert.equal(capFor("borrow"), usd(500));
  assert.equal(capFor("earn"), usd(500));
  assert.equal(capFor("gift"), usd(500));
  assert.equal(capFor("sell"), usd(500));
  assert.equal(capFor("send"), usd(100));
  for (const a of ["repay", "unlock", "withdraw", "stop_earning"] as const) assert.equal(capFor(a), undefined);
  // Unlock about 1,200 USDC of gold with no loan: allowed.
  ok(buildPlan({ action: "unlock", params: { asset: "mPAXG", amount: "100", unit: "percent" } }, ctx({ positions: positions({ mPAXG: { collateral: tokens(0.3, 18) } }) })));
});

test("buy with a recurring plan running: approve the current allowance plus the buy, never overwrite it", () => {
  const plan = { usdcPerBuy: usd(10), interval: 604800, nextBuyAt: 0, slippageBps: 100 };
  const c = ctx({ routerAllowance: usd(120), positions: positions({ mNVDA: { recurring: plan } }), quotes: { oracleOut: 1000n } });
  const p = ok(buildPlan({ action: "buy", params: { asset: "mAAPL", usdc: "20" } }, c));
  assert.deepEqual(p.calls.map((x) => x.functionName), ["approve", "invest"]);
  assert.deepEqual(p.calls[0].args, [ADDR.router, usd(140)]);
  assert.ok(p.notes.some((n) => /plans keep running/.test(n)));
  // Unlimited approval: nothing to add.
  const unlimited = ok(buildPlan({ action: "buy", params: { asset: "mAAPL", usdc: "20" } }, { ...c, routerAllowance: MAX_UINT }));
  assert.deepEqual(unlimited.calls.map((x) => x.functionName), ["invest"]);
});

test("repay refuses when nothing is owed", () => {
  refused(buildPlan({ action: "repay", params: { asset: "mAAPL", usdc: "5", all: false } }, ctx({ positions: positions({ mAAPL: { collateral: tokens(1, 8) } }) })), /no loan against Apple/);
});

test("gift: real GiftBox calls to the one resolved recipient; one_stock needs an asset; research needs approved research", () => {
  const c = ctx({ recipient: maria, gift: { allowance: 0n } });
  const plan = ok(buildPlan({ action: "gift", params: { recipient_id: "maria", usdc: "5", box: "one_stock", asset: "mNVDA" } }, c));
  assert.deepEqual(plan.calls.map((x) => x.functionName), ["approve", "create"]);
  assert.equal(plan.calls[1].address, GIFT_BOX);
  const [to, amount, expires, kind, assets, weights] = plan.calls[1].args as [string, bigint, number, number, string[], number[]];
  assert.equal(to, MARIA);
  assert.equal(amount, usd(5));
  assert.equal(expires, 1_800_000_000 + 30 * 86_400);
  assert.equal(kind, 0);
  assert.deepEqual(assets, [asset("mNVDA").token]);
  assert.deepEqual(weights, [10_000]);
  assert.equal(plan.handoff, undefined);
  assert.equal(plan.destination.kind, "recipient");
  assert.match(plan.headline, /to @maria \(SD-7KQ2M9XA\)$/);
  refused(buildPlan({ action: "gift", params: { recipient_id: "maria", usdc: "5", box: "one_stock" } }, c), /Which stock/);
  refused(buildPlan({ action: "gift", params: { recipient_id: "maria", usdc: "5", box: "research_pick" } }, c), /no approved research/);
  const research = ok(buildPlan({ action: "gift", params: { recipient_id: "maria", usdc: "5", box: "research_pick" } }, ctx({ recipient: maria, gift: { allowance: usd(5), researchReady: true } })));
  assert.deepEqual(research.calls.map((x) => x.functionName), ["create"]);
  // My mix copies the person's holdings by value.
  const mine = ok(buildPlan({ action: "gift", params: { recipient_id: "maria", usdc: "5", box: "my_mix" } }, ctx({ recipient: maria, gift: { allowance: 0n }, positions: positions({ mAAPL: { idle: tokens(1, 8) }, mNVDA: { idle: tokens(1, 8) } }) })));
  assert.equal((mine.calls[1].args![4] as string[]).length, 2);
  refused(buildPlan({ action: "gift", params: { recipient_id: "maria", usdc: "5", box: "my_mix" } }, c), /hold nothing/);
  // Unresolved, self or typed recipients are refused.
  refused(buildPlan({ action: "gift", params: { recipient_id: "maria", usdc: "5", box: "surprise" } }, ctx({ recipient: { ok: false, reason: "Nobody on Stackday has the username @maria." } })), /Nobody/);
  refused(buildPlan({ action: "gift", params: { recipient_id: "maria", usdc: "5", box: "one_stock", asset: "mNVDA" } }, ctx({ recipient: { ...maria, wallet: ME } })), /your own/);
  refused(buildPlan({ action: "gift", params: { recipient_id: "maria", usdc: "5", box: "one_stock", asset: "mNVDA" } }, ctx({ recipient: { ...maria, typed: true } })), /Stackday ID or username/);
});

test("send by ID: USDC to their wallet (from wallet or vault), an asset into their own vault, at most 100 USDC", () => {
  const intent = (over: Record<string, unknown>) => ({ action: "send", params: { to: { kind: "id", id: "maria" }, asset: "USDC", amount: "5", unit: "usdc", from: "wallet", ...over } }) as Intent;
  const c = ctx({ recipient: maria, vaultUsdc: usd(50), positions: positions({ mNVDA: { idle: tokens(1, 8) } }) });
  const w = ok(buildPlan(intent({}), c));
  assert.deepEqual(w.calls.map((x) => [x.address, x.functionName, x.args]), [[ADDR.usdc, "transfer", [MARIA, usd(5)]]]);
  assert.equal(w.headline, "You send 5.00 USDC to @maria (SD-7KQ2M9XA)");
  assert.deepEqual(w.destination, { kind: "recipient", address: MARIA, name: "@maria", id: "SD-7KQ2M9XA" });
  assert.ok(w.notes.includes("Sends cannot be undone."));
  const v = ok(buildPlan(intent({ from: "vault" }), c));
  assert.deepEqual(v.calls.map((x) => [x.address, x.functionName, x.args]), [[VAULT, "withdraw", [ADDR.usdc, usd(5), MARIA]]]);
  const stock = ok(buildPlan(intent({ asset: "mNVDA", amount: "0.01", unit: "tokens", from: "vault" }), c));
  assert.deepEqual(stock.calls[0].args, [asset("mNVDA").token, tokens(0.01, 8), MARIA_VAULT]);
  assert.equal(stock.destination.address, MARIA_VAULT);
  refused(buildPlan(intent({ asset: "mNVDA", amount: "0.01", unit: "tokens", from: "vault" }), ctx({ recipient: { ...maria, vault: undefined }, positions: positions({ mNVDA: { idle: tokens(1, 8) } }) })), /no Stackday vault/);
  refused(buildPlan(intent({ amount: "100.01" }), ctx({ recipient: maria })), /at most 100 test USDC/);
  ok(buildPlan(intent({ amount: "100" }), ctx({ recipient: maria })));
  refused(buildPlan(intent({ asset: "mNVDA", amount: "1", unit: "tokens", from: "vault" }), c), /at most 100/);
  refused(buildPlan(intent({}), ctx({ recipient: { ...maria, wallet: ME } })), /your own/);
  refused(buildPlan(intent({}), ctx({ recipient: { ...maria, wallet: ADDR.router } })), /contract, not a person/);
  refused(buildPlan(intent({}), ctx({ recipient: { ...maria, typed: true } })), /changed/);
  // The send limit is named first, before the balance, so the person learns the limit.
  refused(buildPlan(intent({ amount: "2000" }), ctx({ recipient: maria, walletUsdc: usd(1) })), /at most 100/);
  refused(buildPlan(intent({ amount: "50" }), ctx({ recipient: maria, walletUsdc: usd(1) })), /wallet has 1\.00 USDC\./);
});

test("send to a typed address: the token goes straight there, with the confirm suffix and the leaves-Stackday note", () => {
  const typed = { ok: true as const, typed: true, wallet: TYPED };
  const c = ctx({ recipient: typed, positions: positions({ mNVDA: { idle: tokens(1, 8) } }) });
  const plan = ok(buildPlan({ action: "send", params: { to: { kind: "typed_address" }, asset: "mNVDA", amount: "0.01", unit: "tokens", from: "vault" } }, c));
  assert.deepEqual(plan.calls[0].args, [asset("mNVDA").token, tokens(0.01, 8), TYPED]);
  assert.equal(plan.destination.confirmSuffix, "169EE7");
  assert.equal(plan.destination.address, TYPED);
  assert.ok(plan.notes.includes("Sends cannot be undone. Check the full address."));
  assert.ok(plan.notes.some((n) => /leave Stackday/.test(n)));
  assert.equal(plan.rows[0].value, TYPED);
  refused(buildPlan({ action: "send", params: { to: { kind: "typed_address" }, asset: "USDC", amount: "1", unit: "usdc", from: "wallet" } }, ctx({ recipient: { ok: false, reason: "Your message has more than one address." } })), /more than one/);
  refused(buildPlan({ action: "send", params: { to: { kind: "typed_address" }, asset: "USDC", amount: "1", unit: "usdc", from: "wallet" } }, ctx()), /Could not look up/);
});

test("allowlist: only the one resolved recipient is accepted as an extra address", () => {
  const call: Call = { label: "x", address: ADDR.usdc, abi: vaultAbi, functionName: "transfer", args: [MARIA, 1n] };
  assert.match(checkCalls([call], ctx())!, /outside the allowlist/);
  assert.equal(checkCalls([call], ctx(), [MARIA]), null);
  assert.match(checkCalls([{ ...call, args: [ATTACKER, 1n] }], ctx(), [MARIA])!, /outside the allowlist/);
  assert.match(checkCalls([{ ...call, address: MARIA }], ctx(), [MARIA])!, /call to an address outside/);
});
