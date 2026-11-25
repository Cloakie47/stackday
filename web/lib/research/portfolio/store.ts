import { configured, db } from "../../server/backend.ts";
import type { PortfolioInput } from "../types.ts";
import type { Catalog } from "./catalog.ts";
import type { PortfolioStore } from "./handlers.ts";
import { asWeeklyReport, type ResearchLoader } from "./research-source.ts";
import { parsePortfolioInput } from "./validate.ts";

/**
 * The Supabase side of the portfolio routes: table research_portfolios in supabase/schema.sql
 * (manual holdings only; vault holdings are read from the chain each time). Server only (service
 * role). Returns null when the account database is not connected, and the routes then say so.
 */
export function portfolioStore(catalog: Catalog): PortfolioStore | null {
  if (!configured()) return null;
  return {
    async loadPortfolio(wallet) {
      const { data, error } = await db().from("research_portfolios").select("input").eq("wallet", wallet).maybeSingle();
      if (error) throw new Error("load portfolio failed");
      if (!data) return null;
      // Re-check what comes back, so an old or hand-edited row cannot break the analysis.
      const parsed = parsePortfolioInput(data.input, catalog, { allowVault: false });
      return parsed.ok ? parsed.value : null;
    },
    async savePortfolio(wallet, input: PortfolioInput) {
      const { error } = await db().from("research_portfolios").upsert({ wallet, input, updated_at: new Date().toISOString() }, { onConflict: "wallet" });
      if (error) throw new Error("save portfolio failed");
    },
  };
}

/**
 * The default loader: the newest published (reviewer-approved) Monday report, read straight from
 * the research tables. No call back into this site's own API (no shared rate-limit bucket, no URL
 * built from the Host header). Daily notes are reviewer-only, so the public portfolio check never
 * reads them. Nothing connected or nothing published yet gives no research (and no views).
 */
export const publishedWeeklyLoader: ResearchLoader = async () => {
  if (!configured()) return { weekly: null, snapshot: null };
  const { data, error } = await db()
    .from("research_weekly")
    .select("body")
    .eq("approved", true)
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("load published weekly report failed");
  return { weekly: data ? asWeeklyReport(data.body) : null, snapshot: null };
};
