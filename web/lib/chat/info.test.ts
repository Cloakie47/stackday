import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, maxBorrowAt, usdcText, type BuildContext, type PositionLike } from "./buildCalls.ts";
import { COMMANDS, parseCommand } from "./commands.ts";
import { balanceView, borrowMaxView, buildContextOf, heldSymbols, helpView, positionsView, tickerView, type InfoContext } from "./info.ts";
import { CARD_CAP_UNITS } from "./intent.ts";
import { ctx, ME, positions, tokens, usd, VAULT } from "./test-fixtures.ts";

const info = (pos: PositionLike[] = positions(), over: Partial<InfoContext> = {}): InfoContext => ({
  me: ME,
  vault: VAULT,
  predictedVault: VAULT,
  positions: pos,
  borrowCapBps: 5000n,
  walletUsdc: usd(1234.5),
  vaultUsdc: usd(5),
  earning: usd(20.25),
  nowSec: 1_800_000_000,
  ...over,
});
const nvda = (c: BuildContext) => c.positions.find((p) => p.asset.symbol === "mNVDA")!;
const accepts = (c: BuildContext, units: bigint, risk: "low" | "mid" | "high") => buildPlan({ action: "borrow", params: { asset: "mNVDA", usdc: usdcText(units), risk } }, c).ok;

test("maxBorrowAt: nothing without collateral, a price, or for an invest-only asset", () => {
  const c = ctx();
  for (const r of ["low", "mid", "high"] as const) assert.equal(maxBorrowAt(nvda(c), c, r), 0n);
  const noPrice = ctx({ positions: positions({ mNVDA: { idle: tokens(1, 8), price: undefined } }) });
  assert.equal(maxBorrowAt(nvda(noPrice), noPrice, "mid"), 0n);
  const tsla = ctx({ positions: positions({ mTSLA: { idle: tokens(10, 8) } }) });
  assert.equal(maxBorrowAt(tsla.positions.find((p) => p.asset.symbol === "mTSLA")!, tsla, "mid"), 0n);
});

test("maxBorrowAt: the most each level's card accepts, low below mid below high, and a cent more is refused", () => {
  // 1 NVIDIA at 190, LLTV 62.5%: liquidation limit 118.75.
  const c = ctx({ positions: positions({ mNVDA: { idle: tokens(1, 8) } }) });
  const low = maxBorrowAt(nvda(c), c, "low");
  const mid = maxBorrowAt(nvda(c), c, "mid");
  const high = maxBorrowAt(nvda(c), c, "high");
  assert.ok(low > 0n && low < mid && mid < high, `${low} ${mid} ${high}`);
  for (const [risk, v] of [["low", low], ["mid", mid], ["high", high]] as const) {
    assert.equal(accepts(c, v, risk), true, risk);
    assert.equal(accepts(c, v + 20_000n, risk), false, `${risk} + 2 cents`);
  }
  // About 30%, 50% and 65% of 118.75, less the 1% buffer.
  assert.ok(low >= usd(35) && low <= usd(35.3), `${low}`);
  assert.ok(mid >= usd(58.5) && mid <= usd(58.8), `${mid}`);
});

test("maxBorrowAt: a debt above the level leaves nothing at that level", () => {
  // Debt 50 against 118.75: above Low (35.6), below Mid (59.4).
  const c = ctx({ positions: positions({ mNVDA: { collateral: tokens(1, 8), debt: usd(50) } }) });
  assert.equal(maxBorrowAt(nvda(c), c, "low"), 0n);
  const mid = maxBorrowAt(nvda(c), c, "mid");
  assert.ok(mid > 0n && mid < usd(10), `${mid}`);
  assert.equal(accepts(c, mid, "mid"), true);
});

test("maxBorrowAt: limited by market liquidity and by the card cap", () => {
  const thin = ctx({ positions: positions({ mNVDA: { idle: tokens(1, 8), liquidity: usd(4.239) } }) });
  assert.equal(maxBorrowAt(nvda(thin), thin, "high"), usd(4.23));
  const rich = ctx({ positions: positions({ mNVDA: { idle: tokens(100, 8) } }) });
  assert.equal(maxBorrowAt(nvda(rich), rich, "mid"), CARD_CAP_UNITS);
  assert.equal(accepts(rich, CARD_CAP_UNITS, "mid"), true);
});

test("maxBorrowAt: High raises a lower vault cap to 65%, Mid stays inside the vault's own cap", () => {
  const low = ctx({ borrowCapBps: 3000n, positions: positions({ mNVDA: { idle: tokens(1, 8) } }) });
  const mid = maxBorrowAt(nvda(low), low, "mid");
  const high = maxBorrowAt(nvda(low), low, "high");
  // With a 30% cap, Mid is held to the cap (same as Low); High raises the cap.
  assert.equal(mid, maxBorrowAt(nvda(low), low, "low"));
  assert.ok(high > mid * 2n, `${high} ${mid}`);
  const plan = buildPlan({ action: "borrow", params: { asset: "mNVDA", usdc: usdcText(high), risk: "high" } }, low);
  assert.ok(plan.ok);
  assert.ok(plan.rows.some((r) => r.label === "Vault safety cap"));
});

test("balanceView and positionsView format the numbers", () => {
  assert.deepEqual(balanceView(info()), { kind: "balance", walletUsdc: "1,234.50 USDC", vaultUsdc: "5.00 USDC", earning: "20.25 USDC", total: "1,259.75 USDC" });
  const pos = positions({
    mNVDA: { idle: tokens(0.5, 8), collateral: tokens(1, 8), debt: usd(50), fee: usd(0.01) },
    mAAPL: { idle: tokens(0.1, 8) },
    mWETH: { wallet: tokens(1, 18) },
  });
  const v = positionsView(info(pos));
  assert.equal(v.kind, "positions");
  // Largest vault value first; wallet-only holdings are not in the vault list.
  assert.deepEqual(v.holdings, [
    { ticker: "NVDA", name: "NVIDIA", free: "0.5 NVDA", locked: "1 NVDA", value: "285.00 USDC" },
    { ticker: "AAPL", name: "Apple", free: "0.1 AAPL", locked: "0 AAPL", value: "35.70 USDC" },
  ]);
  // Health 118.75 / 50 = 2.375 (2.38); liquidation at 50 / 0.625 = 80.
  assert.deepEqual(v.loans, [{ ticker: "NVDA", owed: "50.01 USDC", health: 2.38, liquidationPrice: "$80.00" }]);
  assert.equal(v.earning, "20.25 USDC");
  assert.equal(v.total, "345.95 USDC");
  assert.deepEqual(positionsView(info()).holdings, []);
  assert.deepEqual(heldSymbols(pos), ["mAAPL", "mNVDA", "mWETH"]);
});

test("tickerView: price, holdings and code-built chips", () => {
  const pos = positions({ mNVDA: { idle: tokens(1, 8), wallet: tokens(0.5, 8), collateral: tokens(0.25, 8) } });
  const v = tickerView("mNVDA", info(pos))!;
  assert.equal(v.ticker, "NVDA");
  assert.equal(v.price, "$190.00");
  assert.equal(v.wallet, "0.5 NVDA");
  assert.equal(v.vault, "1 NVDA");
  assert.equal(v.locked, "0.25 NVDA");
  assert.equal(v.value, "332.50 USDC");
  assert.equal(v.borrowable, true);
  assert.deepEqual(v.chips.map((c) => [c.label, c.text, c.kind]), [
    ["Buy $20 of NVIDIA", "/buy $NVDA 20$", "action"],
    ["How much can I borrow against NVIDIA?", "/borrow $NVDA", "question"],
    ["This week's research on NVIDIA", "What does Stackday's research say about NVIDIA this week?", "question"],
  ]);
  // Every command chip parses to what it says.
  assert.equal((parseCommand(v.chips[0].text, { held: [] }) as { kind: string }).kind, "intent");
  const t = tickerView("mTSLA", info())!;
  assert.equal(t.borrowable, false);
  assert.ok(!t.chips.some((c) => c.text.startsWith("/borrow")));
  assert.equal(tickerView("mXYZ", info()), null);
  assert.equal(tickerView("mNVDA", info(positions({ mNVDA: { price: undefined } })))!.price, null);
});

test("borrowMaxView: three levels with exact chips, or notes and a reason", () => {
  const i = info(positions({ mNVDA: { idle: tokens(1, 8) } }));
  const v = borrowMaxView("mNVDA", i)!;
  assert.deepEqual(v.levels.map((l) => l.risk), ["low", "mid", "high"]);
  assert.equal(v.reason, undefined);
  const c = buildContextOf(i);
  for (const l of v.levels) {
    const max = maxBorrowAt(nvda(c), c, l.risk);
    assert.equal(l.max, `${usdcText(max).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} USDC`);
    assert.equal(l.chip!.text, `/borrow $NVDA ${usdcText(max)}$ ${l.risk}`);
    const r = parseCommand(l.chip!.text, { held: [] });
    assert.ok(r && r.kind === "intent");
    assert.equal(buildPlan(r.intent, c).ok, true, l.risk);
  }
  const none = borrowMaxView("mNVDA", info())!;
  assert.ok(none.levels.every((l) => l.chip === null && l.note));
  assert.match(none.reason!, /no NVIDIA yet/);
  const full = borrowMaxView("mNVDA", info(positions({ mNVDA: { collateral: tokens(1, 8), debt: usd(80) } })))!;
  assert.match(full.reason!, /already at or above/);
  const dry = borrowMaxView("mNVDA", info(positions({ mNVDA: { idle: tokens(1, 8), liquidity: 0n } })))!;
  assert.match(dry.reason!, /no USDC to lend/);
  const big = borrowMaxView("mNVDA", info(positions({ mNVDA: { idle: tokens(100, 8) } })))!;
  assert.match(big.levels[1].note!, /at most 500/);
  assert.match(borrowMaxView("mTSLA", info())!.reason!, /invest only/);
  assert.equal(borrowMaxView("mXYZ", info()), null);
});

test("helpView lists every command without em dashes", () => {
  const v = helpView(COMMANDS);
  assert.equal(v.commands.length, COMMANDS.length);
  assert.ok(v.commands.some((c) => c.name === "/send"));
  assert.ok(v.commands.find((c) => c.name === "/earn")!.aliases.includes("/lend"));
  for (const c of v.commands) assert.equal(parseCommand(c.example, { held: [], info: info(positions({ mNVDA: { idle: tokens(1, 8) } })) })?.kind !== "error", true, c.example);
});
