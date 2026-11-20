import { configured, db, json, sessionWallet } from "@/lib/server/backend";
import { isReviewer } from "@/lib/research/engine/reviewers";
import { gradeReply } from "@/lib/research/engine/snapshot";
import { supabaseStore } from "@/lib/research/engine/store";

/** POST /api/research/scores/grade { date, assetId, grade } -> { ok: true }. Reviewers only. */
export async function POST(request: Request) {
  const wallet = sessionWallet(request);
  const body = await request.json().catch(() => null);
  const reply = await gradeReply(configured() ? supabaseStore(db()) : null, wallet, isReviewer(wallet), body);
  return json(reply.body, reply.status);
}
