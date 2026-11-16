import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateToGaps,
  assetOf,
  buildPlan,
  CATALOG,
  drift,
  needsProposal,
  proposalToSipLegs,
  proposeNewMoney,
  RISK_LEVELS,
  THEMES,
  toSipLegs,
  type Plan,
  type RiskLevel,
} from "./index.ts";

// A fixed 4-asset list (the first testnet deployment), so these numbers do not move when the deployment grows.
const TESTNET = ["AAPLc", "NVDAc", "cbBTC", "WETH"];
const EVERYTHING = CATALOG.map((a) => a.ticker);
const RISKS = Object.keys(RISK_LEVELS) as RiskLevel[];

/** A hand-built plan: [ticker, bps] pairs plus the USDC cushion. */
function mkPlan(holdings: [string, number][], usdcBps: number): Plan {
  return {
    holdings: holdings.map(([ticker, bps]) => ({ ticker, name: assetOf(ticker)?.name ?? ticker, sleeve: "stocks", bps, themes: [], why: [] })),
    usdcBps,
    previewOnly: [],
    notes: [],
  };
}
const buyOf = (p: ReturnType<typeof proposeNewMoney>, t: string) => p.buys.find((b) => b.ticker === t)?.usd ?? 0;
const rowOf = (rows: ReturnType<typeof drift>, t: string) => rows.find((r) => r.ticker === t)!;
const cents = (x: number) => Math.round(x * 100);
const spentPlusCash = (p: ReturnType<typeof proposeNewMoney>) => cents(p.buys.reduce((s, b) => s + b.usd, 0) + p.cashUsd);

test("new money goes only to holdings below target, with a plain reason", () => {
  const plan = mkPlan([["NVDAc", 4000], ["AAPLc", 4000]], 2000);
  const p = proposeNewMoney({ plan, holdingsUsd: { NVDAc: 600, AAPLc: 200 }, cashUsd: 200, newMoneyUsd: 100 });
  assert.deepEqual(p.buys.map((b) => b.ticker), ["AAPLc"]);
  // Total after = 1100. Apple's gap is 440 - 200 = 240, the cushion's is 220 - 200 = 20: money is short, split 240 to 20.
  assert.equal(buyOf(p, "AAPLc"), 92.3);
  assert.equal(p.cashUsd, 7.7);
  assert.match(p.buys[0].reason, /^Apple is 20\.0 points under target$/);
  assert.ok(p.why.some((w) => /NVIDIA is 20\.0 points over target, so it gets no new money/.test(w)));
  assert.ok(p.why.some((w) => /nothing is sold/.test(w)));
  assert.equal(spentPlusCash(p), cents(100));
});

test("when money is short, each gap gets the same fraction", () => {
  const plan = mkPlan([["NVDAc", 3000], ["AAPLc", 3000], ["cbBTC", 2000]], 2000);
  const holdingsUsd = { NVDAc: 100, AAPLc: 300, cbBTC: 200 };
  const p = proposeNewMoney({ plan, holdingsUsd, cashUsd: 400, newMoneyUsd: 100, minTradeUsd: 0 });
  // Total after = 1100. Gaps: NVIDIA 330 - 100 = 230, Apple 30, Bitcoin 20; the cushion (400 vs 220) is over.
  const gaps: Record<string, number> = { NVDAc: 230, AAPLc: 30, cbBTC: 20 };
  for (const [t, g] of Object.entries(gaps)) {
    assert.ok(Math.abs(buyOf(p, t) - (100 * g) / 280) < 0.011, `${t} gets ${buyOf(p, t)}`);
    assert.ok(buyOf(p, t) <= g);
  }
  assert.ok(p.why.some((w) => /Not enough new money to close every gap/.test(w)));
  assert.ok(p.cashUsd < 0.05, "only rounding dust stays as cash");
});

test("money left after every gap is closed follows the plan weights, never an overweight one", () => {
  const { amounts, unplaced } = allocateToGaps(
    [
      { key: "A", gap: 10, weight: 0.5, overweight: false },
      { key: "B", gap: 0, weight: 0.3, overweight: false },
      { key: "C", gap: 0, weight: 0.2, overweight: true },
    ],
    30,
  );
  assert.equal(amounts.A, 10 + (20 * 0.5) / 0.8);
  assert.equal(amounts.B, (20 * 0.3) / 0.8);
  assert.equal(amounts.C, 0);
  assert.equal(unplaced, 0);
  // Nobody can take the extra: it is handed back, not forced on an overweight holding.
  const none = allocateToGaps([{ key: "C", gap: 0, weight: 1, overweight: true }], 30);
  assert.equal(none.amounts.C, 0);
  assert.equal(none.unplaced, 30);
});

test("against the plan, targets add up to the new total, so every dollar is placed or kept as cash", () => {
  const plan = buildPlan({ themes: ["ai-chips", "big-tech"], risk: "balanced", available: TESTNET });
  // Everything already on target: the new money is split exactly like the plan.
  const p = proposeNewMoney({ plan, holdingsUsd: { NVDAc: 150, AAPLc: 150, cbBTC: 80, WETH: 40 }, cashUsd: 580, newMoneyUsd: 100 });
  assert.deepEqual(
    p.buys.map((b) => [b.ticker, b.usd]),
    [["AAPLc", 15], ["NVDAc", 15], ["cbBTC", 8]],
  );
  // Ether would get $4, below the $5 minimum.
  assert.equal(p.cashUsd, 62);
  assert.ok(p.why.some((w) => /Ether would get only \$4\.00, below the \$5\.00 minimum/.test(w)));
  assert.ok(p.buys.every((b) => /Keeps .* near its .* target/.test(b.reason)));
});

test("an overweight holding is never bought (property check, 400 cases)", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 400; i++) {
    const themes = THEMES.filter(() => rand() < 0.5).map((t) => t.id);
    const risk = RISKS[Math.floor(rand() * RISKS.length)];
    const plan = buildPlan({ themes, risk, available: EVERYTHING });
    const holdingsUsd: Record<string, number> = {};
    for (const t of EVERYTHING) if (rand() < 0.6) holdingsUsd[t] = Math.round(rand() * 50_000) / 100;
    const cashUsd = Math.round(rand() * 20_000) / 100;
    const newMoneyUsd = Math.round(rand() * 100_000) / 100;
    const p = proposeNewMoney({ plan, holdingsUsd, cashUsd, newMoneyUsd });
    const total = Object.values(holdingsUsd).reduce((s, v) => s + v, 0) + cashUsd + newMoneyUsd;
    const inPlan = new Set(plan.holdings.map((h) => h.ticker));
    for (const b of p.buys) {
      assert.ok(inPlan.has(b.ticker), "only plan holdings are bought");
      const target = (plan.holdings.find((h) => h.ticker === b.ticker)!.bps / 10_000) * total;
      const now = holdingsUsd[b.ticker] ?? 0;
      assert.ok(now <= target + 1e-6, `${b.ticker} was over target and still bought`);
      assert.ok(now + b.usd <= target + 0.01, `${b.ticker} bought past its target`);
      assert.ok(b.usd >= 5);
    }
    assert.ok(p.buys.length <= 6);
    assert.ok(p.cashUsd >= 0);
    assert.equal(spentPlusCash(p), cents(newMoneyUsd));
  }
});

test("buys under the minimum stay as cash; exactly the minimum is kept", () => {
  const plan = mkPlan([["NVDAc", 4500], ["AAPLc", 4500], ["cbBTC", 1000]], 0);
  const small = proposeNewMoney({ plan, holdingsUsd: {}, cashUsd: 0, newMoneyUsd: 40 });
  assert.deepEqual(small.buys.map((b) => b.ticker), ["AAPLc", "NVDAc"]);
  assert.equal(small.cashUsd, 4);
  const edge = proposeNewMoney({ plan, holdingsUsd: {}, cashUsd: 0, newMoneyUsd: 50 });
  assert.equal(buyOf(edge, "cbBTC"), 5);
  assert.equal(edge.cashUsd, 0);
  const custom = proposeNewMoney({ plan, holdingsUsd: {}, cashUsd: 0, newMoneyUsd: 50, minTradeUsd: 25 });
  assert.equal(custom.buys.length, 0, "22.50 each is below a $25 minimum");
  assert.equal(custom.cashUsd, 50);
});

test("at most 6 assets: the largest buys win, the rest stays as cash", () => {
  const plan = mkPlan(
    [["NVDAc", 1500], ["AAPLc", 1400], ["MSFTc", 1300], ["AMZNc", 1200], ["GOOGLc", 1100], ["METAc", 1000], ["cbBTC", 900], ["WETH", 800]],
    800,
  );
  const p = proposeNewMoney({ plan, holdingsUsd: {}, cashUsd: 0, newMoneyUsd: 1000 });
  assert.deepEqual(p.buys.map((b) => b.ticker), ["NVDAc", "AAPLc", "MSFTc", "AMZNc", "GOOGLc", "METAc"]);
  assert.equal(p.cashUsd, 90 + 80 + 80);
  assert.ok(p.why.some((w) => /Only 6 assets fit in one plan, so the parts for cbBTC, Ether stay as USDC/.test(w)));
  const three = proposeNewMoney({ plan, holdingsUsd: {}, cashUsd: 0, newMoneyUsd: 1000, maxLegs: 3 });
  assert.equal(three.buys.length, 3);
  const legs = proposalToSipLegs(proposeNewMoney({ plan, holdingsUsd: {}, cashUsd: 0, newMoneyUsd: 1000, maxLegs: 8 }), 2000);
  assert.equal(legs.tickers.length, 6, "Payroll legs never go above 6 even if the proposal has more");
});

test("the cushion counts as a holding: money for it is kept as USDC, not invested", () => {
  const plan = buildPlan({ themes: ["ai-chips", "big-tech"], risk: "balanced", available: TESTNET });
  assert.equal(plan.usdcBps, 5800);
  // Every stock and coin is over target once the cushion is counted, so all new money tops up the cushion.
  const p = proposeNewMoney({ plan, holdingsUsd: { NVDAc: 150, AAPLc: 150, cbBTC: 80, WETH: 40 }, cashUsd: 0, newMoneyUsd: 100 });
  assert.equal(p.buys.length, 0);
  assert.equal(p.cashUsd, 100);
  assert.ok(p.why.some((w) => /\$100\.00 stays as USDC to keep the cushion near its 58% target/.test(w)));
  assert.ok(rowOf(p.after, "USDC").currentShare > rowOf(p.before, "USDC").currentShare);
});

test("drift 5/25 rule: exactly 5 points is in band, just over is out", () => {
  const plan = mkPlan([["NVDAc", 3000]], 7000);
  const edge = drift(plan, { NVDAc: 350 }, 650);
  assert.equal(rowOf(edge, "NVDAc").outOfBand, false);
  assert.equal(rowOf(edge, "USDC").outOfBand, false);
  assert.ok(Math.abs(rowOf(edge, "NVDAc").diffPts - 5) < 1e-9);
  assert.equal(needsProposal(edge), false);
  const over = drift(plan, { NVDAc: 351 }, 649);
  assert.equal(rowOf(over, "NVDAc").outOfBand, true);
  assert.equal(rowOf(over, "USDC").outOfBand, true);
  assert.equal(needsProposal(over), true);
});

test("drift 5/25 rule: exactly 25 percent of a small target is in band, just over is out", () => {
  const plan = mkPlan([["AAPLc", 1000]], 9000);
  const edge = drift(plan, { AAPLc: 125 }, 875);
  assert.equal(rowOf(edge, "AAPLc").outOfBand, false, "2.5 points on a 10% target is exactly 25%");
  assert.equal(needsProposal(edge), false);
  const over = drift(plan, { AAPLc: 126 }, 874);
  assert.equal(rowOf(over, "AAPLc").outOfBand, true, "2.6 points is under 5 but over 25% of 10%");
  assert.equal(rowOf(over, "USDC").outOfBand, false);
  assert.equal(needsProposal(over), true);
  const under = drift(plan, { AAPLc: 74 }, 926);
  assert.equal(rowOf(under, "AAPLc").outOfBand, true);
  assert.ok(rowOf(under, "AAPLc").diffPts < 0);
});

test("holdings outside the plan show as target 0 and are never bought", () => {
  const plan = mkPlan([["NVDAc", 5000]], 5000);
  const rows = drift(plan, { NVDAc: 460, TSLAc: 40, METAc: 0 }, 500);
  const tsla = rowOf(rows, "TSLAc");
  assert.equal(tsla.kind, "outside");
  assert.equal(tsla.name, "Tesla");
  assert.equal(tsla.targetShare, 0);
  assert.ok(Math.abs(tsla.currentShare - 0.04) < 1e-12);
  assert.equal(tsla.outOfBand, false, "4 points off a 0 target is inside the 5-point band");
  assert.equal(rows.find((r) => r.ticker === "METAc"), undefined, "a zero balance is not listed");
  assert.deepEqual(rows.map((r) => r.kind), ["holding", "outside", "cash"]);
  assert.equal(rowOf(drift(plan, { NVDAc: 440, TSLAc: 60 }, 500), "TSLAc").outOfBand, true);
  const p = proposeNewMoney({ plan, holdingsUsd: { NVDAc: 400, TSLAc: 100 }, cashUsd: 500, newMoneyUsd: 200 });
  assert.equal(buyOf(p, "TSLAc"), 0);
  assert.ok(p.why.some((w) => /Tesla is not in your plan\. It is kept \(nothing is sold\)/.test(w)));
});

test("payday legs never exceed the investing share and hold at most 6 assets", () => {
  let seed = 99;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 300; i++) {
    const themes = THEMES.filter(() => rand() < 0.6).map((t) => t.id);
    const plan = buildPlan({ themes, risk: RISKS[i % RISKS.length], available: EVERYTHING });
    const holdingsUsd: Record<string, number> = {};
    for (const t of EVERYTHING) if (rand() < 0.5) holdingsUsd[t] = Math.round(rand() * 30_000) / 100;
    const p = proposeNewMoney({ plan, holdingsUsd, cashUsd: Math.round(rand() * 5_000) / 100, newMoneyUsd: Math.round(rand() * 80_000) / 100, maxLegs: 10 });
    const shareBps = Math.floor(rand() * 10_001);
    const legs = proposalToSipLegs(p, shareBps);
    const invested = legs.bps.reduce((s, b) => s + b, 0);
    assert.ok(invested <= shareBps, `${invested} > ${shareBps}`);
    assert.ok(legs.tickers.length <= 6);
    assert.equal(legs.tickers.length, legs.bps.length);
    assert.ok(legs.bps.every((b) => Number.isInteger(b) && b > 0));
    assert.equal(legs.cashBps, 10_000 - invested);
  }
  const p = proposeNewMoney({ plan: mkPlan([["NVDAc", 5000]], 5000), holdingsUsd: {}, cashUsd: 0, newMoneyUsd: 100 });
  assert.deepEqual(proposalToSipLegs(p, 2000), { tickers: ["NVDAc"], bps: [1000], cashBps: 9000 });
  assert.throws(() => proposalToSipLegs(p, 10_001));
  assert.throws(() => proposalToSipLegs(p, 1.5));
});

test("empty portfolio: the first buy is exactly the plan split", () => {
  const plan = buildPlan({ themes: ["ai-chips", "big-tech"], risk: "balanced", available: TESTNET });
  const p = proposeNewMoney({ plan, holdingsUsd: {}, cashUsd: 0, newMoneyUsd: 1000 });
  assert.deepEqual(
    p.buys.map((b) => [b.ticker, b.usd]),
    plan.holdings.map((h) => [h.ticker, (h.bps / 10_000) * 1000]).sort((a, b) => (b[1] as number) - (a[1] as number) || String(a[0]).localeCompare(String(b[0]))),
  );
  assert.equal(p.cashUsd, (plan.usdcBps / 10_000) * 1000);
  assert.ok(needsProposal(p.before), "an empty portfolio is out of band against any plan");
  assert.equal(needsProposal(p.after), false, "after the first buy it matches the plan");
  const legs = proposalToSipLegs(p, 2000);
  const planLegs = toSipLegs(plan, 2000);
  assert.deepEqual(legs, { tickers: planLegs.tickers, bps: planLegs.bps, cashBps: planLegs.cashBps });
});

test("zero new money gives no buys", () => {
  const plan = buildPlan({ themes: ["ai-chips"], risk: "bold", available: TESTNET });
  const p = proposeNewMoney({ plan, holdingsUsd: { NVDAc: 500 }, cashUsd: 10, newMoneyUsd: 0 });
  assert.deepEqual(p.buys, []);
  assert.equal(p.cashUsd, 0);
  assert.deepEqual(p.after, p.before);
  assert.ok(p.why.some((w) => /No new money/.test(w)));
  assert.deepEqual(proposalToSipLegs(p, 2000), { tickers: [], bps: [], cashBps: 10_000 });
  assert.throws(() => proposeNewMoney({ plan, holdingsUsd: {}, cashUsd: 0, newMoneyUsd: -1 }));
  assert.throws(() => proposeNewMoney({ plan, holdingsUsd: { NVDAc: Number.NaN }, cashUsd: 0, newMoneyUsd: 10 }));
});

test("drift and proposals are deterministic", () => {
  const plan = buildPlan({ themes: ["big-tech", "crypto-native"], risk: "bold", available: EVERYTHING });
  const input = { plan, holdingsUsd: { AAPLc: 300, cbBTC: 120, TSLAc: 50, WETH: 10 }, cashUsd: 40, newMoneyUsd: 250 };
  assert.deepEqual(proposeNewMoney(input), proposeNewMoney(input));
  assert.deepEqual(proposeNewMoney({ ...input, holdingsUsd: { WETH: 10, TSLAc: 50, cbBTC: 120, AAPLc: 300 } }), proposeNewMoney(input));
  assert.deepEqual(drift(plan, input.holdingsUsd, 40), drift(plan, input.holdingsUsd, 40));
});
