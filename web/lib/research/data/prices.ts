import type { BarInterval, PriceBar, PriceSeries, Source } from "../types.ts";
import type { UniverseAsset } from "../universe.ts";
import { addDays, isTradingDay, lastTradingDay, newYorkParts, newYorkTimeToUtc, sessionHours } from "./calendar.ts";
import { GENERIC_USER_AGENT, RateLimiter, getJson, type DataDeps } from "./deps.ts";

/**
 * Price history per interval for the six research assets. Server-only.
 *
 * - Crypto and PAXG: Coinbase Exchange public candles (no key). Hourly bars come straight from
 *   the API; daily bars are paged back 5 years; weekly and monthly bars are built in code from
 *   the daily bars (see `aggregateBars`).
 * - Stocks and the S&P 500: a pluggable provider chosen with RESEARCH_PRICE_PROVIDER (see
 *   `STOCK_PROVIDERS`). The default is "none": stock prices stay off until a provider whose plan
 *   allows display and commercial use is configured. Twelve Data can be switched on by name for
 *   internal review, but its free plan allows neither, so every fact built from it carries
 *   `display: false` (see `PriceHistory.display`). With no provider or no key the asset is
 *   reported in `problems` and no price is made up.
 *
 * Terms for every source, with links and display status, are in ./SOURCES.md.
 */

export type PriceProvider = "coinbase" | "twelvedata";

export type PriceSourceRef = {
  /** Provider for crypto assets; stocks use the RESEARCH_PRICE_PROVIDER switch instead. */
  provider: PriceProvider | "stock";
  /** Symbol at the provider. */
  symbol: string;
  /** Shown next to the numbers when the price is a stand-in for the real underlying. */
  proxyNote?: string;
};

/** Where each research asset's price comes from. */
export const PRICE_SOURCES: Record<string, PriceSourceRef> = {
  mAAPL: { provider: "stock", symbol: "AAPL" },
  mNVDA: { provider: "stock", symbol: "NVDA" },
  mSPX: { provider: "stock", symbol: "SPY", proxyNote: "S&P 500 shown through the SPY ETF price (tracks the index, before fees)" },
  mPAXG: { provider: "coinbase", symbol: "PAXG-USD", proxyNote: "Gold shown through the PAXG token price on Coinbase" },
  mcbBTC: { provider: "coinbase", symbol: "BTC-USD" },
  mWETH: { provider: "coinbase", symbol: "ETH-USD" },
};

export const COINBASE_SOURCE: Source = {
  name: "Coinbase Exchange public candles",
  url: "https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles",
};
export const TWELVEDATA_SOURCE: Source = { name: "Twelve Data time series", url: "https://twelvedata.com/docs#time-series" };

export const PRICE_KEY_ENV = "RESEARCH_PRICE_API_KEY";
/** Which stock price provider to use: "none" (default) or "twelvedata" (internal use only). */
export const PRICE_PROVIDER_ENV = "RESEARCH_PRICE_PROVIDER";

export type StockProviderId = "twelvedata" | "none";

/**
 * Stock price providers. `display` says whether the plan we use allows showing the numbers to
 * users, `commercial` whether it allows commercial use (a paid report is commercial). Add a
 * provider whose plan allows both here (and in SOURCES.md) and make it the default before stock
 * prices go on a public page; until then stock prices are for the engine and internal review only.
 */
export const STOCK_PROVIDERS: Record<StockProviderId, { label: string; display: boolean; commercial: boolean; keyEnv?: string; note: string }> = {
  twelvedata: { label: "Twelve Data", display: false, commercial: false, keyEnv: PRICE_KEY_ENV, note: "free Basic plan: internal, non-display, non-commercial use only" },
  none: { label: "No stock provider", display: false, commercial: false, note: "stock prices switched off" },
};

/** Default provider: none, because no wired provider allows display and commercial use. */
export const DEFAULT_STOCK_PROVIDER: StockProviderId = "none";

export function stockProvider(env: Record<string, string | undefined>): StockProviderId | { unknown: string } {
  const raw = (env[PRICE_PROVIDER_ENV] ?? "").trim().toLowerCase() || DEFAULT_STOCK_PROVIDER;
  return raw in STOCK_PROVIDERS ? (raw as StockProviderId) : { unknown: raw };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const COINBASE_BASE = "https://api.exchange.coinbase.com";
const TWELVEDATA_BASE = "https://api.twelvedata.com";
/** Coinbase: "Requests per second per IP: 10". We stay well under it. */
export const coinbaseLimiter = new RateLimiter(150);
/** Twelve Data Basic: 8 API credits per minute. One credit per symbol per call. */
export const twelveDataLimiter = new RateLimiter(7_600);

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
 * highest high, lowest low, close of the last day, summed volume. The newest bar is the week or
 * month so far, as providers also show it; `closedBars` drops it until its period has ended.
 */
export function aggregateBars(daily: PriceBar[], to: "1w" | "1mo"): PriceBar[] {
  const out: PriceBar[] = [];
  let key = "";
  for (const b of daily) {
    const k = to === "1w" ? weekKey(b.t) : b.t.slice(0, 7);
    const cur = out[out.length - 1];
    if (k !== key || !cur) {
      out.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, ...(b.v !== undefined ? { v: b.v } : {}) });
      key = k;
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      if (b.v !== undefined) cur.v = (cur.v ?? 0) + b.v;
    }
  }
  return out;
}

/**
 * When the period of a bar that opened at `t` ends, in ms since the epoch.
 * - Crypto (every day, UTC): 1 hour, 1 day, the next Monday 00:00 UTC, the first of the next month.
 * - Stocks (NYSE sessions from calendar.ts, holidays and 1:00 p.m. early closes included): an
 *   hourly bar ends after an hour or at the session close, whichever is first (the last Twelve
 *   Data bar of a day is 15:30 to 16:00); a daily bar at that day's close; a weekly or monthly bar
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
// Twelve Data
// ---------------------------------------------------------------------------------------------

/**
 * Parses a Twelve Data time series requested with timezone=UTC. Intraday datetimes are UTC
 * ("2026-11-18 20:30:00"); daily datetimes are the trading date, which we stamp with the 9:30
 * New York open so `t` is the bar's opening time as the shared type says.
 */
export function parseTwelveData(raw: unknown): PriceBar[] {
  if (!raw || typeof raw !== "object") throw new Error("Twelve Data: unexpected shape");
  const r = raw as { status?: unknown; code?: unknown; message?: unknown; values?: unknown };
  if (r.status === "error" || !Array.isArray(r.values)) {
    throw new Error(`Twelve Data error ${typeof r.code === "number" ? r.code : ""}: ${String(r.message ?? "no values").slice(0, 120)}`.trim());
  }
  const bars: PriceBar[] = [];
  for (const v of r.values as Record<string, unknown>[]) {
    const dt = String(v.datetime ?? "");
    let t: string;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) t = newYorkTimeToUtc(dt, 9, 30).toISOString();
    else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dt)) t = `${dt.replace(" ", "T")}Z`;
    else continue;
    const vol = Number(v.volume);
    bars.push({ t: new Date(t).toISOString(), o: Number(v.open), h: Number(v.high), l: Number(v.low), c: Number(v.close), ...(Number.isFinite(vol) ? { v: vol } : {}) });
  }
  return bars;
}

export function twelveDataUrl(symbol: string, interval: "1h" | "1day", outputsize: number, apiKey: string): string {
  const p = new URLSearchParams({ symbol, interval, outputsize: String(outputsize), timezone: "UTC", order: "asc", apikey: apiKey });
  return `${TWELVEDATA_BASE}/time_series?${p}`;
}

async function twelveDataGet(deps: DataDeps, symbol: string, interval: "1h" | "1day", outputsize: number, apiKey: string): Promise<PriceBar[]> {
  await twelveDataLimiter.wait(deps);
  const raw = await getJson(deps, twelveDataUrl(symbol, interval, outputsize, apiKey), { "User-Agent": GENERIC_USER_AGENT, Accept: "application/json" });
  return cleanBars(parseTwelveData(raw));
}

// ---------------------------------------------------------------------------------------------
// Per asset
// ---------------------------------------------------------------------------------------------

export type PriceHistory = {
  series: Partial<Record<BarInterval, PriceSeries>>;
  problems: string[];
  ref?: PriceSourceRef;
  /**
   * False when the provider's terms do not allow showing these prices to users or using them
   * commercially. Every fact built from this history must carry it (`Fact.display`). Undefined
   * when no restriction is recorded.
   */
  display?: boolean;
};

/**
 * Fetches 1h and 1d bars and builds 1w and 1mo from the daily bars. Every failure is written to
 * `problems`; a missing interval is simply absent from `series`.
 */
export async function fetchPriceHistory(asset: UniverseAsset, deps: DataDeps): Promise<PriceHistory> {
  const problems: string[] = [];
  const series: PriceHistory["series"] = {};
  const ref = PRICE_SOURCES[asset.assetId];
  if (!ref) return { series, problems: [`${asset.assetId}: no price source configured`] };

  let source: Source;
  let display: boolean | undefined;
  let hourly: () => Promise<PriceBar[]>;
  let daily: () => Promise<PriceBar[]>;
  if (ref.provider === "coinbase") {
    source = COINBASE_SOURCE;
    hourly = () => coinbaseHourly(deps, ref.symbol);
    daily = () => coinbaseDaily(deps, ref.symbol);
  } else {
    const prov = stockProvider(deps.env);
    if (typeof prov !== "string") return { series, problems: [`${asset.assetId}: ${PRICE_PROVIDER_ENV}="${prov.unknown.slice(0, 40)}" is not a known provider, no stock price fetched`], ref };
    if (prov === "none") {
      const why = deps.env[PRICE_PROVIDER_ENV]?.trim() ? `${PRICE_PROVIDER_ENV}=none` : `${PRICE_PROVIDER_ENV} not set (default none: no stock provider that allows display and commercial use is configured)`;
      return { series, problems: [`${asset.assetId}: ${why}, no stock price fetched`], ref };
    }
    const key = deps.env[PRICE_KEY_ENV];
    if (!key) return { series, problems: [`${asset.assetId}: ${PRICE_KEY_ENV} not set, no stock price fetched`], ref };
    source = TWELVEDATA_SOURCE;
    const terms = STOCK_PROVIDERS[prov];
    if (!terms.display || !terms.commercial) {
      display = false;
      problems.push(`${asset.assetId}: stock prices from ${terms.label} are internal only (${terms.note}), every fact built from them is marked display false`);
    }
    hourly = () => twelveDataGet(deps, ref.symbol, "1h", 500, key);
    daily = () => twelveDataGet(deps, ref.symbol, "1day", 1300, key);
  }
  const src: Source = { ...source, name: `${source.name} (${ref.symbol})` };

  const make = (interval: BarInterval, bars: PriceBar[]): PriceSeries => ({ assetId: asset.assetId, interval, bars, source: src, fetchedAt: deps.now().toISOString() });
  for (const [interval, load] of [["1h", hourly], ["1d", daily]] as const) {
    try {
      const bars = await load();
      if (bars.length === 0) problems.push(`${asset.assetId}: ${interval} price history came back empty`);
      else series[interval] = make(interval, bars);
    } catch (e) {
      problems.push(`${asset.assetId}: ${interval} prices failed (${e instanceof Error ? e.message : "unknown error"})`);
    }
  }
  const d = series["1d"];
  if (d) {
    series["1w"] = { ...make("1w", aggregateBars(d.bars, "1w")), source: { ...src, name: `${src.name}, weekly bars built from daily` } };
    series["1mo"] = { ...make("1mo", aggregateBars(d.bars, "1mo")), source: { ...src, name: `${src.name}, monthly bars built from daily` } };
  }
  return { series, problems, ref, ...(display === false ? { display } : {}) };
}
