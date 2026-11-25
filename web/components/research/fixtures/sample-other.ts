/**
 * SAMPLE DATA for local development, used only when /api/research/access is missing or fails.
 * Prices are not set until the founder decides them (spec section 8), so they show as "Not set"
 * rather than a made-up amount.
 */
import type { AccessInfo } from "../api";

export const SAMPLE_ACCESS: AccessInfo = {
  paywallEnabled: false,
  prices: { "weekly-single": null, monthly: null },
  entitlement: null,
};
