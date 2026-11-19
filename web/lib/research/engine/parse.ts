import { sanitizeText } from "../../themes/mood.ts";
import { ACTIONS, TIMEFRAMES, type Action, type Confidence, type Fact, type Outlook, type Reasoned, type Scenario, type Stance, type Timeframe } from "../types.ts";
import { LIMITS } from "./prompt.ts";

/**
 * Strict check of the model's answer. The model may only pick from fixed lists and write short
 * text that cites fact ids. Everything is validated here:
 * - unknown keys, wrong types or values outside the fixed lists: the whole answer is rejected
 * - a reason, risk or opportunity whose fact ids are all unknown (or flagged as injection) is dropped
 * - text with a link, or with a number that appears in no fact, is dropped (the model never writes numbers of its own)
 * - no reason or no risk left, or a summary that is not 2 to 3 clean lines: rejected
 * A rejected answer becomes "no reading"; nothing is invented to fill the gap.
 */

export type Reading = {
  action: Action;
  confidence: Confidence;
  summary: string;
  reasons: Reasoned[];
  opportunities: Reasoned[];
  risks: Reasoned[];
  scenarios: { bull: Scenario; base: Scenario; bear: Scenario };
  outlook: Record<Timeframe, Outlook>;
  materialEvent: boolean;
  /** Fact ids the model flagged as possible prompt injection. Never citable. */
  injectionFactIds: string[];
};

const LEVELS = ["low", "medium", "high"] as const;
const STANCES = ["positive", "neutral", "negative", "no-view"] as const;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => typeof x === "string" && (list as readonly string[]).includes(x);
const onlyKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
const LINK_RE = /https?:|www\.|\.(com|io|org|net|xyz)\b/i;

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

/** True when every number in `text` is a small count, a year, or matches a fact number after rounding. */
export function numbersBacked(text: string, allowed: number[], extra: number[] = []): boolean {
  for (const m of text.match(NUMBER_RE) ?? []) {
    const n = Number(m.replace(/,/g, ""));
    if (!Number.isFinite(n)) return false;
    if (Number.isInteger(n) && n <= 31) continue;
    if (Number.isInteger(n) && n >= 1990 && n <= 2100) continue;
    const ok = [...allowed, ...extra].some((v) => Math.abs(n - v) <= Math.max(0.011 * v, 0.051));
    if (!ok) return false;
  }
  return true;
}

type Ctx = { ids: Set<string>; numbers: number[] };

function cleanText(raw: unknown, max: number, ctx: Ctx): string | null {
  if (typeof raw !== "string") return null;
  const text = sanitizeText(raw, max + 1);
  if (!text || text.length > max || LINK_RE.test(text) || !numbersBacked(text, ctx.numbers)) return null;
  return text;
}

function citedIds(raw: unknown, ctx: Ctx): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = [...new Set(raw.filter((x): x is string => typeof x === "string" && ctx.ids.has(x)))];
  return ids;
}

/** One reasoned item, or null to drop it. Structural errors throw (the whole answer is off-schema). */
function reasonedItem(raw: unknown, ctx: Ctx, max: number = LIMITS.text): Reasoned | null {
  if (!isObject(raw) || !onlyKeys(raw, ["text", "factIds"])) throw new Error("bad reasoned item");
  const ids = citedIds(raw.factIds, ctx);
  if (ids === null) throw new Error("bad factIds");
  const text = cleanText(raw.text, max, ctx);
  if (!text || ids.length === 0) return null;
  return { text, factIds: ids };
}

function list(raw: unknown, ctx: Ctx, cap: number): Reasoned[] {
  if (!Array.isArray(raw)) throw new Error("not a list");
  return raw.map((r) => reasonedItem(r, ctx)).filter((r): r is Reasoned => r !== null).slice(0, cap);
}

const NO_EVIDENCE = "Not enough cited evidence for this scenario.";

function scenario(raw: unknown, ctx: Ctx): Scenario {
  if (!isObject(raw) || !onlyKeys(raw, ["text", "factIds", "likelihood"]) || !oneOf(LEVELS, raw.likelihood)) throw new Error("bad scenario");
  const item = reasonedItem({ text: raw.text, factIds: raw.factIds }, ctx);
  return item ? { ...item, likelihood: raw.likelihood } : { text: NO_EVIDENCE, factIds: [], likelihood: "low" };
}

function outlookEntry(raw: unknown, ctx: Ctx): Outlook {
  if (!isObject(raw) || !onlyKeys(raw, ["text", "factIds", "stance"]) || !oneOf(STANCES, raw.stance)) throw new Error("bad outlook");
  const stance = raw.stance as Stance;
  const item = stance === "no-view" ? null : reasonedItem({ text: raw.text, factIds: raw.factIds }, ctx, LIMITS.outlookText);
  return item ? { ...item, stance } : { text: "No view from the facts available.", factIds: [], stance: "no-view" };
}

/** Joins 2 to 3 summary lines; null when the lines are missing, unclean or too long. */
function summaryOf(raw: unknown, ctx: Ctx): string | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 3) return null;
  const lines: string[] = [];
  for (const l of raw) {
    const t = cleanText(l, LIMITS.summaryLine, ctx);
    if (!t) return null;
    lines.push(t);
  }
  const summary = lines.join("\n");
  return summary.length <= LIMITS.summary ? summary : null;
}

const TOP_KEYS = ["action", "confidence", "summaryLines", "reasons", "opportunities", "risks", "scenarios", "outlook", "materialEvent", "injectionFactIds"];

/**
 * Parses the model's JSON text against the facts it was given. `context` is trusted text from our
 * own code (asset name and note) whose numbers may appear too, for example "S&P 500". Returns null
 * when the answer must become "no reading".
 */
export function parseReading(text: string, facts: Fact[], context = ""): Reading | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || !onlyKeys(raw, TOP_KEYS)) return null;
  if (!oneOf(ACTIONS, raw.action) || !oneOf(LEVELS, raw.confidence) || typeof raw.materialEvent !== "boolean") return null;
  if (!Array.isArray(raw.injectionFactIds) || !raw.injectionFactIds.every((x) => typeof x === "string")) return null;

  const flagged = new Set(raw.injectionFactIds as string[]);
  const ctx: Ctx = {
    ids: new Set(facts.map((f) => f.id).filter((id) => !flagged.has(id))),
    numbers: [
      ...factNumbers(facts.filter((f) => !flagged.has(f.id))),
      ...(context.match(NUMBER_RE) ?? []).map((m) => Number(m.replace(/,/g, ""))),
    ],
  };
  try {
    const summary = summaryOf(raw.summaryLines, ctx);
    const reasons = list(raw.reasons, ctx, LIMITS.reasons);
    const opportunities = list(raw.opportunities, ctx, LIMITS.opportunities);
    const risks = list(raw.risks, ctx, LIMITS.risks);
    if (!summary || reasons.length === 0 || risks.length === 0) return null;
    if (!isObject(raw.scenarios) || !onlyKeys(raw.scenarios, ["bull", "base", "bear"])) return null;
    const scenarios = { bull: scenario(raw.scenarios.bull, ctx), base: scenario(raw.scenarios.base, ctx), bear: scenario(raw.scenarios.bear, ctx) };
    const o = raw.outlook;
    if (!isObject(o) || !onlyKeys(o, [...TIMEFRAMES])) return null;
    const outlook = Object.fromEntries(TIMEFRAMES.map((t) => [t, outlookEntry(o[t], ctx)])) as Record<Timeframe, Outlook>;
    return {
      action: raw.action,
      confidence: raw.confidence,
      summary,
      reasons,
      opportunities,
      risks,
      scenarios,
      outlook,
      materialEvent: raw.materialEvent,
      injectionFactIds: [...flagged],
    };
  } catch {
    return null;
  }
}
