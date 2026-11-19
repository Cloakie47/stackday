import { parseUnits } from "viem";
import type { AccessCheck, Entitlement, Plan } from "../types.ts";
import { isFreeScope, MAX_CREDITS_PER_PAYMENT, PRICE_LIST, USDC_DECIMALS, type Purpose } from "./prices.ts";
import type { ReportRequest } from "./gate.ts";

/**
 * Pure entitlement math: no database, no clock, no network. The caller passes `now`.
 * Unit tested in entitlement.test.ts.
 */

const DAY_MS = 86_400_000;

/** A wallet with no row yet. */
export const freeEntitlement = (owner: string): Entitlement => ({
  owner,
  plan: "free",
  validUntil: null,
  reportCredits: 0,
  premium: false,
});

const isSubscription = (plan: Plan) => plan === "monthly" || plan === "yearly";

/** True while a monthly or yearly plan has not run out. */
export function subscriptionActive(ent: Entitlement, now: Date): boolean {
  if (!isSubscription(ent.plan) || !ent.validUntil) return false;
  const until = Date.parse(ent.validUntil);
  return Number.isFinite(until) && until > now.getTime();
}

/**
 * What the stored row means today: an expired plan falls back to pay-per-report (if credits are
 * left) or free, with validUntil cleared. Credits and premium are never touched.
 */
export function effectiveEntitlement(ent: Entitlement, now: Date): Entitlement {
  if (subscriptionActive(ent, now)) return ent;
  return { ...ent, plan: ent.reportCredits > 0 ? "pay-per-report" : "free", validUntil: null };
}

/**
 * The paid-mode decision (RESEARCH_PAYWALL_ENABLED on). The gate handles the flag being off.
 * Order: sign-in, premium depth, free scopes, active plan, credits, otherwise pay.
 */
export function decideAccess(req: ReportRequest, ent: Entitlement | null, now: Date): AccessCheck {
  const personal = req.scope === "portfolio" || req.scope === "full";
  if ((personal || req.premium) && !req.wallet) return { allowed: false, reason: "sign-in" };
  const e = effectiveEntitlement(ent ?? freeEntitlement(req.wallet ?? ""), now);
  if (req.premium && !e.premium) return { allowed: false, reason: "premium-required" };
  if (isFreeScope(req.scope)) return { allowed: true, consumesCredit: false };
  if (subscriptionActive(e, now)) return { allowed: true, consumesCredit: false };
  if (e.reportCredits > 0) return { allowed: true, consumesCredit: true };
  return { allowed: false, reason: "payment-required" };
}

/** The entitlement after one credit is used, or null when none is left. */
export function useCredit(ent: Entitlement, now: Date): Entitlement | null {
  if (ent.reportCredits < 1) return null;
  const left = ent.reportCredits - 1;
  const next = { ...ent, reportCredits: left };
  if (!subscriptionActive(ent, now)) {
    next.plan = left > 0 ? "pay-per-report" : "free";
    next.validUntil = null;
  }
  return next;
}

/** Price of one item in USDC base units (6 decimals). */
export const priceUnits = (purpose: Purpose): bigint => parseUnits(PRICE_LIST.items[purpose].usdc, USDC_DECIMALS);

export type Grant =
  | { ok: true; next: Entitlement; summary: string }
  | { ok: false; error: string };

/**
 * What a verified payment of `amount` base units for `purpose` adds to the entitlement.
 * - report: one credit per full price paid (at most MAX_CREDITS_PER_PAYMENT), any remainder is not counted.
 * - monthly / yearly: days added to the later of now and the current end date. A yearly plan stays
 *   "yearly" when a month is added to it.
 * - premium: sets the premium flag.
 * Paying less than one price is refused (the payment is then not stored, see pay.ts).
 */
export function applyPayment(ent: Entitlement, purpose: Purpose, amount: bigint, now: Date): Grant {
  const price = priceUnits(purpose);
  if (amount < price)
    return { ok: false, error: `This payment is below the ${PRICE_LIST.items[purpose].label} price of ${PRICE_LIST.items[purpose].usdc} test USDC.` };

  const current = effectiveEntitlement(ent, now);
  const active = subscriptionActive(current, now);

  if (purpose === "report") {
    const perPrice = PRICE_LIST.items.report.credits ?? 1;
    const bought = amount / price;
    const credits = Number(bought > BigInt(MAX_CREDITS_PER_PAYMENT) ? BigInt(MAX_CREDITS_PER_PAYMENT) : bought) * perPrice;
    const next: Entitlement = { ...current, reportCredits: current.reportCredits + credits };
    if (!active) next.plan = "pay-per-report";
    return { ok: true, next, summary: `${credits} report credit${credits === 1 ? "" : "s"} added.` };
  }

  if (purpose === "monthly" || purpose === "yearly") {
    const days = PRICE_LIST.items[purpose].days ?? 0;
    const from = active ? Date.parse(current.validUntil!) : now.getTime();
    const validUntil = new Date(from + days * DAY_MS).toISOString();
    const plan: Plan = active && current.plan === "yearly" ? "yearly" : purpose;
    return { ok: true, next: { ...current, plan, validUntil }, summary: `Plan active until ${validUntil}.` };
  }

  return { ok: true, next: { ...current, premium: true }, summary: "Premium depth unlocked." };
}
