import { connection } from "next/server";
import { configured, db, json, sessionWallet } from "@/lib/server/backend";
import { checkReportAccess, consumeReportCredit } from "@/lib/research/access/gate";
import { isReviewer } from "@/lib/research/engine/reviewers";
import { weeklyReply } from "@/lib/research/engine/snapshot";
import { supabaseStore } from "@/lib/research/engine/store";

/**
 * GET /api/research/weekly?weekOf=YYYY-MM-DD -> { report: WeeklyReport, access: AccessCheck }.
 * Latest approved report when weekOf is missing; unapproved reports only for reviewers; the
 * labelled sample (kind "sample") when there is none or the database is not connected.
 */
export async function GET(request: Request) {
  await connection();
  const wallet = sessionWallet(request);
  const reviewer = isReviewer(wallet);
  const weekOf = new URL(request.url).searchParams.get("weekOf");
  const reply = await weeklyReply(configured() ? supabaseStore(db()) : null, {
    weekOf,
    reviewer,
    access: () => checkReportAccess({ wallet, product: "weekly-report", ...(weekOf ? { weekOf } : {}) }),
  });
  const body = reply.body as { report?: { kind: string; weekOf: string } | null; access?: { allowed: boolean; consumesCredit?: boolean } };
  if (wallet && body.report?.kind === "live" && body.access?.allowed && body.access.consumesCredit) await consumeReportCredit(wallet, body.report.weekOf);
  return json(reply.body, reply.status, reply.publicCache ? { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } : {});
}
