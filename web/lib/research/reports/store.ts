import { configured, db } from "../../server/backend.ts";
import type { PortfolioInput, Report } from "../types.ts";
import type { ResearchStore } from "./handlers.ts";
import { parsePortfolioInput } from "../portfolio/validate.ts";
import { parseSchedule, type Schedule } from "./request.ts";

/**
 * The Supabase side of the research routes: tables research_reports, research_portfolios and
 * research_schedules in supabase/schema.sql. Server only (service role). Returns null when the
 * account database is not connected, and the routes then work without saving.
 */
export function researchStore(): ResearchStore | null {
  if (!configured()) return null;
  return supabaseStore;
}

const fail = (what: string, error: { message?: string } | null) => {
  if (error) throw new Error(`${what} failed`);
};

const supabaseStore: ResearchStore = {
  async saveReport(report) {
    const { error } = await db().from("research_reports").insert({
      id: report.id,
      wallet: report.owner,
      scope: report.scope,
      period: report.period,
      snapshot_date: report.snapshotDate,
      premium: report.premium,
      body: report,
      created_at: report.createdAt,
    });
    fail("save report", error);
  },
  async listReports(wallet, limit) {
    const { data, error } = await db().from("research_reports").select("body").eq("wallet", wallet).order("created_at", { ascending: false }).limit(limit);
    fail("list reports", error);
    return (data ?? []).map((r) => r.body as Report);
  },
  async previousReport(wallet, period, scope) {
    const { data, error } = await db()
      .from("research_reports")
      .select("body")
      .eq("wallet", wallet)
      .eq("period", period)
      .eq("scope", scope)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    fail("previous report", error);
    return (data?.body as Report | undefined) ?? null;
  },
  async loadPortfolio(wallet) {
    const { data, error } = await db().from("research_portfolios").select("input").eq("wallet", wallet).maybeSingle();
    fail("load portfolio", error);
    if (!data) return null;
    // Re-check what comes back, so an old or hand-edited row cannot break the analysis.
    const parsed = parsePortfolioInput(data.input, { allowVault: false });
    return parsed.ok ? parsed.value : null;
  },
  async savePortfolio(wallet, input: PortfolioInput) {
    const { error } = await db().from("research_portfolios").upsert({ wallet, input, updated_at: new Date().toISOString() }, { onConflict: "wallet" });
    fail("save portfolio", error);
  },
  async listSchedules(wallet) {
    const { data, error } = await db().from("research_schedules").select("scope, period, enabled").eq("wallet", wallet);
    fail("list schedules", error);
    const out: Schedule[] = [];
    for (const row of data ?? []) {
      const s = parseSchedule(row);
      if (s.ok) out.push(s.value);
    }
    return out.sort((a, b) => a.period.localeCompare(b.period) || a.scope.localeCompare(b.scope));
  },
  async saveSchedules(wallet, schedules) {
    const rows = schedules.map((s) => ({ wallet, scope: s.scope, period: s.period, enabled: s.enabled }));
    const { error } = await db().from("research_schedules").upsert(rows, { onConflict: "wallet,period,scope" });
    fail("save schedules", error);
  },
};
