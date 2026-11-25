/**
 * Research data layer (server-only): prices on 1h, 1d, 1w and 1mo bars (stocks: on-chain prices on Base, 1d, 1w and 1mo), indicators, chart read and
 * patterns in code, FRED macro, the official week-ahead calendar, headlines from reputable outlets,
 * official feeds and company newsrooms, SEC filings and crypto flows, gathered into
 * `MarketResearchInput` and `AssetResearchInput` for the engine. Sources and terms: ./SOURCES.md.
 */
export { gatherAsset, gatherMarket, gatherAll, gatherRun, barCloseTime, seriesAsOf, cutSeries, NotResearchableError, type GatherOptions } from "./gather.ts";
export { defaultDeps, type DataDeps, type FetchLike } from "./deps.ts";
export { computeIndicators, changePct, sma, rsi, macd, atr, volatility, maxDrawdown } from "./indicators.ts";
export { readChart, findSwings, trendStructure, clusterLevels, volatilityRegime, detectorMinBars, PATTERN_LABEL, CHART_PARAMS } from "./chart.ts";
export { isMarketOpen, isTradingDay, lastTradingDay, calendarCovers, isEarlyClose, holidayName, sessionHours, NYSE_HOLIDAYS, NYSE_EARLY_CLOSES, NYSE_SOURCE } from "./calendar.ts";
export { fetchWeekAhead, eventsForAsset, FOMC_FALLBACK, BLS_FALLBACK, BEA_FALLBACK } from "./events.ts";
export { fetchMacro, FRED_SERIES, MACRO_FOR_ASSET, FRED_KEY_ENV } from "./macro.ts";
export { fetchFlows, ETF_FLOWS_PROBLEM } from "./flows.ts";
export { fetchPriceHistory, aggregateBars, PRICE_SOURCES, COINBASE_SOURCE } from "./prices.ts";
export { fetchOnchainHistory, ONCHAIN_ASSETS, ONCHAIN_BACKFILL, BASE_RPC_ENV, DEFAULT_BASE_RPC_URL } from "./onchain.ts";
export { fetchFilings, SEC_USER_AGENT_ENV } from "./news.ts";
export { fetchPressNews, fetchWireNews, fetchOfficialNews, PRESS_FEEDS, REPUTABLE_DOMAINS, OFFICIAL_FEEDS, tagTopics } from "./headlines.ts";
