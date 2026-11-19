import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzePortfolio, capFor, diversificationScore, lastPrice, type PortfolioAnalysisResult } from "./analyze.ts";
import { makeNote, makeSnapshot, type NoteSpec } from "./fixtures.ts";
import type { Holding, PortfolioInput } from "../types.ts";
import { universeAsset } from "../universe.ts";

const h = (assetId: string, amount: number, origin: Holding["origin"] = "vault"): Holding => ({ assetId, amount, origin });
const input = (holdings: Holding[], extra: Partial<PortfolioInput> = {}): PortfolioInput => ({ holdings, horizon: "long", risk: "medium", ...extra });

// Ten priced fixture assets at round prices.
const NOTES: NoteSpec[] = [
  { assetId: "mAAPL", price: 100 },
  { assetId: "mNVDA", price: 100, action: "buy", stance: "positive" },
  { assetId: "mMSFT", price: 100 },
  { assetId: "mAMD", price: 100, action: "buy" },
  { assetId: "mGOOGL", price: 100 },
  { assetId: "mSPX", price: 100 },
  { assetId: "mSGOV", price: 100 },
  { assetId: "mPAXG", price: 100 },
  { assetId: "mcbBTC", price: 100, action: "buy" },
  { assetId: "mWETH", price: 100 },
  { assetId: "mMSTR", price: 100 },
  { assetId: "mTSLA", price: 100, action: "sell", stance: "negative" },
  { assetId: "mSPCX" }, // no public price
];
const SNAP = makeSnapshot(NOTES);

/** Every fact id cited anywhere in the analysis exists in `facts`. */
function assertCitationsResolve(a: PortfolioAnalysisResult) {
  const ids = new Set(a.facts.map((f) => f.id));
  const all = [...a.concentration, ...a.overlaps, ...a.rebalanceIdeas, ...a.holdings.map((x) => x.why)];
  for (const r of all) for (const id of r.factIds) assert.ok(ids.has(id), `cited fact ${id} is missing: "${r.text}"`);
  assert.equal(ids.size, a.facts.length, "fact ids are unique");
}

function assertNeverSells(a: PortfolioAnalysisResult) {
  const texts = [...a.concentration, ...a.rebalanceIdeas, ...a.holdings.map((x) => x.why)].map((r) => r.text.toLowerCase());
  for (const t of texts) {
    // "sell" only ever appears in negations ("never sells", "nothing is sold") or quoting the note's action.
    const cleaned = t.replace(/never sells?/g, "").replace(/suggests sell/g, "");
    assert.ok(!/\bsell\b/.test(cleaned), `text suggests selling: "${t}"`);
  }
}

test("prices come only from px.last facts; holdings without one are listed as unpriced", () => {
  const a = analyzePortfolio(input([h("mAAPL", 3), h("mSPCX", 5)]), SNAP);
  assert.equal(a.totalUsd, 300);
  assert.equal(a.byAsset.length, 1);
  assert.deepEqual(a.unpriced.map((u) => u.assetId), ["mSPCX"]);
  assert.match(a.unpriced[0].why, /no price/);
  const px = a.facts.find((f) => f.id === "mAAPL:px.last");
  assert.equal(px?.value, 100);
  assert.equal(px?.source.name, "Test fixture (not market data)");
  assert.ok(a.health.parts.some((p) => p.label === "Not scored" && p.why.includes("SpaceX")));
  assertCitationsResolve(a);
});

test("an asset missing from the snapshot, or with a bad price, is unpriced and never guessed", () => {
  const snap = makeSnapshot([{ assetId: "mAAPL", price: 100 }, { assetId: "mNVDA", price: -5 }]);
  const a = analyzePortfolio(input([h("mAAPL", 1), h("mNVDA", 1), h("mAMZN", 1)]), snap);
  assert.equal(a.totalUsd, 100);
  assert.deepEqual(a.unpriced.map((u) => u.assetId).sort(), ["mAMZN", "mNVDA"]);
  assert.match(a.unpriced.find((u) => u.assetId === "mAMZN")!.why, /Not in today's research snapshot/);
  assert.equal(lastPrice(makeNote({ assetId: "mAAPL" })), null);
  assert.equal(lastPrice(undefined), null);
});

test("holdings of the same asset are added together and amounts are cited as facts with their origin", () => {
  const a = analyzePortfolio(input([h("mAAPL", 1, "vault"), h("mAAPL", 2, "manual")]), SNAP);
  assert.equal(a.totalUsd, 300);
  assert.equal(a.byAsset.length, 1);
  assert.equal(a.facts.find((f) => f.id === "mAAPL:amount")?.value, 3);
});

test("allocation by asset, class, sector and risk adds up to the total and to 100 percent", () => {
  const a = analyzePortfolio(input([h("mAAPL", 2), h("mMSFT", 1), h("mSPX", 4), h("mcbBTC", 1), h("mPAXG", 2)]), SNAP);
  assert.equal(a.totalUsd, 1000);
  for (const s of [a.byAsset, a.byClass, a.bySector, a.byRisk]) {
    assert.ok(Math.abs(s.reduce((x, y) => x + y.valueUsd, 0) - 1000) < 1e-9);
    assert.ok(Math.abs(s.reduce((x, y) => x + y.share, 0) - 1) < 1e-9);
    for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].valueUsd >= s[i].valueUsd, "largest first");
  }
  assert.deepEqual(a.byClass.map((s) => s.key), ["fund", "stock", "commodity", "crypto"]);
  assert.equal(a.byClass[0].label, "Funds");
  assert.equal(a.bySector.find((s) => s.key === "Technology")?.valueUsd, 300);
  assert.equal(a.byRisk.find((s) => s.key === "core")?.share, 0.9);
  assert.equal(a.byAsset[0].label, "S&P 500");
});

test("diversification: 0 for one stock, 1 for a broad fund or ten equal holdings, in between otherwise", () => {
  assert.equal(diversificationScore([{ assetId: "mAAPL", share: 1 }]), 0);
  assert.equal(diversificationScore([{ assetId: "mSPX", share: 1 }]), 1);
  const ten = Array.from({ length: 10 }, (_, i) => ({ assetId: `x${i}`, share: 0.1 }));
  assert.equal(diversificationScore(ten), 1);
  const two = diversificationScore([{ assetId: "mAAPL", share: 0.5 }, { assetId: "mNVDA", share: 0.5 }]);
  assert.ok(two > 0 && two < 0.2, `two equal stocks gave ${two}`);
  assert.equal(diversificationScore([]), 0);
});

test("a single stock above 15 percent is flagged as a target for new buys, not a sale", () => {
  const a = analyzePortfolio(input([h("mAAPL", 5), h("mSPX", 5)]), SNAP);
  const flag = a.concentration.find((c) => c.text.startsWith("Apple"));
  assert.ok(flag, "Apple flagged");
  assert.match(flag!.text, /50% of your portfolio, above the 15% single-stock cap/);
  assert.match(flag!.text, /nothing is sold/);
  assert.equal(a.holdings.find((x) => x.assetId === "mAAPL")?.verdict, "trim-new-buys");
  assert.ok(!a.concentration.some((c) => c.text.startsWith("S&P 500")), "a broad fund has no single-asset cap");
  assertNeverSells(a);
  assertCitationsResolve(a);
});

test("the crypto cap follows the risk answer: 10% low, 25% medium and high", () => {
  const holdings = [h("mcbBTC", 2), h("mSPX", 8)]; // 20% crypto
  const low = analyzePortfolio(input(holdings, { risk: "low" }), SNAP);
  const med = analyzePortfolio(input(holdings, { risk: "medium" }), SNAP);
  assert.ok(low.concentration.some((c) => /above the 10% crypto cap/.test(c.text)));
  assert.ok(!med.concentration.some((c) => /crypto cap/.test(c.text)));
  assert.equal(capFor(universeAsset("mcbBTC")!, "high")?.cap, 0.25);
});

test("Strategy counts toward the crypto group and the tiny risk-bucket cap", () => {
  const a = analyzePortfolio(input([h("mMSTR", 1), h("mSPX", 9)]), SNAP);
  assert.ok(a.concentration.some((c) => /Strategy is 10% of your portfolio, above the 2.5% cap for a single risk-bucket name/.test(c.text)));
  assert.ok(!a.concentration.some((c) => /crypto cap/.test(c.text)), "10% crypto group is under the 25% cap");
});

test("crypto group over its cap is flagged with every member", () => {
  const a = analyzePortfolio(input([h("mMSTR", 1), h("mcbBTC", 2), h("mWETH", 1), h("mSPX", 6)]), SNAP);
  const flag = a.concentration.find((c) => /crypto cap/.test(c.text));
  assert.ok(flag);
  assert.match(flag!.text, /Strategy, Bitcoin, Ether/);
  assert.match(flag!.text, /40%/);
});

test("AI and chips cap counts NVIDIA, Microsoft and AMD together", () => {
  const a = analyzePortfolio(input([h("mNVDA", 14), h("mMSFT", 14), h("mAMD", 14), h("mSPX", 58)]), SNAP);
  assert.ok(a.concentration.some((c) => /AI and chip stocks \(NVIDIA, Microsoft, AMD\) make up 42% of your portfolio, above the 35% AI and chips cap/.test(c.text)));
  assert.ok(!a.concentration.some((c) => /single-stock cap/.test(c.text)));
});

test("the single-theme cap flags a theme above 40 percent", () => {
  const a = analyzePortfolio(input([h("mAAPL", 14), h("mMSFT", 14), h("mGOOGL", 14), h("mSPX", 58)]), SNAP);
  assert.ok(a.concentration.some((c) => /The Big tech core theme .* make up 42%/.test(c.text)));
});

test("overlap: the S&P 500 fund with its big holdings, and Strategy with bitcoin", () => {
  const a = analyzePortfolio(input([h("mSPX", 5), h("mAAPL", 1), h("mNVDA", 1), h("mMSTR", 1), h("mcbBTC", 2)]), SNAP);
  assert.equal(a.overlaps.length, 2);
  assert.match(a.overlaps[0].text, /already holds Apple, NVIDIA, which you also own directly \(20%\)/);
  assert.match(a.overlaps[1].text, /about 30% of your portfolio rides on the bitcoin price/);
  assert.ok(a.overlaps[0].factIds.includes("mSPX:px.last"));
  assertCitationsResolve(a);
  const none = analyzePortfolio(input([h("mSPX", 5), h("mPAXG", 1)]), SNAP);
  assert.equal(none.overlaps.length, 0);
});

test("verdicts follow the note's action, the horizon outlook, risk answer and caps", () => {
  const snap = makeSnapshot([
    { assetId: "mSPX", price: 100, action: "hold" },
    { assetId: "mNVDA", price: 100, action: "buy", stance: "positive" },
    { assetId: "mAMD", price: 100, action: "buy", stance: { "5y": "negative", "1m": "positive" } },
    { assetId: "mTSLA", price: 100, action: "sell" },
    { assetId: "mGOOGL", price: 100, action: "hold", stance: "negative" },
    { assetId: "mWETH", price: 100, action: "buy", stance: "positive" },
    { assetId: "mPAXG", price: 100, action: "watch", status: "no-reading" },
    { assetId: "mAAPL", price: 100, action: "hold", status: "carried" },
  ]);
  const holdings = [h("mSPX", 30), h("mNVDA", 10), h("mAMD", 10), h("mTSLA", 10), h("mGOOGL", 10), h("mWETH", 5), h("mPAXG", 10), h("mAAPL", 10)];
  const v = (a: PortfolioAnalysisResult, id: string) => a.holdings.find((x) => x.assetId === id)!;

  const long = analyzePortfolio(input(holdings, { horizon: "long", risk: "medium" }), snap);
  assert.equal(v(long, "mSPX").verdict, "keep");
  assert.equal(v(long, "mNVDA").verdict, "add-with-new-money");
  assert.equal(v(long, "mAMD").verdict, "keep", "buy with a negative 5y outlook is mixed");
  assert.equal(v(long, "mTSLA").verdict, "review");
  assert.match(v(long, "mTSLA").why.text, /never sells for you/);
  assert.equal(v(long, "mGOOGL").verdict, "review");
  assert.equal(v(long, "mWETH").verdict, "add-with-new-money");
  assert.equal(v(long, "mPAXG").verdict, "review");
  assert.equal(v(long, "mPAXG").action, "watch");
  assert.match(v(long, "mPAXG").why.text, /no research reading/);
  assert.match(v(long, "mAAPL").why.text, /carried from the last trading day/);

  const short = analyzePortfolio(input(holdings, { horizon: "short", risk: "low" }), snap);
  assert.equal(v(short, "mAMD").verdict, "add-with-new-money", "1m outlook is positive");
  assert.equal(v(short, "mWETH").verdict, "keep", "speculative asset for a low-risk answer");
  assert.match(v(short, "mWETH").why.text, /you chose low risk/);

  // Outlook fact ids are copied into the analysis under the asset prefix.
  assert.ok(v(long, "mNVDA").why.factIds.includes("mNVDA:ind.rsi14"));
  assertCitationsResolve(long);
  assertNeverSells(long);
});

test("rebalance ideas only place new money, never above a cap, and add up to at most the new money", () => {
  const a = analyzePortfolio(input([h("mAAPL", 40), h("mNVDA", 5), h("mAMD", 5), h("mSPX", 50)], { monthlyNewMoneyUsd: 1000 }), SNAP);
  assert.match(a.rebalanceIdeas[0].text, /New money only/);
  assert.ok(a.rebalanceIdeas.some((r) => /Skip new buys of Apple/.test(r.text)));
  const amounts = a.rebalanceIdeas
    .map((r) => /about \$([\d,.]+) could go to (\w+)/.exec(r.text))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ usd: Number(m[1].replace(/,/g, "")), name: m[2] }));
  assert.ok(amounts.length >= 1);
  assert.ok(amounts.every((x) => x.name !== "Apple"), "no new money to an over-cap holding");
  assert.ok(amounts.reduce((s, x) => s + x.usd, 0) <= 1000 + 1e-9);
  assert.deepEqual(amounts.map((x) => x.name).sort(), ["AMD", "NVIDIA"], "buy-rated holdings get the money");
  assertNeverSells(a);
  assertCitationsResolve(a);
});

test("without monthly new money the ideas name the smallest supported holdings; low risk suggests a cash-like fund", () => {
  const a = analyzePortfolio(input([h("mAAPL", 1), h("mGOOGL", 1), h("mSPX", 8)], { risk: "low" }), SNAP);
  assert.ok(a.rebalanceIdeas.some((r) => /favour Apple, Alphabet/.test(r.text)));
  assert.ok(a.rebalanceIdeas.some((r) => /US Treasuries 0-3M/.test(r.text)));
  const b = analyzePortfolio(input([h("mSGOV", 1), h("mSPX", 8)], { risk: "low" }), SNAP);
  assert.ok(!b.rebalanceIdeas.some((r) => /hold nothing cash-like/.test(r.text)));
});

test("loan exposure is measured against priced holdings and flagged when high", () => {
  const low = analyzePortfolio(input([h("mSPX", 10)], { loanUsd: 200 }), SNAP);
  assert.equal(low.concentration.length, 0);
  assert.equal(low.facts.find((f) => f.id === "input.loan")?.value, 200);
  assert.equal(low.health.parts.find((p) => p.label === "Loan")?.score, 67);

  const high = analyzePortfolio(input([h("mSPX", 10)], { loanUsd: 500 }), SNAP);
  const flag = high.concentration.find((c) => /loan/.test(c.text));
  assert.match(flag!.text, /\$500.00 is 50% of the value of your priced holdings. That is high/);
  assert.ok(flag!.factIds.includes("input.loan"));
  assert.equal(high.health.parts.find((p) => p.label === "Loan")?.score, 17);
  assertCitationsResolve(high);

  const unpricedLoan = analyzePortfolio(input([h("mSPCX", 1)], { loanUsd: 100 }), SNAP);
  assert.match(unpricedLoan.concentration[0].text, /cannot be measured/);
});

test("health score is 0 to 100, explains every part, and matches the weighted parts", () => {
  const good = analyzePortfolio(input([h("mSPX", 60), h("mSGOV", 20), h("mPAXG", 10), h("mAAPL", 10)]), SNAP);
  const bad = analyzePortfolio(input([h("mTSLA", 10)], { risk: "low", loanUsd: 900 }), SNAP);
  for (const a of [good, bad]) {
    assert.ok(a.health.score >= 0 && a.health.score <= 100);
    for (const p of a.health.parts) {
      assert.ok(p.score >= 0 && p.score <= 100, `${p.label} ${p.score}`);
      assert.ok(p.why.length > 10);
    }
  }
  assert.ok(good.health.score > 80, `good portfolio scored ${good.health.score}`);
  assert.ok(bad.health.score < 30, `bad portfolio scored ${bad.health.score}`);
  assert.deepEqual(good.health.parts.map((p) => p.label), ["Diversification", "Caps", "Research fit", "Risk fit", "Loan"]);
  const weights = [0.3, 0.25, 0.2, 0.15, 0.1];
  const expected = Math.round(good.health.parts.reduce((s, p, i) => s + p.score * weights[i], 0));
  assert.equal(good.health.score, expected);
});

test("an empty or wholly unpriced portfolio scores 0 with a reason and no ideas", () => {
  const empty = analyzePortfolio(input([]), SNAP);
  assert.equal(empty.totalUsd, 0);
  assert.equal(empty.health.score, 0);
  assert.match(empty.health.parts[0].why, /no holdings/);
  assert.deepEqual(empty.rebalanceIdeas, []);
  assert.equal(empty.diversification, 0);
  const unpriced = analyzePortfolio(input([h("mSPCX", 3)]), SNAP);
  assert.match(unpriced.health.parts[0].why, /could be priced/);
});

test("the analysis is deterministic and does not change its input", () => {
  const i = input([h("mAAPL", 2), h("mAAPL", 1, "manual"), h("mSPX", 3)], { monthlyNewMoneyUsd: 250, loanUsd: 50 });
  const copy = structuredClone(i);
  const a = analyzePortfolio(i, SNAP);
  const b = analyzePortfolio(i, SNAP);
  assert.deepEqual(a, b);
  assert.deepEqual(i, copy);
  assert.equal(a.asOf, SNAP.generatedAt);
});
