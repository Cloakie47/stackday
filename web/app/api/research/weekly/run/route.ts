import { configured, db, json } from "@/lib/server/backend";
import { cronAuthorized } from "@/lib/server/keeper";
import { researchFlags } from "@/lib/research/flags";
import { defaultGather, defaultGatherMarket } from "@/lib/research/engine/gather";
import { callModel } from "@/lib/research/engine/model";
import { supabaseStore } from "@/lib/research/engine/store";
import { runWeekly } from "@/lib/research/engine/weekly";

/**
 * Monday weekly report, ONE STEP PER CALL, called by Vercel's cron with
 * `Authorization: Bearer ${CRON_SECRET}`. web/vercel.json calls it once an hour on Monday from
 * 12:00 to 21:00 UTC (`?slot=1` to `?slot=10`; Vercel Hobby fires each entry at some time within
 * its hour and may deliver it twice):
 * - each call first takes the week's lease (a reserved row in research_weekly_sections); a call that
 *   does not get it exits without spending anything;
 * - each call researches the next asset that has no section yet (or a failed one, at most twice);
 * - when every asset has a section, the next call writes the report (summary, ideas, scorecard);
 * - slot 9 and later, and any call on Monday from 19:30 UTC, always write the report: assets not
 *   finished by then are shown as "no reading";
 * - once the week has a report, every later call does nothing (a re-run never replaces it or
 *   un-approves it).
 * Each call stays under 300 seconds (Vercel Hobby): the engine stops model calls at 270 seconds.
 *
 * The report is written unapproved: nobody but the reviewers sees it until one of them approves it
 * (POST /api/research/weekly/approve with its runId).
 *
 * The weekly cap RESEARCH_MAX_WEEKLY_RUN_COST_USD (default $4, researchFlags().maxWeeklyRunCostUsd)
 * covers all weekly calls of one week; the per-day cap (RESEARCH_MAX_DAY_COST_USD) always applies.
 */
export const maxDuration = 300;

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
      slot: parseSlot(new URL(request.url).searchParams.get("slot")),
    });
    // The report itself is read through GET /api/research/weekly; the cron only gets the summary.
    const outcome = { ...result, report: undefined };
    return json(outcome, outcome.status === "ok" || outcome.status === "skipped" ? 200 : 500);
  } catch (e) {
    return json({ error: "Weekly research run failed.", detail: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, 500);
  }
}

/** `?slot=` as a whole number from 1 to 10, or undefined (the engine then goes by the time). */
function parseSlot(v: string | null): number | undefined {
  const n = Number(v);
  return v !== null && Number.isInteger(n) && n >= 1 && n <= 10 ? n : undefined;
}
