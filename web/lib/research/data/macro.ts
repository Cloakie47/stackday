import type { Fact, IsoDate } from "../types.ts";
import { addDays } from "./calendar.ts";
import { GENERIC_USER_AGENT, RateLimiter, getJson, getText, type DataDeps } from "./deps.ts";
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
 * never by a model. Observations after the run date are dropped, so a backfill never sees the
 * future. A series that fails or is stale is a "no reading" line in `problems`.
 */

export const FRED_KEY_ENV = "FRED_API_KEY";
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
};

/**
 * The series the market input reads (spec section 3.3): rates and the Fed, the dollar, VIX, the
 * S&P 500 trend, inflation and jobs. Real yields and the dollar also drive gold.
 */
export const FRED_SERIES: FredSeriesDef[] = [
  { id: "DGS2", label: "2-year Treasury yield", unit: "%", freq: "daily", change: "bp" },
  { id: "DGS10", label: "10-year Treasury yield", unit: "%", freq: "daily", change: "bp" },
  { id: "DFII10", label: "10-year real yield (TIPS)", unit: "%", freq: "daily", change: "bp" },
  { id: "DFF", label: "Effective federal funds rate", unit: "%", freq: "daily", change: "bp" },
  { id: "DFEDTARL", label: "Fed funds target range, lower limit", unit: "%", freq: "daily" },
  { id: "DFEDTARU", label: "Fed funds target range, upper limit", unit: "%", freq: "daily" },
  { id: "DTWEXBGS", label: "Broad US dollar index (Federal Reserve, nominal)", unit: "index", freq: "daily", change: "pct" },
  { id: "VIXCLS", label: "VIX volatility index (Cboe, close)", unit: "index", freq: "daily", change: "points" },
  { id: "SP500", label: "S&P 500 index (close)", unit: "index", freq: "daily", change: "pct", noLevel: true },
  { id: "CPIAUCSL", label: "CPI inflation, all items", unit: "%", freq: "monthly", monthly: "yoy" },
  { id: "CPILFESL", label: "Core CPI inflation (less food and energy)", unit: "%", freq: "monthly", monthly: "yoy" },
  { id: "PAYEMS", label: "Nonfarm payrolls, change from prior month", unit: "thousand jobs", freq: "monthly", monthly: "diff" },
  { id: "UNRATE", label: "Unemployment rate", unit: "%", freq: "monthly", monthly: "level" },
];

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
/** A monthly series whose newest month starts more than this many days before the run is stale. */
export const STALE_MONTHLY_DAYS = 75;

export type Observation = { date: IsoDate; value: number };

export const fredCsvUrl = (id: string, start: IsoDate) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${start}`;
export const fredApiUrl = (id: string, start: IsoDate, key: string) =>
  `https://api.stlouisfed.org/fred/series/observations?${new URLSearchParams({ series_id: id, observation_start: start, file_type: "json", api_key: key })}`;
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

export async function fetchFredSeries(id: string, start: IsoDate, deps: DataDeps): Promise<Observation[]> {
  const headers = { "User-Agent": GENERIC_USER_AGENT, Accept: "text/csv, application/json" };
  const key = deps.env[FRED_KEY_ENV]?.trim();
  if (key) {
    try {
      await fredLimiter.wait(deps);
      return parseFredApi(await getJson(deps, fredApiUrl(id, start, key), headers));
    } catch {
      // Fall through to the public CSV.
    }
  }
  await fredLimiter.wait(deps);
  return parseFredCsv(await getText(deps, fredCsvUrl(id, start), headers));
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

/** Fetches every FRED series for the run date. Never throws: failures and stale series go to problems. */
export async function fetchMacro(date: IsoDate, deps: DataDeps): Promise<{ facts: Fact[]; problems: string[] }> {
  const facts: Fact[] = [];
  const problems: string[] = [];
  const series: Record<string, Observation[]> = {};
  for (const def of FRED_SERIES) {
    const start = addDays(date, def.freq === "daily" ? -420 : -800);
    try {
      const obs = (await fetchFredSeries(def.id, start, deps)).filter((o) => o.date <= date);
      if (!obs.length) {
        problems.push(`FRED ${def.id}: no observations up to ${date}, no reading`);
        continue;
      }
      const ageDays = (Date.parse(at(date)) - Date.parse(at(obs[obs.length - 1].date))) / 86_400_000;
      if (ageDays > (def.freq === "daily" ? STALE_DAILY_DAYS : STALE_MONTHLY_DAYS)) {
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
  return { facts, problems };
}
