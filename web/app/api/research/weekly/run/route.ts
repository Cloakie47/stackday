import { configured, db, json } from "@/lib/server/backend";
import { cronAuthorized } from "@/lib/server/keeper";
import { researchFlags } from "@/lib/research/flags";
import { defaultGather, defaultGatherMarket } from "@/lib/research/engine/gather";
import { callModel } from "@/lib/research/engine/model";
import { supabaseStore } from "@/lib/research/engine/store";
import { runWeekly } from "@/lib/research/engine/weekly";

/**
 * Monday weekly report run, called by Vercel's cron (web/vercel.json, Monday 12:00 UTC) with
 * `Authorization: Bearer ${CRON_SECRET}`. Writes the report unapproved: nobody but the reviewers
 * sees it until one of them approves it (POST /api/research/weekly/approve).
 *
 * The weekly run uses the strongest model for many steps, so it gets its own per-run cap:
 * RESEARCH_MAX_WEEKLY_RUN_COST_USD (default $4, researchFlags().maxWeeklyRunCostUsd).
 * The per-day cap (RESEARCH_MAX_DAY_COST_USD) always applies.
 */
export const maxDuration = 800;

export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) return json({ error: "Not allowed." }, 401);
  const flags = researchFlags();
  if (!flags.engineEnabled) return json({ error: "The research engine is off (RESEARCH_ENGINE_ENABLED and ANTHROPIC_API_KEY)." }, 503);
  if (!configured()) return json({ error: "The account database is not connected yet." }, 503);
  if (!defaultGather || !defaultGatherMarket) return json({ error: "The research data source is not connected yet." }, 503);
  try {
    const result = await runWeekly({
      gather: defaultGather,
      gatherMarket: defaultGatherMarket,
      model: callModel,
      store: supabaseStore(db()),
      maxRunCostUsd: flags.maxWeeklyRunCostUsd,
      maxDayCostUsd: flags.maxDayCostUsd,
    });
    // The report itself is read through GET /api/research/weekly; the cron only gets the summary.
    const outcome = { ...result, report: undefined };
    return json(outcome, outcome.status === "ok" ? 200 : 500);
  } catch (e) {
    return json({ error: "Weekly research run failed.", detail: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, 500);
  }
}
