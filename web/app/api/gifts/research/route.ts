import { connection } from "next/server";
import { researchPick } from "@/lib/gifts/mix";
import { supabaseStore } from "@/lib/research/engine/store";
import { UNIVERSE } from "@/lib/research/universe";
import { configured, db, json } from "@/lib/server/backend";

/**
 * GET /api/gifts/research -> { pick: { weekOf, source, legs: [{ assetId, weightBps }] } | null, reason? }
 *
 * The mix a research-pick gift box buys when it is opened: built from the latest APPROVED live
 * weekly report only (never the labelled sample, never an unapproved draft), and only from the six
 * researched assets. Sends nothing else from the report and spends no report credit.
 */
export async function GET() {
  await connection();
  if (!configured()) return json({ pick: null, reason: "The research database is not connected here." });
  try {
    const latest = await supabaseStore(db()).latestWeekly(true);
    if (!latest?.approved) return json({ pick: null, reason: "There is no approved weekly research report yet." });
    const pick = researchPick(latest.report, UNIVERSE.map((a) => a.assetId));
    return json(
      pick
        ? { pick }
        : { pick: null, reason: `The approved report for the week of ${latest.report.weekOf} rates no asset Accumulate or Hold, so there is no research pick this week.` },
    );
  } catch {
    return json({ pick: null, reason: "Could not read the research right now." }, 502);
  }
}
