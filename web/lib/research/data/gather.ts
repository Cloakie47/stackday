import deployment from "../../deployment.json" with { type: "json" };
import type { AssetResearchInput, BarInterval, CalendarEvent, ChartInterval, Fact, Indicators, IsoDate, IsoDateTime, MarketResearchInput, PriceBar, PriceSeries, Source } from "../types.ts";
import { CHART_INTERVAL_LABEL, CHART_INTERVALS } from "../types.ts";
import { checkResearchable, researchableUniverse, type DeploymentLike, type UniverseAsset } from "../universe.ts";
import { NYSE_SOURCE, calendarCovers, holidayName, isEarlyClose, isTradingDay, lastTradingDay } from "./calendar.ts";
import { PATTERN_LABEL, readChart } from "./chart.ts";
import { assertServer, defaultDeps, type DataDeps } from "./deps.ts";
import { eventsForAsset, fetchWeekAhead } from "./events.ts";
import { fetchFlows } from "./flows.ts";
import { fetchOfficialNews, fetchPressNews, fetchWireNews, newsFacts } from "./headlines.ts";
import { computeIndicators, spansYear } from "./indicators.ts";
import { MACRO_FOR_ASSET, fetchMacro } from "./macro.ts";
import { fetchFilings } from "./news.ts";
import { PRICE_SOURCES, aggregateBars, barPeriodEnd, closedBars, fetchPriceHistory } from "./prices.ts";
import type { Backfill } from "./onchain.ts";

/**
 * Gathers everything the engine needs, code only (spec section 4.1). Every number in `facts`
 * comes from fetched data or a formula in this folder, with its source and time. Anything that
 * fails goes to `problems` as a "no reading" line; nothing is filled in. Server-only.
 *
 * `gatherMarket(date)` -> MarketResearchInput: FRED macro facts, the official week-ahead calendar,
 *   market-wide headlines from reputable outlets and official feeds.
 * `gatherAsset(assetId, date)` -> AssetResearchInput: refuses assets that fail `checkResearchable`;
 *   price series (1h, 1d, 1w, 1mo), indicators, chart read on 1d, 1w and 1mo bars, calendar
 *   events for the asset, headlines, filings and crypto flows.
 *
 * Fact ids (stable within a run):
 *   px.last, px.1d.prevClose, px.1w.volume, px.pool.last, px.pool.premium (on-chain stocks)
 *   chg.<interval>.bar1 | bar5 | bar20                      percent change over 1, 5, 20 bars
 *   ind.<interval>.<name>, for example ind.1d.rsi14, ind.1w.sma50, ind.1d.high52w
 *   chart.<interval>.trend, chart.<interval>.position
 *   lvl.<interval>.support1 .. support3, lvl.<interval>.resistance1 .. resistance3
 *   vol.<interval>.regime, vol.<interval>.atrPct, vol.<interval>.volPct
 *   pat.<interval>.<kind>, for example pat.1d.double-bottom
 *   cal.open, cal.lastTradingDay, cal.holiday, cal.earlyClose, cal.<date>.<kind> (events)
 *   macro.<series>[.chg5|.chg20|.yoy|.chg], macro.curve2s10s, macro.fedTarget, macro.sp500.*
 *   flow.funding.last, flow.funding.avg7d, flow.stablecoins.total | chg7d | chg30d
 *   news.0 .., filing.0 ..
 *
 * No look-ahead: bars, observations and headlines after the run date are dropped, and so is any
 * bar whose period has not ended at the run time (see `cutSeries`).
 *
 * Licences: every price series carries `source.display` (Coinbase and the on-chain sources: true),
 * and every fact, level and pattern built from it copies that source, so it inherits the flag
 * (core `isDisplayable`). FRED S&P 500 and VIX facts are display false unless RESEARCH_SHOW_SP_VIX=1.
 */

const BAR_INTERVALS: BarInterval[] = ["1h", "1d", "1w", "1mo"];
const INTERVAL_LABEL: Record<BarInterval, string> = { "1h": "hourly", "1d": "daily", "1w": "weekly", "1mo": "monthly" };

const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
/** Prices to cents, or 6 significant digits under $1. */
export const roundPrice = (x: number) => (Math.abs(x) >= 1 ? round(x, 2) : Number(x.toPrecision(6)));

export const FED_FUNDS_EXPECTATIONS_PROBLEM = "Fed funds expectations (futures pricing): no free source with clear terms for automated use, no reading";
export const EARNINGS_PROBLEM = "earnings dates: no official machine-readable source wired, omitted rather than guessed";

/** Thrown when an asset is not in the research universe or not borrowable in this deployment. */
export class NotResearchableError extends Error {}

export type GatherOptions = {
  /** Deployment record to check borrowability against. Defaults to web/lib/deployment.json. */
  deployment?: DeploymentLike;
  /** Market input from the same run: supplies the week-ahead calendar and the asset's macro facts. */
  market?: MarketResearchInput;
  /** On-chain backfill to use instead of the checked-in onchain-backfill.json (tests). */
  onchainBackfill?: Backfill;
};

/** When the newest bar of a series closed (or `fetchedAt` if it is still open). */
export function seriesAsOf(s: PriceSeries, crypto: boolean): IsoDateTime {
  return barCloseTime(s.bars[s.bars.length - 1], s.interval, crypto, s.fetchedAt);
}

/**
 * When a bar closed (`barPeriodEnd`): start + 1 hour or 1 day for crypto; for stocks never later
 * than that day's NYSE close (16:00 New York, 13:00 on early closes). Capped at `fetchedAt`.
 */
export function barCloseTime(bar: PriceBar, interval: BarInterval, crypto: boolean, fetchedAt: IsoDateTime): IsoDateTime {
  return new Date(Math.min(barPeriodEnd(bar.t, interval, crypto), Date.parse(fetchedAt))).toISOString();
}

type FactSpec = { key: string; label: string; value: number | undefined; unit?: string };

function indicatorSpecs(ind: Indicators, iv: BarInterval, bars: PriceBar[]): FactSpec[] {
  const L = INTERVAL_LABEL[iv];
  // Volatility and drawdown use the last year of bars, or all of them when the series is shorter.
  const span = spansYear(bars) ? `last year of ${L} bars` : `all ${bars.length} ${L} bars, less than a year`;
  const spanCloses = spansYear(bars) ? `last year of ${L} closes` : `all ${bars.length} ${L} closes, less than a year`;
  const p = (x: number | undefined) => (x === undefined ? undefined : roundPrice(x));
  const specs: FactSpec[] = [
    { key: "rsi14", label: `RSI (14, ${L})`, value: ind.rsi14 === undefined ? undefined : round(ind.rsi14, 1) },
    { key: "sma20", label: `20-bar average (${L})`, value: p(ind.sma20), unit: "USD" },
    { key: "sma50", label: `50-bar average (${L})`, value: p(ind.sma50), unit: "USD" },
    { key: "atr14", label: `Average true range (14, ${L})`, value: p(ind.atr14), unit: "USD" },
    { key: "macdHist", label: `MACD histogram (12, 26, 9, ${L})`, value: ind.macd ? Number(ind.macd.histogram.toPrecision(4)) : undefined },
  ];
  if (iv === "1h") return specs;
  specs.push(
    { key: "sma200", label: `200-bar average (${L})`, value: p(ind.sma200), unit: "USD" },
    { key: "macd", label: `MACD line (12, 26, ${L})`, value: ind.macd ? Number(ind.macd.macd.toPrecision(4)) : undefined },
    { key: "macdSignal", label: `MACD signal (9, ${L})`, value: ind.macd ? Number(ind.macd.signal.toPrecision(4)) : undefined },
    { key: "vol", label: `Annualised volatility (${span})`, value: ind.volatility === undefined ? undefined : round(ind.volatility * 100, 1), unit: "%" },
    { key: "mdd", label: `Max drawdown (${spanCloses})`, value: ind.maxDrawdown === undefined ? undefined : round(ind.maxDrawdown * 100, 1), unit: "%" },
  );
  if (iv === "1d") {
    specs.push({ key: "high52w", label: "52-week high", value: p(ind.high52w), unit: "USD" }, { key: "low52w", label: "52-week low", value: p(ind.low52w), unit: "USD" });
  }
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

/** Calendar events as facts, so claims about the week ahead can cite them. */
export function eventFacts(events: CalendarEvent[], at: IsoDateTime): Fact[] {
  return events.map((e) => ({ id: e.id, kind: "calendar" as const, label: e.name, value: e.timeUtc ? `${e.date} ${e.timeUtc} UTC` : e.date, source: e.source, asOf: at }));
}

/** The weekly report runs on Monday at 12:00 UTC; a backfill for an earlier date sees only what that run would have seen. */
export const RUN_TIME_UTC = "12:00:00";

/** The run time for a run date: 12:00 UTC on that date, or `now` when that is earlier. */
export function runCutoff(date: IsoDate, now?: Date): number {
  return Math.min(Date.parse(`${date}T${RUN_TIME_UTC}Z`), now ? now.getTime() : Infinity);
}

/**
 * Keeps only closed bars and rebuilds weekly and monthly bars from the closed daily bars. The run
 * time is 12:00 UTC on the run date (the live run's time, also used by macro.ts), or `now` when
 * earlier: a bar is kept only when its period (hour, NYSE session or UTC day, week, month; see
 * `barPeriodEnd`) has ended by then, so a backfill never sees the afternoon of its own run date and
 * changes such as chg.1w.bar1 and chart patterns never read a bar that is still forming.
 */
export function cutSeries(series: Partial<Record<BarInterval, PriceSeries>>, date: IsoDate, crypto: boolean, now?: Date): Partial<Record<BarInterval, PriceSeries>> {
  const at = runCutoff(date, now);
  const out: Partial<Record<BarInterval, PriceSeries>> = {};
  for (const iv of ["1h", "1d"] as const) {
    const s = series[iv];
    if (!s) continue;
    const bars = closedBars(s.bars, iv, crypto, at);
    if (bars.length) out[iv] = { ...s, bars };
  }
  const d = out["1d"];
  if (d) {
    for (const iv of ["1w", "1mo"] as const) {
      const s = series[iv];
      const bars = s ? closedBars(aggregateBars(d.bars, iv), iv, crypto, at) : [];
      if (s && bars.length) out[iv] = { ...s, bars };
    }
  }
  return out;
}

/** Facts and fact ids for one chart read. */
function chartFacts(input: AssetResearchInput, iv: ChartInterval, crypto: boolean): string[] {
  const s = input.series[iv]!;
  const read = readChart(s.bars, iv, { crypto });
  const L = CHART_INTERVAL_LABEL[iv].toLowerCase();
  if (!read) {
    input.problems.push(`${input.assetId}: ${L} chart read needs at least 30 bars, no reading`);
    return [];
  }
  const asOf = seriesAsOf(input.series["1d"] ?? s, crypto);
  const src: Source = { ...s.source, name: `${s.source.name}, chart read computed by Stackday` };
  const facts: Fact[] = [];
  const add = (f: Omit<Fact, "source" | "asOf"> & { asOf?: IsoDateTime }) => facts.push({ source: src, asOf, ...f } as Fact);
  const trendText = { "higher-highs-higher-lows": "higher highs and higher lows", "lower-highs-lower-lows": "lower highs and lower lows", range: "range (no clear swing trend)" }[read.trend];
  add({ id: `chart.${iv}.trend`, kind: "indicator", label: `Trend structure (${L} swing highs and lows)`, value: trendText });
  read.support.forEach((v, i) => add({ id: `lvl.${iv}.support${i + 1}`, kind: "indicator", label: `Support ${i + 1} (${L}, cluster of ${read.supportTouches[i]} swing points)`, value: v, unit: "USD" }));
  read.resistance.forEach((v, i) => add({ id: `lvl.${iv}.resistance${i + 1}`, kind: "indicator", label: `Resistance ${i + 1} (${L}, cluster of ${read.resistanceTouches[i]} swing points)`, value: v, unit: "USD" }));
  if (read.positionInRange !== null) add({ id: `chart.${iv}.position`, kind: "indicator", label: `Position between nearest ${L} support (0) and resistance (1)`, value: round(read.positionInRange, 2) });
  const vr = read.volatility;
  const lookback = iv === "1d" ? "last year" : iv === "1w" ? "last 3 years" : "last 5 years";
  add({ id: `vol.${iv}.regime`, kind: "indicator", label: `Volatility regime (${L} ATR and realized volatility against the ${lookback})`, value: vr.regime });
  if (vr.atrPercentile !== undefined) add({ id: `vol.${iv}.atrPct`, kind: "indicator", label: `${CHART_INTERVAL_LABEL[iv]} ATR as a share of price, percentile against the ${lookback}`, value: vr.atrPercentile });
  if (vr.volPercentile !== undefined) add({ id: `vol.${iv}.volPct`, kind: "indicator", label: `${CHART_INTERVAL_LABEL[iv]} realized volatility, percentile against the ${lookback}`, value: vr.volPercentile });
  for (const p of read.patterns) {
    add({
      id: p.id,
      kind: "pattern",
      label: `${PATTERN_LABEL[p.kind]} on ${L} bars (${p.direction}, ${p.confidence} confidence): ${p.detail}. Invalidated by a close beyond the value.`,
      value: p.invalidation,
      unit: "USD",
      tags: [p.kind, p.direction],
    });
  }
  input.facts.push(...facts);
  const indIds = input.facts.filter((f) => f.id.startsWith(`ind.${iv}.`) || f.id.startsWith(`chg.${iv}.`)).map((f) => f.id);
  const ids = [...(input.facts.some((f) => f.id === "px.last") ? ["px.last"] : []), ...indIds, ...facts.map((f) => f.id)];
  const groups = new Map<number, string[]>();
  for (const x of read.noReading) groups.set(x.minBars, [...(groups.get(x.minBars) ?? []), PATTERN_LABEL[x.kind].toLowerCase()]);
  for (const [min, kinds] of groups) input.problems.push(`${input.assetId}: ${kinds.join(", ")} on ${L} bars need${kinds.length > 1 ? "" : "s"} ${min} bars, only ${read.bars}, no reading`);
  // The shared ChartRead only: touch counts, ATR and the no-reading list stay in this file.
  input.chart[iv] = { interval: read.interval, trend: read.trend, support: read.support, resistance: read.resistance, positionInRange: read.positionInRange, patterns: read.patterns, volatility: read.volatility, factIds: ids };
  return ids;
}

export async function gatherAsset(assetId: string, date: IsoDate, deps?: Partial<DataDeps>, opts: GatherOptions = {}): Promise<AssetResearchInput> {
  assertServer();
  const check = checkResearchable(assetId, opts.deployment ?? (deployment as DeploymentLike));
  if (!check.ok) throw new NotResearchableError(check.reason);
  const asset = check.asset;
  const d: DataDeps = { ...defaultDeps(), ...deps };
  const out: AssetResearchInput = { assetId, date, marketOpenToday: false, series: {}, indicators: {}, chart: {}, facts: [], calendar: [], problems: [] };
  const crypto = asset.calendar === "CRYPTO";
  const nowIso = d.now().toISOString();

  if (!calendarCovers(asset.calendar, date)) out.problems.push(`${assetId}: NYSE holiday list not loaded for ${date.slice(0, 4)}, only weekends are known`);
  out.marketOpenToday = isTradingDay(asset.calendar, date);
  out.facts.push(...calendarFacts(asset, date, out.marketOpenToday, nowIso));

  // Prices and indicators
  const history = await fetchPriceHistory(asset, d, { onchainBackfill: opts.onchainBackfill });
  out.series = cutSeries(history.series, date, crypto, d.now());
  out.problems.push(...history.problems);
  const proxy = PRICE_SOURCES[assetId]?.proxyNote;
  const cutoff = runCutoff(date, d.now());
  // Before 12:00 UTC on the run date the cut is "now": whatever was just read is current (a block
  // time a few seconds past the server clock is not the future). Later, or for a backfill, a value
  // read from chain counts only if it was published by 12:00 UTC on the run date.
  const usable = (asOf: IsoDateTime) => cutoff >= d.now().getTime() || Date.parse(asOf) <= cutoff;

  for (const iv of BAR_INTERVALS) {
    const s = out.series[iv];
    if (!s) continue;
    const ind = computeIndicators(s.bars, iv, { crypto });
    if (!ind) continue;
    out.indicators[iv] = ind;
    const asOf = seriesAsOf(iv === "1w" || iv === "1mo" ? (out.series["1d"] ?? s) : s, crypto);
    for (const spec of indicatorSpecs(ind, iv, s.bars)) {
      if (spec.value === undefined || !Number.isFinite(spec.value)) continue;
      out.facts.push({ id: `ind.${iv}.${spec.key}`, kind: "indicator", label: spec.label, value: spec.value, ...(spec.unit ? { unit: spec.unit } : {}), source: s.source, asOf });
    }
    for (const [k, n] of [["bar1", 1], ["bar5", 5], ["bar20", 20]] as const) {
      const v = ind.changePct[k];
      if (v === undefined) continue;
      out.facts.push({ id: `chg.${iv}.${k}`, kind: "price", label: `Change over the last ${n} ${INTERVAL_LABEL[iv]} bar${n > 1 ? "s" : ""}`, value: round(v * 100, 2), unit: "%", source: s.source, asOf });
    }
  }

  // Short histories: say which long-window readings are missing rather than leaving them out silently.
  for (const iv of ["1d", "1w", "1mo"] as const) {
    const n = out.series[iv]?.bars.length ?? 0;
    if (n > 0 && n < 200) out.problems.push(`${assetId}: ${INTERVAL_LABEL[iv]} 200-bar average needs 200 bars, only ${n}, no reading`);
  }
  if (out.series["1d"] && !spansYear(out.series["1d"].bars)) {
    out.problems.push(`${assetId}: 52-week high and low need a year of daily bars, history starts ${out.series["1d"].bars[0].t.slice(0, 10)}, no reading`);
  }

  // Last price: the source's current price (Chainlink feed or Morpho oracle) when it was published
  // by the run time, otherwise the newest close across hourly and daily bars.
  const candidates = (["1h", "1d"] as const).map((iv) => out.series[iv]).filter((s): s is PriceSeries => Boolean(s && s.bars.length));
  const cur = history.current;
  if (cur && usable(cur.asOf)) {
    out.facts.push({ id: "px.last", kind: "price", label: cur.label, value: cur.value, unit: "USD", source: cur.source, asOf: cur.asOf });
  } else if (candidates.length) {
    const best = candidates.reduce((a, b) => (Date.parse(seriesAsOf(b, crypto)) > Date.parse(seriesAsOf(a, crypto)) ? b : a));
    const last = best.bars[best.bars.length - 1];
    out.facts.push({ id: "px.last", kind: "price", label: proxy ? `Last price (${proxy})` : "Last price", value: roundPrice(last.c), unit: "USD", source: best.source, asOf: seriesAsOf(best, crypto) });
  }
  const daily = out.series["1d"];
  if (daily && daily.bars.length >= 2) {
    const prev = daily.bars[daily.bars.length - 2];
    out.facts.push({ id: "px.1d.prevClose", kind: "price", label: "Previous daily close", value: roundPrice(prev.c), unit: "USD", source: daily.source, asOf: barCloseTime(prev, "1d", crypto, daily.fetchedAt) });
  }
  const weekly = out.series["1w"];
  const wk = weekly?.bars.at(-1);
  // A week's volume is only given when every session of it has volume (on-chain pool volume ends where the backfill ends).
  const weekDays = wk && daily ? daily.bars.filter((b) => b.t >= wk.t && barPeriodEnd(b.t, "1d", crypto) <= barPeriodEnd(wk.t, "1w", crypto)) : [];
  if (weekly && wk && weekDays.length && weekDays.every((b) => b.v !== undefined && Number.isFinite(b.v))) {
    const onchain = history.ref?.provider === "onchain";
    const unit = crypto ? `${PRICE_SOURCES[assetId].symbol.split("-")[0]} traded` : onchain ? `USDC traded in the ${PRICE_SOURCES[assetId].symbol}/USDC pool` : "shares traded";
    const wv = weekDays.reduce((sum, b) => sum + (b.v ?? 0), 0);
    out.facts.push({ id: "px.1w.volume", kind: "price", label: `Volume in the last full week (week starting ${wk.t.slice(0, 10)})`, value: Math.round(wv), unit, source: weekly.source, asOf: barCloseTime(wk, "1w", crypto, weekly.fetchedAt) });
  } else if (weekly && wk) {
    out.problems.push(`${assetId}: volume for the week starting ${wk.t.slice(0, 10)} is not complete, no weekly volume reading`);
  }
  // Pool price and premium (on-chain stocks), only when read by the run time.
  out.facts.push(...(history.facts ?? []).filter((f) => usable(f.asOf)));

  // Chart read in code on daily, weekly and monthly bars.
  for (const iv of CHART_INTERVALS) {
    if (out.series[iv]) chartFacts(out, iv, crypto);
    else out.problems.push(`${assetId}: no ${CHART_INTERVAL_LABEL[iv].toLowerCase()} bars, no chart reading`);
  }

  // Week-ahead calendar: shared with the market input when given.
  let events: CalendarEvent[];
  if (opts.market) events = opts.market.calendar;
  else {
    const wk = await fetchWeekAhead(date, d);
    events = wk.events;
    out.problems.push(...wk.problems);
  }
  out.calendar = eventsForAsset(events, assetId);
  out.facts.push(...eventFacts(out.calendar, nowIso));
  if (asset.assetClass === "stock") out.problems.push(`${assetId}: ${EARNINGS_PROBLEM}`);

  // Macro facts that matter for this asset, from the market input.
  if (opts.market) {
    const want = new Set(MACRO_FOR_ASSET[assetId] ?? []);
    out.facts.push(...opts.market.facts.filter((f) => want.has(f.id)));
  }

  // Headlines (company, reputable outlets, official), filings and flows. None of these throw.
  const press = await fetchPressNews(asset, date, d);
  const wire = await fetchWireNews(assetId, date, d);
  const official = await fetchOfficialNews(assetId, date, d);
  const filings = await fetchFilings(asset, date, d);
  const flows = await fetchFlows(assetId, date, d);
  out.facts.push(...newsFacts([...press.items, ...wire.items, ...official.items]), ...filings.facts, ...flows.facts);
  out.problems.push(...press.problems, ...wire.problems, ...official.problems, ...filings.problems, ...flows.problems);
  if (press.items.length && !wire.items.length && !official.items.length) {
    out.problems.push(`${assetId}: only company press releases this week, which are one side; no independent headline found`);
  }
  return out;
}

/** Market-wide input, gathered once per run. Never throws. */
export async function gatherMarket(date: IsoDate, deps?: Partial<DataDeps>): Promise<MarketResearchInput> {
  assertServer();
  const d: DataDeps = { ...defaultDeps(), ...deps };
  const nowIso = d.now().toISOString();
  const macro = await fetchMacro(date, d);
  const week = await fetchWeekAhead(date, d);
  const wire = await fetchWireNews("market", date, d);
  const official = await fetchOfficialNews("market", date, d);
  return {
    date,
    facts: [...macro.facts, ...eventFacts(week.events, nowIso), ...newsFacts([...wire.items, ...official.items])],
    calendar: week.events,
    problems: [...macro.problems, FED_FUNDS_EXPECTATIONS_PROBLEM, ...week.problems, ...wire.problems, ...official.problems],
  };
}

/** Gathers several assets one after another, sharing one market input and one response cache. */
export async function gatherAll(assetIds: string[], date: IsoDate, deps?: Partial<DataDeps>, opts: GatherOptions = {}): Promise<AssetResearchInput[]> {
  const d: Partial<DataDeps> = { ...deps, cache: deps?.cache ?? new Map() };
  const market = opts.market ?? (await gatherMarket(date, d));
  const out: AssetResearchInput[] = [];
  for (const id of assetIds) out.push(await gatherAsset(id, date, d, { ...opts, market }));
  return out;
}

/** A whole run: the market input and every researchable asset, with refusals for the run log. */
export async function gatherRun(date: IsoDate, deps?: Partial<DataDeps>, opts: Omit<GatherOptions, "market"> = {}): Promise<{ market: MarketResearchInput; assets: AssetResearchInput[]; refused: string[] }> {
  const { assets, refused } = researchableUniverse(opts.deployment ?? (deployment as DeploymentLike));
  const d: Partial<DataDeps> = { ...deps, cache: deps?.cache ?? new Map() };
  const market = await gatherMarket(date, d);
  return { market, assets: await gatherAll(assets.map((a) => a.assetId), date, d, { ...opts, market }), refused };
}
