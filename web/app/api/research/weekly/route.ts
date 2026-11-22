import { connection } from "next/server";
import { configured, db, json, sessionWallet } from "@/lib/server/backend";
import { checkReportAccess, consumeReportCredit } from "@/lib/research/access/gate";
import { researchFlags } from "@/lib/research/flags";
import { isReviewer } from "@/lib/research/engine/reviewers";
import { weeklyReply } from "@/lib/research/engine/snapshot";
import { supabaseStore } from "@/lib/research/engine/store";

/**
 * GET /api/research/weekly?weekOf=YYYY-MM-DD -> { report: WeeklyReport, access: AccessCheck }.
 * Latest approved report when weekOf is missing; unapproved reports only for reviewers; the
 * labelled sample (kind "sample") when there is none or the database is not connected.
 * A paid report is sent only after its credit was spent: if spending fails the answer is 402 with
 * no report. Answers that went through a paid access check are never publicly cached.
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
    consume: async (week) => {
      if (!wallet) throw new Error("no wallet to spend a credit from");
      await consumeReportCredit(wallet, week);
    },
    paidCheck: researchFlags().paywallEnabled && Boolean(wallet),
  });
  return json(reply.body, reply.status, reply.publicCache ? { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } : {});
}
