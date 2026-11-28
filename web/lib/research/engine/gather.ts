import type { IsoDate, MarketResearchInput } from "../types.ts";
import type { GatherFn } from "./daily.ts";
import type { GatherMarketFn } from "./weekly.ts";
import { gatherAsset, gatherMarket, type OnchainTailState, type OnchainTailStore } from "../data/index.ts";
import { supabaseOnchainTail } from "./onchain-tail.ts";
import { dailyCutAt } from "./cutoff.ts";

/**
 * The on-chain history store (research_onchain_tail) when the account database is connected, so
 * each run continues the price and volume history from where the last one stopped. Without the
 * database (or before schema.sql is applied) the reader falls back to the checked-in backfill.
 */
async function tailDeps(): Promise<{ onchainTail?: OnchainTailStore }> {
  try {
    const backend = await import("@/lib/server/backend");
    return backend.configured() ? { onchainTail: supabaseOnchainTail<OnchainTailState>(backend.db()) } : {};
  } catch {
    return {};
  }
}

/**
 * Where the engine gets its data: web/lib/research/data. The market-wide input (macro series,
 * week-ahead calendar) is fetched once per run and shared by every asset in it, so FRED, the Fed
 * and BEA calendars and the news feeds are not asked six times.
 *
 * The cache key is the date plus the cut time: the Monday weekly slots cut at 12:00 UTC (no cut
 * time), the daily note at its real run time. So a warm instance never hands the 12:00 weekly
 * market input to the 22:30 daily note. The daily path is keyed by the hour of its cut time, so the
 * assets of one daily run share one market input (cut at the first asset's time) and no other run does.
 */
const marketCache = new Map<string, Promise<MarketResearchInput>>();

/** The cache key: the run date plus the hour of the cut time ("noon" for the weekly 12:00 UTC cut). */
export const marketCacheKey = (date: IsoDate, cutAt?: string) => `${date}|${cutAt ? cutAt.slice(0, 13) : "noon"}`;

export function gatherMarketCached(date: IsoDate, cutAt?: string, fetchMarket: typeof gatherMarket = gatherMarket): Promise<MarketResearchInput> {
  const key = marketCacheKey(date, cutAt);
  let m = marketCache.get(key);
  if (!m) {
    m = fetchMarket(date, undefined, cutAt ? { cutAt } : {});
    m.catch(() => marketCache.delete(key));
    marketCache.set(key, m);
    // Keep only the most recent few runs in memory.
    while (marketCache.size > 4) marketCache.delete(marketCache.keys().next().value as string);
  }
  return m;
}

/** The weekly run's market input: cut at 12:00 UTC on the run date. */
export const defaultGatherMarket: GatherMarketFn | null = (date) => gatherMarketCached(date);

export const defaultGather: GatherFn | null = async (assetId, date) => {
  const market = await gatherMarketCached(date).catch(() => undefined);
  return gatherAsset(assetId, date, await tailDeps(), { market });
};

/** The daily note's cut time (engine/cutoff.ts, kept importable from here). */
export { dailyCutAt };

/**
 * The daily note's gatherer (22:30 UTC on weekdays): when the run date is today it cuts the data at
 * the real time (`cutAt`), so the note's entry price includes today's closed session and its scores
 * never count a move that was already known. The same cut time applies to its macro series and
 * headlines (the market input), not only to prices. The Monday weekly slots (12:00 to 21:00 UTC)
 * keep `defaultGather`, which cuts at 12:00 UTC, so they never see intraday data.
 */
export const defaultGatherDaily: GatherFn | null = async (assetId, date) => {
  const cutAt = dailyCutAt(date);
  const market = await gatherMarketCached(date, cutAt).catch(() => undefined);
  return gatherAsset(assetId, date, await tailDeps(), { market, ...(cutAt ? { cutAt } : {}) });
};
