import { connection } from "next/server";
import { configured, db, json, today } from "@/lib/server/backend";
import { scoresReply } from "@/lib/research/engine/snapshot";
import { supabaseStore } from "@/lib/research/engine/store";

/** GET /api/research/scores?asset=mAAPL -> { scores: DailyScore[], calibration }. Public, wrong calls included. */
export async function GET(request: Request) {
  await connection();
  const assetId = new URL(request.url).searchParams.get("asset");
  const reply = await scoresReply(configured() ? supabaseStore(db()) : null, assetId, today());
  return json(reply.body, reply.status, reply.publicCache ? { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } : {});
}
