import type { BarInterval, Fact, IsoDateTime, PriceBar, PriceSeries, Source } from "../types.ts";
import type { UniverseAsset } from "../universe.ts";
import { addDays, isTradingDay, lastTradingDay, newYorkParts, sessionHours } from "./calendar.ts";
import { GENERIC_USER_AGENT, RateLimiter, getJson, type DataDeps } from "./deps.ts";
import { ONCHAIN_ASSETS, fetchOnchainHistory, type Backfill } from "./onchain.ts";

/**
 * Price history per interval for the six research assets. Server-only.
 *
 * - Crypto and PAXG: Coinbase Exchange public candles (no key). Hourly bars come straight from
 *   the API; daily bars are paged back 5 years; weekly and monthly bars are built in code from
 *   the daily bars (see `aggregateBars`).
 * - Apple, NVIDIA and the S&P 500 (founder decision, November 25, 2026): the tokens' on-chain
 *   prices on Base mainnet (onchain.ts): Chainlink "Coinbase AAPL" and "Coinbase NVDA" feeds and
 *   their round history, the deSPXA Morpho market oracle and the deSPXA/USDC pool. Daily bars on
 *   NYSE sessions; weekly and monthly bars built from them. Labelled as the token's on-chain price
 *   on Base, never as the exchange price or the index level. No hourly bars for these assets.
 * Every series' source carries `display` (core `Source.display`), so facts, levels and patterns
 * built from it inherit it. With a source failing the asset is reported in `problems` and no price
 * is made up.
 *
 * Terms for every source, with links and display status, are in ./SOURCES.md.
 */

export type PriceProvider = "coinbase" | "onchain";

export type PriceSourceRef = {
  provider: PriceProvider;
  /** Symbol at the provider. */
  symbol: string;
  /** Shown next to the numbers when the price is a stand-in for the real underlying. */
  proxyNote?: string;
};

/** Where each research asset's price comes from. */
export const PRICE_SOURCES: Record<string, PriceSourceRef> = {
  mAAPL: { provider: "onchain", symbol: "AAPLc", proxyNote: "on-chain price of AAPLc on Base, not Apple's exchange price" },
  mNVDA: { provider: "onchain", symbol: "NVDAc", proxyNote: "on-chain price of NVDAc on Base, not NVIDIA's exchange price" },
  mSPX: { provider: "onchain", symbol: "deSPXA", proxyNote: "on-chain price of the deSPXA S&P 500 fund token on Base, not the index level" },
  mPAXG: { provider: "coinbase", symbol: "PAXG-USD", proxyNote: "Gold shown through the PAXG token price on Coinbase" },
  mcbBTC: { provider: "coinbase", symbol: "BTC-USD" },
  mWETH: { provider: "coinbase", symbol: "ETH-USD" },
};

export const COINBASE_SOURCE: Source = {
  name: "Coinbase Exchange public candles",
  url: "https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles",
  display: true,
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const COINBASE_BASE = "https://api.exchange.coinbase.com";
/** Coinbase: "Requests per second per IP: 10". We stay well under it. */
export const coinbaseLimiter = new RateLimiter(150);

/** How far back the daily series goes, so 5-year changes can be computed. */
export const DAILY_HISTORY_DAYS = 5 * 366 + 10;

// ---------------------------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------------------------

/** Monday (UTC) of the week a time falls in, as "YYYY-MM-DD". */
function weekKey(t: string): string {
  const d = new Date(t);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds weekly (Monday to Sunday, UTC) or monthly bars from daily bars: open of the first day,
 * highest high, lowest low, close of the last day, summed volume. Volume is left out when any day
 * of the period has none (a partial sum would read as low volume). The newest bar is the week or
 * month so far, as providers also show it; `closedBars` drops it until its period has ended.
 */
export function aggregateBars(daily: PriceBar[], to: "1w" | "1mo"): PriceBar[] {
  const out: PriceBar[] = [];
  let key = "";
  let missingV = false;
  const close = () => {
    const cur = out[out.length - 1];
    if (cur && missingV) delete cur.v;
  };
  for (const b of daily) {
    const k = to === "1w" ? weekKey(b.t) : b.t.slice(0, 7);
    const cur = out[out.length - 1];
    if (k !== key || !cur) {
      close();
      out.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, ...(b.v !== undefined ? { v: b.v } : {}) });
      missingV = b.v === undefined;
      key = k;
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      if (b.v === undefined) missingV = true;
      else cur.v = (cur.v ?? 0) + b.v;
    }
  }
  close();
  return out;
}

/**
 * When the period of a bar that opened at `t` ends, in ms since the epoch.
 * - Crypto (every day, UTC): 1 hour, 1 day, the next Monday 00:00 UTC, the first of the next month.
 * - Stocks (NYSE sessions from calendar.ts, holidays and 1:00 p.m. early closes included): an
 *   hourly bar ends after an hour or at the session close, whichever is first; a daily bar at that
 *   day's close; a weekly or monthly bar
 *   at the close of the last trading day of its week (Monday to Sunday) or month. Where no session
 *   is known the crypto rule is used.
 */
export function barPeriodEnd(t: string, interval: BarInterval, crypto: boolean): number {
  const start = Date.parse(t);
  if (interval === "1h") {
    const session = crypto ? null : sessionHours(newYorkParts(new Date(start)).date);
    return session ? Math.min(start + HOUR, session.close.getTime()) : start + HOUR;
  }
  // First UTC day of the next period.
  let next: string;
  if (interval === "1d") next = addDays(t.slice(0, 10), 1);
  else if (interval === "1w") next = addDays(weekKey(t), 7);
  else {
    const d = new Date(`${t.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    next = d.toISOString().slice(0, 10);
  }
  const utcEnd = Date.parse(`${next}T00:00:00Z`);
  if (crypto) return utcEnd;
  if (interval === "1d") return sessionHours(newYorkParts(new Date(start)).date)?.close.getTime() ?? utcEnd;
  const first = interval === "1w" ? weekKey(t) : `${t.slice(0, 7)}-01`;
  const day = lastTradingDay("XNYS", addDays(next, -1));
  if (day < first || !isTradingDay("XNYS", day)) return utcEnd;
  return sessionHours(day)?.close.getTime() ?? utcEnd;
}

/**
 * Keeps only bars whose period has ended by `at` (ms), so a still-forming hourly, daily, weekly
 * or monthly bar is never read as closed. At a Monday 12:00 UTC run, Monday's daily bar, the week
 * so far and the month so far are all dropped.
 */
export function closedBars(bars: PriceBar[], interval: BarInterval, crypto: boolean, at: number): PriceBar[] {
  return bars.filter((b) => barPeriodEnd(b.t, interval, crypto) <= at);
}

/** Sorts oldest first, drops duplicate times and bars with non-finite or non-positive prices. */
export function cleanBars(bars: PriceBar[]): PriceBar[] {
  const seen = new Set<string>();
  return bars
    .filter((b) => [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0) && Number.isFinite(Date.parse(b.t)))
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
    .filter((b) => (seen.has(b.t) ? false : (seen.add(b.t), true)));
}

// ---------------------------------------------------------------------------------------------
// Coinbase Exchange
// ---------------------------------------------------------------------------------------------

/** Parses Coinbase candles: arrays of [time (unix seconds), low, high, open, close, volume], newest first. */
export function parseCoinbaseCandles(raw: unknown): PriceBar[] {
  if (!Array.isArray(raw)) {
    const msg = raw && typeof raw === "object" && "message" in raw ? String((raw as { message: unknown }).message).slice(0, 120) : "unexpected shape";
    throw new Error(`Coinbase candles: ${msg}`);
  }
  const bars: PriceBar[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const [time, low, high, open, close, volume] = row.map(Number);
    bars.push({ t: new Date(time * 1000).toISOString(), o: open, h: high, l: low, c: close, ...(Number.isFinite(volume) ? { v: volume } : {}) });
  }
  return bars;
}

export function coinbaseUrl(product: string, granularity: number, start?: Date, end?: Date): string {
  const p = new URLSearchParams({ granularity: String(granularity) });
  if (start && end) {
    p.set("start", start.toISOString());
    p.set("end", end.toISOString());
  }
  return `${COINBASE_BASE}/products/${encodeURIComponent(product)}/candles?${p}`;
}

async function coinbaseGet(deps: DataDeps, url: string): Promise<PriceBar[]> {
  await coinbaseLimiter.wait(deps);
  return parseCoinbaseCandles(await getJson(deps, url, { "User-Agent": GENERIC_USER_AGENT, Accept: "application/json" }));
}

/**
 * Coinbase daily candles back `days` days, in windows of at most 300 candles (the API maximum).
 * Windows are aligned to whole UTC days so recorded fixtures replay with the same URLs.
 */
export async function coinbaseDaily(deps: DataDeps, product: string, days = DAILY_HISTORY_DAYS): Promise<PriceBar[]> {
  const today = Math.floor(deps.now().getTime() / DAY) * DAY;
  const bars: PriceBar[] = [];
  for (let endMs = today + DAY; endMs > today - days * DAY; endMs -= 300 * DAY) {
    const startMs = Math.max(endMs - 300 * DAY, today - days * DAY);
    const page = await coinbaseGet(deps, coinbaseUrl(product, 86_400, new Date(startMs), new Date(endMs - 1000)));
    bars.push(...page);
    if (page.length === 0) break; // before the product was listed
  }
  return cleanBars(bars);
}

/** Last 300 hourly candles (about 12 days). */
export async function coinbaseHourly(deps: DataDeps, product: string): Promise<PriceBar[]> {
  return cleanBars(await coinbaseGet(deps, coinbaseUrl(product, 3600)));
}

// ---------------------------------------------------------------------------------------------
// Per asset
// ---------------------------------------------------------------------------------------------

export type PriceHistory = {
  series: Partial<Record<BarInterval, PriceSeries>>;
  problems: string[];
  ref?: PriceSourceRef;
  /** Current price when the source has one apart from its bars (Chainlink feed or Morpho oracle). */
  current?: { value: number; asOf: IsoDateTime; label: string; source: Source };
  /** Further price facts from the source (pool price and premium), each with its own time. */
  facts?: Fact[];
};

/**
 * Coinbase: fetches 1h and 1d bars and builds 1w and 1mo from the daily bars. On-chain stocks:
 * daily bars plus the current price and pool facts (onchain.ts). Every failure is written to
 * `problems`; a missing interval is simply absent from `series`.
 */
export async function fetchPriceHistory(asset: UniverseAsset, deps: DataDeps, opts: { onchainBackfill?: Backfill } = {}): Promise<PriceHistory> {
  const problems: string[] = [];
  const series: PriceHistory["series"] = {};
  const ref = PRICE_SOURCES[asset.assetId];
  if (!ref) return { series, problems: [`${asset.assetId}: no price source configured`] };
  const fetchedAt = deps.now().toISOString();
  const make = (interval: BarInterval, bars: PriceBar[], src: Source): PriceSeries => ({ assetId: asset.assetId, interval, bars, source: src, fetchedAt });
  const addAggregates = (src: Source) => {
    const d = series["1d"];
    if (!d) return;
    series["1w"] = make("1w", aggregateBars(d.bars, "1w"), { ...src, name: `${src.name}, weekly bars built from daily` });
    series["1mo"] = make("1mo", aggregateBars(d.bars, "1mo"), { ...src, name: `${src.name}, monthly bars built from daily` });
  };

  if (ref.provider === "onchain") {
    if (!ONCHAIN_ASSETS[asset.assetId]) return { series, problems: [`${asset.assetId}: no on-chain price source configured`], ref };
    const h = await fetchOnchainHistory(asset.assetId, deps, opts.onchainBackfill);
    problems.push(...h.problems);
    if (h.daily && h.source) {
      series["1d"] = make("1d", cleanBars(h.daily), h.source);
      addAggregates(h.source);
    }
    problems.push(`${asset.assetId}: no hourly bars from on-chain data (the founder's spec asks for daily, weekly and monthly), no hourly reading`);
    return { series, problems, ref, ...(h.current ? { current: h.current } : {}), ...(h.facts.length ? { facts: h.facts } : {}) };
  }

  const src: Source = { ...COINBASE_SOURCE, name: `${COINBASE_SOURCE.name} (${ref.symbol})` };
  for (const [interval, load] of [["1h", () => coinbaseHourly(deps, ref.symbol)], ["1d", () => coinbaseDaily(deps, ref.symbol)]] as const) {
    try {
      const bars = await load();
      if (bars.length === 0) problems.push(`${asset.assetId}: ${interval} price history came back empty`);
      else series[interval] = make(interval, bars, src);
    } catch (e) {
      problems.push(`${asset.assetId}: ${interval} prices failed (${e instanceof Error ? e.message : "unknown error"})`);
    }
  }
  addAggregates(src);
  return { series, problems, ref };
}
