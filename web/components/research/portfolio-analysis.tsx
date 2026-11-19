"use client";

import { Badge, Card, SplitBar, Stat, splitColor } from "@/components/ui";
import type { AllocationSlice, HoldingVerdict, PortfolioAnalysis } from "@/lib/research/types";
import { ActionBadge, AiLabel, AsOf, DataLabel, ReasonList, ResearchAssetIcon, SubHead, assetName, fmtUsd } from "./bits";

const VERDICT: Record<HoldingVerdict["verdict"], { label: string; tone: "neutral" | "warn" | "grow" | "brand" }> = {
  keep: { label: "Keep", tone: "neutral" },
  review: { label: "Review", tone: "warn" },
  "trim-new-buys": { label: "Point new buys elsewhere", tone: "brand" },
  "add-with-new-money": { label: "Add with new money", tone: "grow" },
};

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

function healthTone(score: number) {
  return score >= 70 ? "grow" : score >= 45 ? "warn" : "danger";
}

export function PortfolioAnalysisView({ a, preview = false }: { a: PortfolioAnalysis; preview?: boolean }) {
  return (
    <>
      <Card
        title="Portfolio health"
        badge={preview ? <Badge tone="warn">Preview, sample method</Badge> : undefined}
        action={<AsOf at={a.asOf} />}
        tip="A score from 0 to 100 built from the parts below. It describes how spread out the holdings are, not how they will perform."
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Stat label="Health score" value={`${a.health.score}/100`} tone={healthTone(a.health.score)} big />
          <Stat label="Value" value={fmtUsd(a.totalUsd)} hint="At testnet mock prices" />
          <Stat label="Spread" value={`${Math.round(a.diversification * 100)}%`} hint="0% one asset, 100% even" />
        </div>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {a.health.parts.map((p) => (
            <li key={p.label} className="rounded-xl border border-line-soft bg-popover px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="font-medium">{p.label}</span>
                <span className="tabular-nums">{p.score}/100</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-press" role="meter" aria-label={p.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.score}>
                <span className={`block h-full rounded-full ${{ grow: "bg-grow", warn: "bg-warn", danger: "bg-danger" }[healthTone(p.score)]}`} style={{ width: `${Math.max(2, p.score)}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-muted">{p.why}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Allocation" badge={<DataLabel />}>
        <div className="grid gap-6 md:grid-cols-2">
          <Allocation title="By asset" slices={a.byAsset} />
          <Allocation title="By asset class" slices={a.byClass} />
          <Allocation title="By sector" slices={a.bySector} />
          <Allocation title="By risk" slices={a.byRisk} />
        </div>
      </Card>

      <Card title="Flags">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <SubHead>Concentration</SubHead>
            <ReasonList items={a.concentration} facts={a.facts} empty="No holding or group is above its target." />
          </div>
          <div>
            <SubHead>Overlap</SubHead>
            <ReasonList items={a.overlaps} facts={a.facts} empty="No overlap between funds and single stocks." />
          </div>
        </div>
      </Card>

      <Card title="Each holding" badge={preview ? <Badge tone="neutral">Computed</Badge> : <AiLabel />} flush>
        <div className="mt-3 overflow-x-auto border-t border-line-soft">
          <table className="dtable min-w-[36rem]">
            <thead>
              <tr>
                <th scope="col">Holding</th>
                <th scope="col" className="r">
                  Share
                </th>
                <th scope="col">Today&apos;s note</th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {a.holdings.map((h) => (
                <tr key={h.assetId}>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <ResearchAssetIcon assetId={h.assetId} size={24} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{assetName(h.assetId)}</span>
                        <span className="block text-xs text-muted">{h.why.text}</span>
                      </span>
                    </span>
                  </td>
                  <td className="r">{(h.share * 100).toFixed(1)}%</td>
                  <td>
                    <ActionBadge action={h.action} />
                  </td>
                  <td>
                    <Badge tone={VERDICT[h.verdict].tone}>{VERDICT[h.verdict].label}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Ideas for new money" badge={preview ? <Badge tone="neutral">Computed</Badge> : <AiLabel />} tip="These only redirect new money. Nothing is ever sold for you, and targets apply to new buys only.">
        <ReasonList items={a.rebalanceIdeas} facts={a.facts} empty="No change suggested for new money." />
      </Card>
    </>
  );
}
