"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Field, Notice, PageHeader, Skeleton, cx } from "@/components/ui";
import type { ResearchNote } from "@/lib/research/types";
import { ApiError, approveWeekly, getSnapshot, getWeekly, gradeNote } from "./api";
import {
  AiLabel,
  AsOf,
  Disclaimer,
  LevelsRow,
  LoadError,
  ReasonList,
  ResearchAssetIcon,
  ResearchTabs,
  SampleBanner,
  ViewChip,
  assetName,
  fmtDate,
  thisMonday,
  useLoad,
} from "./bits";

const errText = (e: unknown) =>
  e instanceof ApiError && (e.status === 401 || e.status === 403)
    ? "Only reviewer wallets can do this. Sign in with a reviewer wallet."
    : e instanceof Error
      ? e.message
      : "That did not work.";

function Grade({ note, enabled }: { note: ResearchNote; enabled: boolean }) {
  const [grade, setGrade] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(g: number) {
    setBusy(true);
    setMsg(null);
    try {
      await gradeNote(note.date, note.assetId, g);
      setGrade(g);
      setMsg({ ok: true, text: `Graded ${g} of 5.` });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="min-w-0" disabled={!enabled || busy}>
      <legend className="mb-1.5 text-xs text-ink-soft">Would I pay for this? Grade 1 to 5</legend>
      <div className="flex flex-wrap gap-1.5">
        {[1, 2, 3, 4, 5].map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={grade === g}
            onClick={() => send(g)}
            className={cx(
              "inline-flex h-11 w-11 items-center justify-center rounded-[10px] border text-[13px] font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-9",
              grade === g ? "border-[color-mix(in_srgb,var(--brand)_45%,transparent)] bg-brand-soft text-brand-ink" : "border-line bg-popover text-ink hover:bg-hover",
            )}
          >
            {g}
          </button>
        ))}
      </div>
      {msg && (
        <p role="status" className={cx("mt-1.5 text-xs", msg.ok ? "text-grow" : "text-danger")}>
          {msg.text}
        </p>
      )}
    </fieldset>
  );
}

function NoteCard({ n, enabled }: { n: ResearchNote; enabled: boolean }) {
  const ok = n.status !== "no-reading";
  return (
    <article className="min-w-0 rounded-[14px] border border-line bg-popover px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <ResearchAssetIcon assetId={n.assetId} size={28} />
          <span className="min-w-0">
            <Link href={`/research/${n.assetId}`} className="block truncate text-[14px] font-medium text-ink hover:underline">
              {assetName(n.assetId)}
            </Link>
            <span className="block text-xs text-muted">
              {fmtDate(n.date)} · {n.status === "carried" ? "market closed, last note carried" : n.status === "no-reading" ? "no reading" : "fresh"}
            </span>
          </span>
        </span>
        {ok && <ViewChip view={n.view} conviction={n.conviction} />}
      </div>
      {ok ? (
        <>
          {n.previousView && n.previousView !== n.view && <Badge tone="warn">View changed since the last trading day</Badge>}
          <div className="mt-2 flex items-center gap-2">
            <AiLabel />
            <span className="text-xs text-muted">
              {n.model.triage}
              {n.model.escalated ? `, escalated to ${n.model.escalated}` : ""}
            </span>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-ink">{n.summary}</p>
          {n.levels && (
            <div className="mt-2">
              <LevelsRow levels={n.levels} compact at={n.dataAsOf} />
            </div>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-ink-soft">Reasons and risks</summary>
            <div className="mt-2 grid gap-3">
              <ReasonList items={n.reasons} facts={n.facts} />
              <ReasonList items={n.risks} facts={n.facts} empty="No risk named." />
            </div>
          </details>
          <div className="mt-3 border-t border-line-soft pt-3">
            <Grade note={n} enabled={enabled} />
          </div>
        </>
      ) : (
        <p className="mt-2 text-[13px] text-muted">No reading: data or the model failed. Nothing was filled in.</p>
      )}
    </article>
  );
}

function WeeklyApproval() {
  // Set after mount: the current date must not be read while the page is prerendered.
  const [weekOf, setWeekOf] = useState("");
  // Reading the date in the initial state would differ between the prerender and the browser.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setWeekOf(thisMonday()), []);
  const w = useLoad(() => getWeekly(weekOf || undefined), `weekly-${weekOf}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function approve(week: string) {
    setBusy(true);
    setMsg(null);
    try {
      await approveWeekly(week);
      setDone(week);
      setMsg({ ok: true, text: `The report for the week of ${fmtDate(week)} is approved and published.` });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Weekly report approval" tip="Nobody else sees a Monday report until a reviewer approves it. The risk reviewer can still block it.">
      <div className="max-w-xs">
        <Field label="Week of (Monday)" type="date" value={weekOf} onChange={(e) => setWeekOf(e.target.value)} />
      </div>
      <div className="mt-4">
        {w.status === "loading" || !weekOf ? (
          <Skeleton className="h-12 w-full rounded-xl" />
        ) : w.status === "error" ? (
          <LoadError error={w.error} />
        ) : w.from === "sample" ? (
          <Notice tone="warn">No live report could be loaded ({w.why ?? "service not live"}). The sample report cannot be approved.</Notice>
        ) : w.data.report.weekOf !== weekOf ? (
          <Notice>No report for the week of {fmtDate(weekOf)} yet. The latest one is for the week of {fmtDate(w.data.report.weekOf)}.</Notice>
        ) : (
          <div className="grid gap-3">
            <p className="text-[13px]">
              Week of {fmtDate(w.data.report.weekOf)} · <AsOf at={w.data.report.generatedAt} label="written" /> ·{" "}
              {w.data.report.review.approved || done === weekOf ? <Badge tone="grow">Published</Badge> : <Badge tone="warn">Waiting for approval</Badge>}
            </p>
            <p className="text-xs text-muted">
              Risk review: {w.data.report.review.removedClaims} claims removed, {w.data.report.review.sentBack} sections sent back.
              {w.data.report.review.notes.length > 0 && ` Notes: ${w.data.report.review.notes.join(" ")}`}
            </p>
            {!w.data.report.review.approved && done !== weekOf && (
              <div>
                <Button disabled={busy} onClick={() => approve(weekOf)}>
                  {busy ? "Publishing" : "Approve and publish"}
                </Button>
              </div>
            )}
          </div>
        )}
        {msg && (
          <p role="status" className={cx("mt-2 text-xs", msg.ok ? "text-grow" : "text-danger")}>
            {msg.text}
          </p>
        )}
      </div>
    </Card>
  );
}

export function ReviewPage() {
  const snap = useLoad(getSnapshot, "snapshot");
  const ready = snap.status === "ready";
  const internal = ready && snap.data.internal && snap.data.snapshot.kind === "live";
  return (
    <>
      <PageHeader title="Review" lead="Internal while testing: daily notes, grades and approving the Monday report." />
      <ResearchTabs />
      <Notice>
        Daily notes are internal while the quality bar is being proven. Only reviewer wallets see live notes, can grade them and can publish a weekly
        report.
      </Notice>

      <WeeklyApproval />

      {snap.status === "error" && <LoadError error={snap.error} />}
      {ready && !internal && (
        <SampleBanner show what="set of daily notes" why={snap.from === "sample" ? (snap.why ?? "The notes service is not live.") : "Sign in with a reviewer wallet to see live notes."} />
      )}
      <Card
        title={ready ? `Daily notes, ${fmtDate(snap.data.snapshot.date)}` : "Daily notes"}
        badge={internal ? <Badge tone="brand">Internal</Badge> : <Badge tone="warn">Preview, grading off</Badge>}
        action={ready ? <AsOf at={snap.data.snapshot.generatedAt} label="Run" /> : undefined}
      >
        {snap.status === "loading" ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : ready ? (
          <>
            {snap.data.snapshot.costUsd !== undefined && <p className="mb-3 text-xs text-muted">Model cost for this run: ${snap.data.snapshot.costUsd.toFixed(2)}</p>}
            <ul className="grid gap-3 lg:grid-cols-2">
              {snap.data.snapshot.notes.map((n) => (
                <li key={n.assetId} className="min-w-0">
                  <NoteCard n={n} enabled={internal} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>

      <Disclaimer />
    </>
  );
}
