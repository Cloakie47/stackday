import type { ChartInterval, Confidence, Reasoned, View, WeeklyScenario } from "../types.ts";
import { CHART_INTERVALS, VIEWS } from "../types.ts";
import { Ctx, isObject, oneOf, parseJsonObject, StepRejected, stringList } from "./parse.ts";
import { EDITOR_SCHEMA, LIMITS, PROBABILITIES, REWARD_CHECK, SECTION_KEYS, type SectionKey } from "./prompts.ts";

/**
 * The editor's draft of one asset section and the risk reviewer's code checks (founder spec
 * section 4.4). Code checks run on every draft:
 * - every claim cites a valid fact id (claims without one are removed and counted);
 * - no links, no numbers missing from the facts, no banned phrases (removed and counted);
 * - scenario levels come from the code chart read (others are dropped and counted);
 * - scenario probabilities add up to 100;
 * - the view matches the evidence: accumulate needs bull >= bear, reduce or avoid new buys needs
 *   bear >= bull, and every view needs at least one reason.
 * The model reviewer may send one section back once; whatever still fails afterwards is fixed in
 * code (`finalizeDraft`) and recorded as a correction.
 */

export type ScenarioDraft = WeeklyScenario & { evidence: boolean };

export type Draft = {
  recap: Reasoned[];
  chart: Partial<Record<ChartInterval, Reasoned[]>>;
  market: Reasoned[];
  news: Reasoned[];
  scenarios: { bull: ScenarioDraft; base: ScenarioDraft; bear: ScenarioDraft };
  view: { view: View; conviction: Confidence; reasons: Reasoned[] };
};

export type DraftParse = { draft: Draft; removed: Record<SectionKey, string[]> };

const NO_EVIDENCE = "Not enough cited evidence for this scenario.";
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.0005 * Math.abs(b), 0.005);

function scenarioDraft(raw: unknown, ctx: Ctx, allowedLevels: number[], removed: string[]): ScenarioDraft {
  if (!isObject(raw)) throw new StepRejected("bad scenario");
  const keys = ["text", "factIds", "probability", "levels", "trigger"];
  if (Object.keys(raw).some((k) => !keys.includes(k))) throw new StepRejected("bad scenario keys");
  if (typeof raw.probability !== "number" || !PROBABILITIES.includes(raw.probability)) throw new StepRejected("bad probability");
  if (!Array.isArray(raw.levels) || !raw.levels.every((x) => typeof x === "number" && Number.isFinite(x))) throw new StepRejected("bad levels");
  const before = ctx.removed.length;
  const item = ctx.reasoned({ text: raw.text, factIds: raw.factIds }, LIMITS.text);
  const trigger = ctx.text(raw.trigger, LIMITS.trigger, "trigger") ?? "";
  for (const r of ctx.removed.slice(before)) removed.push(`${r.why}: ${r.text}`);
  const levels: number[] = [];
  for (const l of raw.levels as number[]) {
    const match = allowedLevels.find((a) => near(l, a));
    if (match === undefined) removed.push(`level ${l} is not in the code chart read`);
    else if (!levels.includes(match)) levels.push(match);
  }
  return { text: item?.text ?? NO_EVIDENCE, factIds: item?.factIds ?? [], probability: raw.probability, levels, trigger, evidence: item !== null };
}

/**
 * The editor writes chart text as a flat list of { interval, text, factIds } (see EDITOR_SCHEMA);
 * this groups it by timeframe. An object keyed by timeframe is also accepted.
 */
function chartByInterval(c: unknown): Record<string, unknown[]> {
  const intervals = CHART_INTERVALS as readonly string[];
  if (Array.isArray(c)) {
    const out: Record<string, unknown[]> = {};
    for (const item of c) {
      if (!isObject(item) || typeof item.interval !== "string" || !intervals.includes(item.interval)) throw new StepRejected("bad chart item");
      (out[item.interval] ??= []).push({ text: item.text, factIds: item.factIds });
    }
    return out;
  }
  if (!isObject(c) || Object.keys(c).some((k) => !intervals.includes(k))) throw new StepRejected("bad chart");
  return c as Record<string, unknown[]>;
}

/** A draft in the editor's own output shape (flat chart list), for the review and revise prompts. */
export function editorJson<D extends { chart: Draft["chart"] }>(d: D): string {
  const chart = CHART_INTERVALS.flatMap((i) => (d.chart[i] ?? []).map((r) => ({ interval: i, text: r.text, factIds: r.factIds })));
  return JSON.stringify({ ...d, chart });
}

/** Strict parse of the editor's JSON. Throws StepRejected when the structure is wrong. */
export function parseDraft(text: string, ctx: Ctx, allowedLevels: number[]): DraftParse {
  const raw = parseJsonObject(text, Object.keys((EDITOR_SCHEMA as { properties: object }).properties));
  const removed = Object.fromEntries(SECTION_KEYS.map((k) => [k, [] as string[]])) as Record<SectionKey, string[]>;
  const track = <T>(key: SectionKey, fn: () => T): T => {
    const before = ctx.removed.length;
    const out = fn();
    for (const r of ctx.removed.slice(before)) removed[key].push(`${r.why}: ${r.text}`);
    return out;
  };
  const recap = track("recap", () => ctx.list(raw.recap, LIMITS.text, LIMITS.sectionItems));
  const market = track("market", () => ctx.list(raw.market, LIMITS.text, LIMITS.sectionItems));
  const news = track("news", () => ctx.list(raw.news, LIMITS.text, LIMITS.sectionItems));
  const chartRaw = chartByInterval(raw.chart);
  const chart = track("chart", () => Object.fromEntries(CHART_INTERVALS.map((i) => [i, ctx.list(chartRaw[i] ?? [], LIMITS.text, 3)]))) as Draft["chart"];
  const s = raw.scenarios;
  if (!isObject(s) || Object.keys(s).sort().join() !== "base,bear,bull") throw new StepRejected("bad scenarios");
  const scenarios = {
    bull: scenarioDraft(s.bull, ctx, allowedLevels, removed.scenarios),
    base: scenarioDraft(s.base, ctx, allowedLevels, removed.scenarios),
    bear: scenarioDraft(s.bear, ctx, allowedLevels, removed.scenarios),
  };
  const v = raw.view;
  if (!isObject(v) || Object.keys(v).sort().join() !== "conviction,reasons,view") throw new StepRejected("bad view");
  if (!oneOf(VIEWS, v.view) || !oneOf(["low", "medium", "high"] as const, v.conviction)) throw new StepRejected("bad view values");
  const reasons = track("view", () => ctx.list(v.reasons, LIMITS.text, LIMITS.viewReasons));
  return { draft: { recap, chart, market, news, scenarios, view: { view: v.view, conviction: v.conviction, reasons } }, removed };
}

export type Issue = { section: SectionKey; issue: string };

export function probabilitySum(d: Draft): number {
  return d.scenarios.bull.probability + d.scenarios.base.probability + d.scenarios.bear.probability;
}

export function viewConsistent(d: Draft): boolean {
  const { bull, bear } = d.scenarios;
  if (d.view.view === "accumulate") return bull.probability >= bear.probability;
  if (d.view.view === "reduce" || d.view.view === "avoid-new-buys") return bear.probability >= bull.probability;
  return true;
}

/** Text of the code issue raised when the priced-in check fired and the view does not say so. */
export const PRICED_IN_ISSUE = "priced-in check fired";

/**
 * Code checks of the risk reviewer. `hasNews` says whether any news or filing fact was available.
 * `pricedIn` is the priced-in check computed in code (facts.ts pricedInCheck): when it fired, at
 * least one view reason must cite its fact (the view says how much of the move is already in the
 * price), otherwise the view is a blocking issue and is sent back.
 */
export function codeIssues(p: DraftParse, hasNews: boolean, pricedIn: { factId: string; moveAtr: number; fired: boolean } | null = null): Issue[] {
  const { draft: d, removed } = p;
  const out: Issue[] = [];
  for (const k of SECTION_KEYS) for (const r of removed[k]) out.push({ section: k, issue: `removed: ${r}` });
  if (d.recap.length === 0) out.push({ section: "recap", issue: "no recap claim with a valid fact" });
  if (hasNews && d.news.length === 0) out.push({ section: "news", issue: "no news claim with a valid fact" });
  const sum = probabilitySum(d);
  if (sum !== 100) out.push({ section: "scenarios", issue: `scenario probabilities add up to ${sum}, not 100` });
  for (const k of ["bull", "base", "bear"] as const) if (!d.scenarios[k].evidence) out.push({ section: "scenarios", issue: `${k} scenario cites no valid fact` });
  if (d.view.reasons.length === 0) out.push({ section: "view", issue: "view has no reason with a valid fact" });
  if (!viewConsistent(d)) out.push({ section: "view", issue: `view ${d.view.view} does not match the scenario probabilities` });
  if (pricedIn?.fired && !d.view.reasons.some((r) => r.factIds.includes(pricedIn.factId)))
    out.push({
      section: "view",
      issue: `${PRICED_IN_ISSUE}: the price already moved ${Math.abs(pricedIn.moveAtr)} ATR in the last daily bars, and no view reason says how much of it may be in the price or cites ${pricedIn.factId}`,
    });
  return out;
}

/** Issues that make a section unfit unless fixed (removals alone are already handled by removing). */
export const blocking = (issues: Issue[]) => issues.filter((i) => !i.issue.startsWith("removed:"));

/** Rescales probabilities to multiples of 5 that add up to exactly 100 (largest remainder). */
export function rescaleProbabilities(p: [number, number, number]): [number, number, number] {
  const total = p[0] + p[1] + p[2];
  if (total <= 0) return [30, 40, 30];
  const raw = p.map((x) => (x / total) * 20);
  const floor = raw.map(Math.floor);
  let left = 20 - floor.reduce((s, x) => s + x, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) if (left-- > 0) floor[i]++;
  return floor.map((x) => x * 5) as [number, number, number];
}

/** Last-resort fixes in code after the one send-back, each recorded as a correction. */
export function finalizeDraft(d: Draft): { draft: Draft; corrections: string[] } {
  const corrections: string[] = [];
  const out: Draft = structuredClone(d);
  const sum = probabilitySum(out);
  if (sum !== 100) {
    const [a, b, c] = rescaleProbabilities([out.scenarios.bull.probability, out.scenarios.base.probability, out.scenarios.bear.probability]);
    out.scenarios.bull.probability = a;
    out.scenarios.base.probability = b;
    out.scenarios.bear.probability = c;
    corrections.push(`probabilities rescaled from a total of ${sum} to 100`);
  }
  if (!viewConsistent(out) || out.view.reasons.length === 0) {
    corrections.push(`view ${out.view.view} did not match the evidence: set to hold with low conviction`);
    out.view = { view: "hold", conviction: "low", reasons: out.view.reasons };
  }
  return { draft: out, corrections };
}

export type RewardCheck = (typeof REWARD_CHECK)[number];
export type Review = { approve: boolean; sendBack: SectionKey | null; notes: string[]; rewardCheck: RewardCheck; rewardFactIds: string[] };

const REVIEW_KEYS = ["approve", "sendBack", "notes"];
const REWARD_KEYS = ["rewardCheck", "rewardFactIds"];

/**
 * Strict parse of the reviewer's answer. The reward check fields are read when present (the schema
 * asks for them); an answer without them still parses, as "no-data". The reward answer is then
 * coerced in code: "not-crypto" for any non-crypto asset, "no-data" for a crypto asset answered
 * "not-crypto", and "reward-driven" or "real-demand" without a valid cited fact id becomes
 * "no-data" (the engine has no emission or reward data of its own, so the claim needs a fact).
 */
export function parseReview(text: string, ctx: Ctx, crypto = false): Review {
  let probe: unknown;
  try {
    probe = JSON.parse(text);
  } catch {
    throw new StepRejected("answer is not JSON");
  }
  const withReward = isObject(probe) && REWARD_KEYS.some((k) => k in probe);
  const raw = parseJsonObject(text, withReward ? [...REVIEW_KEYS, ...REWARD_KEYS] : REVIEW_KEYS);
  if (typeof raw.approve !== "boolean") throw new StepRejected("bad approve");
  if (raw.sendBack !== "none" && !oneOf(SECTION_KEYS, raw.sendBack)) throw new StepRejected("bad sendBack");
  const notes = stringList(raw.notes, "notes")
    .slice(0, 4)
    .map((n) => ctx.text(n, LIMITS.note, "note"))
    .filter((n): n is string => n !== null);
  let rewardCheck: RewardCheck = "no-data";
  let rewardFactIds: string[] = [];
  if (withReward) {
    if (!oneOf(REWARD_CHECK, raw.rewardCheck)) throw new StepRejected("bad rewardCheck");
    rewardCheck = raw.rewardCheck;
    rewardFactIds = [...new Set(stringList(raw.rewardFactIds, "rewardFactIds").filter((id) => ctx.ids.has(id)))];
  }
  if (!crypto) rewardCheck = "not-crypto";
  else if (rewardCheck === "not-crypto" || (rewardCheck !== "no-data" && rewardFactIds.length === 0)) rewardCheck = "no-data";
  if (rewardCheck === "no-data" || rewardCheck === "not-crypto") rewardFactIds = [];
  return { approve: raw.approve, sendBack: raw.sendBack === "none" ? null : (raw.sendBack as SectionKey), notes, rewardCheck, rewardFactIds };
}

/** Takes one section from the revised draft. */
export function replaceSection(base: DraftParse, revised: DraftParse, key: SectionKey): DraftParse {
  const draft = { ...base.draft, [key]: revised.draft[key] } as Draft;
  return { draft, removed: { ...base.removed, [key]: revised.removed[key] } };
}

export const removedCount = (p: DraftParse) => SECTION_KEYS.reduce((s, k) => s + p.removed[k].length, 0);
