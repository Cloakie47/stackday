"use client";

import Link from "next/link";
import { useState } from "react";
import { useViewer } from "@/components/providers";
import { Badge, Button, Card, Chip, Empty, Notice, PageHeader, Select, Skeleton, cx } from "@/components/ui";
import { ASSETS } from "@/lib/contracts";
import type { PortfolioInput, Report, ReportPeriod, ReportScope } from "@/lib/research/types";
import { UNIVERSE } from "@/lib/research/universe";
import { usePortfolio } from "@/lib/usePortfolio";
import { ApiError, buildReport, getSchedules, listReports, sampleReport, saveSchedule, type Refusal, type ScheduleRow } from "./api";
import { Disclaimer, LoadError, ResearchTabs, SampleBanner, fmtTime, useLoad, useSnapshot } from "./bits";
import { previewAnalysis } from "./portfolio-preview";
import { PERIOD_LABEL, ReportView, SCOPE_LABEL, reportTitle } from "./report-view";

const LOCAL_KEY = "stackday-research-sample-reports";

const REFUSAL: Record<Refusal, string> = {
  "sign-in": "Sign in with your wallet to build a personal report.",
  "payment-required": "This report needs a plan or a single-report payment.",
  "premium-required": "This report needs premium depth.",
  "rate-limited": "Too many reports in a short time. Try again in a minute.",
};

/** Hides everything but the report when printing or saving as PDF. */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #research-report, #research-report * { visibility: visible !important; }
  #research-report { position: absolute; inset: 0 auto auto 0; width: 100%; }
}`;

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="hit inline-flex min-h-11 items-center disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0"
    >
      <span className={cx("relative inline-block h-6 w-10 rounded-full border transition-colors duration-150", on ? "border-transparent bg-brand" : "border-line-strong bg-sunken")}>
        <span
          aria-hidden
          className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-popover shadow-pill transition-transform duration-150", on ? "translate-x-[18px]" : "translate-x-0.5")}
        />
      </span>
    </button>
  );
}

export function ReportsPage() {
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const snap = useSnapshot();
  const owner = viewer.address?.toLowerCase();
  const past = useLoad(() => listReports(owner), `reports-${owner ?? "public"}`);
  const sched = useLoad(getSchedules, "schedules");

  const [scope, setScope] = useState<ReportScope>("market");
  const [period, setPeriod] = useState<ReportPeriod>("on-demand");
  const [assetId, setAssetId] = useState(UNIVERSE[0].assetId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; reason?: Refusal } | null>(null);
  // Sample reports saved in this browser. They only render once the past-reports list has loaded, so the server HTML never differs.
  const [local, setLocal] = useState<Report[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
      return Array.isArray(saved) ? (saved as Report[]) : [];
    } catch {
      return []; // on the server, in private mode, or bad data
    }
  });
  const [open, setOpen] = useState<{ report: Report; sample: boolean } | null>(null);
  const [edited, setRows] = useState<ScheduleRow[] | null>(null);
  const [schedMsg, setSchedMsg] = useState<string | null>(null);

  const rows = edited ?? (sched.status === "ready" ? sched.data : null);
  const personal = scope === "portfolio" || scope === "full";
  const vaultInput = (): PortfolioInput => ({
    holdings: p.positions
      .filter((x) => x.idle + x.collateral > 0n)
      .map((x) => ({ assetId: x.asset.symbol, amount: Number(x.idle + x.collateral) / 10 ** x.asset.decimals, origin: "vault" })),
    horizon: "long",
    risk: "medium",
  });
  const priceUsd = (id: string) => {
    const pos = p.positions.find((x) => x.asset.symbol === id);
    const a = ASSETS.find((x) => x.symbol === id);
    return pos?.price ? Number(pos.price) / 1e8 : a ? Number(a.startPrice) / 1e8 : undefined;
  };

  async function build() {
    if (snap.status !== "ready") return;
    setBusy(true);
    setError(null);
    const portfolio = personal ? vaultInput() : undefined;
    const req = { scope, period, assetId: scope === "asset" ? assetId : undefined, portfolio };
    try {
      const r = await buildReport(req, () =>
        sampleReport(snap.data, req, owner ?? null, portfolio ? previewAnalysis(portfolio, priceUsd, snap.data.notes) : undefined),
      );
      const sample = r.from === "sample" || snap.data.kind === "sample";
      setOpen({ report: r.data, sample });
      if (r.from === "sample") {
        const next = [r.data, ...local].slice(0, 10);
        setLocal(next);
        try {
          localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
        } catch {
          /* not saved: fine */
        }
      }
    } catch (e) {
      if (e instanceof ApiError) setError({ text: e.reason ? REFUSAL[e.reason] : e.message, reason: e.reason });
      else setError({ text: "The report could not be built." });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: ScheduleRow, enabled: boolean) {
    if (!rows) return;
    const next = { ...row, enabled };
    setRows(rows.map((r) => (r.scope === row.scope && r.period === row.period ? next : r)));
    setSchedMsg(null);
    try {
      const r = await saveSchedule(next);
      setSchedMsg(r.from === "sample" ? "Saved on this page only: scheduled reports are not live yet." : "Saved.");
    } catch (e) {
      setRows(rows);
      setSchedMsg(e instanceof Error ? e.message : "Could not save the schedule.");
    }
  }

  const apiReports = past.status === "ready" ? past.data : [];
  const all = [...apiReports.map((r) => ({ r, sample: false })), ...local.map((r) => ({ r, sample: true }))].sort((a, b) =>
    b.r.createdAt.localeCompare(a.r.createdAt),
  );

  return (
    <>
      <style>{PRINT_CSS}</style>
      <PageHeader title="Reports" lead="Build a market, asset or portfolio report, or get one on a schedule." />
      <ResearchTabs />
      <SampleBanner show={snap.status === "ready" && snap.data.kind === "sample"} what="research the reports use" />

      <Card title="Build a report">
        <div className="grid gap-4">
          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-[13px] text-ink-soft">What to cover</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(SCOPE_LABEL) as ReportScope[]).map((s) => (
                <Chip key={s} active={scope === s} onClick={() => setScope(s)}>
                  {SCOPE_LABEL[s]}
                </Chip>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            {scope === "asset" && (
              <Select label="Asset" value={assetId} onChange={setAssetId} options={UNIVERSE.map((u) => ({ value: u.assetId, label: `${u.name} (${u.underlying})` }))} />
            )}
            <Select
              label="Period"
              value={period}
              onChange={(v) => setPeriod(v as ReportPeriod)}
              options={(Object.keys(PERIOD_LABEL) as ReportPeriod[]).map((s) => ({ value: s, label: PERIOD_LABEL[s] }))}
              tip="Daily, weekly and monthly reports also list what changed since the last one of the same period."
            />
          </div>
          {personal && !viewer.address && <Notice>Connect a wallet so the report can read your vault.</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={build} disabled={busy || snap.status !== "ready" || (personal && !viewer.address)}>
              {busy ? "Building" : "Build report"}
            </Button>
          </div>
          {error && (
            <Notice tone={error.reason ? "warn" : "danger"}>
              <span role="alert">{error.text}</span>{" "}
              {(error.reason === "payment-required" || error.reason === "premium-required") && (
                <Link href="/research/plans" className="font-semibold underline">
                  See plans
                </Link>
              )}
            </Notice>
          )}
        </div>
      </Card>

      {open && (
        <section aria-label="Open report" className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <h2 className="text-sm font-semibold">Open report</h2>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => window.print()}>
                Print or save as PDF
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
                Close
              </Button>
            </div>
          </div>
          <ReportView report={open.report} sample={open.sample} />
        </section>
      )}

      <Card title="Past reports" flush>
        <div className="px-4 pb-4 pt-3 sm:px-5">
          {past.status === "loading" ? (
            <Skeleton className="h-16 w-full rounded-xl" />
          ) : past.status === "error" ? (
            <LoadError error={past.error} />
          ) : all.length === 0 ? (
            <Empty>No reports yet. Build one above.</Empty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {all.map(({ r, sample }) => (
                <li key={r.id} className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{reportTitle(r)}</span>
                    <span className="block text-xs text-muted">
                      {PERIOD_LABEL[r.period]} · built {fmtTime(r.createdAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {sample && <Badge tone="warn">Sample, saved in this browser</Badge>}
                    <Button variant="secondary" size="sm" onClick={() => setOpen({ report: r, sample })} aria-label={`Open ${reportTitle(r)}`}>
                      Open
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card title="Scheduled reports" tip="Reports built for you on a schedule. They never move money.">
        {sched.status === "loading" || !rows ? (
          sched.status === "error" ? (
            <LoadError error={sched.error} />
          ) : (
            <Skeleton className="h-16 w-full rounded-xl" />
          )
        ) : (
          <>
            {sched.status === "ready" && sched.from === "sample" && (
              <p className="mb-3 text-xs text-warn">Scheduled reports are not live yet. Switches here are a preview and are not saved.</p>
            )}
            <ul className="divide-y divide-line-soft">
              {rows.map((row) => {
                const label = `${PERIOD_LABEL[row.period]} ${SCOPE_LABEL[row.scope].toLowerCase()} report`;
                const needsWallet = (row.scope === "portfolio" || row.scope === "full") && !viewer.address;
                return (
                  <li key={`${row.scope}-${row.period}`} className="flex min-h-[52px] items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{label}</span>
                      {needsWallet && <span className="block text-xs text-muted">Connect a wallet first</span>}
                    </span>
                    <Switch on={row.enabled} label={label} disabled={needsWallet} onChange={(v) => toggle(row, v)} />
                  </li>
                );
              })}
            </ul>
            {schedMsg && (
              <p className="mt-2 text-xs text-muted" role="status">
                {schedMsg}
              </p>
            )}
          </>
        )}
      </Card>

      <Disclaimer />
    </>
  );
}
