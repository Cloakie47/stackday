import { connection } from "next/server";
import { configured, db, json, sessionWallet } from "@/lib/server/backend";
import { isReviewer } from "@/lib/research/engine/reviewers";
import { historyReply } from "@/lib/research/engine/snapshot";
import { supabaseStore } from "@/lib/research/engine/store";

/**
 * GET /api/research/history?asset=mAAPL -> { assetId, kind, notes: { date, view, conviction, price,
 * summary }[], track: { calls, right } }. Live notes for reviewers, the labelled sample otherwise.
 */
export async function GET(request: Request) {
  await connection();
  const reviewer = isReviewer(sessionWallet(request));
  const assetId = new URL(request.url).searchParams.get("asset") ?? "";
  const reply = await historyReply(configured() && reviewer ? supabaseStore(db()) : null, assetId, reviewer);
  return json(reply.body, reply.status, reply.publicCache ? { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } : {});
}
