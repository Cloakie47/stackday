import { sanitizeText } from "../../themes/mood.ts";
import type { Fact, Reasoned } from "../types.ts";

/**
 * Strict parsing helpers shared by every step. The model may only pick from fixed lists and write
 * short text that cites fact ids. Per step:
 * - not JSON, unknown keys, wrong types or values outside the fixed lists: the whole answer is
 *   rejected (`StepRejected`), and the step counts as failed;
 * - a claim whose fact ids are all unknown (or flagged as injection) is removed and counted;
 * - text with a link, a banned phrase, or a number that appears in no fact or code level is removed
 *   and counted (the model never writes numbers of its own).
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
export const BANNED_PHRASES: RegExp[] = [
  /\bwill (reach|hit|go to|rise to|fall to|double|moon)\b/i,
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

/** Every number a fact contains, plus the percent form of fractions (0.25 volatility may read as 25%). */
export function factNumbers(facts: Fact[]): number[] {
  const out: number[] = [];
  for (const f of facts) {
    const strings = [f.label, typeof f.value === "string" ? f.value : "", f.unit ?? "", f.quote ?? ""];
    if (typeof f.value === "number") out.push(f.value, ...(Math.abs(f.value) <= 1 ? [f.value * 100] : []));
    for (const s of strings) for (const m of s.match(NUMBER_RE) ?? []) out.push(Number(m.replace(/,/g, "")));
  }
  return out.filter(Number.isFinite).map(Math.abs);
}

/** True when every number in `text` is a small count, a year, or matches an allowed number after rounding. */
export function numbersBacked(text: string, allowed: number[]): boolean {
  for (const m of text.match(NUMBER_RE) ?? []) {
    const n = Number(m.replace(/,/g, ""));
    if (!Number.isFinite(n)) return false;
    if (Number.isInteger(n) && n <= 31) continue;
    if (Number.isInteger(n) && n >= 1990 && n <= 2100) continue;
    if (!allowed.some((v) => Math.abs(n - v) <= Math.max(0.011 * v, 0.051))) return false;
  }
  return true;
}

/** What a step's answer may cite and mention. Collects what was removed, for the review log. */
export class Ctx {
  readonly ids: Set<string>;
  readonly numbers: number[];
  removed: { text: string; why: string }[] = [];
  kept = 0;

  constructor(facts: Fact[], extraNumbers: number[] = [], flagged: Iterable<string> = []) {
    const skip = new Set(flagged);
    const ok = facts.filter((f) => !skip.has(f.id));
    this.ids = new Set(ok.map((f) => f.id));
    this.numbers = [...factNumbers(ok), ...extraNumbers.map(Math.abs)];
  }

  /** Cleans one text; null (and counted as removed) when it must go. */
  text(raw: unknown, max: number, label = "text"): string | null {
    if (typeof raw !== "string") throw new StepRejected(`${label} is not a string`);
    const text = sanitizeText(raw, max + 1);
    let why = "";
    if (!text) why = "empty";
    else if (text.length > max) why = "too long";
    else if (LINK_RE.test(text)) why = "contains a link";
    else if (bannedPhrase(text)) why = `banned phrase "${bannedPhrase(text)}"`;
    else if (!numbersBacked(text, this.numbers)) why = "number not in the facts";
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
