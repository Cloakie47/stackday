import { test } from "node:test";
import assert from "node:assert/strict";
import { ASSETS } from "../contracts.ts";
import sampleWeekly from "../research/sample-weekly.json" with { type: "json" };
import type { WeeklyReport } from "../research/types.ts";
import { earningText, loanText, portfolioText, pricesText, weeklyAnswer, type Snapshot } from "./summary.ts";
import { tokens, usd } from "./test-fixtures.ts";

const ADDRESS = /0x[0-9a-fA-F]{40}/;

function snap(): Snapshot {
  return {
    hasVault: true,
    walletUsdc: usd(120),
    vaultUsdc: usd(3),
    borrowCapBps: 5000n,
    holdings: ASSETS.map((asset) => ({
      asset,
      price: asset.startPrice,
      priceUpdatedAt: 1_800_000_000n,
      idle: asset.symbol === "mPAXG" ? tokens(0.01, 18) : 0n,
      wallet: 0n,
      collateral: asset.symbol === "mAAPL" ? tokens(1, 8) : 0n,
      debt: asset.symbol === "mAAPL" ? usd(50) : 0n,
      fee: asset.symbol === "mAAPL" ? usd(0.02) : 0n,
      maxDebt: asset.symbol === "mAAPL" ? usd(223.125) : 0n,
      health: asset.symbol === "mAAPL" ? (223_125n * 10n ** 18n) / 50_000n : undefined,
      liquidity: undefined,
    })),
  };
}

test("earning: the model can answer how much is earning, the interest so far and the fee", () => {
  const s = { ...snap(), earnAvailable: true, earning: { balance: usd(10.5), principal: usd(10), feeOwed: usd(0.01) } };
  const text = portfolioText(s);
  assert.match(text, /Earning interest \(MOCK venue on testnet\): 10\.50 USDC now, of which 10\.00 USDC put in and 0\.50 USDC interest so far\. Stackday earn fee owed: 0\.01 USDC/);
  assert.match(earningText({ ...snap(), earnAvailable: false }), /not available/);
  assert.match(earningText({ ...snap(), earnAvailable: true }), /nothing earning/);
  assert.ok(!ADDRESS.test(text));
});

test("portfolio text uses each asset's own decimals and never contains an address", () => {
  const t = portfolioText(snap());
  assert.match(t, /mPAXG \(Gold\): vault 0\.01 free/);
  assert.match(t, /mAAPL \(Apple\): vault 0 free, 1 locked, worth 357\.00 USDC; loan 50\.00 USDC plus 0\.02 USDC Stackday fee, health 4\.46/);
  assert.match(t, /testnet/);
  assert.ok(!ADDRESS.test(t));
});

test("loan text gives health, the fall it survives and the liquidation price", () => {
  const t = loanText(snap(), "mAAPL");
  assert.match(t, /Health 4\.46/);
  assert.match(t, /Liquidation price: \$80\.00/);
  assert.match(loanText(snap(), "mTSLA"), /invest only/);
});

test("prices are labelled as mock test prices", () => {
  assert.match(pricesText(snap(), ["mAAPL"]), /Mock test prices/);
});

test("weekly view: none approved means no view; an approved report gives notes with its date and disclaimer", () => {
  assert.equal(weeklyAnswer(null, "mPAXG").notes.length, 0);
  assert.match(weeklyAnswer(null, "mPAXG").text, /no approved/);
  const report = sampleWeekly as unknown as WeeklyReport;
  const gold = weeklyAnswer(report, "mPAXG");
  if (report.assets.some((a) => a.assetId === "mPAXG" && a.status === "ok")) {
    assert.equal(gold.notes[0].weekOf, report.weekOf);
    assert.ok(gold.notes[0].disclaimer.length > 20);
  }
  assert.match(weeklyAnswer(report, "mTSLA").text, /covers Bitcoin, Ether, Gold, NVIDIA, Apple and the S&P 500 only/);
});
