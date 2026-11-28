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
  /** Hard stop for the Monday weekly run, in USD (it uses the strongest model for every asset). */
  maxWeeklyRunCostUsd: num(process.env.RESEARCH_MAX_WEEKLY_RUN_COST_USD, 4),
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

/**
 * When the daily run sends an asset's note to `RESEARCH_MODELS.dailyEscalation` besides big movers
 * and answers that fail the checks (engine/daily.ts `escalationTriggers`). Fixed in code, no env:
 * - crisis (every asset): Bitcoin (`btcAssetId`) down more than `btcDayDropPct` percent, or the
 *   S&P 500 fund token (`spxAssetId`, its on-chain price, not the index) down more than
 *   `spxDayDropPct` percent, in a day. "In a day" is the worse of the last closed daily bar's change
 *   and the move from that close to the latest price (for crypto at 22:30 UTC the last closed daily
 *   bar is yesterday's, so today's fall shows in the second). Why 7 and 3: on the recorded Coinbase
 *   daily candles in data/fixtures/run.json, Bitcoin fell 7% or more on 21 of 1,840 days since
 *   November 2021 (about 1 day in 90; 8% or more on 13); in the recorded FRED S&P 500 series in the
 *   same file (288 trading days from September 2025) the index fell 3% or more once and 2% or more
 *   four times. Both mark a rare, broad sell-off, not a normal red day. One fall can fire on two
 *   runs in a row (today through the latest price, the next day through the closed daily bar), so
 *   the trigger fires somewhat more often than those day counts.
 * - stale price feed (that asset): the data step says the current price could not be read
 *   (`NO_CURRENT_PRICE` in its problems, for example the Base RPC down and bars from stored history
 *   only), or for crypto the latest price is more than `stalePriceHoursCrypto` hours old at the run
 *   time (it is normally the last closed hour).
 * - low conviction near invalidation (that asset): the checked conviction is low and the latest
 *   price is within `nearInvalidationAtr` daily ATRs of the view's invalidation level. The levels
 *   code puts invalidation at least 1 ATR (Hold, Reduce, Avoid new buys) or 1.5 ATR (Accumulate)
 *   from the daily close, so 1.5 ATR fires only when price sits on its nearest level or has
 *   already moved toward invalidation since that close.
 * The escalation cap and the run budget still apply to every one of them, and these three leave the
 * cap's last slot for answers that failed the checks and big movers (engine/daily.ts `takeSlot`).
 */
export const ESCALATION_TRIGGERS = {
  btcAssetId: "mcbBTC",
  spxAssetId: "mSPX",
  btcDayDropPct: 7,
  spxDayDropPct: 3,
  stalePriceHoursCrypto: 3,
  nearInvalidationAtr: 1.5,
} as const;
