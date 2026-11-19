import { configured, db, json } from "@/lib/server/backend";
import { universeAsset } from "@/lib/research/universe";
import { assetHistory } from "@/lib/research/engine/snapshot";
import { supabaseStore } from "@/lib/research/engine/store";

/**
 * Public: one asset's notes over time and how past suggestions turned out next to plain weekly
 * buying. GET /api/research/history?asset=mAAPL. Rate limited like every /api read (proxy.ts).
 */
export async function GET(request: Request) {
  const assetId = new URL(request.url).searchParams.get("asset") ?? "";
  if (!universeAsset(assetId)) return json({ error: "Unknown asset." }, 400);
  const history = await assetHistory(configured() ? supabaseStore(db()) : null, assetId);
  return json(history, 200, { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" });
}
