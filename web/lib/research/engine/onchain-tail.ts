import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where the on-chain price reader keeps the history it reads after the checked-in backfill file
 * (web/lib/research/data/onchain.ts, `DataDeps.onchainTail`). Each run loads what earlier runs
 * read, reads only the blocks and rounds since then, and saves the merged result, so the history
 * stays fresh with no redeploy and no manual refresh. One row per asset in research_onchain_tail.
 *
 * A missing table (schema.sql not applied yet) or any database error is thrown to the reader,
 * which adds a problem line and falls back to the backfill file plus a live read, as before.
 */
export type TailStore<S> = {
  load(assetId: string): Promise<S | null>;
  save(assetId: string, state: S): Promise<void>;
};

export function supabaseOnchainTail<S>(db: SupabaseClient): TailStore<S> {
  return {
    async load(assetId) {
      const { data, error } = await db.from("research_onchain_tail").select("state").eq("asset_id", assetId).maybeSingle();
      if (error) throw new Error(`read on-chain tail: ${error.message}`);
      return (data?.state as S | undefined) ?? null;
    },
    async save(assetId, state) {
      const { error } = await db.from("research_onchain_tail").upsert({ asset_id: assetId, state, updated_at: new Date().toISOString() }, { onConflict: "asset_id" });
      if (error) throw new Error(`save on-chain tail: ${error.message}`);
    },
  };
}

/** In-memory store with the same behaviour, for tests. */
export function memoryOnchainTail<S>(): TailStore<S> & { rows: Map<string, S> } {
  const rows = new Map<string, S>();
  return {
    rows,
    async load(assetId) {
      return rows.has(assetId) ? structuredClone(rows.get(assetId)!) : null;
    },
    async save(assetId, state) {
      rows.set(assetId, structuredClone(state));
    },
  };
}
