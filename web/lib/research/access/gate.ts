import type { AccessCheck, ReportScope } from "../types.ts";
import { researchFlags } from "../flags.ts";

/**
 * The one access check every report route calls before building a report.
 * Owned by gg/research-access, which replaces the body with real plan, credit and payment checks.
 * This default only enforces sign-in for personal reports and allows everything else, which is
 * what the site does while RESEARCH_PAYWALL_ENABLED is off.
 */
export type ReportRequest = {
  /** Signed-in wallet (lowercase) or null. */
  wallet: string | null;
  scope: ReportScope;
  premium: boolean;
};

export async function checkReportAccess(req: ReportRequest): Promise<AccessCheck> {
  const personal = req.scope === "portfolio" || req.scope === "full";
  if (personal && !req.wallet) return { allowed: false, reason: "sign-in" };
  if (!researchFlags().paywallEnabled) return { allowed: true, consumesCredit: false };
  return { allowed: false, reason: "payment-required" };
}

/** Called after a report was built and saved, when the check said it consumes a credit. */
export async function consumeReportCredit(_wallet: string): Promise<void> {
  // Replaced by gg/research-access.
}
