/**
 * SAMPLE DATA for local development, used only when the matching /api/research route returns 404.
 * Plan prices are placeholders until the founder agrees pricing (docs/research/PLAN.md, "Needs the
 * founder"), so they show as "Not set" rather than a made-up price.
 */
import type { AccessInfo, ScheduleRow } from "../api";

export const SAMPLE_ACCESS: AccessInfo = {
  paywallEnabled: false,
  sample: true,
  plans: [
    { plan: "free", label: "Free", priceUsdc: 0, features: ["Daily research list", "Asset pages with sources", "Market report"] },
    { plan: "pay-per-report", label: "Pay per report", priceUsdc: null, features: ["One portfolio or full report", "Saved to your reports"] },
    { plan: "monthly", label: "Monthly", priceUsdc: null, period: "month", features: ["Every report", "Scheduled reports", "All timeframes"] },
    { plan: "yearly", label: "Yearly", priceUsdc: null, period: "year", features: ["Everything in Monthly", "Premium depth"] },
  ],
  entitlement: null,
};

export const SAMPLE_SCHEDULES: ScheduleRow[] = [
  { scope: "market", period: "daily", enabled: false },
  { scope: "portfolio", period: "weekly", enabled: false },
  { scope: "full", period: "monthly", enabled: false },
];
