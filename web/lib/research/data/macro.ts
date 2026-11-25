import type { Fact, IsoDate } from "../types.ts";
import { addDays, newYorkTimeToUtc } from "./calendar.ts";
import { GENERIC_USER_AGENT, RateLimiter, getJson, getText, type DataDeps } from "./deps.ts";
import { BLS_RELEASED_FOR } from "./events.ts";
import { sma } from "./indicators.ts";

/**
 * Macro series from FRED (Federal Reserve Bank of St. Louis), turned into `Fact`s of kind "macro".
 * Server-only. Two ways in, both public:
 *
 * - Without a key: the CSV download behind every FRED chart,
 *   https://fred.stlouisfed.org/graph/fredgraph.csv?id=SERIES&cosd=START
 * - With FRED_API_KEY set: the official API, https://api.stlouisfed.org/fred/series/observations.
 *   If the API call fails we fall back to the CSV for that series.
 *
 * Every change (basis points, percent, year over year) is computed here from the observations,
 * never by a model. A series that fails or is stale is a "no reading" line in `problems`.
 *
 * No look-ahead (`releasedBy`): FRED dates an observation by the period it measures, not by when
 * it was published, so each series has a release-lag rule and an observation is used only once it
 * was out on the run date.
 * The weekly run is Monday 12:00 UTC (7:00 or 8:00 a.m. New York), so a value published later on
 * the run date is never visible to it. A run that passes its real time (`cutAt`, the daily note at
 * 22:30 UTC) also sees a release that came out earlier that day (`releaseInstant`): an H.15 or
 * H.10 release at 4:15 p.m. New York and a BLS release at 8:30 a.m. New York. For the other daily
 * series the time FRED posts them is not documented, so they keep the day-after rule.
 * - H.15 series (Treasury yields DGS2, DGS10, real yield DFII10, effective fed funds DFF): "The
 *   release is posted daily Monday through Friday at 4:15pm" and not on holidays
 *   (https://www.federalreserve.gov/releases/h15/, read 2026-11-25); the release dated November
 *   24, 2026 ends with November 23, so day D's rates appear on the next business day. They are
 *   used from the day after that release (`h15Release`): Friday's yields are not visible on
 *   Monday, Thursday's are.
 * - H.10 (broad dollar index DTWEXBGS): "On Mondays at 4:15 p.m." for "the previous business
 *   week"; "If Monday falls on a Federal Holiday, the data will be released on the following
 *   business day" (https://www.federalreserve.gov/releases/h10/, read 2026-11-25). Used from the
 *   day after (`h10Release`): a Monday run sees the dollar through the Friday before last.
 * - Other daily series (VIX and S&P 500 closes, the target range): the day after the observation.
 * - CPI (CPIAUCSL, CPILFESL) and payrolls and unemployment (PAYEMS, UNRATE): the day after BLS
 *   published that reference month (`BLS_RELEASED_FOR` in events.ts: actual dates from January
 *   2025, including the 2025 shutdown delays and the cancelled October 2025 CPI, then the published
 *   schedule through 2027). For a month outside that table: the 16th (CPI) or the 11th (jobs) of
 *   the next month, the usual latest release day.
 * With FRED_API_KEY set and a run date in the past, the API is asked for the ALFRED vintage as of
 * the run date (realtime_start = realtime_end = run date), so a backfill also sees the values as
 * first published rather than later revisions. The public CSV has no vintages: a backfill without
 * a key uses revised values and says so in `problems`.
 *
 * Licences: the S&P 500 (S&P Dow Jones Indices) and VIX (Cboe) series are owned by third parties.
 * Their facts carry `display: false` unless RESEARCH_SHOW_SP_VIX is set to 1 (founder decision
 * pending, see SOURCES.md).
 */

export const FRED_KEY_ENV = "FRED_API_KEY";
/** Set to 1 (or true) to allow display of the S&P 500 and VIX facts. Off by default. */
export const SHOW_SP_VIX_ENV = "RESEARCH_SHOW_SP_VIX";
export const fredLimiter = new RateLimiter(250);

type Change = "bp" | "pct" | "points";

export type FredSeriesDef = {
  id: string;
  label: string;
  unit: string;
  freq: "daily" | "monthly";
  /** How changes over 5 and 20 observations are expressed (daily series). */
  change?: Change;
  /** Monthly series: show the 12-month change in percent, or the change from the prior month. */
  monthly?: "yoy" | "diff" | "level";
  /**
   * Third-party series whose owner forbids reproduction without permission (FRED shows the
   * notice): only changes and the trend are published, never the level itself.
   */
  noLevel?: boolean;
  /**
   * Owner whose terms restrict reproduction. Facts from the series carry `display: false` unless
   * RESEARCH_SHOW_SP_VIX allows it.
   */
  restricted?: string;
  /** Monthly series: which BLS release publishes it, and the fallback release day of the next month. */
  release?: { schedule: "cpi" | "jobs"; fallbackDay: number };
  /** Daily series published in the afternoon by the Federal Reserve: H.15 (next business day) or H.10 (weekly, Monday). */
  publisher?: "h15" | "h10";
};

/**
 * The series the market input reads (spec section 3.3): rates and the Fed, the dollar, VIX, the
 * S&P 500 trend, inflation and jobs. Real yields and the dollar also drive gold.
 */
export const FRED_SERIES: FredSeriesDef[] = [
  { id: "DGS2", label: "2-year Treasury yield", unit: "%", freq: "daily", change: "bp", publisher: "h15" },
  { id: "DGS10", label: "10-year Treasury yield", unit: "%", freq: "daily", change: "bp", publisher: "h15" },
  { id: "DFII10", label: "10-year real yield (TIPS)", unit: "%", freq: "daily", change: "bp", publisher: "h15" },
  { id: "DFF", label: "Effective federal funds rate", unit: "%", freq: "daily", change: "bp", publisher: "h15" },
  { id: "DFEDTARL", label: "Fed funds target range, lower limit", unit: "%", freq: "daily" },
  { id: "DFEDTARU", label: "Fed funds target range, upper limit", unit: "%", freq: "daily" },
  { id: "DTWEXBGS", label: "Broad US dollar index (Federal Reserve, nominal)", unit: "index", freq: "daily", change: "pct", publisher: "h10" },
  { id: "VIXCLS", label: "VIX volatility index (Cboe, close)", unit: "index", freq: "daily", change: "points", restricted: "Cboe" },
  { id: "SP500", label: "S&P 500 index (close)", unit: "index", freq: "daily", change: "pct", noLevel: true, restricted: "S&P Dow Jones Indices" },
  { id: "CPIAUCSL", label: "CPI inflation, all items", unit: "%", freq: "monthly", monthly: "yoy", release: { schedule: "cpi", fallbackDay: 16 } },
  { id: "CPILFESL", label: "Core CPI inflation (less food and energy)", unit: "%", freq: "monthly", monthly: "yoy", release: { schedule: "cpi", fallbackDay: 16 } },
  { id: "PAYEMS", label: "Nonfarm payrolls, change from prior month", unit: "thousand jobs", freq: "monthly", monthly: "diff", release: { schedule: "jobs", fallbackDay: 11 } },
  { id: "UNRATE", label: "Unemployment rate", unit: "%", freq: "monthly", monthly: "level", release: { schedule: "jobs", fallbackDay: 11 } },
];

/** Days after the observation date before a daily observation is used. */
export const DAILY_RELEASE_LAG_DAYS = 1;

/** First day of the month after the reference month of `date`. */
const nextMonth = (date: IsoDate): IsoDate => {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

/** Never: for a reference month that was not published (October 2025 CPI). */
export const NEVER: IsoDate = "9999-12-31";

const nthWeekday = (y: number, m: number, wd: number, n: number): string => {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return new Date(Date.UTC(y, m - 1, 1 + ((wd - first + 7) % 7) + (n - 1) * 7)).toISOString().slice(0, 10);
};
const lastWeekday = (y: number, m: number, wd: number): string => {
  const lastDay = new Date(Date.UTC(y, m, 0));
  return new Date(Date.UTC(y, m - 1, lastDay.getUTCDate() - ((lastDay.getUTCDay() - wd + 7) % 7))).toISOString().slice(0, 10);
};

/**
 * Days the Board of Governors (which publishes H.15 and H.10) is closed: the federal holidays on
 * https://www.federalreserve.gov/aboutthefed/k8.htm (read 2026-11-25). A holiday on a Sunday is
 * observed on Monday; for one on a Saturday the Reserve Banks open on Friday "however, the Board of
 * Governors will be closed", so Friday counts as a holiday here (July 3, 2026; December 24, 2027).
 */
export function isFedHoliday(date: IsoDate): boolean {
  const y = Number(date.slice(0, 4));
  const observed = (d: string) => {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    return wd === 0 ? addDays(d, 1) : wd === 6 ? addDays(d, -1) : d;
  };
  // Next year's New Year's Day on a Saturday closes the Board on December 31.
  const fixed = [`${y}-01-01`, `${y}-06-19`, `${y}-07-04`, `${y}-11-11`, `${y}-12-25`, `${y + 1}-01-01`].map(observed);
  const moving = [nthWeekday(y, 1, 1, 3), nthWeekday(y, 2, 1, 3), lastWeekday(y, 5, 1), nthWeekday(y, 9, 1, 1), nthWeekday(y, 10, 1, 2), nthWeekday(y, 11, 4, 4)];
  return fixed.includes(date) || moving.includes(date);
}

export function isFedBusinessDay(date: IsoDate): boolean {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return wd !== 0 && wd !== 6 && !isFedHoliday(date);
}

/** First Federal Reserve business day on or after `date`. */
const fedBusinessOnOrAfter = (date: IsoDate): IsoDate => {
  let d = date;
  while (!isFedBusinessDay(d)) d = addDays(d, 1);
  return d;
};

/** The day H.15 publishes day D's rates (4:15 p.m. New York): the next Federal Reserve business day. */
export const h15Release = (obsDate: IsoDate): IsoDate => fedBusinessOnOrAfter(addDays(obsDate, 1));

/** The day H.10 publishes a day's rate (4:15 p.m. New York): the Monday after its week, or the next business day. */
export function h10Release(obsDate: IsoDate): IsoDate {
  const wd = (new Date(`${obsDate}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
  return fedBusinessOnOrAfter(addDays(obsDate, 7 - wd));
}

/**
 * The first run date on which an observation may be used (see the release-lag rules above).
 * A run dated on a release day does not see that release: BLS publishes at 8:30 a.m. and the
 * Federal Reserve at 4:15 p.m. New York time, both after the 12:00 UTC weekly run. A run with a
 * later cut time (`cutAt`) may see it: see `releaseInstant` and `releasedBy`.
 */
export function releasedFrom(def: FredSeriesDef, obsDate: IsoDate): IsoDate {
  if (def.freq === "daily") {
    if (def.publisher === "h15") return addDays(h15Release(obsDate), 1);
    if (def.publisher === "h10") return addDays(h10Release(obsDate), 1);
    return addDays(obsDate, DAILY_RELEASE_LAG_DAYS);
  }
  const next = nextMonth(obsDate);
  if (!def.release) return addDays(next, 30);
  const table = BLS_RELEASED_FOR[def.release.schedule];
  const ref = obsDate.slice(0, 7);
  if (ref in table) {
    const day = table[ref];
    return day === null ? NEVER : addDays(day, 1);
  }
  return `${next.slice(0, 8)}${String(def.release.fallbackDay).padStart(2, "0")}`;
}

/**
 * When an observation was published (ms), where the publisher states a time of day: H.15 and H.10
 * at 4:15 p.m. New York on their release day, BLS at 8:30 a.m. New York. Undefined where no time
 * is known (VIX, S&P 500, target range, months outside the BLS table): those keep the date rule.
 */
export function releaseInstant(def: FredSeriesDef, obsDate: IsoDate): number | undefined {
  if (def.freq === "daily") {
    if (def.publisher === "h15") return newYorkTimeToUtc(h15Release(obsDate), 16, 15).getTime();
    if (def.publisher === "h10") return newYorkTimeToUtc(h10Release(obsDate), 16, 15).getTime();
    return undefined;
  }
  const day = def.release ? BLS_RELEASED_FOR[def.release.schedule][obsDate.slice(0, 7)] : undefined;
  return day ? newYorkTimeToUtc(day, 8, 30).getTime() : undefined;
}

/**
 * Observations that were published by the run date (12:00 UTC run). With `cutAt` (ms, the run's
 * real time) an observation released earlier on the same day at a known time is visible too.
 */
export function releasedBy(def: FredSeriesDef, obs: Observation[], date: IsoDate, cutAt?: number): Observation[] {
  return obs.filter((o) => {
    if (releasedFrom(def, o.date) <= date) return true;
    if (cutAt === undefined) return false;
    const t = releaseInstant(def, o.date);
    return t !== undefined && t <= cutAt;
  });
}

/** Macro fact ids that matter for each asset, so the asset input can carry them too. */
export const MACRO_FOR_ASSET: Record<string, string[]> = {
  mPAXG: ["macro.dfii10", "macro.dfii10.chg5", "macro.dfii10.chg20", "macro.dtwexbgs", "macro.dtwexbgs.chg5", "macro.dtwexbgs.chg20"],
  mcbBTC: ["macro.dtwexbgs", "macro.dtwexbgs.chg20", "macro.vixcls", "macro.dgs10"],
  mWETH: ["macro.dtwexbgs", "macro.dtwexbgs.chg20", "macro.vixcls", "macro.dgs10"],
  mNVDA: ["macro.dgs10", "macro.dgs10.chg20", "macro.vixcls", "macro.sp500.trend"],
  mAAPL: ["macro.dgs10", "macro.dgs10.chg20", "macro.vixcls", "macro.sp500.trend"],
  mSPX: ["macro.dgs10", "macro.dgs10.chg20", "macro.vixcls", "macro.sp500.trend", "macro.fedTarget"],
};

/** A daily series older than this many days before the run date is stale. */
export const STALE_DAILY_DAYS = 10;
/** H.10 is weekly: a Monday run sees data through the Friday before last (10 days), more after a holiday. */
export const STALE_H10_DAYS = 14;
/**
 * A monthly series whose newest month starts more than this many days before the run is stale.
 * With the release lag the newest usable month can start up to 76 days back (July CPI before
 * September 16), so the bound leaves a few days of margin.
 */
export const STALE_MONTHLY_DAYS = 80;

export type Observation = { date: IsoDate; value: number };

export const fredCsvUrl = (id: string, start: IsoDate) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${start}`;
/** `vintage`: ask ALFRED for the values as they were known on that date. */
export const fredApiUrl = (id: string, start: IsoDate, key: string, vintage?: IsoDate) =>
  `https://api.stlouisfed.org/fred/series/observations?${new URLSearchParams({ series_id: id, observation_start: start, file_type: "json", ...(vintage ? { realtime_start: vintage, realtime_end: vintage } : {}), api_key: key })}`;
export const fredSeriesPage = (id: string) => `https://fred.stlouisfed.org/series/${id}`;

/** Parses fredgraph.csv: a header line, then "YYYY-MM-DD,value". Missing values (".") are skipped. */
export function parseFredCsv(csv: string): Observation[] {
  const lines = csv.trim().split(/\r?\n/);
  if (!lines.length || !/date/i.test(lines[0])) throw new Error("FRED CSV: unexpected header");
  const out: Observation[] = [];
  for (const line of lines.slice(1)) {
    const [date, raw] = line.split(",");
    const v = Number(raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") && raw !== "." && raw !== "" && Number.isFinite(v)) out.push({ date, value: v });
  }
  return out;
}

/** Parses the official API's `observations` array. */
export function parseFredApi(raw: unknown): Observation[] {
  const obs = (raw as { observations?: { date?: unknown; value?: unknown }[] })?.observations;
  if (!Array.isArray(obs)) throw new Error("FRED API: unexpected shape");
  const out: Observation[] = [];
  for (const o of obs) {
    const date = String(o.date ?? "");
    const v = Number(o.value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && o.value !== "." && Number.isFinite(v)) out.push({ date, value: v });
  }
  return out;
}

/**
 * Observations for one series. With a key the API is tried first; when it fails the public CSV is
 * used and `apiError` says why, so a backfill that asked for an ALFRED vintage can report that it
 * got today's revised values instead.
 */
export async function fetchFredSeries(id: string, start: IsoDate, deps: DataDeps, vintage?: IsoDate): Promise<{ obs: Observation[]; apiError?: string }> {
  const headers = { "User-Agent": GENERIC_USER_AGENT, Accept: "text/csv, application/json" };
  const key = deps.env[FRED_KEY_ENV]?.trim();
  let apiError: string | undefined;
  if (key) {
    try {
      await fredLimiter.wait(deps);
      return { obs: parseFredApi(await getJson(deps, fredApiUrl(id, start, key, vintage), headers)) };
    } catch (e) {
      apiError = (e instanceof Error ? e.message : "unknown error").slice(0, 120);
    }
  }
  await fredLimiter.wait(deps);
  const obs = parseFredCsv(await getText(deps, fredCsvUrl(id, start), headers));
  return apiError ? { obs, apiError } : { obs };
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (d: IsoDate) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const at = (d: IsoDate) => `${d}T00:00:00.000Z`;

function changeValue(kind: Change, now: number, then: number): { value: number; unit: string } | null {
  if (kind === "bp") return { value: Math.round((now - then) * 100), unit: "bp" };
  if (kind === "points") return { value: r2(now - then), unit: "points" };
  if (then <= 0) return null;
  return { value: r2((now / then - 1) * 100), unit: "%" };
}

/**
 * Facts for one series from its observations (oldest first, already cut at the run date).
 * Daily: latest value, change over 5 and 20 observations (about a week and a month).
 * Monthly: 12-month change, change from the prior month, or the level.
 */
export function seriesFacts(def: FredSeriesDef, obs: Observation[]): Fact[] {
  const id = `macro.${def.id.toLowerCase()}`;
  const source = { name: `FRED, Federal Reserve Bank of St. Louis (${def.id})`, url: fredSeriesPage(def.id) };
  const n = obs.length;
  if (n === 0) return [];
  const last = obs[n - 1];
  const facts: Fact[] = [];
  if (def.freq === "daily") {
    if (!def.noLevel) facts.push({ id, kind: "macro", label: `${def.label}, ${last.date}`, value: r2(last.value), unit: def.unit, source, asOf: at(last.date) });
    if (def.change) {
      for (const back of [5, 20]) {
        if (n - 1 - back < 0) continue;
        const prev = obs[n - 1 - back];
        const c = changeValue(def.change, last.value, prev.value);
        if (c) facts.push({ id: `${id}.chg${back}`, kind: "macro", label: `${def.label}, change over ${back} trading days (${prev.date} to ${last.date})`, value: c.value, unit: c.unit, source, asOf: at(last.date) });
      }
    }
    return facts;
  }
  if (def.monthly === "level") {
    facts.push({ id, kind: "macro", label: `${def.label}, ${monthName(last.date)}`, value: r2(last.value), unit: def.unit, source, asOf: at(last.date) });
  } else if (def.monthly === "diff") {
    if (n >= 2) facts.push({ id: `${id}.chg`, kind: "macro", label: `${def.label}, ${monthName(last.date)}`, value: Math.round(last.value - obs[n - 2].value), unit: def.unit, source, asOf: at(last.date) });
  } else {
    const yearAgo = obs.find((o) => o.date === `${Number(last.date.slice(0, 4)) - 1}${last.date.slice(4)}`);
    if (yearAgo && yearAgo.value > 0) {
      facts.push({ id: `${id}.yoy`, kind: "macro", label: `${def.label}, 12 months to ${monthName(last.date)}`, value: r2((last.value / yearAgo.value - 1) * 100), unit: "%", source, asOf: at(last.date) });
    }
  }
  return facts;
}

/** Facts that combine series: the 2s10s curve, the Fed target range and the S&P 500 trend. */
export function derivedFacts(series: Record<string, Observation[]>): Fact[] {
  const facts: Fact[] = [];
  const src = (ids: string[]) => ({ name: `FRED, Federal Reserve Bank of St. Louis (${ids.join(", ")}), computed by Stackday`, url: fredSeriesPage(ids[0]) });
  const d2 = series.DGS2?.at(-1);
  const d10 = series.DGS10?.at(-1);
  if (d2 && d10 && d2.date === d10.date) {
    facts.push({ id: "macro.curve2s10s", kind: "macro", label: `10-year minus 2-year Treasury yield, ${d10.date}`, value: Math.round((d10.value - d2.value) * 100), unit: "bp", source: src(["DGS10", "DGS2"]), asOf: at(d10.date) });
  }
  const lo = series.DFEDTARL?.at(-1);
  const hi = series.DFEDTARU?.at(-1);
  if (lo && hi && lo.date === hi.date) {
    facts.push({ id: "macro.fedTarget", kind: "macro", label: `Fed funds target range, ${hi.date}`, value: `${lo.value.toFixed(2)} to ${hi.value.toFixed(2)}`, unit: "%", source: src(["DFEDTARU", "DFEDTARL"]), asOf: at(hi.date) });
  }
  const spx = series.SP500;
  if (spx && spx.length >= 200) {
    const closes = spx.map((o) => o.value);
    const last = spx[spx.length - 1];
    const m50 = sma(closes, 50)!;
    const m200 = sma(closes, 200)!;
    const s = src(["SP500"]);
    // S&P Dow Jones Indices forbids reproducing the index without permission, so only the
    // direction against the averages is published, not the levels.
    const side = (m: number) => (last.value > m ? "above" : "below");
    const trend = side(m50) === side(m200) ? `${side(m50)} its 50-day and 200-day averages` : `${side(m50)} its 50-day and ${side(m200)} its 200-day average`;
    facts.push({ id: "macro.sp500.trend", kind: "macro", label: `S&P 500 close versus its averages, ${last.date}`, value: trend, source: s, asOf: at(last.date) });
  }
  return facts;
}

/** True when the env flag allows display of the S&P 500 and VIX facts. */
export const showSpVix = (env: Record<string, string | undefined>) => /^(1|true|yes)$/i.test(env[SHOW_SP_VIX_ENV]?.trim() ?? "");

/** Marks facts from restricted series (and facts derived from them) display false unless the flag allows them. */
export function restrictFacts(facts: Fact[], env: Record<string, string | undefined>): Fact[] {
  if (showSpVix(env)) return facts;
  const prefixes = FRED_SERIES.filter((d) => d.restricted).map((d) => `macro.${d.id.toLowerCase()}`);
  return facts.map((f) => (prefixes.some((p) => f.id === p || f.id.startsWith(`${p}.`)) ? { ...f, display: false, source: { ...f.source, display: false } } : f));
}

/**
 * Fetches every FRED series for the run date. Never throws: failures and stale series go to
 * problems. `cutAt` (ISO): the run's real time, capped at the end of the run date and at `now`.
 */
export async function fetchMacro(date: IsoDate, deps: DataDeps, cutAt?: string): Promise<{ facts: Fact[]; problems: string[] }> {
  const facts: Fact[] = [];
  const problems: string[] = [];
  let cut: number | undefined;
  if (cutAt !== undefined) {
    const t = Date.parse(cutAt);
    if (Number.isFinite(t)) cut = Math.min(t, Date.parse(`${date}T23:59:59.999Z`), deps.now().getTime());
    else problems.push(`FRED: cut time "${String(cutAt).slice(0, 40)}" is not an ISO time, release rules for 12:00 UTC used`);
  }
  const series: Record<string, Observation[]> = {};
  // A run date before today is a backfill: ask ALFRED for that date's vintage when a key is set.
  const backfill = date < deps.now().toISOString().slice(0, 10);
  const vintage = backfill ? date : undefined;
  if (backfill && !deps.env[FRED_KEY_ENV]?.trim()) problems.push(`FRED: backfill for ${date} uses today's revised values (the public CSV has no vintages; FRED_API_KEY enables ALFRED vintages)`);
  for (const def of FRED_SERIES) {
    const start = addDays(date, def.freq === "daily" ? -420 : -800);
    try {
      const fetched = await fetchFredSeries(def.id, start, deps, vintage);
      if (fetched.apiError && vintage) problems.push(`FRED ${def.id}: ALFRED vintage for ${date} failed (${fetched.apiError}), used today's revised values from the public CSV`);
      const obs = releasedBy(def, fetched.obs, date, cut);
      if (!obs.length) {
        problems.push(`FRED ${def.id}: no observations released by ${date}, no reading`);
        continue;
      }
      const ageDays = (Date.parse(at(date)) - Date.parse(at(obs[obs.length - 1].date))) / 86_400_000;
      if (ageDays > (def.freq === "daily" ? (def.publisher === "h10" ? STALE_H10_DAYS : STALE_DAILY_DAYS) : STALE_MONTHLY_DAYS)) {
        problems.push(`FRED ${def.id}: newest observation ${obs[obs.length - 1].date} is stale, no reading`);
        continue;
      }
      series[def.id] = obs;
      const got = seriesFacts(def, obs);
      // For example CPI year over year when the year-ago month was never published (FRED ".").
      if (!got.length) problems.push(`FRED ${def.id}: the comparison observation is missing, no reading`);
      facts.push(...got);
    } catch (e) {
      problems.push(`FRED ${def.id} failed, no reading (${e instanceof Error ? e.message : "unknown error"})`);
    }
  }
  facts.push(...derivedFacts(series));
  return { facts: restrictFacts(facts, deps.env), problems };
}
