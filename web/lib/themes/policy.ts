/**
 * The Themes portfolio policy (docs/themes/policy.md). Every number is a proposal for the
 * founder. The AI model never sets or overrides these.
 */

export type RiskLevel = "steady" | "balanced" | "bold";

export type SleeveTargets = {
  /** Shares of the whole plan, adding up to 1. */
  stocks: number;
  crypto: number;
  risk: number;
  usdc: number;
  /** The USDC cushion never goes below this. */
  usdcFloor: number;
  /** Most the crypto group (cbBTC, WETH and crypto-like stocks) may take. */
  cryptoCap: number;
};

export const RISK_LEVELS: Record<RiskLevel, SleeveTargets & { label: string; blurb: string }> = {
  steady: {
    label: "Steady",
    blurb: "Mostly large companies and a big cash cushion. Smallest swings.",
    stocks: 0.65, crypto: 0.05, risk: 0, usdc: 0.3, usdcFloor: 0.2, cryptoCap: 0.1,
  },
  balanced: {
    label: "Balanced",
    blurb: "Stocks at the core, a little Bitcoin and Ether, a cushion for cheap weeks.",
    stocks: 0.73, crypto: 0.12, risk: 0.05, usdc: 0.1, usdcFloor: 0.05, cryptoCap: 0.25,
  },
  bold: {
    label: "Bold",
    blurb: "More crypto and a small slice for volatile names. Bigger swings.",
    stocks: 0.7, crypto: 0.18, risk: 0.07, usdc: 0.05, usdcFloor: 0.05, cryptoCap: 0.25,
  },
};

export const CAPS = {
  /** Single stock, share of the whole plan. */
  singleStock: 0.15,
  /** All holdings of one theme together. */
  singleTheme: 0.4,
  /** NVIDIA, Sandisk, Intel and Microsoft together. */
  aiChips: 0.35,
  /** Any single risk-bucket asset. */
  riskAsset: 0.025,
} as const;

/** Bitcoin and Ether split inside the crypto sleeve (8 to 4 in the Balanced policy). */
export const CRYPTO_SPLIT: Record<string, number> = { cbBTC: 2 / 3, WETH: 1 / 3 };

/** A value score moves a weight by at most 25 percent either way: weight x (1 + 0.125 x score), score in [-2, 2]. */
export const VALUE_TILT_PER_POINT = 0.125;
export const VALUE_SCORE_LIMIT = 2;

/** Smart DCA: each planned buy is multiplied by a number in this range. */
export const DCA_MIN = 0.5;
export const DCA_MAX = 1.5;

/** Drift bands: out of band when off target by more than 5 points or 25 percent of the target. */
export const DRIFT_ABS = 0.05;
export const DRIFT_REL = 0.25;

/** Payroll plans hold at most 6 assets (Payroll.MAX_ALLOCATIONS). */
export const MAX_LEGS = 6;
