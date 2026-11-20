import { configured, db, json } from "@/lib/server/backend";
import { cronAuthorized } from "@/lib/server/keeper";
import { researchFlags } from "@/lib/research/flags";
import { runDaily } from "@/lib/research/engine/daily";
import { defaultGather } from "@/lib/research/engine/gather";
import { callModel } from "@/lib/research/engine/model";
import { supabaseStore } from "@/lib/research/engine/store";

/**
 * Daily research run (internal notes while testing), called by Vercel's cron (web/vercel.json,
 * 22:30 UTC Monday to Friday, after the US close) with `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Needs (server only, set by the founder): CRON_SECRET, RESEARCH_ENGINE_ENABLED=true,
 * ANTHROPIC_API_KEY, the account database with the research_* tables, and the data source from
 * gg/research-data. Without them it does nothing and says what is missing.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) return json({ error: "Not allowed." }, 401);
  const flags = researchFlags();
  if (!flags.engineEnabled) return json({ error: "The research engine is off (RESEARCH_ENGINE_ENABLED and ANTHROPIC_API_KEY)." }, 503);
  if (!configured()) return json({ error: "The account database is not connected yet." }, 503);
  if (!defaultGather) return json({ error: "The research data source is not connected yet." }, 503);
  try {
    const outcome = await runDaily({ gather: defaultGather, model: callModel, store: supabaseStore(db()), maxRunCostUsd: flags.maxRunCostUsd, maxDayCostUsd: flags.maxDayCostUsd });
    return json(outcome, outcome.status === "ok" ? 200 : 500);
  } catch (e) {
    // Only the message, never request details or keys.
    return json({ error: "Research run failed.", detail: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, 500);
  }
}
