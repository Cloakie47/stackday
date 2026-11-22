import type { AccessCheck, Entitlement, IsoDate } from "../types.ts";
import { researchFlags } from "../flags.ts";
import { configured, db } from "../../server/backend.ts";
import { decideAccess, effectiveEntitlement, freeEntitlement, isSpendableWeek, unlockWeek } from "./entitlement.ts";
import { supabaseAccessStore, updateEntitlement, type AccessStore } from "./store.ts";

/**
 * The one access check every research route calls before showing something that may be paid.
 *
 * Founder spec section 6: the paywall stays off until the quality bar (section 7) has held and a
 * legal check is done. While it is off the weekly report is a free "beta" preview, and only the
 * portfolio check needs sign-in (it reads one person's holdings).
 *
 * RESEARCH_PAYWALL_ENABLED stays off until the quality bar (four Mondays in a row) and a legal
 * check are done. When it is on, the weekly report needs an active monthly plan, an already
 * unlocked Monday, or a Monday credit (rules in entitlement.ts, prices in prices.ts).
 */
export type ResearchProduct = "weekly-report" | "portfolio-check";

export type ReportRequest = {
  /** Signed-in wallet (lowercase) or null. */
  wallet: string | null;
  product: ResearchProduct;
  /** Monday of the weekly report asked for. */
  weekOf?: IsoDate;
};

/**
 * Thrown by consumeReportCredit when a credit cannot be spent: none left (a parallel request used
 * it), or the Monday is malformed, in the future or not published. The caller treats it, and any
 * other error, as "not allowed".
 */
export class NoReportCreditError extends Error {
  constructor(message = "No Monday report credit left.") {
    super(message);
    this.name = "NoReportCreditError";
  }
}

export type GateDeps = {
  paywallEnabled: boolean;
  store: AccessStore | null;
  now: Date;
  /** True when that Monday's report is published (reviewer-approved). Not checked when absent (tests). */
  isPublished?: (weekOf: IsoDate) => Promise<boolean>;
};

/** Reads research_weekly: a credit may only be spent on a Monday whose report is approved. */
async function publishedInDb(weekOf: IsoDate): Promise<boolean> {
  const { data, error } = await db().from("research_weekly").select("week_of").eq("week_of", weekOf).eq("approved", true).maybeSingle();
  if (error) throw new Error("Could not read the weekly report.");
  return !!data;
}

function defaultDeps(): GateDeps {
  const on = configured();
  return {
    paywallEnabled: researchFlags().paywallEnabled,
    store: on ? supabaseAccessStore(db) : null,
    now: new Date(),
    isPublished: on ? publishedInDb : async () => false,
  };
}

/** Same as checkReportAccess with the switches passed in. Used by the tests. */
export async function checkReportAccessWith(req: ReportRequest, deps: GateDeps): Promise<AccessCheck> {
  if (req.product === "portfolio-check" && !req.wallet) return { allowed: false, reason: "sign-in" };
  if (!deps.paywallEnabled) return { allowed: true, consumesCredit: false };

  let ent: Entitlement | null = null;
  if (req.wallet && deps.store && req.product === "weekly-report") {
    // If the database cannot be read, fall back to the free tier: paid reports stay closed.
    ent = await deps.store
      .load(req.wallet.toLowerCase())
      .then((l) => l.ent)
      .catch(() => null);
  }
  return decideAccess(req, ent, deps.now);
}

export async function checkReportAccess(req: ReportRequest): Promise<AccessCheck> {
  return checkReportAccessWith(req, defaultDeps());
}

/** Same as consumeReportCredit with the switches passed in. Used by the tests. */
export async function consumeReportCreditWith(wallet: string, weekOf: IsoDate, deps: GateDeps): Promise<void> {
  if (!deps.paywallEnabled) return;
  if (!deps.store) throw new NoReportCreditError();
  if (!isSpendableWeek(weekOf, deps.now)) throw new NoReportCreditError("That is not a Monday with a published report.");
  const published = deps.isPublished ? await deps.isPublished(weekOf).catch(() => false) : true;
  if (!published) throw new NoReportCreditError("That Monday's report is not published.");
  let refused: "no-credit" | "bad-week" | null = null;
  await updateEntitlement(deps.store, wallet.toLowerCase(), (ent) => {
    const u = unlockWeek(ent, weekOf, deps.now);
    refused = u.kind === "no-credit" || u.kind === "bad-week" ? u.kind : null;
    return u.kind === "unlocked" ? u.next : null; // already unlocked: nothing to write
  });
  if (refused === "bad-week") throw new NoReportCreditError("That is not a Monday with a published report.");
  if (refused) throw new NoReportCreditError();
}

/**
 * Called after a paid weekly report was unlocked, when the check said it consumes a credit.
 * Atomic: two parallel calls can never spend the same credit, and the same Monday is only ever
 * paid once (reopening it is free). With the paywall off it does nothing. Throws
 * NoReportCreditError when no credit is left, so the caller should call this before delivering.
 */
export async function consumeReportCredit(wallet: string, weekOf: IsoDate): Promise<void> {
  return consumeReportCreditWith(wallet, weekOf, defaultDeps());
}

/** The wallet's entitlement as it applies right now (an expired monthly plan shown as ended). */
export async function currentEntitlement(wallet: string, store: AccessStore | null, now: Date): Promise<Entitlement> {
  if (!store) return freeEntitlement(wallet);
  const { ent } = await store.load(wallet);
  return effectiveEntitlement(ent, now);
}
