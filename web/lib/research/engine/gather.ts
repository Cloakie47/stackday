import type { IsoDate, MarketResearchInput } from "../types.ts";
import type { GatherFn } from "./daily.ts";
import type { GatherMarketFn } from "./weekly.ts";
import { gatherAsset, gatherMarket } from "../data/index.ts";

/**
 * Where the engine gets its data: web/lib/research/data. The market-wide input (macro series,
 * week-ahead calendar) is fetched once per date and shared by every asset in the run, so FRED,
 * the Fed and BEA calendars and the news feeds are not asked six times.
 */
const marketByDate = new Map<IsoDate, Promise<MarketResearchInput>>();

export const defaultGatherMarket: GatherMarketFn | null = (date) => {
  let m = marketByDate.get(date);
  if (!m) {
    m = gatherMarket(date);
    m.catch(() => marketByDate.delete(date));
    marketByDate.set(date, m);
    // Keep only the most recent few dates in memory.
    while (marketByDate.size > 3) marketByDate.delete(marketByDate.keys().next().value as IsoDate);
  }
  return m;
};

export const defaultGather: GatherFn | null = async (assetId, date) => {
  const market = await defaultGatherMarket!(date).catch(() => undefined);
  return gatherAsset(assetId, date, undefined, { market });
};

/**
 * The daily note's gatherer (22:30 UTC on weekdays): when the run date is today it cuts the data at
 * the real time (`cutAt`), so the note's entry price includes today's closed session and its scores
 * never count a move that was already known. The Monday weekly slots (12:00 to 21:00 UTC) keep
 * `defaultGather`, which cuts at 12:00 UTC, so they never see intraday data.
 */
export const defaultGatherDaily: GatherFn | null = async (assetId, date) => {
  const market = await defaultGatherMarket!(date).catch(() => undefined);
  const now = new Date();
  return gatherAsset(assetId, date, undefined, { market, ...(date === now.toISOString().slice(0, 10) ? { cutAt: now.toISOString() } : {}) });
};
