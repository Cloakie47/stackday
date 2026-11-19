import type { ReportScope } from "../types.ts";

/**
 * Research report price list, in test USDC on Base Sepolia.
 *
 * STATUS: PROPOSAL, NEEDS FOUNDER APPROVAL. Report pricing is a new revenue line beyond the small
 * on-chain fee rule in issue #45, so none of this is charged until the founder agrees the prices
 * and RESEARCH_PAYWALL_ENABLED is switched on. Testnet only: every amount is mock USDC with no
 * real value. Change prices here and nowhere else.
 */

export const PRICING_STATUS = "proposal, needs founder approval" as const;

/** USDC has 6 decimals on Base Sepolia (Circle test USDC, see web/lib/deployment.json). */
export const USDC_DECIMALS = 6;

/** What a payment buys. Matches the `purpose` check in the `research_payments` table. */
export const PURPOSES = ["report", "monthly", "yearly", "premium"] as const;
export type Purpose = (typeof PURPOSES)[number];

export type PriceItem = {
  purpose: Purpose;
  label: string;
  /** Price as a decimal string in USDC, for example "2" or "0.5". */
  usdc: string;
  /** For "report": credits granted per price paid. */
  credits?: number;
  /** For "monthly" and "yearly": days added to the subscription. */
  days?: number;
  description: string;
};

export type PriceList = {
  status: typeof PRICING_STATUS;
  currency: string;
  chainId: number;
  /** Reports anyone can open without paying (personal scopes still need sign-in). */
  freeScopes: ReportScope[];
  items: Record<Purpose, PriceItem>;
};

export const PRICE_LIST: PriceList = {
  status: PRICING_STATUS,
  currency: "test USDC (Base Sepolia, no real value)",
  chainId: 84532,
  freeScopes: ["market", "asset"],
  items: {
    report: {
      purpose: "report",
      label: "Pay per report",
      usdc: "2",
      credits: 1,
      description: "One portfolio or full report. Paying a multiple of the price buys that many credits (up to 50).",
    },
    monthly: {
      purpose: "monthly",
      label: "Monthly plan",
      usdc: "9",
      days: 30,
      description: "Unlimited portfolio and full reports for 30 days. Paying again adds 30 more days.",
    },
    yearly: {
      purpose: "yearly",
      label: "Yearly plan",
      usdc: "90",
      days: 365,
      description: "Unlimited portfolio and full reports for 365 days (about two months free).",
    },
    premium: {
      purpose: "premium",
      label: "Premium depth add-on",
      usdc: "15",
      description:
        "One-time unlock of deeper analysis, all timeframes and full portfolio insights on every report you can open. It does not include reports themselves.",
    },
  },
};

/** Most report credits one payment can buy, so a typo in the amount cannot mint thousands. */
export const MAX_CREDITS_PER_PAYMENT = 50;

/** Confirmations a payment needs before it counts. Base Sepolia makes a block about every 2 seconds. */
export const MIN_CONFIRMATIONS = 3;

export const isPurpose = (s: unknown): s is Purpose => typeof s === "string" && (PURPOSES as readonly string[]).includes(s);

export const isFreeScope = (scope: ReportScope) => PRICE_LIST.freeScopes.includes(scope);

/** The plan cards the Research UI renders (shape agreed in the UI session's contract note). */
export function planCards() {
  const i = PRICE_LIST.items;
  return [
    { plan: "free" as const, label: "Free", priceUsdc: 0, features: ["Daily market report", "Asset summaries"] },
    { plan: "pay-per-report" as const, label: i.report.label, priceUsdc: Number(i.report.usdc), period: "per report", features: ["One portfolio or full report"] },
    { plan: "monthly" as const, label: i.monthly.label, priceUsdc: Number(i.monthly.usdc), period: "30 days", features: ["Unlimited portfolio and full reports"] },
    { plan: "yearly" as const, label: i.yearly.label, priceUsdc: Number(i.yearly.usdc), period: "365 days", features: ["Unlimited portfolio and full reports", "About two months free"] },
  ];
}
