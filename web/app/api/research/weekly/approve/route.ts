import { configured, db, json, sessionWallet } from "@/lib/server/backend";
import { isReviewer } from "@/lib/research/engine/reviewers";
import { approveReply } from "@/lib/research/engine/snapshot";
import { supabaseStore } from "@/lib/research/engine/store";

/** POST /api/research/weekly/approve { weekOf } -> { ok: true }. Reviewers only (RESEARCH_REVIEWERS). */
export async function POST(request: Request) {
  const wallet = sessionWallet(request);
  const body = await request.json().catch(() => null);
  const reply = await approveReply(configured() ? supabaseStore(db()) : null, wallet, isReviewer(wallet), body);
  return json(reply.body, reply.status);
}
