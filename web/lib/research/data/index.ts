/**
 * Research data layer (server-only): price history, indicators, trading calendar, primary-source
 * news and filings, gathered per asset into `AssetResearchInput` for the engine.
 * Sources and their terms: ./SOURCES.md.
 */
export { gatherAsset, gatherAll, barCloseTime, seriesAsOf } from "./gather.ts";
export { defaultDeps, type DataDeps, type FetchLike } from "./deps.ts";
export { computeIndicators, changePct, sma, rsi, macd, atr, volatility, maxDrawdown, supportResistance } from "./indicators.ts";
export { isMarketOpen, isTradingDay, lastTradingDay, calendarCovers, isEarlyClose, holidayName, sessionHours, NYSE_HOLIDAYS, NYSE_EARLY_CLOSES, NYSE_SOURCE } from "./calendar.ts";
export { fetchPriceHistory, aggregateBars, PRICE_SOURCES, PRICE_KEY_ENV } from "./prices.ts";
export { fetchFilings, fetchPressNews, PRESS_FEEDS, SEC_USER_AGENT_ENV } from "./news.ts";
