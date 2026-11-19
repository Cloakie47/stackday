"use client";

import { Badge, Card } from "@/components/ui";
import type { Report, ReportPeriod, ReportScope } from "@/lib/research/types";
import { ActionBadge, AiLabel, AsOf, ConfidenceMeter, LevelsRow, ReasonList, ResearchAssetIcon, assetName, fmtDate, fmtTime } from "./bits";
import { PortfolioAnalysisView } from "./portfolio-analysis";

export const SCOPE_LABEL: Record<ReportScope, string> = { market: "Market", asset: "One asset", portfolio: "My portfolio", full: "Everything" };
export const PERIOD_LABEL: Record<ReportPeriod, string> = { "on-demand": "On demand", daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

export function reportTitle(r: Report) {
  const what = r.scope === "asset" && r.notes[0] ? assetName(r.notes[0].assetId) : SCOPE_LABEL[r.scope];
  return `${what} report, ${fmtDate(r.snapshotDate)}`;
}

/** A full report, laid out to read well on screen and when printed or saved as PDF. */
export function ReportView({ report, sample }: { report: Report; sample: boolean }) {
  return (
    <article id="research-report" className="grid gap-4" aria-label={reportTitle(report)}>
      <header className="rounded-[18px] border border-line bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-2xl font-light tracking-[-0.02em] text-ink">{reportTitle(report)}</h2>
          <Badge tone="neutral">{PERIOD_LABEL[report.period]}</Badge>
          {report.premium && <Badge tone="brand">Premium</Badge>}
          {sample && <Badge tone="warn">Sample data</Badge>}
        </div>
        <p className="mt-1.5 text-xs text-muted">
          Built {fmtTime(report.createdAt)} from the research of {fmtDate(report.snapshotDate)}
        </p>
        <p className="mt-3 rounded-xl bg-warn-soft px-3.5 py-2.5 text-xs leading-relaxed text-warn">{report.disclaimer}</p>
      </header>

      {report.changes.length > 0 && (
        <Card title="What changed" badge={<AiLabel />}>
          <ReasonList items={report.changes} facts={report.notes.flatMap((n) => n.facts)} />
        </Card>
      )}

      {report.market && (
        <Card title="Market overview" badge={<AiLabel />}>
          <p className="text-[14px] leading-relaxed text-ink">{report.market.summary}</p>
          {report.market.developments.length > 0 && (
            <div className="mt-4">
              <ReasonList items={report.market.developments} facts={report.market.facts} />
            </div>
          )}
        </Card>
      )}

      {report.notes.length > 0 && (
        <Card title="Asset notes" badge={<AiLabel />}>
          <ul className="divide-y divide-line-soft">
            {report.notes.map((n) => (
              <li key={n.assetId} className="break-inside-avoid py-3.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <ResearchAssetIcon assetId={n.assetId} size={24} />
                  <h3 className="text-[14px] font-medium">{assetName(n.assetId)}</h3>
                  {n.status === "no-reading" ? <Badge tone="warn">No reading</Badge> : <ActionBadge action={n.action} />}
                  {n.status !== "no-reading" && <ConfidenceMeter confidence={n.confidence} />}
                  <span className="ml-auto">
                    <AsOf at={n.dataAsOf} label="Data as of" />
                  </span>
                </div>
                {n.status !== "no-reading" && (
                  <>
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{n.summary}</p>
                    {n.levels && (
                      <div className="mt-2">
                        <LevelsRow levels={n.levels} compact />
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {report.portfolio && <PortfolioAnalysisView a={report.portfolio} preview={sample} />}

      <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-xs leading-relaxed text-warn">{report.disclaimer}</p>
    </article>
  );
}
