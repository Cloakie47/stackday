import type { IsoDate, IsoDateTime, MarketCalendar } from "../types.ts";

/**
 * Trading calendar for the research run: NYSE days and hours for US stocks and funds, every day
 * for crypto (and PAXG, which trades on crypto venues around the clock).
 *
 * NYSE holidays and early closes are copied from NYSE's published list,
 * https://www.nyse.com/markets/hours-calendars (read 2026-11-19): "All NYSE markets observe U.S.
 * holidays as listed below for 2026, 2027, and 2028." Early closes are at 1:00 p.m. New York time.
 * Only 2026 and 2027 are listed here; for any other year `calendarCovers` is false and callers
 * report that in `problems` instead of guessing.
 */

export const NYSE_SOURCE = { name: "NYSE holidays and trading hours", url: "https://www.nyse.com/markets/hours-calendars" };

export const NYSE_HOLIDAYS: Record<IsoDate, string> = {
  "2026-01-01": "New Year's Day",
  "2026-01-19": "Martin Luther King, Jr. Day",
  "2026-02-16": "Washington's Birthday",
  "2026-04-03": "Good Friday",
  "2026-05-25": "Memorial Day",
  "2026-06-19": "Juneteenth National Independence Day",
  "2026-07-03": "Independence Day (observed)",
  "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving Day",
  "2026-12-25": "Christmas Day",
  "2027-01-01": "New Year's Day",
  "2027-01-18": "Martin Luther King, Jr. Day",
  "2027-02-15": "Washington's Birthday",
  "2027-03-26": "Good Friday",
  "2027-05-31": "Memorial Day",
  "2027-06-18": "Juneteenth National Independence Day (observed)",
  "2027-07-05": "Independence Day (observed)",
  "2027-09-06": "Labor Day",
  "2027-11-25": "Thanksgiving Day",
  "2027-12-24": "Christmas Day (observed)",
};

/** Days the NYSE closes at 1:00 p.m. New York time. NYSE lists no other 2027 early close. */
export const NYSE_EARLY_CLOSES: Record<IsoDate, string> = {
  "2026-11-27": "Day after Thanksgiving",
  "2026-12-24": "Christmas Eve",
  "2027-11-26": "Day after Thanksgiving",
};

export const NYSE_YEARS_COVERED = [2026, 2027] as const;

export function calendarCovers(calendar: MarketCalendar, date: IsoDate): boolean {
  if (calendar === "CRYPTO") return true;
  return (NYSE_YEARS_COVERED as readonly number[]).includes(Number(date.slice(0, 4)));
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(date: string): void {
  if (!ISO_DATE_RE.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) throw new Error(`not an ISO date: ${date}`);
}

/** Day of week for an ISO date, 0 = Sunday. */
const weekday = (date: IsoDate) => new Date(`${date}T00:00:00Z`).getUTCDay();

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whether the market trades at all on this date (New York date for XNYS). */
export function isTradingDay(calendar: MarketCalendar, date: IsoDate): boolean {
  assertIsoDate(date);
  if (calendar === "CRYPTO") return true;
  const wd = weekday(date);
  if (wd === 0 || wd === 6) return false;
  return !(date in NYSE_HOLIDAYS);
}

export function holidayName(calendar: MarketCalendar, date: IsoDate): string | undefined {
  return calendar === "XNYS" ? NYSE_HOLIDAYS[date] : undefined;
}

export function isEarlyClose(calendar: MarketCalendar, date: IsoDate): boolean {
  return calendar === "XNYS" && date in NYSE_EARLY_CLOSES;
}

/** Latest trading day on or before `date` (or strictly before, with inclusive = false). */
export function lastTradingDay(calendar: MarketCalendar, date: IsoDate, inclusive = true): IsoDate {
  assertIsoDate(date);
  let d = inclusive ? date : addDays(date, -1);
  for (let i = 0; i < 15; i++) {
    if (isTradingDay(calendar, d)) return d;
    d = addDays(d, -1);
  }
  throw new Error(`no trading day found within 15 days before ${date}`);
}

// ---------------------------------------------------------------------------------------------
// New York time
// ---------------------------------------------------------------------------------------------

const NY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** New York wall-clock parts of an instant. */
export function newYorkParts(at: Date): { date: IsoDate; minutes: number } {
  const p = Object.fromEntries(NY_PARTS.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** The UTC instant of a New York wall-clock time on an ISO date (handles daylight saving). */
export function newYorkTimeToUtc(date: IsoDate, hour: number, minute: number): Date {
  const guess = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hour, minute);
  // New York is UTC-4 or UTC-5; correct the guess by the observed offset (twice covers DST edges).
  let t = guess + 5 * 3_600_000;
  for (let i = 0; i < 2; i++) {
    const p = newYorkParts(new Date(t));
    const shownUtc = Date.UTC(Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)) - 1, Number(p.date.slice(8, 10)), 0, p.minutes);
    t += guess - shownUtc;
  }
  return new Date(t);
}

/** Regular session for a date: open 9:30, close 16:00 (13:00 on early-close days), as UTC instants. */
export function sessionHours(date: IsoDate): { open: Date; close: Date } | null {
  if (!isTradingDay("XNYS", date)) return null;
  const close = isEarlyClose("XNYS", date) ? [13, 0] : [16, 0];
  return { open: newYorkTimeToUtc(date, 9, 30), close: newYorkTimeToUtc(date, close[0], close[1]) };
}

/**
 * Whether the market is open for regular trading at an instant. Crypto is always open. For XNYS,
 * an ISO date ("YYYY-MM-DD") asks whether it is a trading day; a date-time or Date asks whether
 * the regular session (9:30 to 16:00 New York, 13:00 on early closes) is running at that moment.
 */
export function isMarketOpen(calendar: MarketCalendar, at: Date | IsoDate | IsoDateTime): boolean {
  if (calendar === "CRYPTO") return true;
  if (typeof at === "string" && ISO_DATE_RE.test(at)) return isTradingDay(calendar, at);
  const d = typeof at === "string" ? new Date(at) : at;
  if (!Number.isFinite(d.getTime())) throw new Error("invalid date");
  const { date } = newYorkParts(d);
  const s = sessionHours(date);
  return s !== null && d >= s.open && d < s.close;
}
