import type { SupabaseClient } from "@supabase/supabase-js";
import type { IsoDate, MarketOverview, ResearchNote, ResearchSnapshot } from "../types.ts";
import { isNote } from "./validate.ts";

/**
 * Where runs, notes and market overviews are kept: the `research_runs`, `research_notes` and
 * `research_market` tables (supabase/schema.sql), written with the service role on the server.
 * The market row is written last and acts as the commit marker: the public snapshot only reads a
 * date whose market row exists, so a run that fails halfway never shows half a snapshot.
 */

export type RunStatus = "running" | "ok" | "failed" | "aborted-cost";

export interface ResearchStore {
  startRun(runId: string, date: IsoDate): Promise<void>;
  finishRun(runId: string, status: Exclude<RunStatus, "running">, costUsd: number, detail: string): Promise<void>;
  /** Writes one finished run: every note, then the market overview. */
  writeSnapshot(runId: string, date: IsoDate, notes: ResearchNote[], market: MarketOverview): Promise<void>;
  /** The newest committed snapshot, or null. */
  latestSnapshot(): Promise<ResearchSnapshot | null>;
  /** One asset's notes, oldest first, at most `limit` of the newest. */
  history(assetId: string, limit: number): Promise<ResearchNote[]>;
}

/** Keeps everything in memory. For tests. */
export function memoryStore() {
  const runs = new Map<string, { date: IsoDate; status: RunStatus; costUsd: number; detail: string; startedAt: string }>();
  const notes = new Map<string, ResearchNote>(); // key date|asset
  const market = new Map<IsoDate, { runId: string; overview: MarketOverview }>();
  const store: ResearchStore = {
    async startRun(runId, date) {
      runs.set(runId, { date, status: "running", costUsd: 0, detail: "", startedAt: new Date().toISOString() });
    },
    async finishRun(runId, status, costUsd, detail) {
      const r = runs.get(runId);
      if (r) runs.set(runId, { ...r, status, costUsd, detail });
    },
    async writeSnapshot(runId, date, list, overview) {
      for (const n of list) notes.set(`${date}|${n.assetId}`, n);
      market.set(date, { runId, overview });
    },
    async latestSnapshot() {
      const date = [...market.keys()].sort().at(-1);
      if (!date) return null;
      const m = market.get(date)!;
      const run = runs.get(m.runId);
      const list = [...notes.entries()].filter(([k]) => k.startsWith(`${date}|`)).map(([, n]) => n);
      return { kind: "live", date, generatedAt: run?.startedAt ?? new Date().toISOString(), runId: m.runId, market: m.overview, notes: list, costUsd: run?.costUsd };
    },
    async history(assetId, limit) {
      return [...notes.values()].filter((n) => n.assetId === assetId).sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
    },
  };
  return { store, runs, notes, market };
}

/** The real store on the account database. Pass `db()` from lib/server/backend. */
export function supabaseStore(db: SupabaseClient): ResearchStore {
  const fail = (what: string, e: { message: string } | null) => {
    if (e) throw new Error(`${what}: ${e.message}`);
  };
  return {
    async startRun(runId, date) {
      const { error } = await db.from("research_runs").insert({ run_id: runId, run_date: date, status: "running" });
      fail("start run", error);
    },
    async finishRun(runId, status, costUsd, detail) {
      const { error } = await db
        .from("research_runs")
        .update({ status, cost_usd: Number(costUsd.toFixed(4)), detail: detail.slice(0, 2000), finished_at: new Date().toISOString() })
        .eq("run_id", runId);
      fail("finish run", error);
    },
    async writeSnapshot(runId, date, notes, market) {
      const rows = notes.map((n) => ({ run_date: date, asset_id: n.assetId, run_id: runId, action: n.action, note: n }));
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
    async history(assetId, limit) {
      const { data, error } = await db
        .from("research_notes")
        .select("note")
        .eq("asset_id", assetId)
        .order("run_date", { ascending: false })
        .limit(limit);
      fail("read history", error);
      return (data ?? []).map((r) => r.note).filter(isNote).reverse();
    },
  };
}
