/**
 * Research switches, read on the server only. Every one defaults to the safe value so the site
 * keeps working with nothing set (no keys means sample data and no paywall).
 */
const on = (v: string | undefined) => v === "1" || v === "true";
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const researchFlags = () => ({
  /** Run the engine with real model calls. Needs ANTHROPIC_API_KEY. */
  engineEnabled: on(process.env.RESEARCH_ENGINE_ENABLED) && Boolean(process.env.ANTHROPIC_API_KEY),
  /**
   * Ask for payment before showing the weekly report. Founder spec section 6: stays off until the
   * quality bar has held for four Mondays and a legal check is done.
   */
  paywallEnabled: on(process.env.RESEARCH_PAYWALL_ENABLED),
  /** Hard stop for one run's model spend, in USD. */
  maxRunCostUsd: num(process.env.RESEARCH_MAX_RUN_COST_USD, 2),
  /** Hard stop for all runs in one UTC day, in USD (the Monday weekly run counts too). */
  maxDayCostUsd: num(process.env.RESEARCH_MAX_DAY_COST_USD, 6),
});

/**
 * Model choice (founder spec section 2), one place to swap. Daily notes use the cheaper model and
 * escalate big movers; the Monday weekly report uses the strongest model for every asset.
 */
export const RESEARCH_MODELS = {
  dailyTriage: "claude-haiku-5-5",
  dailyEscalation: "claude-sonnet-5-5",
  weekly: "claude-opus-5-5",
} as const;
