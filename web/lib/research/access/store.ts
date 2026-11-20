import type { Entitlement, Plan } from "../types.ts";
import { freeEntitlement } from "./entitlement.ts";
import type { Purpose } from "./prices.ts";

/**
 * Storage for entitlements and payments. Two implementations: Supabase (`research_entitlements`,
 * `research_payments`, server only) and memory (tests).
 *
 * Concurrency: every change is a compare-and-swap. `load` returns the row plus a token describing
 * it, and `save` writes only if the row still matches that token, so two requests that both read
 * "1 credit" cannot both spend it: the second save fails and `updateEntitlement` reads again.
 * Payments are deduplicated by the tx hash primary key.
 */

export type Loaded = { ent: Entitlement; token: unknown };

export type PaymentRow = {
  txHash: string;
  wallet: string;
  chainId: number;
  /** Decimal string with up to 6 places, for example "9" or "2.5". */
  amountUsdc: string;
  purpose: Purpose;
};

export interface AccessStore {
  load(wallet: string): Promise<Loaded>;
  /** Write `next` only if the row is unchanged since `prev` was loaded. False on a clash. */
  save(prev: Loaded, next: Entitlement): Promise<boolean>;
  /** Store a payment once. "duplicate" when this tx hash was stored before. */
  recordPayment(p: PaymentRow): Promise<"stored" | "duplicate">;
  /** Remove a payment row again (only used when granting failed right after storing it). */
  forgetPayment(txHash: string): Promise<void>;
}

/**
 * Read, change, write with retries on a clash. `change` returns the new entitlement, or null to
 * stop without writing. Returns what was written, or null when `change` said stop.
 */
export async function updateEntitlement(
  store: AccessStore,
  wallet: string,
  change: (ent: Entitlement) => Entitlement | null,
  attempts = 8,
): Promise<Entitlement | null> {
  for (let i = 0; i < attempts; i++) {
    const prev = await store.load(wallet);
    const next = change(prev.ent);
    if (!next) return null;
    if (await store.save(prev, { ...next, owner: wallet })) return next;
  }
  throw new Error("The entitlement is busy. Try again.");
}

// ---------------------------------------------------------------------------------------------
// Memory store (tests only: serverless instances do not share memory)
// ---------------------------------------------------------------------------------------------

export function memoryAccessStore(seed: Entitlement[] = []) {
  const rows = new Map<string, { ent: Entitlement; version: number }>();
  for (const e of seed) rows.set(e.owner, { ent: { ...e }, version: 1 });
  const payments = new Map<string, PaymentRow>();
  const tick = () => new Promise<void>((r) => setImmediate(r));

  const store: AccessStore & { payments: Map<string, PaymentRow>; peek(w: string): Entitlement | undefined } = {
    payments,
    peek: (w) => rows.get(w)?.ent,
    async load(wallet) {
      await tick();
      const row = rows.get(wallet);
      return { ent: row ? { ...row.ent, unlockedWeeks: [...row.ent.unlockedWeeks] } : freeEntitlement(wallet), token: row?.version ?? 0 };
    },
    async save(prev, next) {
      await tick();
      const current = rows.get(next.owner)?.version ?? 0;
      if (current !== prev.token) return false;
      rows.set(next.owner, { ent: { ...next }, version: current + 1 });
      return true;
    },
    async recordPayment(p) {
      await tick();
      if (payments.has(p.txHash)) return "duplicate";
      payments.set(p.txHash, { ...p });
      return "stored";
    },
    async forgetPayment(txHash) {
      payments.delete(txHash);
    },
  };
  return store;
}

// ---------------------------------------------------------------------------------------------
// Supabase store (server only, service role key)
// ---------------------------------------------------------------------------------------------

type Row = {
  wallet: string;
  plan: Plan;
  valid_until: string | null;
  weekly_credits: number;
  unlocked_weeks: string[] | null;
  updated_at: string;
};

const COLUMNS = "wallet, plan, valid_until, weekly_credits, unlocked_weeks, updated_at";

const toEnt = (r: Row): Entitlement => ({
  owner: r.wallet,
  plan: r.plan,
  validUntil: r.valid_until ? new Date(r.valid_until).toISOString() : null,
  weeklyCredits: r.weekly_credits,
  unlockedWeeks: (r.unlocked_weeks ?? []).map((d) => String(d).slice(0, 10)),
});

/** Minimal slice of the Supabase client this store uses, so the route can pass `db()`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from(table: string): any };

/** A new updated_at that is always later than the old one, so it works as a row version. */
function nextStamp(old: string | null): string {
  const now = Date.now();
  const prev = old ? Date.parse(old) : Number.NaN;
  return new Date(Number.isFinite(prev) && prev >= now ? prev + 1 : now).toISOString();
}

export function supabaseAccessStore(db: () => Db): AccessStore {
  return {
    async load(wallet) {
      const { data, error } = await db().from("research_entitlements").select(COLUMNS).eq("wallet", wallet).maybeSingle();
      if (error) throw new Error("Could not read the entitlement.");
      return data ? { ent: toEnt(data as Row), token: data as Row } : { ent: freeEntitlement(wallet), token: null };
    },
    async save(prev, next) {
      const old = prev.token as Row | null;
      const values = {
        plan: next.plan,
        valid_until: next.validUntil,
        weekly_credits: next.weeklyCredits,
        unlocked_weeks: next.unlockedWeeks,
        updated_at: nextStamp(old?.updated_at ?? null),
      };
      if (!old) {
        const { error } = await db().from("research_entitlements").insert({ wallet: next.owner, ...values });
        if (!error) return true;
        if (error.code === "23505") return false; // a parallel request created the row first
        throw new Error("Could not save the entitlement.");
      }
      // Conditional update: updated_at is the row version (every save moves it forward), plus the
      // plan and credits we read. Zero rows changed means someone else wrote first.
      const { data, error } = await db()
        .from("research_entitlements")
        .update(values)
        .eq("wallet", old.wallet)
        .eq("plan", old.plan)
        .eq("weekly_credits", old.weekly_credits)
        .eq("updated_at", old.updated_at)
        .select("wallet");
      if (error) throw new Error("Could not save the entitlement.");
      return (data ?? []).length === 1;
    },
    async recordPayment(p) {
      const { error } = await db().from("research_payments").insert({
        tx_hash: p.txHash,
        wallet: p.wallet,
        chain_id: p.chainId,
        amount_usdc: p.amountUsdc,
        purpose: p.purpose,
      });
      if (!error) return "stored";
      if (error.code === "23505") return "duplicate";
      throw new Error("Could not store the payment.");
    },
    async forgetPayment(txHash) {
      await db().from("research_payments").delete().eq("tx_hash", txHash);
    },
  };
}
