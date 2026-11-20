/**
 * A simple factual PortfolioAnalysis worked out in the browser, used ONLY while
 * /api/research/portfolio/preview is missing or fails. The page labels the result "Preview,
 * sample method". The real check lives in web/lib/research/portfolio on gg/research-portfolio.
 *
 * Values are holdings times testnet mock prices, so nothing here is a real market value. It states
 * facts (allocation, overlap, concentration, loan health) and links to the general view; it never
 * gives a personal buy or sell order. Only research-universe holdings come in here.
 */
import type { AllocationSlice, HoldingFacts, PortfolioAnalysis, PortfolioInput, Reasoned, View } from "@/lib/research/types";
import { borrowNote } from "@/lib/research/borrow";
import { universeAsset } from "@/lib/research/universe";

const LARGE_SHARE = 0.25;
const CLASS_LABEL: Record<string, string> = { stock: "Stocks", fund: "Funds", commodity: "Gold", crypto: "Crypto" };
const FUND_HOLDS = ["mAAPL", "mNVDA"];
const pct = (x: number) => `${Math.round(x * 100)}%`;

function slices(rows: { key: string; label: string; valueUsd: number }[], total: number): AllocationSlice[] {
  const m = new Map<string, AllocationSlice>();
  for (const r of rows) {
    const s = m.get(r.key) ?? { key: r.key, label: r.label, valueUsd: 0, share: 0 };
    s.valueUsd += r.valueUsd;
    m.set(r.key, s);
  }
  return [...m.values()].map((s) => ({ ...s, share: total > 0 ? s.valueUsd / total : 0 })).sort((a, b) => b.valueUsd - a.valueUsd);
}

export function previewAnalysis(input: PortfolioInput, priceUsd: (assetId: string) => number | undefined, views: Map<string, View>): PortfolioAnalysis {
  const merged = new Map<string, { amount: number; loanUsd: number }>();
  for (const h of input.holdings) {
    const m = merged.get(h.assetId) ?? { amount: 0, loanUsd: 0 };
    m.amount += h.amount;
    m.loanUsd += h.loanUsd ?? 0;
    merged.set(h.assetId, m);
  }
  const rows = [...merged.entries()]
    .map(([assetId, m]) => {
      const u = universeAsset(assetId);
      const valueUsd = m.amount * (priceUsd(assetId) ?? 0);
      return u && valueUsd > 0 ? { u, valueUsd, loanUsd: m.loanUsd } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const total = rows.reduce((s, r) => s + r.valueUsd, 0);

  const byAsset = slices(rows.map((r) => ({ key: r.u.assetId, label: r.u.name, valueUsd: r.valueUsd })), total);
  const byClass = slices(rows.map((r) => ({ key: r.u.assetClass, label: CLASS_LABEL[r.u.assetClass], valueUsd: r.valueUsd })), total);

  // 1 - Herfindahl index, scaled so one holding is 0 and an even spread over the six assets is 1.
  const hhi = byAsset.reduce((s, a) => s + a.share * a.share, 0);
  const diversification = byAsset.length <= 1 ? 0 : Math.max(0, Math.min(1, (1 - hhi) / (1 - 1 / 6)));

  const concentration: Reasoned[] = byAsset
    .filter((a) => a.share > LARGE_SHARE)
    .map((a) => ({ text: `${a.label} is ${pct(a.share)} of these holdings.`, factIds: [] }));
  const crypto = byClass.find((c) => c.key === "crypto")?.share ?? 0;
  if (crypto > 0) concentration.push({ text: `Crypto is ${pct(crypto)} of these holdings; it has swung more than stocks and gold in the past.`, factIds: [] });

  const held = new Set(byAsset.map((a) => a.key));
  const both = FUND_HOLDS.filter((id) => held.has(id));
  const overlaps: Reasoned[] =
    held.has("mSPX") && both.length
      ? [{ text: `The S&P 500 fund already holds ${both.map((id) => universeAsset(id)!.name).join(" and ")}, so these are owned twice.`, factIds: [] }]
      : [];

  const holdings: HoldingFacts[] = rows
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .map((r) => {
      const limit = r.valueUsd * r.u.lltv;
      const limitUse = r.loanUsd > 0 && limit > 0 ? r.loanUsd / limit : undefined;
      return {
        assetId: r.u.assetId,
        valueUsd: r.valueUsd,
        share: total > 0 ? r.valueUsd / total : 0,
        generalView: views.get(r.u.assetId) ?? null,
        borrowing: borrowNote(r.u.assetId, r.u.name, r.u.lltv, limitUse ?? 0.5),
        limitUse,
      };
    });

  const totalLoanUsd = rows.reduce((s, r) => s + r.loanUsd, 0);
  const uses = holdings.map((h) => h.limitUse).filter((x): x is number => x !== undefined);
  const worstLimitUse = uses.length ? Math.max(...uses) : null;
  const loanFacts: Reasoned[] =
    worstLimitUse === null
      ? []
      : [
          {
            text: `The fullest loan is at ${pct(worstLimitUse)} of its limit.${worstLimitUse >= 0.85 ? " That is close to liquidation." : ""}`,
            factIds: [],
          },
        ];

  return {
    asOf: new Date().toISOString(),
    totalUsd: total,
    byAsset,
    byClass,
    diversification,
    concentration,
    overlaps,
    holdings,
    loans: { totalLoanUsd, worstLimitUse, facts: loanFacts },
    facts: [],
  };
}
