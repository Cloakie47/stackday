import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyScore, IsoDate, MarketOverview, ResearchNote, ResearchSnapshot, WeeklyAssetSection, WeeklyReport } from "../types.ts";
import { isNote, isWeeklyReport } from "./validate.ts";

/**
 * Where runs, notes, weekly reports and scores are kept: the research_* tables in
 * supabase/schema.sql, written with the service role on the server only.
 * A run writes its rows only after every check passed, in one final step; a failed or over-budget
 * run writes only its research_runs row, so the last good note or report stays live.
 * For daily notes the research_market row is written last and acts as the commit marker.
 * The weekly report is built one asset per invocation (research_weekly_sections), then written once:
 * an existing report for a week is never overwritten, so a re-run cannot hide an approved report.
 */

export type RunKind = "daily" | "weekly";
export type RunStatus = "running" | "ok" | "failed" | "aborted-cost";

export type RunStart = { runId: string; kind: RunKind; date: IsoDate; models: Record<string, string>; promptVersion: string };
export type RunFinish = {
  status: Exclude<RunStatus, "running">;
  costUsd: number;
  detail: string;
  dataHash: string | null;
  /** Snapshot of the input data the run used (so a report can be reproduced). */
  inputs?: unknown;
  /** Raw model output of every call (step, model, stop reason, text, cost). */
  outputs?: unknown;
};

export type StoredWeekly = { report: WeeklyReport; approved: boolean };

/** One asset's part of a weekly report, kept between invocations. */
export type StoredSection = {
  assetId: string;
  runId: string;
  failed: boolean;
  attempts: number;
  costUsd: number;
  result: { section: WeeklyAssetSection; approved: boolean; sentBack: number; removed: number; notes: string[] };
};

export interface ResearchStore {
  startRun(run: RunStart): Promise<void>;
  finishRun(runId: string, f: RunFinish): Promise<void>;
  /** Sets a running run's spend so far (settled plus reserved), written before every model call. */
  recordSpend(runId: string, costUsd: number): Promise<void>;
  /** Sum of the cost of every run started on this UTC date (for the per-day cap). */
  daySpend(date: IsoDate): Promise<number>;
  /** Sum of the cost of the weekly runs from `weekOf` to six days later (for the weekly cap). */
  weeklySpend(weekOf: IsoDate): Promise<number>;
  /** Writes one finished daily run: first scores (facts share, price), then notes, then the market row. */
  writeDaily(runId: string, date: IsoDate, notes: ResearchNote[], market: MarketOverview, scores: DailyScore[]): Promise<void>;
  latestSnapshot(): Promise<ResearchSnapshot | null>;
  /** Notes between two dates (inclusive), oldest first; all assets when assetId is null. */
  notes(assetId: string | null, from: IsoDate, to: IsoDate): Promise<ResearchNote[]>;
  /** One asset's newest notes, oldest first. */
  history(assetId: string, limit: number): Promise<ResearchNote[]>;
  /** Writes a finished report unapproved. Never overwrites: false when the week already has one. */
  writeWeekly(runId: string, report: WeeklyReport): Promise<boolean>;
  weekly(weekOf: IsoDate): Promise<StoredWeekly | null>;
  /** Run id of the report written for this week, or null when there is none. */
  weeklyRunId(weekOf: IsoDate): Promise<string | null>;
  weeklySections(weekOf: IsoDate): Promise<StoredSection[]>;
  saveWeeklySection(weekOf: IsoDate, s: StoredSection): Promise<void>;
  /** Newest report; only approved ones when `approvedOnly`. */
  latestWeekly(approvedOnly: boolean): Promise<StoredWeekly | null>;
  /** Up to `n` reports before `weekOf`, newest first. */
  weekliesBefore(weekOf: IsoDate, n: number): Promise<StoredWeekly[]>;
  /** Approves exactly the report the reviewer read: matched on week and run id. */
  approveWeekly(weekOf: IsoDate, runId: string, reviewer: string): Promise<boolean>;
  scores(assetId: string | null, from: IsoDate): Promise<DailyScore[]>;
  /** Writes the automatic part of each score; never touches the human grade. */
  upsertScores(rows: DailyScore[]): Promise<void>;
  gradeScore(date: IsoDate, assetId: string, grade: number, reviewer: string): Promise<boolean>;
}

type MemRun = RunStart & Partial<Omit<RunFinish, "status">> & { status: RunStatus; costUsd: number };

/** Keeps everything in memory. For tests. */
export function memoryStore() {
  const runs = new Map<string, MemRun>();
  const notes = new Map<string, ResearchNote>(); // date|asset
  const market = new Map<IsoDate, { runId: string; overview: MarketOverview }>();
  const weeklies = new Map<IsoDate, StoredWeekly & { runId: string; reviewer?: string }>();
  const sections = new Map<string, StoredSection>(); // week|asset
  const scores = new Map<string, DailyScore>(); // date|asset
  const writes = { daily: 0, weekly: 0 };
  const key = (d: string, a: string) => `${d}|${a}`;
  const store: ResearchStore = {
    async startRun(run) {
      runs.set(run.runId, { ...run, status: "running", costUsd: 0 });
    },
    async finishRun(runId, f) {
      const r = runs.get(runId);
      if (r) runs.set(runId, { ...r, ...f });
    },
    async recordSpend(runId, costUsd) {
      const r = runs.get(runId);
      if (r) runs.set(runId, { ...r, costUsd });
    },
    async daySpend(date) {
      return [...runs.values()].filter((r) => r.date === date).reduce((s, r) => s + r.costUsd, 0);
    },
    async weeklySpend(weekOf) {
      const end = new Date(Date.parse(`${weekOf}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
      return [...runs.values()].filter((r) => r.kind === "weekly" && r.date >= weekOf && r.date <= end).reduce((s, r) => s + r.costUsd, 0);
    },
    async writeDaily(runId, date, list, overview, rows) {
      writes.daily++;
      await store.upsertScores(rows);
      for (const n of list) notes.set(key(date, n.assetId), n);
      market.set(date, { runId, overview });
    },
    async latestSnapshot() {
      const date = [...market.keys()].sort().at(-1);
      if (!date) return null;
      const m = market.get(date)!;
      const list = [...notes.values()].filter((n) => n.date === date);
      return { kind: "live", date, generatedAt: list[0]?.generatedAt ?? `${date}T00:00:00Z`, runId: m.runId, market: m.overview, notes: list, costUsd: runs.get(m.runId)?.costUsd };
    },
    async notes(assetId, from, to) {
      return [...notes.values()].filter((n) => (!assetId || n.assetId === assetId) && n.date >= from && n.date <= to).sort((a, b) => a.date.localeCompare(b.date));
    },
    async history(assetId, limit) {
      return [...notes.values()].filter((n) => n.assetId === assetId).sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
    },
    async writeWeekly(runId, report) {
      if (weeklies.has(report.weekOf)) return false;
      writes.weekly++;
      weeklies.set(report.weekOf, { report, approved: false, runId });
      return true;
    },
    async weekly(weekOf) {
      const w = weeklies.get(weekOf);
      return w ? { report: w.report, approved: w.approved } : null;
    },
    async weeklyRunId(weekOf) {
      return weeklies.get(weekOf)?.runId ?? null;
    },
    async weeklySections(weekOf) {
      return [...sections.entries()].filter(([k]) => k.startsWith(`${weekOf}|`)).map(([, s]) => s);
    },
    async saveWeeklySection(weekOf, s) {
      sections.set(key(weekOf, s.assetId), s);
    },
    async latestWeekly(approvedOnly) {
      const list = [...weeklies.values()].filter((w) => !approvedOnly || w.approved).sort((a, b) => b.report.weekOf.localeCompare(a.report.weekOf));
      return list[0] ? { report: list[0].report, approved: list[0].approved } : null;
    },
    async weekliesBefore(weekOf, n) {
      return [...weeklies.values()]
        .filter((w) => w.report.weekOf < weekOf)
        .sort((a, b) => b.report.weekOf.localeCompare(a.report.weekOf))
        .slice(0, n)
        .map((w) => ({ report: w.report, approved: w.approved }));
    },
    async approveWeekly(weekOf, runId, reviewer) {
      const w = weeklies.get(weekOf);
      if (!w || w.runId !== runId) return false;
      weeklies.set(weekOf, { ...w, approved: true, reviewer });
      return true;
    },
    async scores(assetId, from) {
      return [...scores.values()].filter((s) => (!assetId || s.assetId === assetId) && s.date >= from).sort((a, b) => a.date.localeCompare(b.date));
    },
    async upsertScores(rows) {
      for (const r of rows) {
        const old = scores.get(key(r.date, r.assetId));
        scores.set(key(r.date, r.assetId), { ...r, ...(old?.humanGrade !== undefined ? { humanGrade: old.humanGrade } : {}) });
      }
    },
    async gradeScore(date, assetId, grade) {
      const old = scores.get(key(date, assetId));
      if (!old) return false;
      scores.set(key(date, assetId), { ...old, humanGrade: grade });
      return true;
    },
  };
  return { store, runs, notes, market, weeklies, sections, scores, writes };
}

const isScore = (x: unknown): x is DailyScore =>
  typeof x === "object" && x !== null && typeof (x as DailyScore).assetId === "string" && typeof (x as DailyScore).date === "string" && typeof (x as DailyScore).priceAtNote === "number";

/** The real store on the account database. Pass `db()` from lib/server/backend. */
export function supabaseStore(db: SupabaseClient): ResearchStore {
  const fail = (what: string, e: { message: string } | null) => {
    if (e) throw new Error(`${what}: ${e.message}`);
  };
  const weeklyRow = (r: { body: unknown; approved: boolean } | null | undefined): StoredWeekly | null =>
    r && isWeeklyReport(r.body) ? { report: r.body, approved: r.approved } : null;
  const store: ResearchStore = {
    async startRun(run) {
      const { error } = await db
        .from("research_runs")
        .insert({ run_id: run.runId, kind: run.kind, run_date: run.date, status: "running", models: run.models, prompt_version: run.promptVersion });
      fail("start run", error);
    },
    async finishRun(runId, f) {
      const { error } = await db
        .from("research_runs")
        .update({
          status: f.status,
          cost_usd: Number(f.costUsd.toFixed(4)),
          detail: f.detail.slice(0, 4000),
          data_hash: f.dataHash,
          inputs: f.inputs ?? null,
          outputs: f.outputs ?? null,
          finished_at: new Date().toISOString(),
        })
        .eq("run_id", runId);
      fail("finish run", error);
    },
    async recordSpend(runId, costUsd) {
      const { error } = await db.from("research_runs").update({ cost_usd: Number(costUsd.toFixed(4)) }).eq("run_id", runId);
      fail("record spend", error);
    },
    async daySpend(date) {
      const { data, error } = await db.from("research_runs").select("cost_usd").eq("run_date", date);
      fail("read day spend", error);
      return (data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    },
    async weeklySpend(weekOf) {
      const end = new Date(Date.parse(`${weekOf}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await db.from("research_runs").select("cost_usd").eq("kind", "weekly").gte("run_date", weekOf).lte("run_date", end);
      fail("read weekly spend", error);
      return (data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    },
    async writeDaily(runId, date, notes, market, scores) {
      await store.upsertScores(scores);
      const rows = notes.map((n) => ({ run_date: date, asset_id: n.assetId, run_id: runId, view: n.view, note: n }));
      const { error } = await db.from("research_notes").upsert(rows, { onConflict: "run_date,asset_id" });
      fail("write notes", error);
      const { error: e2 } = await db.from("research_market").upsert({ run_date: date, run_id: runId, overview: market }, { onConflict: "run_date" });
      fail("write market", e2);
    },
    async latestSnapshot() {
      const { data: m, error } = await db.from("research_market").select("run_date, run_id, overview").order("run_date", { ascending: false }).limit(1);
      fail("read market", error);
      const row = m?.[0];
      if (!row) return null;
      const [{ data: notes, error: e2 }, { data: run }] = await Promise.all([
        db.from("research_notes").select("note").eq("run_date", row.run_date),
        db.from("research_runs").select("cost_usd, started_at").eq("run_id", row.run_id).maybeSingle(),
      ]);
      fail("read notes", e2);
      return {
        kind: "live",
        date: row.run_date,
        generatedAt: run?.started_at ?? new Date().toISOString(),
        runId: row.run_id,
        market: row.overview as MarketOverview,
        notes: (notes ?? []).map((r) => r.note).filter(isNote),
        costUsd: run?.cost_usd === undefined || run?.cost_usd === null ? undefined : Number(run.cost_usd),
      };
    },
    async notes(assetId, from, to) {
      let q = db.from("research_notes").select("note").gte("run_date", from).lte("run_date", to);
      if (assetId) q = q.eq("asset_id", assetId);
      const { data, error } = await q.order("run_date", { ascending: true }).limit(2000);
      fail("read notes", error);
      return (data ?? []).map((r) => r.note).filter(isNote);
    },
    async history(assetId, limit) {
      const { data, error } = await db.from("research_notes").select("note").eq("asset_id", assetId).order("run_date", { ascending: false }).limit(limit);
      fail("read history", error);
      return (data ?? []).map((r) => r.note).filter(isNote).reverse();
    },
    async writeWeekly(runId, report) {
      // Insert only: an existing row (maybe already approved) is left as it is.
      const { data, error } = await db
        .from("research_weekly")
        .upsert({ week_of: report.weekOf, run_id: runId, beta: report.beta, approved: false, published_at: null, reviewed_by: null, body: report }, { onConflict: "week_of", ignoreDuplicates: true })
        .select("week_of");
      fail("write weekly", error);
      return (data ?? []).length > 0;
    },
    async weeklyRunId(weekOf) {
      const { data, error } = await db.from("research_weekly").select("run_id").eq("week_of", weekOf).maybeSingle();
      fail("read weekly", error);
      return typeof data?.run_id === "string" ? data.run_id : null;
    },
    async weeklySections(weekOf) {
      const { data, error } = await db.from("research_weekly_sections").select("asset_id, run_id, failed, attempts, cost_usd, result").eq("week_of", weekOf);
      fail("read weekly sections", error);
      return (data ?? []).map((r) => ({ assetId: r.asset_id, runId: r.run_id, failed: r.failed, attempts: r.attempts, costUsd: Number(r.cost_usd ?? 0), result: r.result as StoredSection["result"] }));
    },
    async saveWeeklySection(weekOf, s) {
      const { error } = await db.from("research_weekly_sections").upsert(
        { week_of: weekOf, asset_id: s.assetId, run_id: s.runId, failed: s.failed, attempts: s.attempts, cost_usd: Number(s.costUsd.toFixed(4)), result: s.result, updated_at: new Date().toISOString() },
        { onConflict: "week_of,asset_id" },
      );
      fail("write weekly section", error);
    },
    async weekly(weekOf) {
      const { data, error } = await db.from("research_weekly").select("body, approved").eq("week_of", weekOf).maybeSingle();
      fail("read weekly", error);
      return weeklyRow(data);
    },
    async latestWeekly(approvedOnly) {
      let q = db.from("research_weekly").select("body, approved");
      if (approvedOnly) q = q.eq("approved", true);
      const { data, error } = await q.order("week_of", { ascending: false }).limit(1);
      fail("read weekly", error);
      return weeklyRow(data?.[0]);
    },
    async weekliesBefore(weekOf, n) {
      const { data, error } = await db.from("research_weekly").select("body, approved").lt("week_of", weekOf).order("week_of", { ascending: false }).limit(n);
      fail("read weeklies", error);
      return (data ?? []).map(weeklyRow).filter((w): w is StoredWeekly => w !== null);
    },
    async approveWeekly(weekOf, runId, reviewer) {
      const { data, error } = await db
        .from("research_weekly")
        .update({ approved: true, published_at: new Date().toISOString(), reviewed_by: reviewer })
        .eq("week_of", weekOf)
        .eq("run_id", runId)
        .select("week_of");
      fail("approve weekly", error);
      return (data ?? []).length > 0;
    },
    async scores(assetId, from) {
      let q = db.from("research_scores").select("score, human_grade").gte("run_date", from);
      if (assetId) q = q.eq("asset_id", assetId);
      const { data, error } = await q.order("run_date", { ascending: true }).limit(2000);
      fail("read scores", error);
      return (data ?? [])
        .map((r) => (isScore(r.score) ? { ...r.score, ...(typeof r.human_grade === "number" ? { humanGrade: r.human_grade } : {}) } : null))
        .filter((s): s is DailyScore => s !== null);
    },
    async upsertScores(rows) {
      if (!rows.length) return;
      // Only these columns are sent, so an existing human grade is kept on conflict.
      const payload = rows.map((r) => {
        const score: DailyScore = { ...r };
        delete score.humanGrade;
        return { run_date: r.date, asset_id: r.assetId, score, updated_at: new Date().toISOString() };
      });
      const { error } = await db.from("research_scores").upsert(payload, { onConflict: "run_date,asset_id" });
      fail("write scores", error);
    },
    async gradeScore(date, assetId, grade, reviewer) {
      const { data, error } = await db
        .from("research_scores")
        .update({ human_grade: grade, graded_by: reviewer, updated_at: new Date().toISOString() })
        .eq("run_date", date)
        .eq("asset_id", assetId)
        .select("run_date");
      fail("grade", error);
      return (data ?? []).length > 0;
    },
  };
  return store;
}
