/**
 * Research price list, in test USDC on Base Sepolia (founder spec docs/research/SPEC.md, section 8).
 *
 * The product is the Monday weekly report. Two ways to pay: one Monday report, or a monthly plan
 * that covers every Monday report published while it runs (30 days always hold four or five
 * Mondays).
 *
 * STATUS: PROPOSAL, FOUNDER TO DECIDE. The amounts below are small placeholders. Nothing is charged
 * while RESEARCH_PAYWALL_ENABLED is off, and it stays off until the quality bar (four Mondays in a
 * row, spec section 7) has held and a legal check is done (spec section 6). Testnet only: every
 * amount is mock USDC with no real value. Change prices here and nowhere else.
 */

export const PRICING_STATUS = "proposal, founder to decide" as const;

/** USDC has 6 decimals on Base Sepolia (Circle test USDC, see web/lib/deployment.json). */
export const USDC_DECIMALS = 6;

/** What a payment buys. Matches the `purpose` check in the `research_payments` table. */
export const PURPOSES = ["weekly-single", "monthly"] as const;
export type Purpose = (typeof PURPOSES)[number];

export type PriceItem = {
  purpose: Purpose;
  label: string;
  /** Placeholder price as a decimal string in test USDC, for example "1" or "0.5". */
  usdc: string;
  /** For "weekly-single": Monday reports granted per price paid. */
  credits?: number;
  /** For "monthly": days added to the plan. */
  days?: number;
  description: string;
};

export type PriceList = {
  status: typeof PRICING_STATUS;
  currency: string;
  chainId: number;
  items: Record<Purpose, PriceItem>;
};

export const PRICE_LIST: PriceList = {
  status: PRICING_STATUS,
  currency: "test USDC (Base Sepolia, no real value)",
  chainId: 84532,
  items: {
    "weekly-single": {
      purpose: "weekly-single",
      label: "One Monday report",
      usdc: "1",
      credits: 1,
      description: "Opens one Monday weekly report. Reopening a Monday you already unlocked is free.",
    },
    monthly: {
      purpose: "monthly",
      label: "Monthly plan",
      usdc: "3",
      days: 30,
      description: "Every Monday weekly report for 30 days (four or five Mondays). Paying again adds 30 more days.",
    },
  },
};

/** Most Monday credits one payment can buy, so a typo in the amount cannot mint many. */
export const MAX_CREDITS_PER_PAYMENT = 10;

/** Confirmations a payment needs before it counts. Base Sepolia makes a block about every 2 seconds. */
export const MIN_CONFIRMATIONS = 3;

export const isPurpose = (s: unknown): s is Purpose => typeof s === "string" && (PURPOSES as readonly string[]).includes(s);

/** The plan cards the Research UI renders. Amounts are placeholders until the founder decides. */
export function planCards() {
  const i = PRICE_LIST.items;
  return [
    { plan: "free" as const, label: "Free beta", priceUsdc: 0, features: ["Monday weekly report as a free beta preview while the paywall is off", "Portfolio check (sign-in)"] },
    { plan: "weekly-single" as const, label: i["weekly-single"].label, priceUsdc: Number(i["weekly-single"].usdc), period: "per Monday", features: [i["weekly-single"].description] },
    { plan: "monthly" as const, label: i.monthly.label, priceUsdc: Number(i.monthly.usdc), period: "30 days", features: [i.monthly.description] },
  ];
}
