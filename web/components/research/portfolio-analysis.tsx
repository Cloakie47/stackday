"use client";

import Link from "next/link";
import { Badge, Card, SplitBar, Stat, cx, splitColor } from "@/components/ui";
import type { AllocationSlice, PortfolioAnalysis } from "@/lib/research/types";
import { universeAsset } from "@/lib/research/universe";
import { AsOf, DataLabel, NotCoveredBadge, ReasonList, ResearchAssetIcon, SubHead, ViewBadge, assetName, fmtPct, fmtUsd } from "./bits";

function Allocation({ title, slices }: { title: string; slices: AllocationSlice[] }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-[13px] font-semibold text-ink">{title}</h3>
      <SplitBar parts={slices.map((s, i) => ({ key: s.key, value: s.valueUsd, color: splitColor(i, slices.length), label: s.label }))} height={8} />
      <ul className="mt-3 space-y-1.5">
        {slices.map((s, i) => (
          <li key={s.key} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <i aria-hidden className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: splitColor(i, slices.length) }} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-ink-soft">{(s.share * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const loanTone = (u: number | null | undefined) => (u === null || u === undefined ? undefined : u >= 0.85 ? "danger" : u >= 0.7 ? "warn" : "grow");

export function PortfolioAnalysisView({ a, preview = false }: { a: PortfolioAnalysis; preview?: boolean }) {
  return (
    <>
      <Card title="Allocation" badge={preview ? <Badge tone="warn">Preview, sample method</Badge> : <DataLabel />} action={<AsOf at={a.asOf} />}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Stat label="Value" value={fmtUsd(a.totalUsd)} hint="At testnet mock prices" />
          <Stat label="Spread" value={`${Math.round(a.diversification * 100)}%`} hint="0% one asset, 100% even" />
          <Stat
            label="Borrowed"
            value={fmtUsd(a.loans.totalLoanUsd)}
            hint={a.loans.worstLimitUse === null ? "No loan" : `Fullest loan at ${fmtPct(a.loans.worstLimitUse)} of its limit`}
            tone={loanTone(a.loans.worstLimitUse)}
          />
        </div>
        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <Allocation title="By asset" slices={a.byAsset} />
          <Allocation title="By asset class" slices={a.byClass} />
        </div>
      </Card>

      <Card title="Concentration, overlap and loans" badge={<DataLabel />}>
        <div className="grid gap-5 md:grid-cols-3">
          <div>
            <SubHead>Concentration</SubHead>
            <ReasonList items={a.concentration} facts={a.facts} empty="No single holding or group stands out." />
          </div>
          <div>
            <SubHead>Overlap</SubHead>
            <ReasonList items={a.overlaps} facts={a.facts} empty="No overlap between the fund and single stocks." />
          </div>
          <div>
            <SubHead>Loan health</SubHead>
            <ReasonList items={a.loans.facts} facts={a.facts} empty="No loan against these holdings." />
          </div>
        </div>
      </Card>

      <Card title="Each holding" badge={<DataLabel />} tip="Facts about each holding and a link to the general weekly view for that asset. The view is the same for every reader, not a personal order.">
        <ul className="divide-y divide-line-soft">
          {a.holdings.map((h) => (
            <li key={h.assetId} className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <ResearchAssetIcon assetId={h.assetId} size={24} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{assetName(h.assetId)}</span>
                    <span className="block text-xs text-muted">
                      {fmtUsd(h.valueUsd)} · {(h.share * 100).toFixed(1)}% of these holdings
                      {h.limitUse !== undefined && (
                        <>
                          {" "}
                          · loan at <span className={cx(h.limitUse >= 0.85 ? "text-danger" : h.limitUse >= 0.7 ? "text-warn" : "")}>{fmtPct(h.limitUse)}</span> of its
                          limit
                        </>
                      )}
                    </span>
                  </span>
                </span>
                {universeAsset(h.assetId) ? (
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted">General view:</span>
                    {h.generalView ? <ViewBadge view={h.generalView} /> : <span className="text-muted">none this week</span>}
                    <Link href={`/research/${h.assetId}`} className="inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-2 sm:min-h-0">
                      Read it
                    </Link>
                  </span>
                ) : (
                  <NotCoveredBadge />
                )}
              </div>
              {h.borrowing && (
                <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                  <span className="text-muted">Borrowing note: </span>
                  {h.borrowing.text}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
