import { configured, db, json, sessionWallet } from "@/lib/server/backend";
import { isReviewer } from "@/lib/research/engine/reviewers";
import { approveReply } from "@/lib/research/engine/snapshot";
import { supabaseStore } from "@/lib/research/engine/store";

/**
 * POST /api/research/weekly/approve { weekOf, runId } -> { ok: true }. Reviewers only
 * (RESEARCH_REVIEWERS). `runId` is the report's runId, so only the version the reviewer read is approved.
 */
export async function POST(request: Request) {
  const wallet = sessionWallet(request);
  const body = await request.json().catch(() => null);
  const reply = await approveReply(configured() ? supabaseStore(db()) : null, wallet, isReviewer(wallet), body);
  return json(reply.body, reply.status);
}
