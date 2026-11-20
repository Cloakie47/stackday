import type { CalendarEvent, CalendarEventKind, IsoDate } from "../types.ts";
import { UNIVERSE } from "../universe.ts";
import { addDays, isTradingDay, newYorkTimeToUtc } from "./calendar.ts";
import { GENERIC_USER_AGENT, RateLimiter, getText, type DataDeps } from "./deps.ts";
import { decodeEntities } from "./news.ts";

/**
 * Week-ahead calendar from official sources only (spec section 3.5). Server-only.
 *
 * - FOMC meetings: the Federal Reserve's FOMC calendar page, parsed in code, merged with a
 *   checked-in copy of the published 2026 and 2027 dates (the page did not list 2027 yet on
 *   2026-11-20; the 2027 dates come from the Fed's press release of November 12, 2026).
 * - CPI and the jobs report: the BLS release schedule pages. BLS refuses automated clients
 *   (HTTP 403 on 2026-11-20), so a checked-in copy of the published dates is used when the page
 *   cannot be read.
 * - PCE (personal income and outlays) and GDP: the BEA release schedule page, with a checked-in
 *   copy of the dates it listed on 2026-11-20.
 * - Monthly options expiry: computed in code (third Friday for US equity options, last Friday
 *   for Deribit crypto options).
 *
 * Earnings dates are not included: there is no official machine-readable source wired, so the
 * gatherer reports that instead of guessing. Every event keeps the source it came from.
 */

const eventLimiter = new RateLimiter(500);

export const FOMC_PAGE = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
export const FOMC_2027_RELEASE = "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261112a.htm";
export const BLS_CPI_PAGE = "https://www.bls.gov/schedule/news_release/cpi.htm";
export const BLS_JOBS_PAGE = "https://www.bls.gov/schedule/news_release/empsit.htm";
export const BEA_SCHEDULE_PAGE = "https://www.bea.gov/news/schedule";

const STOCK_IDS = UNIVERSE.filter((a) => a.calendar === "XNYS").map((a) => a.assetId);
const CRYPTO_OPTION_IDS = ["mcbBTC", "mWETH"];

// ---------------------------------------------------------------------------------------------
// FOMC
// ---------------------------------------------------------------------------------------------

export type FomcMeeting = {
  /** First day of the meeting. */
  start: IsoDate;
  /** Second day: the policy decision and statement at 2:00 p.m. New York time. */
  end: IsoDate;
  /** Marked with an asterisk on the Fed page: meeting with a Summary of Economic Projections. */
  sep: boolean;
  /** False when the Fed said no policy decision will be announced (October 2027 strategy meeting). */
  decision: boolean;
  source: { name: string; url: string };
};

const FED_PAGE_SRC = { name: "Federal Reserve, FOMC meeting calendar", url: FOMC_PAGE };
const FED_2027_SRC = { name: "Federal Reserve press release, revised tentative 2027 FOMC schedule (November 12, 2026)", url: FOMC_2027_RELEASE };

const m = (start: IsoDate, end: IsoDate, sep: boolean, source: FomcMeeting["source"], decision = true): FomcMeeting => ({ start, end, sep, decision, source });

/**
 * Checked-in copy, read 2026-11-20. 2026 from the FOMC calendar page (asterisk = projections);
 * 2027 and January 2028 from the November 12, 2026 press release, which does not mark projection
 * meetings, so `sep` is false there rather than guessed. Update from the same pages when the Fed
 * publishes more (fomc fallback test fails once the list runs out).
 */
export const FOMC_FALLBACK: FomcMeeting[] = [
  m("2026-01-27", "2026-01-28", false, FED_PAGE_SRC),
  m("2026-03-17", "2026-03-18", true, FED_PAGE_SRC),
  m("2026-04-28", "2026-04-29", false, FED_PAGE_SRC),
  m("2026-06-16", "2026-06-17", true, FED_PAGE_SRC),
  m("2026-07-28", "2026-07-29", false, FED_PAGE_SRC),
  m("2026-09-15", "2026-09-16", true, FED_PAGE_SRC),
  m("2026-10-27", "2026-10-28", false, FED_PAGE_SRC),
  m("2026-12-08", "2026-12-09", true, FED_PAGE_SRC),
  m("2027-01-26", "2027-01-27", false, FED_2027_SRC),
  m("2027-03-16", "2027-03-17", false, FED_2027_SRC),
  m("2027-04-27", "2027-04-28", false, FED_2027_SRC),
  m("2027-06-08", "2027-06-09", false, FED_2027_SRC),
  m("2027-07-27", "2027-07-28", false, FED_2027_SRC),
  m("2027-09-14", "2027-09-15", false, FED_2027_SRC),
  m("2027-10-26", "2027-10-27", false, FED_2027_SRC, false),
  m("2027-11-16", "2027-11-17", false, FED_2027_SRC),
  m("2028-01-25", "2028-01-26", false, FED_2027_SRC),
];

const MONTH_INDEX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, mo: number, d: number) => `${y}-${pad(mo)}-${pad(d)}`;

/**
 * Parses the Fed's FOMC calendar page: one panel per year headed "YYYY FOMC Meetings", each
 * meeting a month cell ("March", "Apr/May") and a date cell ("17-18*", "30-1"). Notation votes
 * and single-day unscheduled meetings are skipped.
 */
export function parseFomcPage(html: string): FomcMeeting[] {
  const out: FomcMeeting[] = [];
  const parts = html.split(/<h4>\s*<a[^>]*>\s*(\d{4}) FOMC Meetings\s*<\/a>\s*<\/h4>/i);
  for (let p = 1; p < parts.length; p += 2) {
    const year = Number(parts[p]);
    const body = parts[p + 1] ?? "";
    const re = /fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</gi;
    for (const mt of body.matchAll(re)) {
      const months = mt[1].trim().toLowerCase().split("/").map((s) => MONTH_INDEX[s.slice(0, 3)]);
      const dateText = decodeEntities(mt[2]).trim();
      const dm = dateText.match(/^(\d{1,2})-(\d{1,2})(\*?)/);
      if (!dm || months.some((x) => !x)) continue;
      const m1 = months[0];
      const m2 = months[1] ?? m1;
      const y2 = m2 < m1 ? year + 1 : year;
      out.push({ start: iso(year, m1, Number(dm[1])), end: iso(y2, m2, Number(dm[2])), sep: dm[3] === "*", decision: true, source: FED_PAGE_SRC });
    }
  }
  return out;
}

/** Merges page and fallback: the page wins for every year it lists, the fallback fills the rest. */
export function mergeFomc(page: FomcMeeting[], fallback: FomcMeeting[] = FOMC_FALLBACK): FomcMeeting[] {
  const pageYears = new Set(page.map((x) => x.start.slice(0, 4)));
  const merged = [...page, ...fallback.filter((x) => !pageYears.has(x.start.slice(0, 4)))];
  const seen = new Set<string>();
  return merged.filter((x) => (seen.has(x.end) ? false : (seen.add(x.end), true))).sort((a, b) => a.end.localeCompare(b.end));
}

const hhmm = (d: Date) => d.toISOString().slice(11, 16);

export function fomcEvent(x: FomcMeeting): CalendarEvent {
  const name = x.decision
    ? `FOMC policy decision and statement (meeting ${x.start} to ${x.end})${x.sep ? ", with economic projections" : ""}`
    : `FOMC meeting on monetary policy strategy (${x.start} to ${x.end}), no policy decision announced`;
  return {
    id: `cal.${x.end}.fomc`,
    date: x.end,
    ...(x.decision ? { timeUtc: hhmm(newYorkTimeToUtc(x.end, 14, 0)) } : {}),
    kind: "fomc",
    name,
    assetIds: [],
    source: x.source,
  };
}

// ---------------------------------------------------------------------------------------------
// BLS (CPI, jobs) and BEA (PCE, GDP)
// ---------------------------------------------------------------------------------------------

export type Release = { date: IsoDate; kind: CalendarEventKind; name: string; source: { name: string; url: string } };

const BLS_CPI_SRC = { name: "U.S. Bureau of Labor Statistics, CPI release schedule", url: BLS_CPI_PAGE };
const BLS_JOBS_SRC = { name: "U.S. Bureau of Labor Statistics, Employment Situation release schedule", url: BLS_JOBS_PAGE };
const BEA_SRC = { name: "U.S. Bureau of Economic Analysis, release schedule", url: BEA_SCHEDULE_PAGE };
const copyOf = (s: { name: string; url: string }) => ({ name: `${s.name} (checked-in copy read 2026-11-20)`, url: s.url });

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const refMonth = (date: IsoDate, back: number) => {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - back);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const cpi = (date: IsoDate): Release => ({ date, kind: "cpi", name: `Consumer Price Index for ${refMonth(date, 1)} (BLS)`, source: copyOf(BLS_CPI_SRC) });
const jobs = (date: IsoDate): Release => ({ date, kind: "jobs", name: `Employment Situation (jobs report) for ${refMonth(date, 1)} (BLS)`, source: copyOf(BLS_JOBS_SRC) });

/** BLS release dates, all at 8:30 a.m. New York time, copied from the BLS schedule pages on 2026-11-20. */
export const BLS_FALLBACK: Release[] = [
  ...["2026-11-10", "2026-12-10", "2027-01-13", "2027-02-11", "2027-03-10", "2027-04-13", "2027-05-12", "2027-06-10", "2027-07-14", "2027-08-11", "2027-09-14", "2027-10-14", "2027-11-10", "2027-12-10"].map(cpi),
  ...["2026-11-06", "2026-12-04", "2027-01-08", "2027-02-05", "2027-03-05", "2027-04-02", "2027-05-07", "2027-06-04", "2027-07-02", "2027-08-06", "2027-09-03", "2027-10-08", "2027-11-05", "2027-12-03"].map(jobs),
];

/** BEA PCE and GDP releases listed on the BEA schedule on 2026-11-20 (8:30 a.m. New York time). */
export const BEA_FALLBACK: Release[] = [
  { date: "2026-11-25", kind: "gdp", name: "GDP (Second Estimate) and Corporate Profits, 3rd Quarter 2026 (BEA)", source: copyOf(BEA_SRC) },
  { date: "2026-11-25", kind: "pce", name: "Personal Income and Outlays, October 2026, includes PCE inflation (BEA)", source: copyOf(BEA_SRC) },
  { date: "2026-12-23", kind: "gdp", name: "GDP (Third Estimate), Industries, Corporate Profits, State GDP, and State Personal Income, 3rd Quarter 2026 (BEA)", source: copyOf(BEA_SRC) },
  { date: "2026-12-23", kind: "pce", name: "Personal Income and Outlays, November 2026, includes PCE inflation (BEA)", source: copyOf(BEA_SRC) },
];

/** Parses a BLS schedule table: "Nov. 10, 2026" next to "08:30 AM". */
export function parseBlsSchedule(html: string, kind: "cpi" | "jobs"): Release[] {
  const out: Release[] = [];
  const re = /<td[^>]*>\s*([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})\s*<\/td>\s*<td[^>]*>\s*0?8:30\s*AM\s*<\/td>/g;
  for (const mt of html.matchAll(re)) {
    const mo = MONTH_INDEX[mt[1].toLowerCase()];
    if (!mo) continue;
    const date = iso(Number(mt[3]), mo, Number(mt[2]));
    const r = kind === "cpi" ? cpi(date) : jobs(date);
    out.push({ ...r, source: kind === "cpi" ? BLS_CPI_SRC : BLS_JOBS_SRC });
  }
  return out;
}

/**
 * Parses the BEA schedule table: a "Year YYYY" header, then rows with "November 25" and a release
 * title. Only Personal Income and Outlays (PCE) and GDP releases are kept. When the month goes
 * backwards the table has moved into the next year.
 */
export function parseBeaSchedule(html: string): Release[] {
  const year0 = Number(html.match(/Year\s+(\d{4})/)?.[1]);
  if (!year0) return [];
  const out: Release[] = [];
  let year = year0;
  let prevMonth = 0;
  const re = /<div class="release-date">\s*([A-Za-z]+)\s+(\d{1,2})\s*<\/div>[\s\S]*?<td class="release-title[^"]*"[^>]*>([\s\S]*?)<\/td>/g;
  for (const mt of html.matchAll(re)) {
    const mo = MONTH_INDEX[mt[1].slice(0, 3).toLowerCase()];
    if (!mo) continue;
    if (mo < prevMonth) year += 1;
    prevMonth = mo;
    const title = decodeEntities(mt[3]).replace(/\s+/g, " ").trim();
    const date = iso(year, mo, Number(mt[2]));
    if (/^Personal Income and Outlays/i.test(title)) out.push({ date, kind: "pce", name: `${title}, includes PCE inflation (BEA)`, source: BEA_SRC });
    else if (/^GDP \(/.test(title)) out.push({ date, kind: "gdp", name: `${title} (BEA)`, source: BEA_SRC });
  }
  return out;
}

export function releaseEvent(r: Release): CalendarEvent {
  return { id: `cal.${r.date}.${r.kind}`, date: r.date, timeUtc: hhmm(newYorkTimeToUtc(r.date, 8, 30)), kind: r.kind, name: r.name, assetIds: [], source: r.source };
}

// ---------------------------------------------------------------------------------------------
// Options expiry (computed)
// ---------------------------------------------------------------------------------------------

/** Third Friday of a month; moved to the trading day before when it is an NYSE holiday. */
export function equityOptionsExpiry(year: number, month: number): IsoDate {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((5 - first + 7) % 7) + 14;
  let d = iso(year, month, day);
  while (!isTradingDay("XNYS", d)) d = addDays(d, -1);
  return d;
}

/** Last Friday of a month (Deribit monthly expiry, 08:00 UTC). */
export function cryptoOptionsExpiry(year: number, month: number): IsoDate {
  const last = new Date(Date.UTC(year, month, 0));
  const back = (last.getUTCDay() - 5 + 7) % 7;
  return iso(year, month, last.getUTCDate() - back);
}

export function expiryEvents(from: IsoDate, to: IsoDate): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const months = new Set([from.slice(0, 7), to.slice(0, 7)]);
  for (const ym of months) {
    const [y, mo] = ym.split("-").map(Number);
    const eq = equityOptionsExpiry(y, mo);
    out.push({
      id: `cal.${eq}.options-expiry`,
      date: eq,
      kind: "options-expiry",
      name: "Monthly US equity and index options expiry (third Friday)",
      assetIds: STOCK_IDS,
      source: { name: "Computed by Stackday: third Friday of the month, the standard monthly listed options expiration, moved earlier on an NYSE holiday" },
    });
    const cr = cryptoOptionsExpiry(y, mo);
    out.push({
      id: `cal.${cr}.crypto-options-expiry`,
      date: cr,
      timeUtc: "08:00",
      kind: "options-expiry",
      name: "Monthly Bitcoin and Ether options expiry on Deribit (last Friday, 08:00 UTC)",
      assetIds: CRYPTO_OPTION_IDS,
      source: { name: "Computed by Stackday: last Friday of the month at 08:00 UTC, Deribit's monthly expiry" },
    });
  }
  return out.filter((e) => e.date >= from && e.date <= to);
}

// ---------------------------------------------------------------------------------------------
// Week ahead
// ---------------------------------------------------------------------------------------------

/** Days after the run date the week-ahead calendar covers. */
export const WEEK_AHEAD_DAYS = 7;

async function fetchPage(deps: DataDeps, url: string): Promise<string> {
  await eventLimiter.wait(deps);
  return getText(deps, url, { "User-Agent": GENERIC_USER_AGENT, Accept: "text/html" });
}

/**
 * Official events from the run date through the next 7 days. Never throws. A source that fails is
 * replaced by its checked-in copy; if the copy does not reach the end of the window either, the
 * gap is a "no reading" line in `problems`.
 */
export async function fetchWeekAhead(date: IsoDate, deps: DataDeps): Promise<{ events: CalendarEvent[]; problems: string[] }> {
  const to = addDays(date, WEEK_AHEAD_DAYS);
  const problems: string[] = [];
  const inWindow = (d: IsoDate) => d >= date && d <= to;
  const events: CalendarEvent[] = [];

  // FOMC
  let page: FomcMeeting[] = [];
  try {
    page = parseFomcPage(await fetchPage(deps, FOMC_PAGE));
    if (!page.length) throw new Error("no meetings found on the page");
  } catch {
    // Page failed or changed shape: the checked-in dates below are the documented fallback.
  }
  const fomc = mergeFomc(page);
  if (!fomc.length || fomc[fomc.length - 1].end < to) problems.push(`FOMC dates are only known through ${fomc.at(-1)?.end ?? "nothing"}, no reading after that`);
  events.push(...fomc.filter((x) => inWindow(x.end)).map(fomcEvent));

  // BLS and BEA: live page first, checked-in copy otherwise.
  const sources: { label: string; load: () => Promise<Release[]>; fallback: Release[] }[] = [
    { label: "BLS CPI schedule", load: async () => parseBlsSchedule(await fetchPage(deps, BLS_CPI_PAGE), "cpi"), fallback: BLS_FALLBACK.filter((r) => r.kind === "cpi") },
    { label: "BLS jobs report schedule", load: async () => parseBlsSchedule(await fetchPage(deps, BLS_JOBS_PAGE), "jobs"), fallback: BLS_FALLBACK.filter((r) => r.kind === "jobs") },
    { label: "BEA release schedule", load: async () => parseBeaSchedule(await fetchPage(deps, BEA_SCHEDULE_PAGE)), fallback: BEA_FALLBACK },
  ];
  for (const s of sources) {
    let list: Release[] = [];
    try {
      list = await s.load();
    } catch {
      // Official page refused or failed: the checked-in copy below is the documented fallback.
    }
    if (!list.length) list = s.fallback;
    const last = list.map((r) => r.date).sort().at(-1);
    if (!last || last < to) problems.push(`${s.label}: dates only known through ${last ?? "nothing"}, no reading for later releases`);
    events.push(...list.filter((r) => inWindow(r.date)).map(releaseEvent));
  }

  events.push(...expiryEvents(date, to));
  const seen = new Set<string>();
  const unique = events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  unique.sort((a, b) => (a.date + (a.timeUtc ?? "")).localeCompare(b.date + (b.timeUtc ?? "")));
  return { events: unique, problems };
}

/** Events that matter for one asset: market-wide ones (empty `assetIds`) and its own. */
export function eventsForAsset(events: CalendarEvent[], assetId: string): CalendarEvent[] {
  return events.filter((e) => e.assetIds.length === 0 || e.assetIds.includes(assetId));
}
