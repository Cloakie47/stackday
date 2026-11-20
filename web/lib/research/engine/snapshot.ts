import sample from "../sample-snapshot.json" with { type: "json" };
import sampleWeeklyJson from "../sample-weekly.json" with { type: "json" };
import type { AccessCheck, DailyScore, IsoDate, ResearchSnapshot, Scorecard, View, Confidence, WeeklyReport } from "../types.ts";
import { universeAsset } from "../universe.ts";
import { calibration, notePrice, updateScores } from "./scores.ts";
import type { ResearchStore } from "./store.ts";
import { snapshotProblems, weeklyProblems } from "./validate.ts";

/**
 * What the research routes serve (API contract in docs/research/PLAN.md). Route files only read the
 * request and call these, so access rules are tested without a server.
 * - Daily notes are internal while testing: live notes for reviewers, the labelled sample
 *   (`kind: "sample"`) for everyone else, with `internal: true`.
 * - Weekly reports are public only once a reviewer approved them; reviewers see unapproved ones.
 * - Scores are public, wrong calls included.
 * With no database every route still answers, with the labelled sample or empty lists.
 */

export type Reply = { status: number; body: unknown; publicCache?: boolean };

export function sampleSnapshot(): ResearchSnapshot {
  const s = sample as unknown;
  const problems = snapshotProblems(s);
  if (problems.length || (s as ResearchSnapshot).kind !== "sample") throw new Error(`sample-snapshot.json is invalid: ${problems.slice(0, 3).join("; ")}`);
  return s as ResearchSnapshot;
}

export function sampleWeekly(): WeeklyReport {
  const r = sampleWeeklyJson as unknown;
  const problems = weeklyProblems(r);
  if (problems.length || (r as WeeklyReport).kind !== "sample") throw new Error(`sample-weekly.json is invalid: ${problems.slice(0, 3).join("; ")}`);
  return r as WeeklyReport;
}

/** GET /api/research/snapshot -> { snapshot, internal } */
export async function snapshotReply(store: ResearchStore | null, reviewer: boolean): Promise<Reply> {
  if (reviewer && store) {
    try {
      const live = await store.latestSnapshot();
      if (live && live.notes.length > 0) return { status: 200, body: { snapshot: live, internal: false } };
    } catch {
      // fall through to the sample
    }
  }
  return { status: 200, body: { snapshot: sampleSnapshot(), internal: !reviewer }, publicCache: !reviewer };
}

export type HistoryBody = {
  assetId: string;
  /** "sample" when the labelled sample is shown (non-reviewers, or nothing live yet). */
  kind: "live" | "sample";
  notes: { date: IsoDate; view: View; conviction: Confidence; price: number | null; summary: string }[];
  track: { calls: number; right: number };
};

export const HISTORY_LIMIT = 120;

/** GET /api/research/history?asset= */
export async function historyReply(store: ResearchStore | null, assetId: string, reviewer: boolean): Promise<Reply> {
  if (!universeAsset(assetId)) return { status: 400, body: { error: "Unknown asset." } };
  let kind: HistoryBody["kind"] = "sample";
  let notes = sampleSnapshot().notes.filter((n) => n.assetId === assetId);
  let track = { calls: 0, right: 0 };
  if (reviewer && store) {
    try {
      const live = await store.history(assetId, HISTORY_LIMIT);
      if (live.length) {
        kind = "live";
        notes = live;
        const scored = (await store.scores(assetId, live[0].date)).filter((s) => s.direction5d !== undefined);
        track = { calls: scored.length, right: scored.filter((s) => s.direction5d).length };
      }
    } catch {
      // keep the sample
    }
  }
  const body: HistoryBody = {
    assetId,
    kind,
    notes: notes.map((n) => ({ date: n.date, view: n.view, conviction: n.conviction, price: notePrice(n), summary: n.summary })),
    track,
  };
  return { status: 200, body, publicCache: !reviewer };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/research/weekly?weekOf= -> { report, access } */
export async function weeklyReply(
  store: ResearchStore | null,
  opts: { weekOf: string | null; reviewer: boolean; access: () => Promise<AccessCheck> },
): Promise<Reply> {
  if (opts.weekOf !== null && !DATE.test(opts.weekOf)) return { status: 400, body: { error: "weekOf must be YYYY-MM-DD." } };
  let report: WeeklyReport = sampleWeekly();
  if (store) {
    try {
      const found = opts.weekOf ? await store.weekly(opts.weekOf) : await store.latestWeekly(!opts.reviewer);
      if (found && (found.approved || opts.reviewer)) report = found.report;
    } catch {
      // keep the sample
    }
  }
  const access = await opts.access();
  if (!access.allowed && report.kind === "live") return { status: access.reason === "sign-in" ? 401 : 402, body: { report: null, access } };
  return { status: 200, body: { report, access }, publicCache: !opts.reviewer && report.kind === "sample" };
}

/** POST /api/research/weekly/approve { weekOf } */
export async function approveReply(store: ResearchStore | null, wallet: string | null, reviewer: boolean, body: unknown): Promise<Reply> {
  if (!wallet) return { status: 401, body: { error: "Sign in with your wallet first." } };
  if (!reviewer) return { status: 403, body: { error: "Only research reviewers can approve a report." } };
  const weekOf = (body as { weekOf?: unknown } | null)?.weekOf;
  if (typeof weekOf !== "string" || !DATE.test(weekOf)) return { status: 400, body: { error: "weekOf must be YYYY-MM-DD." } };
  if (!store) return { status: 503, body: { error: "The account database is not connected yet." } };
  const ok = await store.approveWeekly(weekOf, wallet);
  return ok ? { status: 200, body: { ok: true } } : { status: 404, body: { error: "No report for that week." } };
}

/** GET /api/research/scores?asset= -> { scores, calibration } (public). */
export async function scoresReply(store: ResearchStore | null, assetId: string | null, today: IsoDate): Promise<Reply> {
  if (assetId && !universeAsset(assetId)) return { status: 400, body: { error: "Unknown asset." } };
  let scores: DailyScore[] = [];
  if (store) {
    try {
      scores = await store.scores(assetId, addDays(today, -365));
    } catch {
      scores = [];
    }
  }
  const body: { scores: DailyScore[]; calibration: Scorecard["calibration"] } = { scores, calibration: calibration(scores) };
  return { status: 200, body, publicCache: true };
}

/** POST /api/research/scores/grade { date, assetId, grade } */
export async function gradeReply(store: ResearchStore | null, wallet: string | null, reviewer: boolean, body: unknown): Promise<Reply> {
  if (!wallet) return { status: 401, body: { error: "Sign in with your wallet first." } };
  if (!reviewer) return { status: 403, body: { error: "Only research reviewers can grade a note." } };
  const b = (body ?? {}) as { date?: unknown; assetId?: unknown; grade?: unknown };
  if (typeof b.date !== "string" || !DATE.test(b.date)) return { status: 400, body: { error: "date must be YYYY-MM-DD." } };
  if (typeof b.assetId !== "string" || !universeAsset(b.assetId)) return { status: 400, body: { error: "Unknown asset." } };
  if (typeof b.grade !== "number" || !Number.isInteger(b.grade) || b.grade < 1 || b.grade > 5) return { status: 400, body: { error: "grade must be a whole number from 1 to 5." } };
  if (!store) return { status: 503, body: { error: "The account database is not connected yet." } };
  const ok = await store.gradeScore(b.date, b.assetId, b.grade, wallet);
  return ok ? { status: 200, body: { ok: true } } : { status: 404, body: { error: "No scored note for that date and asset." } };
}

const addDays = (date: IsoDate, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Cron job: fills in 1 and 5 trading day results for open scores (the last 30 days). */
export async function runScoreUpdate(store: ResearchStore, today: IsoDate): Promise<{ checked: number; updated: number }> {
  const from = addDays(today, -30);
  const [scores, notes] = await Promise.all([store.scores(null, from), store.notes(null, from, today)]);
  const changed = updateScores(scores, notes);
  await store.upsertScores(changed);
  return { checked: scores.length, updated: changed.length };
}
