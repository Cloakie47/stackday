import type { AccessCheck, IsoDate } from "../types.ts";
import { researchFlags } from "../flags.ts";

/**
 * The one access check every research route calls before showing something that may be paid.
 * Owned by gg/research-access, which replaces the body with plan, credit and payment checks.
 *
 * Founder spec section 6: the paywall stays off until the quality bar (section 7) has held and a
 * legal check is done. While it is off the weekly report is a free "beta" preview, and only the
 * portfolio check needs sign-in (it reads one person's holdings).
 */
export type ResearchProduct = "weekly-report" | "portfolio-check";

export type ReportRequest = {
  /** Signed-in wallet (lowercase) or null. */
  wallet: string | null;
  product: ResearchProduct;
  /** Monday of the weekly report asked for. */
  weekOf?: IsoDate;
};

export async function checkReportAccess(req: ReportRequest): Promise<AccessCheck> {
  if (req.product === "portfolio-check" && !req.wallet) return { allowed: false, reason: "sign-in" };
  if (!researchFlags().paywallEnabled) return { allowed: true, consumesCredit: false };
  if (req.product === "portfolio-check") return { allowed: true, consumesCredit: false };
  return { allowed: false, reason: "payment-required" };
}

/** Called after a paid weekly report was unlocked, when the check said it consumes a credit. */
export async function consumeReportCredit(_wallet: string, _weekOf: IsoDate): Promise<void> {
  // Replaced by gg/research-access.
}
