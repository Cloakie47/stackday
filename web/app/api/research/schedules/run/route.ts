import { randomUUID } from "node:crypto";
import { json } from "@/lib/server/backend";
import { cronAuthorized } from "@/lib/server/keeper";
import { checkReportAccess, consumeReportCredit } from "@/lib/research/access/gate";
import { runDueSchedules } from "@/lib/research/reports/scheduled";
import { fetchSnapshotLoader } from "@/lib/research/reports/snapshot-loader";
import { researchStore } from "@/lib/research/reports/store";

/**
 * Daily job (Vercel cron, after the research run): builds every scheduled report that is due and
 * saves it to its wallet's report list. Needs CRON_SECRET, like the keeper.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) return json({ error: "Not allowed." }, 401);
  const summary = await runDueSchedules({
    store: researchStore(),
    loadSnapshot: fetchSnapshotLoader(request.url),
    checkAccess: checkReportAccess,
    consumeCredit: consumeReportCredit,
    now: () => new Date(),
    newId: randomUUID,
    onError: (where, e) => console.error(`research ${where}:`, e instanceof Error ? e.message : "error"),
  });
  return json(summary, 200, { "Cache-Control": "no-store" });
}
