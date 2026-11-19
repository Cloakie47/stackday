"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Card, Empty, PageHeader, Segmented, Skeleton, cx } from "@/components/ui";
import { TIMEFRAMES, TIMEFRAME_LABEL, type Confidence, type Fact, type ResearchNote, type Scenario, type Timeframe } from "@/lib/research/types";
import { universeAsset } from "@/lib/research/universe";
import { getHistory } from "./api";
import {
  ACTION_LABEL,
  ActionBadge,
  AiLabel,
  AsOf,
  ConfidenceMeter,
  DataLabel,
  Disclaimer,
  FactLine,
  LevelsRow,
  LoadError,
  ReasonList,
  ResearchAssetIcon,
  ResearchTabs,
  SampleBanner,
  StanceText,
  StatusBadge,
  UniverseWarning,
  fmtDate,
  fmtUsd,
  useLoad,
  useSnapshot,
} from "./bits";

const LIKELY: Record<Confidence, string> = { low: "Less likely", medium: "Likely", high: "Most likely" };

function ScenarioBox({ name, s, facts, tone }: { name: string; s: Scenario; facts: Fact[]; tone: "grow" | "neutral" | "danger" }) {
  return (
    <div className="min-w-0 rounded-[14px] border border-line bg-popover px-4 py-3.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className={cx("text-[13px] font-semibold", tone === "grow" ? "text-grow" : tone === "danger" ? "text-danger" : "text-ink")}>{name}</h3>
        <span className="text-xs text-muted">{LIKELY[s.likelihood]}</span>
      </div>
      <ReasonList items={[s]} facts={facts} />
    </div>
  );
}

/** Price fact of a note, when it has one. */
const priceOf = (n: ResearchNote) => {
  const v = n.facts.find((f) => f.id === "px.last")?.value;
  return typeof v === "number" ? v : undefined;
};

function History({ assetId, latest }: { assetId: string; latest?: ResearchNote }) {
  const hist = useLoad(() => getHistory(assetId), `history-${assetId}`);
  if (hist.status === "loading") return <Skeleton className="h-32 w-full rounded-xl" />;
  if (hist.status === "error") return <LoadError error={hist.error} />;
  const rows = [...hist.data].sort((a, b) => b.date.localeCompare(a.date));
  if (rows.length === 0) return <Empty>No past suggestions yet. The log starts with the first daily run.</Empty>;
  const now = latest ? priceOf(latest) : undefined;
  return (
    <>
      {hist.from === "sample" && <p className="mb-3 text-xs text-warn">Sample history for the demo, not a real track record.</p>}
      <div className="-mx-4 overflow-x-auto border-t border-line-soft sm:-mx-5">
        <table className="dtable min-w-[34rem]">
          <caption className="sr-only">Past suggestions for {universeAsset(assetId)?.name ?? assetId}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Suggestion</th>
              <th scope="col">Confidence</th>
              <th scope="col" className="r">
                Price then
              </th>
              <th scope="col" className="r">
                Since then
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const then = priceOf(n);
              const move = then && now ? (now - then) / then : undefined;
              return (
                <tr key={n.date + n.generatedAt}>
                  <td className="whitespace-nowrap">{fmtDate(n.date)}</td>
                  <td>{n.status === "no-reading" ? <span className="text-muted">No reading</span> : <ActionBadge action={n.action} />}</td>
                  <td>
                    <ConfidenceMeter confidence={n.confidence} />
                  </td>
                  <td className="r">{then !== undefined ? fmtUsd(then) : "-"}</td>
                  <td className={cx("r", move === undefined ? "text-muted" : move >= 0 ? "text-grow" : "text-danger")}>
                    {move === undefined ? "-" : `${move >= 0 ? "+" : ""}${(move * 100).toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Every suggestion is logged, right or wrong. &ldquo;Since then&rdquo; is the price change to the latest note, not a return you would
        have made. Plain regular buying is the yardstick, and no claim is made that these suggestions beat it.
      </p>
    </>
  );
}

export function AssetResearch({ assetId }: { assetId: string }) {
  const u = universeAsset(assetId)!;
  const snap = useSnapshot();
  const [tf, setTf] = useState<Timeframe>("1d");
  const note = snap.status === "ready" ? snap.data.notes.find((n) => n.assetId === assetId) : undefined;
  const ready = snap.status === "ready";
  const usable = note && note.status !== "no-reading";

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link href="/research" className="inline-flex min-h-11 items-center hover:text-ink sm:min-h-0">
              Research
            </Link>
            <span aria-hidden>/</span>
            <span>{u.name}</span>
          </>
        }
        title={
          <span className="inline-flex items-center gap-3">
            <ResearchAssetIcon assetId={assetId} size={40} />
            {u.name}
          </span>
        }
        lead={`${u.underlying} · ${u.sector} · testnet token ${u.assetId} (mock)`}
        aside={
          usable ? (
            <span className="inline-flex items-center gap-3">
              <ActionBadge action={note.action} withTip />
              <ConfidenceMeter confidence={note.confidence} />
            </span>
          ) : undefined
        }
      />
      <ResearchTabs />

      {snap.status === "error" && <LoadError error={snap.error} />}
      <SampleBanner show={ready && snap.data.kind === "sample"} />
      <UniverseWarning assetId={assetId} />

      {snap.status === "loading" ? (
        <Card>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </Card>
      ) : ready && !usable ? (
        <Card title="Today's note">
          <Empty>No reading today for {u.name}. When data or the analysis fails, nothing is filled in to cover the gap.</Empty>
        </Card>
      ) : usable ? (
        <>
          <Card title={`Today's note, ${fmtDate(note.date)}`} badge={<AiLabel />} action={<StatusBadge status={note.status} />}>
            <p className="max-w-3xl text-[15px] leading-relaxed text-ink">{note.summary}</p>
            {note.previousAction && note.previousAction !== note.action && (
              <p className="mt-2 text-xs text-muted">
                Changed from {ACTION_LABEL[note.previousAction]} to {ACTION_LABEL[note.action]} since the last trading day.
              </p>
            )}
            <div className="mt-4 border-t border-line-soft pt-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-semibold text-ink">Levels</h3>
                <DataLabel />
              </div>
              {note.levels ? (
                <>
                  <LevelsRow levels={note.levels} />
                  <p className="mt-1.5 text-xs text-muted">{note.levels.basis}</p>
                </>
              ) : (
                <p className="text-[13px] text-muted">
                  {!u.publicPrice
                    ? "No entry, target or stop: there is no public market price."
                    : u.risk === "cash-like"
                      ? "No entry, target or stop: this fund is cash-like."
                      : "No entry, target or stop today: not enough price data."}
                </p>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <AsOf at={note.dataAsOf} label="Data as of" />
              <AsOf at={note.generatedAt} label="Written" />
              <span className="text-xs text-muted">
                Written by {note.model.triage}
                {note.model.escalated ? `, checked by ${note.model.escalated}` : ""}
              </span>
            </div>
          </Card>

          <Card title="Outlook by timeframe" badge={<AiLabel />}>
            <Segmented
              compact
              ariaLabel="Timeframe"
              value={tf}
              onChange={setTf}
              options={TIMEFRAMES.map((t) => ({ value: t, label: t, ariaLabel: TIMEFRAME_LABEL[t] }))}
            />
            <div className="mt-4" aria-live="polite">
              <p className="text-[13px]">
                <span className="text-muted">{TIMEFRAME_LABEL[tf]}:</span> <StanceText stance={note.outlook[tf]?.stance ?? "no-view"} />
              </p>
              <div className="mt-2">
                {note.outlook[tf] ? (
                  <ReasonList items={[note.outlook[tf]]} facts={note.facts} />
                ) : (
                  <p className="text-[13px] text-muted">No view for this timeframe.</p>
                )}
              </div>
            </div>
          </Card>

          <Card title="Why this suggestion" badge={<AiLabel />} tip="Every reason cites facts. A reason that cites no valid fact is dropped before it reaches this page.">
            <ReasonList items={note.reasons} facts={note.facts} />
          </Card>

          <Card title="Scenarios" badge={<AiLabel />}>
            <div className="grid gap-3 md:grid-cols-3">
              <ScenarioBox name="Bull case" s={note.scenarios.bull} facts={note.facts} tone="grow" />
              <ScenarioBox name="Base case" s={note.scenarios.base} facts={note.facts} tone="neutral" />
              <ScenarioBox name="Bear case" s={note.scenarios.bear} facts={note.facts} tone="danger" />
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Opportunities" badge={<AiLabel />}>
              <ReasonList items={note.opportunities} facts={note.facts} empty="None named today." />
            </Card>
            <Card title="Risks" badge={<AiLabel />}>
              <ReasonList items={note.risks} facts={note.facts} empty="None named today." />
            </Card>
          </div>

          <Card title="All facts used" badge={<DataLabel />} tip="Fetched by code, never written by the AI. Each shows its source and time.">
            {note.facts.length === 0 ? (
              <p className="text-[13px] text-muted">No facts.</p>
            ) : (
              <ul className="space-y-1.5">
                {note.facts.map((f) => (
                  <FactLine key={f.id} fact={f} />
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}

      <Card title="Past suggestions" badge={<Badge tone="neutral">Suggestion log</Badge>}>
        <History assetId={assetId} latest={note} />
      </Card>

      <Disclaimer />
    </>
  );
}
