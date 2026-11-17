import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlan,
  CATALOG,
  checkPlan,
  MOCK_FOR,
  RISK_LEVELS,
  splitAmount,
  THEMES,
  toSipLegs,
  type RiskLevel,
} from "./index.ts";

// The 9 assets with a Stackday mock on Base Sepolia today: 7 stocks plus cbBTC and WETH.
const TESTNET = Object.keys(MOCK_FOR);
const EVERYTHING = CATALOG.map((a) => a.ticker);
const RISKS = Object.keys(RISK_LEVELS) as RiskLevel[];
const bpsOf = (plan: ReturnType<typeof buildPlan>, t: string) => plan.holdings.find((h) => h.ticker === t)?.bps ?? 0;

test("the testnet mocks match the deployment list", () => {
  assert.deepEqual(
    Object.values(MOCK_FOR).sort(),
    ["mAAPL", "mGOOGL", "mMETA", "mNVDA", "mSPCX", "mWETH", "mcbBTC"].sort(),
  );
});

// Since November 17, 2026 the testnet only has stocks with a real Morpho market (Tesla, Microsoft and
// Amazon were dropped), so AI and big tech share 4 stocks on testnet; the others are preview only.
test("testnet, Balanced, AI and big tech: 4 stocks, cbBTC and WETH, every cap kept", () => {
  const themes = ["ai-chips", "big-tech"];
  const plan = buildPlan({ themes, risk: "balanced", available: TESTNET });
  assert.deepEqual(checkPlan(plan, "balanced", themes), []);
  assert.deepEqual(
    plan.holdings.map((h) => [h.ticker, h.bps]),
    [["GOOGLc", 1401], ["METAc", 1401], ["AAPLc", 1197], ["NVDAc", 1197], ["cbBTC", 800], ["WETH", 400]],
  );
  assert.equal(plan.usdcBps, 3604);
  assert.ok(plan.previewOnly.includes("MSFTc"), "Microsoft has no testnet token now: preview only");
  assert.ok(plan.previewOnly.includes("INTCc"), "names without a testnet token are preview only");
  assert.ok(plan.notes.some((n) => /No single theme may go above 40%/.test(n)));
});

test("full universe: every risk level and theme mix keeps every cap", () => {
  const subsets: string[][] = [];
  for (let mask = 1; mask < 1 << THEMES.length; mask++) subsets.push(THEMES.filter((_, i) => mask & (1 << i)).map((t) => t.id));
  for (const risk of RISKS) {
    for (const themes of subsets) {
      const plan = buildPlan({ themes, risk, available: EVERYTHING });
      assert.deepEqual(checkPlan(plan, risk, themes), [], `${risk} ${themes.join("+")}`);
      assert.ok(plan.usdcBps >= RISK_LEVELS[risk].usdcFloor * 10_000);
    }
  }
});

test("random availability and value scores never break a cap (500 cases)", () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 500; i++) {
    const themes = THEMES.filter(() => rand() < 0.5).map((t) => t.id);
    const available = EVERYTHING.filter(() => rand() < 0.7);
    const valueScores = Object.fromEntries(EVERYTHING.map((t) => [t, rand() * 6 - 3]));
    const risk = RISKS[Math.floor(rand() * RISKS.length)];
    const plan = buildPlan({ themes, risk, available, valueScores });
    assert.deepEqual(checkPlan(plan, risk, themes), [], JSON.stringify({ themes, available, risk }));
    for (const h of plan.holdings) assert.ok(available.includes(h.ticker), "never buys something unavailable");
  }
});

test("the same input always gives the same plan", () => {
  const input = { themes: ["big-tech", "crypto-native"], risk: "bold" as const, available: EVERYTHING, valueScores: { AAPLc: 1.2 } };
  assert.deepEqual(buildPlan(input), buildPlan(input));
});

test("a cheap stock is tilted up, at most 25 percent, and an expensive one down", () => {
  const themes = ["big-tech"];
  const base = buildPlan({ themes, risk: "steady", available: EVERYTHING });
  const tilted = buildPlan({ themes, risk: "steady", available: EVERYTHING, valueScores: { AAPLc: 9, AMZNc: -2 } });
  assert.ok(bpsOf(tilted, "AAPLc") > bpsOf(base, "AAPLc"));
  assert.ok(bpsOf(tilted, "AMZNc") < bpsOf(base, "AMZNc"));
  assert.ok(bpsOf(tilted, "AAPLc") <= Math.ceil(bpsOf(base, "AAPLc") * 1.25) + 1, "score is clipped to +2, so at most +25%");
  assert.ok(tilted.holdings.find((h) => h.ticker === "AAPLc")!.why.some((w) => /Tilted up/.test(w)));
});

test("Steady keeps crypto at or under 10 percent even with the crypto theme", () => {
  const plan = buildPlan({ themes: ["crypto-native"], risk: "steady", available: EVERYTHING });
  const crypto = plan.holdings.filter((h) => ["cbBTC", "WETH", "MSTRc", "CRCLc"].includes(h.ticker)).reduce((s, h) => s + h.bps, 0);
  assert.ok(crypto <= 1000, `crypto ${crypto}`);
  assert.ok(plan.usdcBps >= 2000);
});

test("risk-bucket names only appear for risk levels with a bucket, each at most 2.5 percent", () => {
  const themes = ["future-movers", "ai-chips"];
  assert.equal(bpsOf(buildPlan({ themes, risk: "steady", available: EVERYTHING }), "SPCXc"), 0);
  const bold = buildPlan({ themes, risk: "bold", available: EVERYTHING });
  assert.equal(bpsOf(bold, "SPCXc"), 250);
  assert.ok(bpsOf(bold, "SNDKc") > 0 && bpsOf(bold, "SNDKc") <= 250);
});

test("one theme alone is held to the 40 percent theme cap, and the plan says so", () => {
  const plan = buildPlan({ themes: ["big-tech"], risk: "balanced", available: EVERYTHING });
  const stocks = plan.holdings.filter((h) => h.sleeve === "stocks").reduce((s, h) => s + h.bps, 0);
  assert.ok(stocks <= 4000);
  assert.ok(plan.notes.some((n) => /No single theme may go above 40%/.test(n)));
});

test("no theme picked: nothing is bought", () => {
  const plan = buildPlan({ themes: [], risk: "balanced", available: EVERYTHING });
  assert.equal(plan.holdings.length, 0);
  assert.equal(plan.usdcBps, 10_000);
  assert.equal(buildPlan({ themes: ["not-a-theme"], risk: "balanced", available: EVERYTHING }).usdcBps, 10_000);
});

test("payday legs: a 20 percent share is split across at most 6 assets, the rest is paid as USDC", () => {
  const plan = buildPlan({ themes: ["ai-chips", "big-tech", "crypto-native"], risk: "bold", available: EVERYTHING });
  assert.ok(plan.holdings.length > 6);
  const legs = toSipLegs(plan, 2000);
  assert.ok(legs.tickers.length <= 6);
  assert.equal(legs.tickers.length, legs.bps.length);
  const invested = legs.bps.reduce((s, b) => s + b, 0);
  assert.ok(invested <= 2000);
  assert.equal(legs.cashBps, 10_000 - invested);
  assert.ok(legs.dropped.length > 0);
  for (const d of legs.dropped) assert.ok(!legs.tickers.includes(d));
  assert.throws(() => toSipLegs(plan, 10_001));
  assert.deepEqual(toSipLegs(plan, 0).tickers, []);
});

test("payday legs on testnet match the plan", () => {
  const plan = buildPlan({ themes: ["ai-chips", "big-tech"], risk: "balanced", available: TESTNET });
  const legs = toSipLegs(plan, 2000);
  // 6 holdings: all fit in a payday plan (at most 6 assets), nothing is left out.
  assert.deepEqual(legs.tickers, ["GOOGLc", "METAc", "AAPLc", "NVDAc", "cbBTC", "WETH"]);
  assert.deepEqual(legs.bps, [280, 280, 239, 239, 160, 80]);
  assert.deepEqual(legs.dropped, []);
  assert.equal(legs.cashBps, 8722);
});

test("splitting a USDC amount never spends more than the amount", () => {
  const plan = buildPlan({ themes: ["big-tech"], risk: "balanced", available: EVERYTHING });
  const { buys, cash } = splitAmount(plan, 100_000_000n);
  assert.equal(buys.reduce((s, b) => s + b.usdc, 0n) + cash, 100_000_000n);
  assert.ok(cash >= (100_000_000n * BigInt(plan.usdcBps)) / 10_000n);
});
