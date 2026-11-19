/**
 * A simple PortfolioAnalysis worked out in the browser, used ONLY while /api/research/portfolio is
 * not built yet (it answers 404). The page labels the result "Preview, sample method". The real
 * analysis lives in web/lib/research/portfolio on the gg/research-portfolio branch.
 *
 * Values come from the person's holdings times the testnet mock prices, so nothing here is a real
 * market value. Verdicts only read the daily note's action; ideas only redirect new money.
 */
import type { AllocationSlice, HoldingVerdict, PortfolioAnalysis, PortfolioInput, Reasoned, ResearchNote } from "@/lib/research/types";
import { universeAsset, type RiskBucket } from "@/lib/research/universe";

const SINGLE_CAP = 0.15;
const CRYPTO_CAP: Record<PortfolioInput["risk"], number> = { low: 0.05, medium: 0.15, high: 0.25 };
const FUND_HOLDS = ["mAAPL", "mNVDA", "mMSFT", "mAMZN", "mGOOGL", "mMETA", "mTSLA"];

const CLASS_LABEL: Record<string, string> = { stock: "Stocks", fund: "Funds", commodity: "Gold", crypto: "Crypto" };
const RISK_LABEL: Record<RiskBucket, string> = { "cash-like": "Cash-like", core: "Core", growth: "Growth", speculative: "Speculative" };

function slices(rows: { key: string; label: string; valueUsd: number }[], total: number): AllocationSlice[] {
  const m = new Map<string, AllocationSlice>();
  for (const r of rows) {
    const s = m.get(r.key) ?? { key: r.key, label: r.label, valueUsd: 0, share: 0 };
    s.valueUsd += r.valueUsd;
    m.set(r.key, s);
  }
  return [...m.values()].map((s) => ({ ...s, share: total > 0 ? s.valueUsd / total : 0 })).sort((a, b) => b.valueUsd - a.valueUsd);
}

export function previewAnalysis(input: PortfolioInput, priceUsd: (assetId: string) => number | undefined, notes: ResearchNote[]): PortfolioAnalysis {
  const rows = input.holdings
    .map((h) => {
      const u = universeAsset(h.assetId);
      const p = priceUsd(h.assetId) ?? 0;
      return u ? { h, u, valueUsd: h.amount * p } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null && r.valueUsd > 0);
  const total = rows.reduce((s, r) => s + r.valueUsd, 0);

  const byAsset = slices(rows.map((r) => ({ key: r.u.assetId, label: r.u.name, valueUsd: r.valueUsd })), total);
  const byClass = slices(rows.map((r) => ({ key: r.u.assetClass, label: CLASS_LABEL[r.u.assetClass], valueUsd: r.valueUsd })), total);
  const bySector = slices(rows.map((r) => ({ key: r.u.sector, label: r.u.sector, valueUsd: r.valueUsd })), total);
  const byRisk = slices(rows.map((r) => ({ key: r.u.risk, label: RISK_LABEL[r.u.risk], valueUsd: r.valueUsd })), total);

  // 1 - Herfindahl index, scaled so one holding is 0 and an even spread over 15 assets is 1.
  const hhi = byAsset.reduce((s, a) => s + a.share * a.share, 0);
  const diversification = byAsset.length <= 1 ? 0 : Math.max(0, Math.min(1, (1 - hhi) / (1 - 1 / 15)));

  const concentration: Reasoned[] = byAsset
    .filter((a) => a.share > SINGLE_CAP && universeAsset(a.key)?.assetClass !== "fund")
    .map((a) => ({ text: `${a.label} is ${(a.share * 100).toFixed(0)}% of the portfolio, above the ${SINGLE_CAP * 100}% target for one holding.`, factIds: [] }));
  const crypto = byClass.find((c) => c.key === "crypto")?.share ?? 0;
  if (crypto > CRYPTO_CAP[input.risk])
    concentration.push({ text: `Crypto is ${(crypto * 100).toFixed(0)}%, above ${(CRYPTO_CAP[input.risk] * 100).toFixed(0)}% for your risk level.`, factIds: [] });

  const held = new Set(byAsset.map((a) => a.key));
  const overlaps: Reasoned[] =
    held.has("mSPX") && FUND_HOLDS.some((id) => held.has(id))
      ? [
          {
            text: `The S&P 500 fund already holds ${FUND_HOLDS.filter((id) => held.has(id)).map((id) => universeAsset(id)!.name).join(", ")}, so you own them twice.`,
            factIds: [],
          },
        ]
      : [];

  const note = (id: string) => notes.find((n) => n.assetId === id && n.status !== "no-reading");
  const holdings: HoldingVerdict[] = byAsset.map((a) => {
    const n = note(a.key);
    const action = n?.action ?? "hold";
    const over = a.share > SINGLE_CAP && universeAsset(a.key)?.assetClass !== "fund";
    const verdict: HoldingVerdict["verdict"] = action === "sell" ? "review" : over ? "trim-new-buys" : action === "buy" ? "add-with-new-money" : "keep";
    const why =
      verdict === "review"
        ? "Today's note leans against it. Look again before adding more."
        : verdict === "trim-new-buys"
          ? "Already a large share. Point new buys elsewhere first."
          : verdict === "add-with-new-money"
            ? "Today's note suggests new money could go here."
            : "No change suggested.";
    return { assetId: a.key, valueUsd: a.valueUsd, share: a.share, action, verdict, why: { text: why, factIds: [] } };
  });

  const ideas: Reasoned[] = holdings
    .filter((h) => h.verdict === "add-with-new-money")
    .slice(0, 3)
    .map((h) => ({ text: `Direct part of new money to ${universeAsset(h.assetId)?.name}.`, factIds: [] }));
  if (!held.has("mSPX") && note("mSPX")?.action === "buy") ideas.push({ text: "A broad market fund (S&P 500) spreads new money across many companies.", factIds: [] });
  if (input.monthlyNewMoneyUsd && ideas.length > 0) ideas.unshift({ text: `Ideas for your $${input.monthlyNewMoneyUsd.toFixed(0)} a month of new money. Nothing is sold.`, factIds: [] });

  const parts = [
    { label: "Spread", score: Math.round(diversification * 100), why: "How evenly money is spread across holdings." },
    { label: "Concentration", score: Math.max(0, 100 - concentration.length * 25), why: "Points off for each holding or group above its target." },
    { label: "Overlap", score: overlaps.length ? 70 : 100, why: "Points off when a fund already holds your single stocks." },
    { label: "Research fit", score: Math.round((holdings.filter((h) => h.verdict !== "review").length / Math.max(1, holdings.length)) * 100), why: "Share of holdings today's notes do not lean against." },
  ];
  const score = holdings.length ? Math.round(parts.reduce((s, p) => s + p.score, 0) / parts.length) : 0;

  return {
    asOf: new Date().toISOString(),
    totalUsd: total,
    byAsset,
    byClass,
    bySector,
    byRisk,
    diversification,
    concentration,
    overlaps,
    holdings,
    rebalanceIdeas: ideas,
    health: { score, parts },
    facts: [],
  };
}
