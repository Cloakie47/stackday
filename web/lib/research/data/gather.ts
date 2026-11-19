import type { AssetResearchInput, BarInterval, Fact, Indicators, IsoDate, IsoDateTime, PriceBar, PriceSeries, Source, Timeframe } from "../types.ts";
import { universeAsset, type UniverseAsset } from "../universe.ts";
import { NYSE_SOURCE, calendarCovers, holidayName, isEarlyClose, isTradingDay, lastTradingDay, newYorkParts, sessionHours } from "./calendar.ts";
import { assertServer, defaultDeps, type DataDeps } from "./deps.ts";
import { computeIndicators } from "./indicators.ts";
import { fetchFilings, fetchPressNews } from "./news.ts";
import { PRICE_SOURCES, fetchPriceHistory } from "./prices.ts";

/**
 * Gathers everything the engine needs for one asset on one run date: price series per interval,
 * indicators, and facts with stable ids. Every number in `facts` comes from fetched data or a
 * formula in ./indicators.ts, with its source and time. Anything that fails goes to `problems`;
 * nothing is filled in by guesswork. Server-only.
 *
 * Fact ids:
 *   px.last, px.prevClose
 *   chg.1h, chg.1d, chg.1w, chg.1m, chg.1y, chg.5y         (percent)
 *   ind.<name>.<interval>, for example ind.rsi14.1d, ind.sma200.1d, ind.atr14.1h,
 *     ind.macd.1d, ind.macdSignal.1d, ind.macdHist.1d, ind.vol.1d, ind.mdd.1d,
 *     ind.high52w.1d, ind.low52w.1d, ind.support1.1d .. ind.support3.1d, ind.resistance1.1d ..
 *   cal.open, cal.lastTradingDay, cal.holiday, cal.earlyClose
 *   news.0 .. news.4 (company press releases), filing.0 .. filing.4 (SEC EDGAR)
 */

const INTERVALS: BarInterval[] = ["1h", "1d", "1w", "1mo"];
const INTERVAL_LABEL: Record<BarInterval, string> = { "1h": "hourly", "1d": "daily", "1w": "weekly", "1mo": "monthly" };
const TF_LABEL: Record<Timeframe, string> = { "1h": "1 hour", "1d": "1 day", "1w": "1 week", "1m": "1 month", "1y": "1 year", "5y": "5 years" };

const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
/** Prices to cents, or 6 significant digits under $1. */
export const roundPrice = (x: number) => (Math.abs(x) >= 1 ? round(x, 2) : Number(x.toPrecision(6)));

/** When the newest bar of a series closed (or `fetchedAt` if it is still open). */
export function seriesAsOf(s: PriceSeries, crypto: boolean): IsoDateTime {
  return barCloseTime(s.bars[s.bars.length - 1], s.interval, crypto, s.fetchedAt);
}

/**
 * When a bar closed: start + 1 hour or 1 day for crypto; for stocks never later than that day's
 * NYSE close (16:00 New York, 13:00 on early closes). Capped at `fetchedAt` for a bar still open.
 */
export function barCloseTime(bar: PriceBar, interval: BarInterval, crypto: boolean, fetchedAt: IsoDateTime): IsoDateTime {
  const start = Date.parse(bar.t);
  let close = start + (interval === "1h" ? 3_600_000 : 86_400_000);
  if (!crypto) {
    const session = sessionHours(newYorkParts(new Date(start)).date);
    if (session) close = interval === "1h" ? Math.min(close, session.close.getTime()) : session.close.getTime();
  }
  return new Date(Math.min(close, Date.parse(fetchedAt))).toISOString();
}

type FactSpec = { key: string; label: string; value: number | undefined; unit?: string };

function indicatorSpecs(ind: Indicators, iv: BarInterval, full: boolean): FactSpec[] {
  const L = INTERVAL_LABEL[iv];
  const specs: FactSpec[] = [
    { key: "rsi14", label: `RSI (14, ${L})`, value: ind.rsi14 === undefined ? undefined : round(ind.rsi14, 1) },
    { key: "sma20", label: `20-bar average (${L})`, value: ind.sma20 === undefined ? undefined : roundPrice(ind.sma20), unit: "USD" },
    { key: "sma50", label: `50-bar average (${L})`, value: ind.sma50 === undefined ? undefined : roundPrice(ind.sma50), unit: "USD" },
    { key: "atr14", label: `Average true range (14, ${L})`, value: ind.atr14 === undefined ? undefined : roundPrice(ind.atr14), unit: "USD" },
    { key: "macdHist", label: `MACD histogram (12, 26, 9, ${L})`, value: ind.macd ? Number(ind.macd.histogram.toPrecision(4)) : undefined },
  ];
  if (!full) return specs;
  specs.push(
    { key: "sma200", label: `200-bar average (${L})`, value: ind.sma200 === undefined ? undefined : roundPrice(ind.sma200), unit: "USD" },
    { key: "macd", label: `MACD line (12, 26, ${L})`, value: ind.macd ? Number(ind.macd.macd.toPrecision(4)) : undefined },
    { key: "macdSignal", label: `MACD signal (9, ${L})`, value: ind.macd ? Number(ind.macd.signal.toPrecision(4)) : undefined },
    { key: "vol", label: `Annualised volatility (last year of ${L} bars)`, value: ind.volatility === undefined ? undefined : round(ind.volatility * 100, 1), unit: "%" },
    { key: "mdd", label: `Max drawdown (last year of ${L} closes)`, value: ind.maxDrawdown === undefined ? undefined : round(ind.maxDrawdown * 100, 1), unit: "%" },
    { key: "high52w", label: "52-week high", value: ind.high52w === undefined ? undefined : roundPrice(ind.high52w), unit: "USD" },
    { key: "low52w", label: "52-week low", value: ind.low52w === undefined ? undefined : roundPrice(ind.low52w), unit: "USD" },
  );
  (ind.support ?? []).forEach((v, i) => specs.push({ key: `support${i + 1}`, label: `Support ${i + 1} (swing low, ${L})`, value: roundPrice(v), unit: "USD" }));
  (ind.resistance ?? []).forEach((v, i) => specs.push({ key: `resistance${i + 1}`, label: `Resistance ${i + 1} (swing high, ${L})`, value: roundPrice(v), unit: "USD" }));
  return specs;
}

function calendarFacts(asset: UniverseAsset, date: IsoDate, open: boolean, at: IsoDateTime): Fact[] {
  const crypto = asset.calendar === "CRYPTO";
  const source: Source = crypto ? { name: "Crypto markets trade every day" } : NYSE_SOURCE;
  const facts: Fact[] = [
    { id: "cal.open", kind: "calendar", label: crypto ? "Market open today (trades every day)" : "NYSE open today", value: open ? "yes" : "no", source, asOf: at },
  ];
  if (calendarCovers(asset.calendar, date)) {
    facts.push({ id: "cal.lastTradingDay", kind: "calendar", label: "Last trading day on or before the run date", value: lastTradingDay(asset.calendar, date), source, asOf: at });
  }
  const hol = holidayName(asset.calendar, date);
  if (hol) facts.push({ id: "cal.holiday", kind: "calendar", label: "NYSE holiday", value: hol, source, asOf: at });
  if (isEarlyClose(asset.calendar, date)) facts.push({ id: "cal.earlyClose", kind: "calendar", label: "NYSE closes early at 1:00 p.m. New York time", value: "yes", source, asOf: at });
  return facts;
}

export async function gatherAsset(assetId: string, date: IsoDate, deps?: Partial<DataDeps>): Promise<AssetResearchInput> {
  assertServer();
  const d: DataDeps = { ...defaultDeps(), ...deps };
  const out: AssetResearchInput = { assetId, date, marketOpenToday: false, series: {}, indicators: {}, facts: [], problems: [] };
  const asset = universeAsset(assetId);
  if (!asset) {
    out.problems.push(`${assetId}: not in the research universe`);
    return out;
  }
  const crypto = asset.calendar === "CRYPTO";
  const nowIso = d.now().toISOString();

  if (!calendarCovers(asset.calendar, date)) {
    out.problems.push(`${assetId}: NYSE holiday list not loaded for ${date.slice(0, 4)}, only weekends are known`);
  }
  out.marketOpenToday = isTradingDay(asset.calendar, date);
  out.facts.push(...calendarFacts(asset, date, out.marketOpenToday, nowIso));

  // Prices and indicators
  const history = await fetchPriceHistory(asset, d);
  out.series = history.series;
  out.problems.push(...history.problems);
  const proxy = PRICE_SOURCES[assetId]?.proxyNote;

  for (const iv of INTERVALS) {
    const s = out.series[iv];
    if (!s) continue;
    const ind = computeIndicators(s.bars, iv, { crypto });
    if (!ind) continue;
    out.indicators[iv] = ind;
    const asOf = seriesAsOf(iv === "1w" || iv === "1mo" ? (out.series["1d"] ?? s) : s, crypto);
    for (const spec of indicatorSpecs(ind, iv, iv === "1d")) {
      if (spec.value === undefined || !Number.isFinite(spec.value)) continue;
      out.facts.push({ id: `ind.${spec.key}.${iv}`, kind: "indicator", label: spec.label, value: spec.value, ...(spec.unit ? { unit: spec.unit } : {}), source: s.source, asOf });
    }
  }

  // Last price: the newest close across hourly and daily bars.
  const candidates = (["1h", "1d"] as const).map((iv) => out.series[iv]).filter((s): s is PriceSeries => Boolean(s && s.bars.length));
  if (candidates.length) {
    const best = candidates.reduce((a, b) => (Date.parse(seriesAsOf(b, crypto)) > Date.parse(seriesAsOf(a, crypto)) ? b : a));
    const last = best.bars[best.bars.length - 1];
    out.facts.push({
      id: "px.last",
      kind: "price",
      label: proxy ? `Last price (${proxy})` : "Last price",
      value: roundPrice(last.c),
      unit: "USD",
      source: best.source,
      asOf: seriesAsOf(best, crypto),
    });
  }
  const daily = out.series["1d"];
  if (daily && daily.bars.length >= 2) {
    const prev = daily.bars[daily.bars.length - 2];
    out.facts.push({ id: "px.prevClose", kind: "price", label: "Previous daily close", value: roundPrice(prev.c), unit: "USD", source: daily.source, asOf: barCloseTime(prev, "1d", crypto, daily.fetchedAt) });
  }

  // Changes: 1h from hourly bars, the rest from daily bars.
  const tfs: [Timeframe, BarInterval][] = [["1h", "1h"], ["1d", "1d"], ["1w", "1d"], ["1m", "1d"], ["1y", "1d"], ["5y", "1d"]];
  for (const [tf, iv] of tfs) {
    const v = out.indicators[iv]?.changePct[tf];
    const s = out.series[iv];
    if (v === undefined || !s) continue;
    out.facts.push({ id: `chg.${tf}`, kind: "price", label: `Change over ${TF_LABEL[tf]}`, value: round(v, 2), unit: "%", source: s.source, asOf: seriesAsOf(s, crypto) });
  }

  // News and filings (both never throw; failures land in problems).
  const [news, filings] = await Promise.all([fetchPressNews(asset, date, d), fetchFilings(asset, date, d)]);
  out.facts.push(...news.facts, ...filings.facts);
  out.problems.push(...news.problems, ...filings.problems);
  return out;
}

/** Gathers several assets one after another (rate limits are per source, shared across calls). */
export async function gatherAll(assetIds: string[], date: IsoDate, deps?: Partial<DataDeps>): Promise<AssetResearchInput[]> {
  const out: AssetResearchInput[] = [];
  for (const id of assetIds) out.push(await gatherAsset(id, date, deps));
  return out;
}
