import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryOnchainTail, supabaseOnchainTail } from "./onchain-tail.ts";

/** A fake of the two Supabase calls the store makes, backed by a Map. */
function fakeDb(fail = false) {
  const rows = new Map<string, unknown>();
  const err = fail ? { message: 'relation "research_onchain_tail" does not exist' } : null;
  const db = {
    from: (table: string) => {
      assert.equal(table, "research_onchain_tail");
      return {
        select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: rows.has(id) ? { state: rows.get(id) } : null, error: err }) }) }),
        upsert: async (row: { asset_id: string; state: unknown }) => {
          if (!fail) rows.set(row.asset_id, row.state);
          return { error: err };
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, rows };
}

test("the on-chain tail store saves and loads one row per asset", async () => {
  const { db, rows } = fakeDb();
  const store = supabaseOnchainTail<{ version: number; toBlock: number }>(db);
  assert.equal(await store.load("mSPX"), null);
  await store.save("mSPX", { version: 1, toBlock: 62_000_000 });
  assert.deepEqual(await store.load("mSPX"), { version: 1, toBlock: 62_000_000 });
  assert.equal(rows.size, 1);
});

test("a missing table is an error the reader turns into a problem line (it never returns a wrong state)", async () => {
  const store = supabaseOnchainTail(fakeDb(true).db);
  await assert.rejects(store.load("mSPX"), /research_onchain_tail/);
  await assert.rejects(store.save("mSPX", { version: 1 }), /research_onchain_tail/);
});

test("the in-memory store returns copies", async () => {
  const m = memoryOnchainTail<{ n: number }>();
  const s = { n: 1 };
  await m.save("mAAPL", s);
  s.n = 2;
  assert.deepEqual(await m.load("mAAPL"), { n: 1 });
});
