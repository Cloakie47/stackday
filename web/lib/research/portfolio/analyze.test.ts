import { test } from "node:test";
import assert from "node:assert/strict";
import deployment from "../../deployment.json" with { type: "json" };
import { analyzePortfolio, diversificationScore, limitUseOf, mergeHoldings, NOT_COVERED, type PortfolioContext } from "./analyze.ts";
import { FIXTURE_ASSETS, FIXTURE_CATALOG, FIXTURE_TIME, quote } from "./fixtures.ts";
import { deployedLltv } from "../universe.ts";
import type { PortfolioInput } from "../types.ts";

const PRICES = { mAAPL: quote(100), mSPX: quote(50), mcbBTC: quote(1000), mNVDA: quote(10), mMSFT: quote(20), mMSTR: quote(5), mGOOGL: quote(10) };
const ctx = (over: Partial<PortfolioContext> = {}): PortfolioContext => ({
  kind: "sample",
  asOf: FIXTURE_TIME,
  catalog: FIXTURE_CATALOG,
  views: { mAAPL: "hold", mSPX: "accumulate", mcbBTC: "avoid-new-buys", mNVDA: "reduce" },
  viewSource: { product: "weekly-report", weekOf: "2026-11-16" },
  prices: PRICES,
  loanPrices: PRICES,
  ...over,
});

const allText = (a: ReturnType<typeof analyzePortfolio>) =>
  [...a.concentration, ...a.overlaps, ...a.loans.facts].map((r) => r.text).join(" ") +
  a.holdings.map((h) => `${h.borrowing?.text ?? ""} ${h.coverageNote ?? ""}`).join(" ");

test("fixture LLTVs match the deployment", () => {
  for (const a of FIXTURE_ASSETS) assert.equal(deployedLltv(a.assetId, deployment as Record<string, unknown>), a.lltv, a.assetId);
});

test("allocation by asset and class adds up, with values from the prices passed in", () => {
  const input: PortfolioInput = {
    holdings: [
      { assetId: "mAAPL", amount: 3, origin: "vault" },
      { assetId: "mSPX", amount: 4, origin: "manual" },
      { assetId: "mcbBTC", amount: 0.5, origin: "vault" },
    ],
  };
  const a = analyzePortfolio(input, ctx());
  assert.equal(a.totalUsd, 300 + 200 + 500);
  assert.deepEqual(
    a.byAsset.map((s) => [s.key, s.share]),
    [["mcbBTC", 0.5], ["mAAPL", 0.3], ["mSPX", 0.2]],
  );
  assert.equal(a.byAsset[0].label, "Bitcoin", "research name, not the token name");
  assert.deepEqual(a.byClass.map((s) => s.key), ["crypto", "stock", "fund"]);
  assert.ok(Math.abs(a.byAsset.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);
  assert.equal(a.kind, "sample");
  assert.deepEqual(a.viewSource, { product: "weekly-report", weekOf: "2026-11-16" });
});

test("general view comes from the research passed in, and holdings carry no orders", () => {
  const a = analyzePortfolio(
    { holdings: [{ assetId: "mNVDA", amount: 10, origin: "manual" }, { assetId: "mAAPL", amount: 1, origin: "manual" }] },
    ctx(),
  );
  assert.equal(a.holdings.find((h) => h.assetId === "mNVDA")!.generalView, "reduce");
  const allowed = ["assetId", "name", "valueUsd", "share", "coveredByResearch", "generalView", "borrowing", "limitUse", "coverageNote"];
  for (const h of a.holdings) assert.deepEqual(Object.keys(h).filter((k) => !allowed.includes(k)), []);
  const text = allText(a).toLowerCase();
  for (const word of ["you should", "sell", "buy more", "trim", "rebalance", "we recommend", "add to"]) assert.ok(!text.includes(word), `no "${word}"`);
});

test("borrowing note per covered holding at its own limit use, or 50% with no loan", () => {
  const input: PortfolioInput = {
    holdings: [
      { assetId: "mcbBTC", amount: 1, origin: "vault", loanUsd: 430 },
      { assetId: "mAAPL", amount: 2, origin: "vault" },
    ],
  };
  const a = analyzePortfolio(input, ctx());
  const btc = a.holdings.find((h) => h.assetId === "mcbBTC")!;
  // limit = 1000 x 0.86 = 860; loan 430 = 50% of the limit.
  assert.equal(btc.limitUse, 0.5);
  assert.equal(btc.borrowing!.examples[0].fromLimitUse, 0.5);
  assert.equal(btc.borrowing!.lltv, 0.86);
  const aapl = a.holdings.find((h) => h.assetId === "mAAPL")!;
  assert.equal(aapl.limitUse, undefined);
  assert.equal(aapl.borrowing!.examples[0].fromLimitUse, 0.5);
  assert.match(aapl.borrowing!.text, /emergency rule/);
});

test("loan health: limit use per holding and the worst one", () => {
  const input: PortfolioInput = {
    holdings: [
      { assetId: "mcbBTC", amount: 1, origin: "vault", loanUsd: 172 },
      { assetId: "mAAPL", amount: 2, origin: "vault", loanUsd: 100 },
    ],
  };
  const a = analyzePortfolio(input, ctx());
  // BTC: 172 / 860 = 0.2. AAPL: 100 / (200 x 0.625) = 0.8.
  assert.ok(Math.abs(a.loans.worstLimitUse! - 0.8) < 1e-9);
  assert.equal(a.loans.totalLoanUsd, 272);
  assert.match(a.loans.facts.map((f) => f.text).join(" "), /80% of its limit/);
  assert.ok(a.loans.facts.every((f) => f.factIds.length > 0));
  const none = analyzePortfolio({ holdings: [{ assetId: "mAAPL", amount: 1, origin: "manual" }] }, ctx());
  assert.deepEqual(none.loans, { totalLoanUsd: 0, worstLimitUse: null, facts: [] });
});

test("a loan at or over the limit says it can be liquidated", () => {
  const a = analyzePortfolio({ holdings: [{ assetId: "mAAPL", amount: 1, origin: "vault", loanUsd: 70 }] }, ctx());
  assert.ok(a.loans.worstLimitUse! > 1);
  assert.match(a.loans.facts[0].text, /can be liquidated/);
});

test("holdings outside the six show in allocation as not covered, without a view or borrowing note", () => {
  const input: PortfolioInput = {
    holdings: [
      { assetId: "mMSFT", amount: 10, origin: "vault" },
      { assetId: "mGOOGL", amount: 10, origin: "vault", loanUsd: 10 },
      { assetId: "mAAPL", amount: 1, origin: "vault" },
    ],
  };
  const a = analyzePortfolio(input, ctx({ views: { mMSFT: "accumulate", mAAPL: "hold" } }));
  const msft = a.holdings.find((h) => h.assetId === "mMSFT")!;
  assert.equal(msft.coveredByResearch, false);
  assert.equal(msft.generalView, null);
  assert.equal(msft.borrowing, null);
  assert.match(msft.coverageNote!, /not covered by research/);
  assert.equal(a.byAsset.find((s) => s.key === "mMSFT")!.label, `Microsoft (${NOT_COVERED})`);
  // Alphabet is borrowable but not researched: loan health is still measured, no borrowing note.
  const googl = a.holdings.find((h) => h.assetId === "mGOOGL")!;
  assert.equal(googl.borrowing, null);
  assert.ok(Math.abs(googl.limitUse! - 10 / (100 * 0.77)) < 1e-9);
  assert.equal(a.holdings.find((h) => h.assetId === "mAAPL")!.coveredByResearch, true);
});

test("overlap: the S&P 500 fund already holds Apple and NVIDIA", () => {
  const a = analyzePortfolio(
    {
      holdings: [
        { assetId: "mSPX", amount: 2, origin: "vault" },
        { assetId: "mAAPL", amount: 1, origin: "vault" },
        { assetId: "mNVDA", amount: 5, origin: "vault" },
      ],
    },
    ctx(),
  );
  assert.equal(a.overlaps.length, 1);
  assert.match(a.overlaps[0].text, /already holds Apple, NVIDIA/);
  const b = analyzePortfolio(
    { holdings: [{ assetId: "mMSTR", amount: 10, origin: "vault" }, { assetId: "mcbBTC", amount: 0.1, origin: "vault" }] },
    ctx(),
  );
  assert.match(b.overlaps[0].text, /bitcoin price/);
});

test("concentration facts are plain statements", () => {
  const a = analyzePortfolio({ holdings: [{ assetId: "mcbBTC", amount: 1, origin: "vault" }, { assetId: "mAAPL", amount: 1, origin: "vault" }] }, ctx());
  assert.match(a.concentration.map((c) => c.text).join(" "), /Bitcoin is 90\.9% of the valued holdings/);
  const one = analyzePortfolio({ holdings: [{ assetId: "mAAPL", amount: 1, origin: "vault" }] }, ctx());
  assert.match(one.concentration.map((c) => c.text).join(" "), /one asset, Apple/);
  assert.equal(one.diversification, 0);
});

test("a holding with no price is listed as unpriced and left out of every share", () => {
  const a = analyzePortfolio(
    { holdings: [{ assetId: "mPAXG", amount: 1, origin: "vault", loanUsd: 5 }, { assetId: "mAAPL", amount: 1, origin: "vault" }] },
    ctx(),
  );
  assert.deepEqual(a.unpriced.map((u) => u.assetId), ["mPAXG"]);
  assert.equal(a.totalUsd, 100);
  assert.equal(a.byAsset.length, 1);
  assert.match(a.loans.facts.map((f) => f.text).join(" "), /Gold, but it had no price/);
});

test("every cited fact id exists in facts", () => {
  const a = analyzePortfolio(
    {
      holdings: [
        { assetId: "mSPX", amount: 2, origin: "vault", loanUsd: 10 },
        { assetId: "mAAPL", amount: 1, origin: "vault" },
        { assetId: "mMSFT", amount: 1, origin: "manual" },
      ],
    },
    ctx(),
  );
  const ids = new Set(a.facts.map((f) => f.id));
  for (const r of [...a.concentration, ...a.overlaps, ...a.loans.facts]) for (const id of r.factIds) assert.ok(ids.has(id), id);
  assert.ok(a.facts.find((f) => f.id === "mAAPL:price")!.source.name.includes("Test fixture"));
});

test("helpers: merge, diversification, limit use", () => {
  assert.deepEqual(
    mergeHoldings([
      { assetId: "mAAPL", amount: 1, origin: "manual", loanUsd: 5 },
      { assetId: "mAAPL", amount: 2, origin: "vault", loanUsd: 5 },
    ]),
    // The vault loan is the real debt; the hand-typed loan on the same asset is not added to it.
    [{ assetId: "mAAPL", amount: 3, origin: "vault", loanUsd: 5, collateralAmount: 2 }],
  );
  assert.deepEqual(
    mergeHoldings([
      { assetId: "mAAPL", amount: 1, origin: "manual", loanUsd: 5 },
      { assetId: "mAAPL", amount: 4, origin: "manual", loanUsd: 3 },
    ]),
    [{ assetId: "mAAPL", amount: 5, origin: "manual", loanUsd: 8, collateralAmount: 5 }],
    "loans typed by hand on separate entries still add up",
  );
  assert.equal(diversificationScore([{ assetId: "mAAPL", share: 1 }]), 0);
  assert.equal(diversificationScore([{ assetId: "mSPX", share: 1 }]), 1);
  assert.equal(limitUseOf(0, 100, 0.5), null);
  assert.equal(limitUseOf(10, 100, 0), null);
  assert.equal(limitUseOf(25, 100, 0.5), 0.5);
});

test("same input, same output", () => {
  const input: PortfolioInput = { holdings: [{ assetId: "mAAPL", amount: 1, origin: "vault" }, { assetId: "mSPX", amount: 1, origin: "vault" }] };
  assert.deepEqual(analyzePortfolio(input, ctx()), analyzePortfolio(input, ctx()));
});

test("loan health uses the lending market's feed price, never the research price", () => {
  // Research says $100, the feed Morpho reads says $80 (for example after the judges' stress step).
  const a = analyzePortfolio(
    { holdings: [{ assetId: "mAAPL", amount: 1, origin: "vault", loanUsd: 40 }] },
    ctx({ loanPrices: { mAAPL: quote(80) } }),
  );
  const lltv = FIXTURE_CATALOG.get("mAAPL")!.lltv;
  assert.equal(a.totalUsd, 100, "the allocation still values the holding at the research price");
  assert.ok(Math.abs(a.loans.worstLimitUse! - 40 / (80 * lltv)) < 1e-9, "limit use at the feed price");
  assert.equal(a.holdings[0].limitUse, a.loans.worstLimitUse);
  assert.ok(a.facts.some((f) => f.id === "mAAPL:loan-price" && f.value === 80));
  assert.ok(a.loans.facts[0].factIds.includes("mAAPL:loan-price"));
});

test("a loan with no feed price is not measured at a research price", () => {
  const a = analyzePortfolio({ holdings: [{ assetId: "mAAPL", amount: 1, origin: "vault", loanUsd: 40 }] }, ctx({ loanPrices: {} }));
  assert.equal(a.loans.worstLimitUse, null);
  assert.equal(a.holdings[0].limitUse, undefined);
  assert.match(a.loans.facts[0].text, /could not be read, so the loan's limit use is not measured/);
});

test("loan health counts only locked collateral, never idle tokens in the vault", () => {
  // 10 units in the vault, only 1 locked. Morpho measures the loan against the 1 locked unit.
  const lltv = FIXTURE_CATALOG.get("mAAPL")!.lltv;
  const a = analyzePortfolio(
    { holdings: [{ assetId: "mAAPL", amount: 10, collateralAmount: 1, origin: "vault", loanUsd: 60 }] },
    ctx({ loanPrices: { mAAPL: quote(100) } }),
  );
  assert.equal(a.totalUsd, 1000, "the allocation still values every unit held");
  assert.ok(Math.abs(a.loans.worstLimitUse! - 60 / (100 * lltv)) < 1e-9, "limit use on the locked unit only");
  assert.ok(a.facts.some((f) => f.id === "mAAPL:collateral" && f.value === 1));
  assert.ok(a.loans.facts[0].factIds.includes("mAAPL:collateral"));
});

test("a manual loan on the same asset as a vault loan is not counted twice", () => {
  const a = analyzePortfolio(
    {
      holdings: [
        { assetId: "mAAPL", amount: 2, collateralAmount: 2, origin: "vault", loanUsd: 50 },
        { assetId: "mAAPL", amount: 0.5, origin: "manual", loanUsd: 50 },
      ],
    },
    ctx(),
  );
  assert.equal(a.facts.find((f) => f.id === "mAAPL:loan")?.value, 50);
});
