import type { AccessCheck, Entitlement, ReportScope } from "../types.ts";
import { researchFlags } from "../flags.ts";
import { configured, db } from "../../server/backend.ts";
import { decideAccess, effectiveEntitlement, freeEntitlement, useCredit } from "./entitlement.ts";
import { supabaseAccessStore, updateEntitlement, type AccessStore } from "./store.ts";

/**
 * The one access check every report route calls before building a report.
 *
 * RESEARCH_PAYWALL_ENABLED off (the default until the founder agrees the pricing): personal
 * reports (portfolio, full) need sign-in, everything else is allowed, and no credit is ever used.
 *
 * On: market and asset reports stay free; portfolio and full reports need an active monthly or
 * yearly plan or a report credit; premium depth needs the premium add-on. Rules live in
 * entitlement.ts (`decideAccess`), prices in prices.ts.
 */
export type ReportRequest = {
  /** Signed-in wallet (lowercase) or null. */
  wallet: string | null;
  scope: ReportScope;
  premium: boolean;
};

/** Thrown by consumeReportCredit when the wallet has no credit left (a parallel request used it). */
export class NoReportCreditError extends Error {
  constructor() {
    super("No report credit left.");
    this.name = "NoReportCreditError";
  }
}

export type GateDeps = { paywallEnabled: boolean; store: AccessStore | null; now: Date };

function defaultDeps(): GateDeps {
  return {
    paywallEnabled: researchFlags().paywallEnabled,
    store: configured() ? supabaseAccessStore(db) : null,
    now: new Date(),
  };
}

/** Same as checkReportAccess with the switches passed in. Used by the tests. */
export async function checkReportAccessWith(req: ReportRequest, deps: GateDeps): Promise<AccessCheck> {
  const personal = req.scope === "portfolio" || req.scope === "full";
  if (personal && !req.wallet) return { allowed: false, reason: "sign-in" };
  if (!deps.paywallEnabled) return { allowed: true, consumesCredit: false };

  let ent: Entitlement | null = null;
  if (req.wallet && deps.store) {
    // If the database cannot be read, fall back to the free tier: paid reports stay closed.
    ent = await deps.store
      .load(req.wallet)
      .then((l) => l.ent)
      .catch(() => null);
  }
  return decideAccess(req, ent, deps.now);
}

export async function checkReportAccess(req: ReportRequest): Promise<AccessCheck> {
  return checkReportAccessWith(req, defaultDeps());
}

/** Same as consumeReportCredit with the switches passed in. Used by the tests. */
export async function consumeReportCreditWith(wallet: string, deps: GateDeps): Promise<void> {
  if (!deps.paywallEnabled) return;
  if (!deps.store) throw new NoReportCreditError();
  const used = await updateEntitlement(deps.store, wallet.toLowerCase(), (ent) => useCredit(ent, deps.now));
  if (!used) throw new NoReportCreditError();
}

/**
 * Called after a report was built and saved, when the check said it consumes a credit.
 * Atomic: two parallel calls can never spend the same credit. With the paywall off it does nothing.
 * Throws NoReportCreditError when no credit is left, so the caller should not hand out the report
 * (or should call this before delivering it).
 */
export async function consumeReportCredit(wallet: string): Promise<void> {
  return consumeReportCreditWith(wallet, defaultDeps());
}

/** The wallet's entitlement as it applies right now (expired plans shown as ended). */
export async function currentEntitlement(wallet: string, store: AccessStore | null, now: Date): Promise<Entitlement> {
  if (!store) return freeEntitlement(wallet);
  const { ent } = await store.load(wallet);
  return effectiveEntitlement(ent, now);
}
