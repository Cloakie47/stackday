/**
 * Research switches, read on the server only. Every one defaults to the safe value so the site
 * keeps working with nothing set (no keys means sample data and no paywall).
 */
const on = (v: string | undefined) => v === "1" || v === "true";

export const researchFlags = () => ({
  /** Run the daily engine with real model calls. Needs ANTHROPIC_API_KEY (set by the founder). */
  engineEnabled: on(process.env.RESEARCH_ENGINE_ENABLED) && Boolean(process.env.ANTHROPIC_API_KEY),
  /** Ask for payment or a plan before building reports. Off until the founder agrees the pricing. */
  paywallEnabled: on(process.env.RESEARCH_PAYWALL_ENABLED),
  /** Hard stop for one engine run's model spend, in USD (founder's $2 per-run abort). */
  maxRunCostUsd: Number(process.env.RESEARCH_MAX_RUN_COST_USD ?? "2"),
});
