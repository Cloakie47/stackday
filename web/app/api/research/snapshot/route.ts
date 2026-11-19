import { connection } from "next/server";
import { configured, db, json } from "@/lib/server/backend";
import { publicSnapshot } from "@/lib/research/engine/snapshot";
import { supabaseStore } from "@/lib/research/engine/store";

/**
 * Public: the latest live research snapshot, or the labelled sample (kind "sample") when there is
 * none yet or the database is not connected. Rate limited like every /api read (proxy.ts).
 */
export async function GET() {
  // Read at request time (never prerendered at build), so a new run shows without a redeploy.
  await connection();
  const snapshot = await publicSnapshot(configured() ? supabaseStore(db()) : null);
  return json(snapshot, 200, { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" });
}
