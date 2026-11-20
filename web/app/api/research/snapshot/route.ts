import { connection } from "next/server";
import { configured, db, json, sessionWallet } from "@/lib/server/backend";
import { isReviewer } from "@/lib/research/engine/reviewers";
import { snapshotReply } from "@/lib/research/engine/snapshot";
import { supabaseStore } from "@/lib/research/engine/store";

/**
 * GET /api/research/snapshot -> { snapshot: ResearchSnapshot, internal: boolean }.
 * Daily notes are internal while testing: reviewers get the latest live notes, everyone else the
 * labelled sample with `internal: true`.
 */
export async function GET(request: Request) {
  await connection();
  const reviewer = isReviewer(sessionWallet(request));
  const reply = await snapshotReply(configured() && reviewer ? supabaseStore(db()) : null, reviewer);
  return json(reply.body, reply.status, reply.publicCache ? { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } : {});
}
