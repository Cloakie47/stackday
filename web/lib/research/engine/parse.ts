import { sanitizeText } from "../../themes/mood.ts";
import type { Fact, Reasoned } from "../types.ts";
import { isUntrusted, looksLikeInjection } from "./facts.ts";

/**
 * Strict parsing helpers shared by every step. The model may only pick from fixed lists and write
 * short text that cites fact ids. Per step:
 * - not JSON, unknown keys, wrong types or values outside the fixed lists: the whole answer is
 *   rejected (`StepRejected`), and the step counts as failed;
 * - a claim whose fact ids are all unknown (or flagged as injection) is removed and counted;
 * - text with a link, injection-like text, a banned phrase, or a number that appears in no trusted
 *   fact or code level is removed and counted (the model never writes numbers of its own).
 */

export class StepRejected extends Error {}

export const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
export const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => typeof x === "string" && (list as readonly string[]).includes(x);

export function parseJsonObject(text: string, keys: string[]): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new StepRejected("answer is not JSON");
  }
  if (!isObject(raw)) throw new StepRejected("answer is not an object");
  const extra = Object.keys(raw).filter((k) => !keys.includes(k));
  if (extra.length) throw new StepRejected(`unknown keys: ${extra.join(", ")}`);
  const missing = keys.filter((k) => !(k in raw));
  if (missing.length) throw new StepRejected(`missing keys: ${missing.join(", ")}`);
  return raw;
}

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
const LINK_RE = /https?:|www\.|\.(com|io|org|net|xyz)\b/i;

/**
 * Promises, certainty and personal advice the risk reviewer never lets through (founder spec
 * section 6). Matching text is removed.
 */
const MOVES = "reach|hit|go to|rise|surge|soar|rally|climb|jump|rebound|recover|skyrocket|explode|fall|drop|crash|plunge|tank|double|moon";

export const BANNED_PHRASES: RegExp[] = [
  new RegExp(`\\bwill (definitely |certainly |surely |almost certainly |likely |most likely |very likely |probably |most probably )?(${MOVES})\\b`, "i"),
  new RegExp(`\\b(is|are) (going|set|bound|sure|certain) to (${MOVES})\\b`, "i"),
  new RegExp(`\\b(likely|probably) to (${MOVES})\\b`, "i"),
  /\b(buy|sell) (it |them |this |more )?(right )?(now|today|immediately)\b/i,
  /\b(we|i) (strongly |would )?(recommend|advise|suggest)\b/i,
  /\b(our|my) (recommendation|advice)\b/i,
  /\bguarantee(d|s)?\b/i,
  /\bcan(?:'|no)?t lose\b/i,
  /\bcannot lose\b/i,
  /\byou should\b/i,
  /\byou must\b/i,
  /\brisk[- ]free\b/i,
  /\bsure thing\b/i,
  /\b(100%|completely) (certain|sure|safe)\b/i,
  /\bno[- ]brainer\b/i,
  /\bbeats? the market\b/i,
  /\bfree money\b/i,
];

export function bannedPhrase(text: string): string | null {
  for (const re of BANNED_PHRASES) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

/** Dates and times found in trusted facts. They back a number only where the text uses it as a date. */
export type DateParts = { years: Set<number>; months: Set<number>; days: Set<number>; times: Set<string> };
const emptyDates = (): DateParts => ({ years: new Set(), months: new Set(), days: new Set(), times: new Set() });

const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;
const TIME_RE = /\b(\d{1,2}):(\d{2})\b/g;
// Capitalised month names only (case-sensitive), so the verb "may" never makes a number a date.
const MONTHS = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const hhmm = (h: string | number, m: string | number) => `${String(Number(h)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/** Takes the dates and times out of a fact string: their parts go to `dates`, the rest is returned. */
function stripDates(s: string, dates: DateParts): string {
  return s
    .replace(ISO_DATE_RE, (_m, y: string, mo: string, d: string) => {
      dates.years.add(Number(y));
      dates.months.add(Number(mo));
      dates.days.add(Number(d));
      return " ";
    })
    .replace(TIME_RE, (_m, h: string, mi: string) => {
      dates.times.add(hhmm(h, mi));
      return " ";
    });
}

/**
 * Every number a trusted fact contains, plus the percent form of fractions (0.25 volatility may read
 * as 25%). Dates and times (in `asOf` and inside labels, for example calendar events) are kept apart
 * in `dates`: they never back a bare number like "a 20% drop", only a number written as a date.
 * News and filing facts add nothing: a number that appears only in untrusted text is not backed.
 */
export function factNumbers(facts: Fact[]): { numbers: number[]; dates: DateParts } {
  const out: number[] = [];
  const dates = emptyDates();
  for (const f of facts) {
    if (isUntrusted(f)) continue;
    const strings = [f.label, typeof f.value === "string" ? f.value : "", f.unit ?? "", f.quote ?? ""];
    if (typeof f.asOf === "string") stripDates(f.asOf.slice(0, 10), dates);
    if (typeof f.value === "number") out.push(f.value, ...(Math.abs(f.value) <= 1 ? [f.value * 100] : []));
    for (const s of strings) for (const m of stripDates(s, dates).match(NUMBER_RE) ?? []) out.push(Number(m.replace(/,/g, "")));
  }
  return { numbers: out.filter(Number.isFinite).map(Math.abs), dates };
}

type Span = { start: number; end: number; ok?: boolean; role?: "day" | "year" };

/** Where `text` writes a date: whole tokens (full dates, times) and numbers next to a month name. */
function dateSpans(text: string, dates: DateParts): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(ISO_DATE_RE)) {
    const ok = dates.years.has(Number(m[1])) && dates.months.has(Number(m[2])) && dates.days.has(Number(m[3])) && (m[4] === undefined || dates.times.has(hhmm(m[4], m[5])));
    spans.push({ start: m.index, end: m.index + m[0].length, ok });
  }
  const inside = (i: number) => spans.some((s) => i >= s.start && i < s.end);
  for (const m of text.matchAll(TIME_RE)) if (!inside(m.index)) spans.push({ start: m.index, end: m.index + m[0].length, ok: dates.times.has(hhmm(m[1], m[2])) });
  // A number right after or before a month name ("November 26", "26 Nov", "Nov. 26, 2026",
  // "November 2026"). Unit marks ($ before, % or x after) make it a value, not a date.
  const roles: [RegExp, ("day" | "year")[]][] = [
    [new RegExp(`\\b(?:${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, "g"), ["day", "year"]],
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})\\b\\.?(?:,?\\s+(\\d{4})\\b)?`, "g"), ["day", "year"]],
    [new RegExp(`\\b(?:${MONTHS})\\.?\\s+(\\d{4})\\b`, "g"), ["year"]],
  ];
  for (const [re, kinds] of roles) {
    for (const m of text.matchAll(re)) {
      let from = m.index;
      kinds.forEach((role, k) => {
        const g = m[k + 1];
        if (g === undefined) return;
        const start = text.indexOf(g, from);
        from = start + g.length;
        const before = text.slice(Math.max(0, start - 1), start);
        const after = text.slice(start + g.length, start + g.length + 2);
        if (before === "$" || /^(%|x\b|X\b)/.test(after) || /^x$/i.test(after.trim())) return;
        if (!inside(start)) spans.push({ start, end: start + g.length, role });
      });
    }
  }
  return spans;
}

/**
 * True when every number in `text` is backed. No free numbers: small counts and years must come from
 * the facts too.
 * - A plain number matches an allowed number within rounding (1.1% or 0.05). An integer that looks
 *   like a year (1900 to 2100) gets no relative tolerance: only a value that rounds to it (an Ether or
 *   gold price near 2,026) backs it.
 * - Date parts back a number only where the text writes a date: a whole date or time that matches a
 *   fact's, or a day or year next to a month name. Years match exactly.
 */
export function numbersBacked(text: string, allowed: number[], dates: DateParts = emptyDates()): boolean {
  const spans = dateSpans(text, dates);
  for (const m of text.matchAll(NUMBER_RE)) {
    const raw = m[0];
    const n = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(n)) return false;
    const span = spans.find((s) => m.index >= s.start && m.index < s.end);
    if (span?.ok !== undefined) {
      if (!span.ok) return false;
      continue;
    }
    if (span?.role === "day" && n >= 1 && n <= 31 && dates.days.has(n)) continue;
    if (span?.role === "year" && dates.years.has(n)) continue;
    const yearLike = /^\d{4}$/.test(raw) && n >= 1900 && n <= 2100;
    const ok = yearLike ? allowed.some((v) => Math.round(v) === n) : allowed.some((v) => Math.abs(n - v) <= Math.max(0.011 * v, 0.051));
    if (!ok) return false;
  }
  return true;
}

/** What a step's answer may cite and mention. Collects what was removed, for the review log. */
export class Ctx {
  readonly ids: Set<string>;
  readonly numbers: number[];
  readonly dates: DateParts;
  removed: { text: string; why: string }[] = [];
  kept = 0;

  constructor(facts: Fact[], extraNumbers: number[] = [], flagged: Iterable<string> = []) {
    const skip = new Set(flagged);
    const ok = facts.filter((f) => !skip.has(f.id));
    this.ids = new Set(ok.map((f) => f.id));
    const found = factNumbers(ok);
    this.numbers = [...found.numbers, ...extraNumbers.map(Math.abs)];
    this.dates = found.dates;
  }

  /** True when every number in `text` is backed by these facts (see numbersBacked). */
  backed(text: string): boolean {
    return numbersBacked(text, this.numbers, this.dates);
  }

  /** Cleans one text; null (and counted as removed) when it must go. */
  text(raw: unknown, max: number, label = "text"): string | null {
    if (typeof raw !== "string") throw new StepRejected(`${label} is not a string`);
    const text = sanitizeText(raw, max + 1);
    let why = "";
    if (!text) why = "empty";
    else if (text.length > max) why = "too long";
    else if (LINK_RE.test(text)) why = "contains a link";
    else if (looksLikeInjection(text)) why = "looks like an injection";
    else if (bannedPhrase(text)) why = `banned phrase "${bannedPhrase(text)}"`;
    else if (!this.backed(text)) why = "number not in the facts";
    if (why) {
      if (text) this.removed.push({ text: text.slice(0, 120), why });
      return null;
    }
    return text;
  }

  /** One reasoned item, or null (counted) when it has no valid fact id or its text fails. */
  reasoned(raw: unknown, max: number): Reasoned | null {
    if (!isObject(raw) || Object.keys(raw).some((k) => k !== "text" && k !== "factIds")) throw new StepRejected("bad reasoned item");
    if (!Array.isArray(raw.factIds) || !raw.factIds.every((x) => typeof x === "string")) throw new StepRejected("bad factIds");
    const ids = [...new Set((raw.factIds as string[]).filter((id) => this.ids.has(id)))];
    const text = this.text(raw.text, max);
    if (!text) return null;
    if (ids.length === 0) {
      this.removed.push({ text: text.slice(0, 120), why: "cites no valid fact" });
      return null;
    }
    this.kept++;
    return { text, factIds: ids };
  }

  list(raw: unknown, max: number, cap: number): Reasoned[] {
    if (!Array.isArray(raw)) throw new StepRejected("expected a list");
    return raw.map((r) => this.reasoned(r, max)).filter((r): r is Reasoned => r !== null).slice(0, cap);
  }

  /** Share of claims that survived the checks, 1 = all. */
  factsShare(): number {
    const total = this.kept + this.removed.length;
    return total === 0 ? 1 : this.kept / total;
  }
}

export function stringList(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) throw new StepRejected(`${label} is not a list of strings`);
  return raw as string[];
}

export const NUMBERS_IN = (s: string) => (s.match(NUMBER_RE) ?? []).map((m) => Number(m.replace(/,/g, ""))).filter(Number.isFinite);
