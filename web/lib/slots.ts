/**
 * Time slots for scheduled buys. A slot is a weekday and a time in New York (the US stock market's
 * clock), so a weekly plan always lands while the market is open and trading is deepest.
 * Pure functions, no imports, unit tested in slots.test.ts.
 */

export const MARKET_TZ = "America/New_York";

/** Weekdays a buy can be scheduled on (the market is closed at weekends). 1 = Monday. */
export const SLOT_DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
] as const;

/**
 * Times offered, New York time. The first and last half hour of the trading day (9:30 to 4:00) swing
 * the most, so slots run from 10:00 to 3:00. 11:00 is the default: deep trading, settled prices.
 */
export const SLOT_TIMES = [
  { value: "10:00", label: "10:00 am" },
  { value: "11:00", label: "11:00 am (suggested)" },
  { value: "12:00", label: "12:00 pm" },
  { value: "13:00", label: "1:00 pm" },
  { value: "14:00", label: "2:00 pm" },
  { value: "15:00", label: "3:00 pm" },
] as const;

export const DEFAULT_SLOT = { day: 1, time: "11:00" };

/** Offset of `tz` from UTC at instant `ms`, in milliseconds (positive east of UTC). */
function tzOffset(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Unix seconds of the next `day` (1 = Monday) at `time` ("HH:MM") New York time, strictly after `nowSec`. */
export function nextSlot(day: number, time: string, nowSec: number, tz: string = MARKET_TZ): number {
  const [hh, mm] = time.split(":").map(Number);
  for (let i = 0; i <= 8; i++) {
    // The calendar date in New York, i days from now.
    const probe = new Date(nowSec * 1000 + i * 86_400_000 + tzOffset(nowSec * 1000 + i * 86_400_000, tz));
    const y = probe.getUTCFullYear(), m = probe.getUTCMonth(), d = probe.getUTCDate();
    const weekday = new Date(Date.UTC(y, m, d)).getUTCDay(); // 0 = Sunday
    if (weekday !== day) continue;
    const guess = Date.UTC(y, m, d, hh, mm);
    const at = Math.floor((guess - tzOffset(guess, tz)) / 1000);
    if (at > nowSec) return at;
  }
  throw new Error("no slot found");
}

/** "Monday 11:00 am" style label for a slot. */
export function slotLabel(day: number, time: string): string {
  const d = SLOT_DAYS.find((x) => x.value === day)?.label ?? "";
  const t = SLOT_TIMES.find((x) => x.value === time)?.label.replace(" (suggested)", "") ?? time;
  return `${d} ${t}`;
}
