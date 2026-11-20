import { parseUnits } from "viem";
import type { AccessCheck, Entitlement, IsoDate, Plan } from "../types.ts";
import { MAX_CREDITS_PER_PAYMENT, PRICE_LIST, USDC_DECIMALS, type Purpose } from "./prices.ts";
import type { ReportRequest } from "./gate.ts";

/**
 * Pure entitlement math: no database, no clock, no network. The caller passes `now`.
 * Unit tested in entitlement.test.ts.
 *
 * An entitlement holds a monthly plan end date (`validUntil`), Monday credits bought one at a time
 * (`weeklyCredits`) and the Mondays already opened with a credit (`unlockedWeeks`, reopening is free).
 */

const DAY_MS = 86_400_000;
/** Most unlocked Mondays kept per wallet (about five years), so a row cannot grow without end. */
export const MAX_UNLOCKED_WEEKS = 260;
const WEEK_RULE = /^\d{4}-\d{2}-\d{2}$/;

export const isWeekOf = (s: unknown): s is IsoDate => typeof s === "string" && WEEK_RULE.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));

/** A wallet with no row yet. */
export const freeEntitlement = (owner: string): Entitlement => ({
  owner,
  plan: "free",
  validUntil: null,
  weeklyCredits: 0,
  unlockedWeeks: [],
});

/** True while a monthly plan has not run out. */
export function monthlyActive(ent: Entitlement, now: Date): boolean {
  if (ent.plan !== "monthly" || !ent.validUntil) return false;
  const until = Date.parse(ent.validUntil);
  return Number.isFinite(until) && until > now.getTime();
}

const planWithoutMonthly = (ent: Entitlement): Plan => (ent.weeklyCredits > 0 || ent.unlockedWeeks.length > 0 ? "weekly-single" : "free");

/**
 * What the stored row means today: an expired monthly plan falls back to "weekly-single" (if any
 * credit or unlocked Monday is left) or "free", with validUntil cleared. Credits and unlocked
 * Mondays are never touched.
 */
export function effectiveEntitlement(ent: Entitlement, now: Date): Entitlement {
  if (monthlyActive(ent, now)) return ent;
  return { ...ent, plan: planWithoutMonthly(ent), validUntil: null };
}

/**
 * The paid-mode decision (RESEARCH_PAYWALL_ENABLED on). The gate handles the switch being off.
 * - portfolio check: sign-in only, never paid;
 * - weekly report: sign-in, then an active monthly plan, an already unlocked Monday, or a credit
 *   (which the caller then spends with consumeReportCredit), otherwise payment is required.
 */
export function decideAccess(req: ReportRequest, ent: Entitlement | null, now: Date): AccessCheck {
  if (!req.wallet) return { allowed: false, reason: "sign-in" };
  if (req.product === "portfolio-check") return { allowed: true, consumesCredit: false };
  const e = effectiveEntitlement(ent ?? freeEntitlement(req.wallet), now);
  if (monthlyActive(e, now)) return { allowed: true, consumesCredit: false };
  if (req.weekOf && e.unlockedWeeks.includes(req.weekOf)) return { allowed: true, consumesCredit: false };
  if (req.weekOf && e.weeklyCredits > 0) return { allowed: true, consumesCredit: true };
  return { allowed: false, reason: "payment-required" };
}

export type Unlock = { kind: "already-unlocked" } | { kind: "no-credit" } | { kind: "unlocked"; next: Entitlement };

/** Spends one credit on a Monday. Reopening an unlocked Monday spends nothing. */
export function unlockWeek(ent: Entitlement, weekOf: IsoDate, now: Date): Unlock {
  if (ent.unlockedWeeks.includes(weekOf)) return { kind: "already-unlocked" };
  if (ent.weeklyCredits < 1) return { kind: "no-credit" };
  const unlockedWeeks = [...ent.unlockedWeeks, weekOf].sort().slice(-MAX_UNLOCKED_WEEKS);
  const next: Entitlement = { ...ent, weeklyCredits: ent.weeklyCredits - 1, unlockedWeeks };
  if (!monthlyActive(ent, now)) {
    next.plan = planWithoutMonthly(next);
    next.validUntil = null;
  }
  return { kind: "unlocked", next };
}

/** Price of one item in USDC base units (6 decimals). */
export const priceUnits = (purpose: Purpose): bigint => parseUnits(PRICE_LIST.items[purpose].usdc, USDC_DECIMALS);

export type Grant = { ok: true; next: Entitlement; summary: string } | { ok: false; error: string };

/**
 * What a verified payment of `amount` base units for `purpose` adds to the entitlement.
 * - weekly-single: one Monday credit per full price paid (at most MAX_CREDITS_PER_PAYMENT), any
 *   remainder is not counted.
 * - monthly: 30 days added to the later of now and the current end date.
 * Paying less than one price is refused (the payment is then not stored, see pay.ts).
 */
export function applyPayment(ent: Entitlement, purpose: Purpose, amount: bigint, now: Date): Grant {
  const item = PRICE_LIST.items[purpose];
  const price = priceUnits(purpose);
  if (amount < price) return { ok: false, error: `This payment is below the ${item.label} price of ${item.usdc} test USDC.` };

  const current = effectiveEntitlement(ent, now);
  const active = monthlyActive(current, now);

  if (purpose === "weekly-single") {
    const bought = amount / price;
    const credits = Number(bought > BigInt(MAX_CREDITS_PER_PAYMENT) ? BigInt(MAX_CREDITS_PER_PAYMENT) : bought) * (item.credits ?? 1);
    const next: Entitlement = { ...current, weeklyCredits: current.weeklyCredits + credits };
    if (!active) next.plan = "weekly-single";
    return { ok: true, next, summary: `${credits} Monday report${credits === 1 ? "" : "s"} added.` };
  }

  const from = active ? Date.parse(current.validUntil!) : now.getTime();
  const validUntil = new Date(from + (item.days ?? 30) * DAY_MS).toISOString();
  return { ok: true, next: { ...current, plan: "monthly", validUntil }, summary: `Monthly plan active until ${validUntil}.` };
}
