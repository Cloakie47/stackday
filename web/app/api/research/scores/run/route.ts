import { configured, db, json, today } from "@/lib/server/backend";
import { cronAuthorized } from "@/lib/server/keeper";
import { runScoreUpdate } from "@/lib/research/engine/snapshot";
import { supabaseStore } from "@/lib/research/engine/store";

/**
 * Score update, called by Vercel's cron (web/vercel.json, 23:00 UTC Monday to Friday, after the
 * daily run) with `Authorization: Bearer ${CRON_SECRET}`. Code only, no model calls.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) return json({ error: "Not allowed." }, 401);
  if (!configured()) return json({ error: "The account database is not connected yet." }, 503);
  try {
    return json(await runScoreUpdate(supabaseStore(db()), today()));
  } catch (e) {
    return json({ error: "Score update failed.", detail: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, 500);
  }
}
