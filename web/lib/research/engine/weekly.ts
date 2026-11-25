import { borrowNote } from "../borrow.ts";
import { RESEARCH_MODELS } from "../flags.ts";
import type {
  AssetResearchInput,
  CalendarEvent,
  ChartInterval,
  ChartReadSection,
  ExampleSplit,
  Fact,
  InvestmentIdea,
  IsoDate,
  MarketOverview,
  MarketResearchInput,
  Reasoned,
  View,
  WeeklyAssetSection,
  WeeklyReport,
  WeeklyScenario,
} from "../types.ts";
import { CHART_INTERVALS, RESEARCH_DISCLAIMER } from "../types.ts";
import type { UniverseAsset } from "../universe.ts";
import { defaultAlert, type AlertFn } from "./alert.ts";
import { costBudget, CostAbort, guardedCall, settleAll, type Budget } from "./budget.ts";
import { assetNumbers, defaultAssets, MAX_NO_READINGS, newRunId, readSpend, RUN_TIME_LIMIT_MS, type GatherFn, type RunOutcome } from "./daily.ts";
import {
  calendarFacts,
  chartBlock,
  chartLevels,
  displayableFacts,
  displayableInput,
  ensurePriceFacts,
  factBlock,
  factsFor,
  hashInputs,
  isUntrusted,
  patternFacts,
  prepareFacts,
  sentFacts,
  untrustedNotes,
} from "./facts.ts";
import { computeLevels, levelNumbers, roundPrice } from "./levels.ts";
import { LONG_CALL_TIMEOUT_MS, worstCaseCost, type ModelFn, type ModelRequest } from "./model.ts";
import { Ctx, oneOf, parseJsonObject, StepRejected, stringList } from "./parse.ts";
import {
  ANALYST_ROLE,
  ANALYST_SCHEMA,
  CASE_ROLE,
  CASE_SCHEMA,
  EDITOR_ROLE,
  EDITOR_SCHEMA,
  LIMITS,
  PROMPT_VERSION,
  REBUTTAL_ROLE,
  REVIEW_ROLE,
  REVIEW_SCHEMA,
  REVISE_ROLE,
  SUMMARY_ROLE,
  summarySchema,
  TECHNICAL_SCHEMA,
  WEEKLY_SYSTEM,
  type SectionKey,
} from "./prompts.ts";
import { blocking, codeIssues, finalizeDraft, parseDraft, parseReview, removedCount, replaceSection, type Draft, type DraftParse, type Review } from "./review.ts";
import { qualityBar, weeklyScorecard } from "./scores.ts";
import { LEASE_TTL_MS, type LeaseResult, type NoReadingCause, type ResearchStore, type StoredSection } from "./store.ts";
import { citableIds, ideaProblems, sectionProblems, weeklyProblems } from "./validate.ts";

/**
 * The Monday weekly report (founder spec sections 3 and 4), every step on RESEARCH_MODELS.weekly.
 * For each researchable asset:
 * 1. Data step (code, injected `gather` and `gatherMarket`).
 * 2. Four analyst passes, each seeing only its own fact kinds: technical (price, indicator,
 *    pattern plus the code chart read), macro and geopolitics (macro, calendar, geopolitics-tagged
 *    news), news and sentiment (news, filing), fundamentals (fundamental, flow, filing).
 * 3. Bull and bear cases from the facts and the analyst notes, then one rebuttal round.
 * 4. Editor draft as strict JSON, then the risk reviewer: code checks (fact ids, banned phrases,
 *    levels from code, probabilities add up to 100, view matches the evidence) plus a model review
 *    that may send ONE section back once. What still fails is fixed in code and recorded; a section
 *    that still cannot pass (a scenario or the view without a valid fact) becomes "no reading".
 * 5. Week-ahead calendar, buy zone, invalidation and borrowing note are added by code.
 * Then one summary call (market mood, ranked ideas, example split explanations; split shares are
 * computed in code) and the scorecard of last week's views, computed in code.
 *
 * Model text written after reading news (analyst notes, debate, draft, reviewer notes, our own
 * earlier notes) reaches later steps only inside an <untrusted_notes> block.
 *
 * Time limit (Vercel Hobby, 300 s per invocation): ONE ASSET PER INVOCATION. Each call of
 * `runWeekly` does the next step of the week and returns:
 * - "asset": researches the next asset without a section (or a failed one, at most
 *   MAX_SECTION_ATTEMPTS tries) and saves it in research_weekly_sections;
 * - "final": when every asset has a section, builds the summary and the report and writes it once;
 * - "skipped": the week already has a report (a re-run never replaces or un-approves it), or
 *   another call holds the week's lease.
 * The cron entries in web/vercel.json call it once an hour on Monday from 12:00 to 21:00 UTC
 * (`?slot=1` to `?slot=10`). From slot WEEKLY_LAST_SLOT on (slot 10 is a spare in case slot 9 is
 * lost or killed), on a call without a slot number on Monday from FINAL_FROM_UTC on, and on any
 * call on Monday from LAST_SLOT_HOUR_UTC on, the call always runs the final step: assets not
 * finished by then are "no reading" (unfinished).
 *
 * Overlap: Vercel can deliver a cron twice and neighbouring slots can overlap, so each call first
 * takes the week's lease (store.takeWeeklyLease, LEASE_TTL_MS) before reading the sections or
 * spending anything; a call that does not get it exits without spending. Each asset attempt is
 * recorded before the work starts, so a call killed mid-asset still uses up an attempt.
 *
 * Cost: the weekly cap (`maxRunCostUsd`) covers all weekly invocations of the week, the day cap
 * covers every run of the day; spend is recorded before each model call. A group of calls that run
 * together must fit in the budget before any of them starts. When the budget is out, the asset
 * becomes "no reading" (budget), the remaining assets too, and the final step still writes the
 * report (summary built in code when there is no budget for the model).
 * Failure policy: before the last slot, more than MAX_NO_READINGS assets that were researched and
 * failed their checks ("error") write nothing. The last slot always writes the report (it stays
 * unapproved until a reviewer approves it): failed sections are "no reading" with the reason and
 * the notes say the week is below the quality bar. No-readings caused by the budget or by calls
 * that did not finish never block the report; the report names each one and why. If the spend
 * cannot be read, asset steps stop, and the final step writes the report with the summary built
 * in code (no model call). Only a failed whole-report check writes nothing.
 */

export type GatherMarketFn = (date: IsoDate) => Promise<MarketResearchInput>;

export type WeeklyDeps = {
  gather: GatherFn;
  gatherMarket: GatherMarketFn;
  model: ModelFn;
  store: ResearchStore;
  /** Weekly cap: all weekly invocations of one week together. */
  maxRunCostUsd: number;
  maxDayCostUsd: number;
  now?: () => Date;
  assets?: UniverseAsset[];
  /** Wall-clock limit of one invocation in ms (default RUN_TIME_LIMIT_MS). */
  timeLimitMs?: number;
  /** Called when a spend cap is hit (default: warning plus optional webhook). */
  alert?: AlertFn;
  /** Cron slot of this call (`?slot=`), 1 to 10; slot WEEKLY_LAST_SLOT and later always run the final step. */
  slot?: number;
  /** Waits between lease checks in the last slot (tests pass a fake). */
  sleep?: (ms: number) => Promise<void>;
};

/** From this slot on every call runs the final step. */
export const WEEKLY_LAST_SLOT = 9;
/** From this time (UTC) on Monday every call runs the final step, even if slot numbers are missing. */
export const FINAL_FROM_UTC = "19:30";
/** Start of the last slot's hour (UTC): a numbered earlier slot that runs this late turns final too. */
export const LAST_SLOT_HOUR_UTC = "20:00";
/** In the final slots, how long a call waits for a lease held by a late earlier slot. */
export const LEASE_WAIT_MS = 120_000;
const LEASE_POLL_MS = 10_000;

/** Room for adaptive thinking plus the JSON answer on every step (thinking counts toward max_tokens). */
export const MAX_TOKENS = { analyst: 12000, case: 10000, rebuttal: 8000, editor: 16000, review: 8000, revise: 16000, summary: 16000 } as const;
/** A failed asset section is tried again once in a later invocation. */
export const MAX_SECTION_ATTEMPTS = 2;
const ROLES = ["technical", "macro", "news", "fundamentals"] as const;
type Role = (typeof ROLES)[number];
type Stance = "bullish" | "neutral" | "bearish";
type AnalystNote = { role: Role; stance: Stance; points: Reasoned[]; chart?: Partial<Record<ChartInterval, Reasoned[]>> };

export type WeeklyOutcome = RunOutcome & { step: "asset" | "final" | "skipped"; assetId?: string; report?: WeeklyReport };

/** Monday of the week that contains `date` (UTC). */
export function mondayOf(date: IsoDate): IsoDate {
  const d = new Date(`${date}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}
const addDays = (date: IsoDate, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const reasonedLines = (items: Reasoned[]) => items.map((r) => `- ${r.text} [${r.factIds.join(", ")}]`).join("\n") || "- (none)";

type StepCtx = { deps: WeeklyDeps; budget: Budget; model: string };

/** Worst-case cost of a group of steps that run together. */
const groupCost = (s: StepCtx, reqs: Omit<ModelRequest, "model" | "system">[]) => reqs.reduce((t, r) => t + worstCaseCost({ ...r, model: s.model, system: WEEKLY_SYSTEM }), 0);

async function step<T>(s: StepCtx, req: Omit<ModelRequest, "model" | "system">, parse: (text: string) => T): Promise<T | null> {
  const res = await guardedCall(s.deps.model, { ...req, model: s.model, system: WEEKLY_SYSTEM }, s.budget);
  if (!res || !res.text) return null;
  try {
    return parse(res.text);
  } catch (e) {
    if (e instanceof StepRejected) return null;
    throw e;
  }
}

function parseAnalyst(role: Role, text: string, facts: Fact[], extra: number[]): { note: AnalystNote; flagged: string[] } {
  const keys = role === "technical" ? ["stance", "points", "chart", "injectionFactIds"] : ["stance", "points", "injectionFactIds"];
  const raw = parseJsonObject(text, keys);
  if (!oneOf(["bullish", "neutral", "bearish"] as const, raw.stance)) throw new StepRejected("bad stance");
  const flagged = stringList(raw.injectionFactIds, "injectionFactIds");
  const ctx = new Ctx(facts, extra, flagged);
  const points = ctx.list(raw.points, LIMITS.text, LIMITS.points);
  const note: AnalystNote = { role, stance: raw.stance, points };
  if (role === "technical") {
    const c = raw.chart;
    if (typeof c !== "object" || c === null || Array.isArray(c)) throw new StepRejected("bad chart");
    note.chart = Object.fromEntries(CHART_INTERVALS.map((i) => [i, ctx.list((c as Record<string, unknown>)[i] ?? [], LIMITS.text, 3)]));
  }
  return { note, flagged };
}

function parsePoints(text: string, facts: Fact[], extra: number[], cap: number): Reasoned[] {
  const raw = parseJsonObject(text, ["points"]);
  return new Ctx(facts, extra).list(raw.points, LIMITS.text, cap);
}

const placeholderScenario = (text: string): WeeklyScenario => ({ text, factIds: [], probability: 0, levels: [], trigger: "" });

/** Reader-facing reason shown in a no-reading section (the report says why there is no reading). */
export const NO_READING_TEXT: Record<NoReadingCause, string> = {
  budget: "No reading this week: the research budget ran out before this asset was done.",
  unfinished: "No reading this week: the research on this asset did not finish in time.",
  error: "No reading this week: the analysis did not pass our checks.",
};

export function noReadingSection(asset: UniverseAsset, weekAhead: CalendarEvent[], cause: NoReadingCause = "error"): WeeklyAssetSection {
  const s = placeholderScenario(NO_READING_TEXT[cause]);
  return {
    assetId: asset.assetId,
    status: "no-reading",
    recap: [],
    chart: {},
    market: [],
    news: [],
    weekAhead,
    scenarios: { bull: s, base: s, bear: s },
    view: { view: "hold", conviction: "low", levels: null, reasons: [] },
    borrowing: borrowNote(asset.assetId, asset.name, asset.lltv),
    facts: [],
  };
}

type SectionResult = {
  section: WeeklyAssetSection;
  failed: boolean;
  approved: boolean;
  sentBack: number;
  removed: number;
  notes: string[];
  input?: AssetResearchInput;
  /** Set when failed. */
  cause?: NoReadingCause;
};

const relevant = (e: CalendarEvent, assetId: string) => e.assetIds.length === 0 || e.assetIds.includes(assetId);

async function researchSection(asset: UniverseAsset, weekOf: IsoDate, date: IsoDate, market: MarketResearchInput | null, s: StepCtx): Promise<SectionResult> {
  const marketCal = (market?.calendar ?? []).filter((e) => relevant(e, asset.assetId) && e.source?.display !== false);
  let input: AssetResearchInput;
  try {
    input = await s.deps.gather(asset.assetId, date);
    if (!input || input.assetId !== asset.assetId) throw new Error("gather returned another asset");
  } catch (e) {
    return { section: noReadingSection(asset, marketCal, "error"), failed: true, approved: false, sentBack: 0, removed: 0, notes: [`${asset.assetId}: data failed (${e instanceof Error ? e.message.slice(0, 120) : "unknown"})`], cause: "error" };
  }
  // Only what may be shown reaches the model and the report (display flag on facts and series).
  const shown = displayableInput(input);
  const view = shown.input;
  const weekAhead = [...(view.calendar ?? []), ...marketCal].filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i).sort((a, b) => a.date.localeCompare(b.date));
  const chart = view.chart ?? {};
  const own = ensurePriceFacts(view);
  const { facts: prepared, screened, restricted } = prepareFacts([...own, ...patternFacts(chart, own, view.series), ...calendarFacts(weekAhead), ...(market?.facts ?? [])]);
  const levelsFromChart = chartLevels(chart);
  const extra = [...levelsFromChart, ...assetNumbers(asset)];
  const header = `Asset: ${asset.assetId} (${asset.name}, underlying ${asset.underlying}), class ${asset.assetClass}, sector ${asset.sector}, risk bucket ${asset.risk}.${asset.note ? ` Note: ${asset.note}` : ""}\nWeek of ${weekOf}, data as of ${view.date}.`;
  const notes: string[] = screened.length ? [`${asset.assetId}: ${screened.length} news items screened as possible injection`] : [];
  const withheld = [...new Set([...shown.withheld, ...restricted.map((id) => `fact ${id}`)])];
  if (withheld.length) notes.push(`${asset.assetId}: ${withheld.length} items not for display (source terms) were kept from the model and the report`);
  const fail = (why: string): SectionResult => ({ section: noReadingSection(asset, weekAhead, "error"), failed: true, approved: false, sentBack: 0, removed: 0, notes: [...notes, `${asset.assetId}: ${why}`], input, cause: "error" });

  // 2. Four analysts, each with only its own facts. They run together, so the budget must hold all
  // four before any starts (otherwise three could be paid for and the fourth refused).
  const analystReqs = ROLES.map((role) => {
    const roleFacts = sentFacts(factsFor(role, prepared));
    const context = [header, role === "technical" ? chartBlock(chart) : "", factBlock(roleFacts)].filter(Boolean).join("\n\n");
    const req = { step: `weekly.analyst.${role}`, context, user: ANALYST_ROLE[role], schema: role === "technical" ? TECHNICAL_SCHEMA : ANALYST_SCHEMA, maxTokens: MAX_TOKENS.analyst, effort: "low" as const };
    return { role, roleFacts, req };
  });
  s.budget.ensure(groupCost(s, analystReqs.map((a) => a.req)), `the four analysts of ${asset.assetId}`);
  const analysts = await settleAll(analystReqs.map(({ role, roleFacts, req }) => step(s, req, (t) => parseAnalyst(role, t, roleFacts, extra))));
  const okAnalysts = analysts.filter((a): a is NonNullable<typeof a> => a !== null);
  if (okAnalysts.length < 3) return fail(`${4 - okAnalysts.length} analyst steps failed`);
  const flagged = new Set(okAnalysts.flatMap((a) => a.flagged));
  const citable = sentFacts(prepared.filter((f) => !flagged.has(f.id)));
  // Written by the analysts after reading news: passed on only as untrusted notes.
  const analystText = okAnalysts.map((a) => `${a.note.role.toUpperCase()} ANALYST (${a.note.stance}):\n${reasonedLines(a.note.points)}`).join("\n\n");
  // Shared, cached context for every later step on this asset.
  const context = [header, chartBlock(chart), factBlock(citable)].join("\n\n");

  // 3. Bull and bear, then one rebuttal round.
  const caseReqs = (["bull", "bear"] as const).map((side) => ({ step: `weekly.${side}`, context, user: `${CASE_ROLE[side]}\n\n${untrustedNotes(`ANALYST NOTES:\n${analystText}`)}`, schema: CASE_SCHEMA, maxTokens: MAX_TOKENS.case, effort: "low" as const }));
  s.budget.ensure(groupCost(s, caseReqs), `the bull and bear cases of ${asset.assetId}`);
  const cases = await settleAll(caseReqs.map((req) => step(s, req, (t) => parsePoints(t, citable, extra, LIMITS.casePoints))));
  const [bull, bear] = cases;
  if (!bull?.length || !bear?.length) return fail("bull or bear step failed");
  const rebuttalReqs = (["bull", "bear"] as const).map((side) => ({
    step: `weekly.${side}.rebuttal`,
    context,
    user: `${REBUTTAL_ROLE[side]}\n\n${untrustedNotes(`${side === "bull" ? "BEAR" : "BULL"} CASE:\n${reasonedLines(side === "bull" ? bear : bull)}`)}`,
    schema: CASE_SCHEMA,
    maxTokens: MAX_TOKENS.rebuttal,
    effort: "low" as const,
  }));
  s.budget.ensure(groupCost(s, rebuttalReqs), `the rebuttals of ${asset.assetId}`);
  const rebuttals = await settleAll(rebuttalReqs.map((req) => step(s, req, (t) => parsePoints(t, citable, extra, LIMITS.rebuttal))));
  const debate = { bull: [...bull, ...(rebuttals[0] ?? [])], bear: [...bear, ...(rebuttals[1] ?? [])] };

  // 4. Editor draft, risk review, at most one send-back.
  const daily = view.indicators?.["1d"];
  const allowedLevels = [...new Set([...levelsFromChart, ...(["accumulate", "hold", "reduce"] as View[]).flatMap((v) => levelNumbers(computeLevels(v, daily, chart["1d"])))])].map(roundPrice);
  const allowedNumbers = [...extra, ...allowedLevels];
  const past = await s.deps.store.notes(asset.assetId, addDays(weekOf, -7), addDays(weekOf, -1)).catch(() => []);
  const pastText = past.length ? past.map((n) => `- ${n.date}: ${n.status}, ${n.view}, ${n.conviction} conviction. ${n.summary.replace(/\n/g, " ")}`).join("\n") : "- (no daily notes last week)";
  const levelsLine = `ALLOWED LEVELS (from the code chart read): ${allowedLevels.join(", ") || "none"}`;
  const deskNotes = [
    `ANALYST NOTES:\n${analystText}`,
    `BULL CASE AND REBUTTAL:\n${reasonedLines(debate.bull)}`,
    `BEAR CASE AND REBUTTAL:\n${reasonedLines(debate.bear)}`,
    `LAST WEEK'S DAILY NOTES (our own earlier research, context only, not citable):\n${pastText}`,
  ].join("\n\n");
  const editorInputs = `${levelsLine}\n\n${untrustedNotes(deskNotes)}`;
  const ctx = new Ctx(citable, allowedNumbers);
  const draft = await step(s, { step: "weekly.editor", context, user: `${EDITOR_ROLE}\n\n${editorInputs}`, schema: EDITOR_SCHEMA, maxTokens: MAX_TOKENS.editor, effort: "medium", timeoutMs: LONG_CALL_TIMEOUT_MS }, (t) => parseDraft(t, ctx, allowedLevels));
  if (!draft) return fail("editor step failed");

  const hasNews = citable.some(isUntrusted);
  const issues = codeIssues(draft, hasNews);
  const reviewCtx = new Ctx(citable);
  const draftJson = JSON.stringify(stripEvidence(draft.draft));
  // Code check lines quote removed model text, so they travel with the draft as untrusted notes.
  const checkLines = issues.map((i) => `- ${i.section}: ${i.issue}`).join("\n") || "- none";
  const review: Review | null = await step(
    s,
    {
      step: "weekly.review",
      context,
      user: `${REVIEW_ROLE}\n\n${untrustedNotes(`CODE CHECKS:\n${checkLines}\n\nDRAFT:\n${draftJson}`)}`,
      schema: REVIEW_SCHEMA,
      maxTokens: MAX_TOKENS.review,
      effort: "medium",
    },
    (t) => parseReview(t, reviewCtx),
  );
  const firstBlocking = blocking(issues)[0]?.section ?? (issues[0]?.section as SectionKey | undefined);
  const sendBack: SectionKey | null = review?.sendBack ?? firstBlocking ?? null;
  let final: DraftParse = draft;
  let sentBack = 0;
  if (sendBack) {
    sentBack = 1;
    const reviewerNotes = (review?.notes ?? []).map((n) => `- ${n}`).join("\n") || "- (none)";
    const sectionChecks = issues.filter((i) => i.section === sendBack).map((i) => `- ${i.issue}`).join("\n") || "- none";
    const revised = await step(
      s,
      {
        step: "weekly.revise",
        context,
        user: `${REVISE_ROLE}\n\nSEND BACK: ${sendBack}\n${levelsLine}\n\n${untrustedNotes(`REVIEWER NOTES:\n${reviewerNotes}\nCODE CHECKS:\n${sectionChecks}\n\n${deskNotes}\n\nDRAFT:\n${draftJson}`)}`,
        schema: EDITOR_SCHEMA,
        maxTokens: MAX_TOKENS.revise,
        timeoutMs: LONG_CALL_TIMEOUT_MS,
        effort: "medium",
      },
      (t) => parseDraft(t, ctx, allowedLevels),
    );
    if (revised) final = replaceSection(draft, revised, sendBack);
    else notes.push(`${asset.assetId}: revision step failed, the first draft was kept`);
  }
  const remaining = blocking(codeIssues(final, hasNews));
  const { draft: fixed, corrections } = finalizeDraft(final.draft);
  // What code cannot fix makes this one section "no reading" (the rest of the report still goes out).
  const unbacked = (["bull", "base", "bear"] as const).filter((k) => !fixed.scenarios[k].evidence || fixed.scenarios[k].factIds.length === 0);
  if (unbacked.length) return fail(`${unbacked.join(", ")} scenario still cites no valid fact after the send-back: no reading for this asset`);
  if (fixed.view.reasons.length === 0) return fail("the view still has no reason with a valid fact after the send-back: no reading for this asset");
  const removed = removedCount(final);
  const approved = (review?.approve ?? false) || (sendBack !== null && remaining.length === 0);

  const levels = computeLevels(fixed.view.view, daily, chart["1d"]);
  const chartSections: Partial<Record<ChartInterval, ChartReadSection>> = {};
  for (const i of CHART_INTERVALS) {
    const c = chart[i];
    if (c) chartSections[i] = { ...c, text: fixed.chart[i] ?? [] };
  }
  const cited = new Set([...fixed.recap, ...fixed.market, ...fixed.news, ...fixed.view.reasons, ...Object.values(fixed.chart).flat(), ...debate.bull, ...debate.bear, ...Object.values(fixed.scenarios)].flatMap((r) => r?.factIds ?? []));
  const keep = (f: Fact) => cited.has(f.id) || f.kind === "price" || f.kind === "indicator";
  const section: WeeklyAssetSection = {
    assetId: asset.assetId,
    status: "ok",
    recap: fixed.recap,
    chart: chartSections,
    market: fixed.market,
    news: fixed.news,
    weekAhead,
    scenarios: { bull: stripOne(fixed.scenarios.bull), base: stripOne(fixed.scenarios.base), bear: stripOne(fixed.scenarios.bear) },
    view: { view: fixed.view.view, conviction: fixed.view.conviction, levels, reasons: fixed.view.reasons },
    borrowing: borrowNote(asset.assetId, asset.name, asset.lltv),
    debate,
    facts: citable.filter(keep),
  };
  const shape = sectionProblems(section);
  if (shape.length) return fail(`section check failed (${shape.slice(0, 3).join("; ")}): no reading for this asset`);
  const reviewNotes = [
    ...notes,
    ...(review ? review.notes.map((n) => `${asset.assetId} reviewer: ${n}`) : [`${asset.assetId}: model review failed, code checks only`]),
    ...(sendBack ? [`${asset.assetId}: ${sendBack} sent back once`] : []),
    ...remaining.map((i) => `${asset.assetId}: still failing after send-back: ${i.section}: ${i.issue}`),
    ...corrections.map((c) => `${asset.assetId}: corrected in code: ${c}`),
  ];
  return { section, failed: false, approved: approved && corrections.length === 0, sentBack, removed: removed + corrections.length, notes: reviewNotes, input };
}

const stripOne = (sc: Draft["scenarios"]["bull"]): WeeklyScenario => ({ text: sc.text, factIds: sc.factIds, probability: sc.probability, levels: sc.levels, trigger: sc.trigger });
const stripEvidence = (d: Draft) => ({ ...d, scenarios: { bull: stripOne(d.scenarios.bull), base: stripOne(d.scenarios.base), bear: stripOne(d.scenarios.bear) } });

// ---------------------------------------------------------------------------------------------
// Ideas and example splits
// ---------------------------------------------------------------------------------------------

const VIEW_ORDER: View[] = ["accumulate", "hold", "reduce", "avoid-new-buys"];
const VIEW_FACTOR: Record<View, number> = { accumulate: 1.25, hold: 1, reduce: 0.5, "avoid-new-buys": 0 };
const PROFILE_WEIGHT: Record<ExampleSplit["profile"], Record<UniverseAsset["risk"], number>> = {
  cautious: { core: 3, growth: 1.5, speculative: 0.5 },
  growth: { core: 1.5, growth: 2.5, speculative: 1.5 },
};

/**
 * General example split for a profile, computed in code: risk-bucket weight times a view factor
 * (accumulate 1.25, hold 1, reduce 0.5, avoid new buys 0), normalised and rounded to 5% steps
 * that add up to 100%. Never an order for a specific person.
 */
export function exampleSplit(profile: ExampleSplit["profile"], items: { asset: UniverseAsset; view: View }[]): ExampleSplit["slices"] {
  const w = items.map((i) => ({ assetId: i.asset.assetId, w: PROFILE_WEIGHT[profile][i.asset.risk] * VIEW_FACTOR[i.view] }));
  const total = w.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return [];
  const raw = w.map((x) => ({ ...x, units: (x.w / total) * 20 }));
  const units = raw.map((x) => Math.floor(x.units));
  let left = 20 - units.reduce((s, x) => s + x, 0);
  raw.map((x, i) => [x.units - Math.floor(x.units), i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
    if (left-- > 0) units[i]++;
  });
  return raw.map((x, i) => ({ assetId: x.assetId, share: (units[i] * 5) / 100 })).filter((x) => x.share > 0);
}

const prefixed = (assetId: string, r: Reasoned): Reasoned => ({ text: r.text, factIds: r.factIds.map((id) => `${assetId}:${id}`) });

type Summary = { market: MarketOverview; ranked: InvestmentIdea[]; splitWhy: Record<ExampleSplit["profile"], Reasoned> | null; ok: boolean };

function fallbackSummary(weekOf: IsoDate, marketFacts: Fact[], okSections: WeeklyAssetSection[]): Summary {
  const sorted = [...okSections].sort((a, b) => VIEW_ORDER.indexOf(a.view.view) - VIEW_ORDER.indexOf(b.view.view));
  return {
    market: { date: weekOf, summary: `Views this week across ${okSections.length} assets, written from the approved asset sections. General research only, not advice.`, developments: [], facts: marketFacts },
    ranked: sorted.map((a, i) => ideaFromSection(a, i + 1)).filter((x): x is InvestmentIdea => x !== null),
    splitWhy: null,
    ok: false,
  };
}

/** An idea built from a section's own cited claims; null when the section has none to rest on. */
function ideaFromSection(a: WeeklyAssetSection, rank: number, over: Partial<InvestmentIdea> = {}): InvestmentIdea | null {
  const first = [...a.view.reasons, ...a.recap].find((r) => r.factIds.length > 0);
  if (!first) return null;
  return {
    rank,
    assetId: a.assetId,
    view: a.view.view,
    reasons: a.view.reasons.filter((r) => r.factIds.length > 0).slice(0, 2).map((r) => prefixed(a.assetId, r)),
    dependsOn: prefixed(a.assetId, a.market.find((r) => r.factIds.length > 0) ?? first),
    mainRisk: prefixed(a.assetId, { text: a.scenarios.bear.text, factIds: a.scenarios.bear.factIds }),
    ...over,
  };
}

async function summarize(weekOf: IsoDate, market: MarketResearchInput | null, okSections: WeeklyAssetSection[], assets: UniverseAsset[], s: StepCtx, useModel: boolean): Promise<Summary> {
  const marketFacts = prepareFacts(market?.facts ?? []).facts;
  if (okSections.length === 0 || !useModel) return fallbackSummary(weekOf, marketFacts, okSections);
  const ids = okSections.map((a) => a.assetId);
  const sectionFacts = okSections.flatMap((a) => a.facts.map((f) => ({ ...f, id: `${a.assetId}:${f.id}` })));
  const digest = okSections
    .map((a) => {
      const asset = assets.find((x) => x.assetId === a.assetId)!;
      const sc = a.scenarios;
      return [
        `SECTION ${a.assetId} (${asset.name}, risk bucket ${asset.risk}): view ${a.view.view}, ${a.view.conviction} conviction. Scenarios bull ${sc.bull.probability}, base ${sc.base.probability}, bear ${sc.bear.probability}.`,
        `Reasons:\n${reasonedLines(a.view.reasons.map((r) => prefixed(a.assetId, r)))}`,
        `Market:\n${reasonedLines(a.market.map((r) => prefixed(a.assetId, r)))}`,
        `Bear case: ${sc.bear.text} [${sc.bear.factIds.map((id) => `${a.assetId}:${id}`).join(", ")}]`,
      ].join("\n");
    })
    .join("\n\n");
  const ctx = new Ctx([...marketFacts, ...sectionFacts], okSections.flatMap((a) => [...chartLevels(a.chart), ...levelNumbers(a.view.levels), ...assetNumbers(assets.find((x) => x.assetId === a.assetId)!)]));
  const parsed = await step(
    s,
    // The sections were written by models after reading news: untrusted notes.
    { step: "weekly.summary", context: factBlock(marketFacts), user: `${SUMMARY_ROLE}\n\n${untrustedNotes(digest)}`, schema: summarySchema(ids), maxTokens: MAX_TOKENS.summary, effort: "medium", timeoutMs: LONG_CALL_TIMEOUT_MS },
    (t) => {
      const raw = parseJsonObject(t, ["marketSummaryLines", "developments", "ranking", "ideas", "splitWhy"]);
      const lines = stringList(raw.marketSummaryLines, "marketSummaryLines").slice(0, 3).map((l) => ctx.text(l, LIMITS.summaryLine)).filter((l): l is string => l !== null);
      if (!lines.length) throw new StepRejected("no clean market summary");
      const marketIds = new Set(marketFacts.map((f) => f.id));
      const developments = ctx.list(raw.developments, LIMITS.text, 4).filter((d) => d.factIds.every((id) => marketIds.has(id)));
      const ranking = stringList(raw.ranking, "ranking").filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i);
      for (const id of ids) if (!ranking.includes(id)) ranking.push(id);
      if (!Array.isArray(raw.ideas)) throw new StepRejected("bad ideas");
      const byAsset = new Map<string, Partial<InvestmentIdea>>();
      for (const it of raw.ideas) {
        if (typeof it !== "object" || it === null || !ids.includes((it as { assetId: string }).assetId)) throw new StepRejected("bad idea");
        const x = it as Record<string, unknown>;
        const reasons = ctx.list(x.reasons, LIMITS.text, 2);
        const dependsOn = ctx.reasoned(x.dependsOn, LIMITS.text);
        const mainRisk = ctx.reasoned(x.mainRisk, LIMITS.text);
        byAsset.set(x.assetId as string, { ...(reasons.length ? { reasons } : {}), ...(dependsOn ? { dependsOn } : {}), ...(mainRisk ? { mainRisk } : {}) });
      }
      const w = raw.splitWhy as Record<string, unknown>;
      if (typeof w !== "object" || w === null) throw new StepRejected("bad splitWhy");
      const cautious = ctx.reasoned(w.cautious, LIMITS.text);
      const growth = ctx.reasoned(w.growth, LIMITS.text);
      return { lines, developments, ranking, byAsset, splitWhy: cautious && growth ? { cautious, growth } : null };
    },
  );
  if (!parsed) return fallbackSummary(weekOf, marketFacts, okSections);
  const ranked = parsed.ranking.map((id, i) => ideaFromSection(okSections.find((a) => a.assetId === id)!, i + 1, parsed.byAsset.get(id))).filter((x): x is InvestmentIdea => x !== null);
  return { market: { date: weekOf, summary: parsed.lines.join("\n"), developments: parsed.developments, facts: marketFacts }, ranked, splitWhy: parsed.splitWhy, ok: true };
}

const SPLIT_WHY: Record<ExampleSplit["profile"], string> = {
  cautious: "Example only: leans on the core assets and trims assets with a cautious view this week. General research, not an order for anyone.",
  growth: "Example only: gives more room to growth and crypto assets where the view allows it. General research, not an order for anyone.",
};

/** A stored section as the final step uses it. A section that no longer passes its check becomes "no reading". */
function fromStored(stored: StoredSection | undefined, asset: UniverseAsset, lastSlot: boolean): SectionResult {
  const id = asset.assetId;
  if (!stored) {
    const why = lastSlot ? `${id}: no reading (unfinished): not researched before the last slot` : `${id}: no section was researched`;
    return { section: noReadingSection(asset, [], "unfinished"), failed: true, approved: false, sentBack: 0, removed: 0, notes: [why], cause: "unfinished" };
  }
  const r = stored.result;
  // Facts not for display never go into a report, even from a section stored before this rule.
  const section = { ...r.section, facts: displayableFacts(r.section.facts) };
  const problems = sectionProblems(section);
  if (stored.failed || section.status !== "ok" || problems.length || section.assetId !== id) {
    const cause: NoReadingCause = problems.length && !stored.failed ? "error" : (r.cause ?? "error");
    const keep = section.status === "no-reading" && !problems.length && section.assetId === id;
    const why = problems.length ? [`${id}: stored section failed its check (${problems.slice(0, 2).join("; ")}): no reading`] : [];
    return { section: keep ? section : noReadingSection(asset, [], cause), failed: true, approved: false, sentBack: r.sentBack, removed: r.removed, notes: [...r.notes, ...why], cause };
  }
  return { section, failed: false, approved: r.approved, sentBack: r.sentBack, removed: r.removed, notes: r.notes };
}

const CAUSE_WORDS: Record<NoReadingCause, string> = {
  budget: "budget: the weekly or daily spend cap ran out before this asset",
  unfinished: "unfinished: the research did not finish within its calls",
  error: "error: the data or the analysis did not pass our checks",
};

// ---------------------------------------------------------------------------------------------
// The run: one step of the week per invocation
// ---------------------------------------------------------------------------------------------

export async function runWeekly(deps: WeeklyDeps): Promise<WeeklyOutcome> {
  const clock = deps.now ?? (() => new Date());
  const startedAt = clock();
  const now = startedAt.toISOString();
  const date = now.slice(0, 10);
  const weekOf = mondayOf(date);
  const assets = deps.assets ?? defaultAssets();
  const alert = deps.alert ?? defaultAlert;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const early = (status: RunOutcome["status"], problems: string[]): WeeklyOutcome => ({ runId: "", kind: "weekly", date, status, written: false, costUsd: 0, counts: {}, problems, step: "skipped" });
  const msg = (e: unknown, n = 200) => (e instanceof Error ? e.message.slice(0, n) : "unknown");

  // A week that already has a report is never run again: a re-run must not replace it or hide an
  // approved report. This cheap check runs before anything is written; it is repeated under the lease.
  try {
    const existing = await deps.store.weeklyRunId(weekOf);
    if (existing) return early("skipped", [`the report for the week of ${weekOf} was already written by run ${existing}: nothing to do`]);
  } catch (e) {
    return early("failed", [`could not read this week's report: ${msg(e)}`]);
  }
  // The last slot always runs the final step. Without a slot number (manual call, or the slot was
  // lost), any call on Monday from FINAL_FROM_UTC does too. A numbered earlier slot keeps its whole
  // hour (Hobby may fire slot 8 at 19:59) and only turns final if it runs from slot 9's hour on.
  const hhmmNow = now.slice(11, 16);
  const lastSlot = date === weekOf ? (deps.slot === undefined ? hhmmNow >= FINAL_FROM_UTC : deps.slot >= WEEKLY_LAST_SLOT || hhmmNow >= LAST_SLOT_HOUR_UTC) : deps.slot !== undefined && deps.slot >= WEEKLY_LAST_SLOT;

  const runId = newRunId(date, "weekly");
  const model = RESEARCH_MODELS.weekly;
  // The run row comes first: the lease row refers to it.
  await deps.store.startRun({ runId, kind: "weekly", date, models: { analysts: model, debate: model, reviewer: model, editor: model, summary: model }, promptVersion: PROMPT_VERSION });

  let phase: WeeklyOutcome["step"] = "skipped";
  let next: UniverseAsset | undefined;
  let budget: Budget | null = null;
  const finish = async (status: RunOutcome["status"], problems: string[], o: { counts?: Record<string, number>; written?: boolean; inputs?: unknown; report?: WeeklyReport } = {}): Promise<WeeklyOutcome> => {
    // Never finish while a call is still being paid for, and write the outputs after the last
    // best-effort output write.
    if (budget) {
      await budget.idle();
      await budget.drain();
    }
    const spent = budget?.spent ?? 0;
    const where = next ? `${phase} ${next.assetId}` : phase;
    if (status === "aborted-cost") await alert(`weekly run ${runId} (${where}) stopped by the cost guard: ${problems[0] ?? ""}`);
    const counts = { ...o.counts, calls: budget?.calls.length ?? 0 };
    const dataHash = o.inputs ? hashInputs(o.inputs) : null;
    const detail = [`${status}: ${where}, ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`, ...problems].join("\n");
    // A skip that spent (another run wrote the report first) is logged as failed, one that spent
    // nothing (report already there, lease held elsewhere) as ok.
    const rowStatus = status === "skipped" ? (spent > 0 ? "failed" : "ok") : status;
    await deps.store.finishRun(runId, { status: rowStatus, costUsd: spent, detail, dataHash, inputs: o.inputs ?? null, outputs: budget?.calls ?? [] });
    return { runId, kind: "weekly", date, status, written: o.written ?? false, costUsd: spent, counts, problems, step: phase, ...(next ? { assetId: next.assetId } : {}), ...(o.report ? { report: o.report } : {}) };
  };

  // ---- Lease: before reading the sections and before any spend --------------------------------
  let lease: LeaseResult;
  let waited = 0;
  try {
    lease = await deps.store.takeWeeklyLease(weekOf, runId, clock(), LEASE_TTL_MS);
    // In the final slots a late earlier slot may still be working: wait a little for it (there is
    // no later slot to pick the week up).
    while (!lease.taken && lastSlot && waited + LEASE_POLL_MS <= LEASE_WAIT_MS) {
      await sleep(LEASE_POLL_MS);
      waited += LEASE_POLL_MS;
      lease = await deps.store.takeWeeklyLease(weekOf, runId, new Date(startedAt.getTime() + waited), LEASE_TTL_MS);
    }
  } catch (e) {
    return finish("failed", [`could not take this week's lease, so nothing was done or spent: ${msg(e)}`]);
  }
  if (!lease.taken) return finish("skipped", [`another call (run ${lease.holder}) is working on the week of ${weekOf} until ${lease.expiresAt}: nothing done, nothing spent`]);
  try {
    return await underLease();
  } finally {
    await deps.store.releaseWeeklyLease(weekOf, runId, clock()).catch(() => {});
  }

  async function underLease(): Promise<WeeklyOutcome> {
    let existing: string | null;
    let stored: StoredSection[];
    try {
      existing = await deps.store.weeklyRunId(weekOf);
      stored = existing ? [] : await deps.store.weeklySections(weekOf);
    } catch (e) {
      return finish("failed", [`could not read this week's report or sections: ${msg(e)}`]);
    }
    if (existing) return finish("skipped", [`the report for the week of ${weekOf} was already written by run ${existing}: nothing to do`]);
    const byAsset = new Map(stored.map((x) => [x.assetId, x]));
    const retryable = (x: StoredSection) => x.failed && x.attempts < MAX_SECTION_ATTEMPTS && x.result.cause !== "budget";
    next = lastSlot ? undefined : (assets.find((a) => !byAsset.has(a.assetId)) ?? assets.find((a) => retryable(byAsset.get(a.assetId)!)));
    phase = next ? "asset" : "final";

    const [spentToday, spentWeek] = await Promise.all([readSpend(() => deps.store.daySpend(date)), readSpend(() => deps.store.weeklySpend(weekOf))]);
    const b = costBudget({
      maxRunUsd: deps.maxRunCostUsd - (spentWeek ?? Infinity),
      maxDayUsd: deps.maxDayCostUsd,
      spentTodayUsd: spentToday ?? Infinity,
      runCapLabel: `weekly cap $${deps.maxRunCostUsd} (spent this week $${(spentWeek ?? 0).toFixed(2)})`,
      record: (usd) => deps.store.recordSpend(runId, usd),
      recordOutputs: (calls) => deps.store.recordOutputs(runId, calls),
      // Time spent waiting for the lease counts against the route's limit.
      timeLimitMs: (deps.timeLimitMs ?? RUN_TIME_LIMIT_MS) - waited,
    });
    budget = b;
    const s: StepCtx = { deps, budget: b, model };

    // Unreadable spend blocks every model call (the budget's cap is then not above zero). An asset
    // step stops here; the final step still writes the report with the summary built in code.
    const spendUnknown = spentToday === null || spentWeek === null;
    const spendUnknownMessage = "cost guard: today's or this week's spend could not be read, so no model call was made";
    if (spendUnknown && next) return finish("aborted-cost", [`${spendUnknownMessage}: the run is blocked`]);
    const capMessage = spendUnknown
      ? spendUnknownMessage
      : `cost guard: no budget left (day cap $${deps.maxDayCostUsd}, spent today $${(spentToday ?? 0).toFixed(2)}; weekly cap $${deps.maxRunCostUsd}, spent this week $${(spentWeek ?? 0).toFixed(2)})`;

    const problems: string[] = [];
    let market: MarketResearchInput | null = null;
    const loadMarket = async () => {
      if (market) return;
      try {
        market = await deps.gatherMarket(date);
      } catch (e) {
        problems.push(`market data failed (${msg(e, 120)}): asset facts only`);
      }
    };
    const save = (asset: UniverseAsset, failed: boolean, attempts: number, result: SectionResult) =>
      deps.store.saveWeeklySection(weekOf, {
        assetId: asset.assetId,
        runId,
        failed,
        attempts,
        costUsd: b.spent,
        result: { section: result.section, approved: result.approved, sentBack: result.sentBack, removed: result.removed, notes: result.notes, ...(result.cause ? { cause: result.cause } : {}) },
      });

    // ---- One asset ----------------------------------------------------------------------------
    let budgetOut: string | null = null;
    let currentAttempt = 0;
    if (next) {
      const asset = next;
      if (!(b.cap > 0)) budgetOut = capMessage;
      else {
        const attempts = (byAsset.get(asset.assetId)?.attempts ?? 0) + 1;
        currentAttempt = attempts;
        // Recorded before any spend: a call killed mid-asset still uses up this attempt.
        const started: SectionResult = {
          section: noReadingSection(asset, [], "unfinished"),
          failed: true,
          approved: false,
          sentBack: 0,
          removed: 0,
          notes: [`${asset.assetId}: no reading (unfinished): attempt ${attempts} started at ${now} and stopped before it saved (run ${runId})`],
          cause: "unfinished",
        };
        try {
          await save(asset, true, attempts, started);
        } catch (e) {
          return finish("failed", [`could not record the attempt for ${asset.assetId}, so nothing was spent: ${msg(e)}`]);
        }
        await loadMarket();
        let status: RunOutcome["status"] = "ok";
        let result: SectionResult;
        try {
          result = await researchSection(asset, weekOf, date, market, s);
        } catch (e) {
          await b.idle();
          const cost = e instanceof CostAbort;
          status = cost ? "aborted-cost" : "failed";
          const why = cost ? e.message : `run error: ${msg(e)}`;
          problems.unshift(why);
          const cause: NoReadingCause = cost ? "budget" : "error";
          result = { section: noReadingSection(asset, [], cause), failed: true, approved: false, sentBack: 0, removed: 0, notes: [`${asset.assetId}: no reading (${cause}): ${why}`], cause };
        }
        if (result.cause === "budget" && b.calls.length === 0) {
          // Nothing was spent on this asset: the budget cannot start another one, so this call goes
          // straight to the final step (below) and the report is still written.
          budgetOut = result.notes[0] ?? capMessage;
        } else {
          if (result.failed && status === "ok") status = "failed";
          let saved = true;
          try {
            await save(asset, result.failed, attempts, result);
          } catch (e) {
            saved = false;
            status = status === "ok" ? "failed" : status;
            problems.push(`section write failed: ${msg(e)}`);
          }
          const counts = { attempt: attempts, sentBack: result.sentBack, removedClaims: result.removed };
          return finish(status, [...problems, ...result.notes], { counts, written: saved && !result.failed, inputs: { market, input: result.input ?? null } });
        }
      }
    }

    // ---- Final: summary, ideas, scorecard, one write -------------------------------------------
    phase = "final";
    if (budgetOut) {
      // Every asset not done yet has no reading because of the budget; saved so later calls agree.
      problems.push(budgetOut);
      await alert(`weekly run ${runId} found no budget for another asset, the report is written with the rest marked no reading: ${budgetOut}`);
      for (const a of assets) {
        const x = byAsset.get(a.assetId);
        if (x && (!x.failed || !retryable(x))) continue;
        const result: SectionResult = {
          section: noReadingSection(a, [], "budget"),
          failed: true,
          approved: false,
          sentBack: 0,
          removed: 0,
          notes: [`${a.assetId}: no reading (budget): ${budgetOut}`],
          cause: "budget",
        };
        const attempts = a.assetId === next?.assetId && currentAttempt > 0 ? currentAttempt : Math.max(1, x?.attempts ?? 1);
        await save(a, true, attempts, result).catch((e) => problems.push(`section write failed for ${a.assetId}: ${msg(e)}`));
        byAsset.set(a.assetId, { assetId: a.assetId, runId, failed: true, attempts, costUsd: 0, result: { section: result.section, approved: false, sentBack: 0, removed: 0, notes: result.notes, cause: "budget" } });
      }
    }
    // In the last slot, an asset still waiting for a retry has no reading (unfinished).
    const results = assets.map((a) => {
      const x = byAsset.get(a.assetId);
      if (lastSlot && x && retryable(x)) {
        const r = fromStored(x, a, true);
        return { ...r, cause: r.cause === "error" ? "error" : ("unfinished" as NoReadingCause), notes: [...r.notes, `${a.assetId}: its retry did not run before the last slot`] };
      }
      return fromStored(x, a, lastSlot);
    });
    const counts = {
      ok: results.filter((r) => r.section.status === "ok").length,
      noReading: results.filter((r) => r.section.status === "no-reading").length,
      sentBack: results.reduce((t, r) => t + r.sentBack, 0),
      removedClaims: results.reduce((t, r) => t + r.removed, 0),
    };
    const noReadingLines = assets.flatMap((a, i) => (results[i].failed ? [`${a.assetId}: no reading (${CAUSE_WORDS[results[i].cause ?? "error"]})`] : []));
    const sectionNotes = [...noReadingLines, ...results.flatMap((r) => r.notes)];
    // Only sections that were researched and failed their checks count toward the limit: the budget
    // or calls that did not finish never block the report.
    const failures = results.filter((r) => r.failed && (r.cause ?? "error") === "error").length;
    // Before the last slot, too many failed sections write nothing (a later slot may still do
    // better). The last slot always writes: the report stays unapproved until a reviewer approves
    // it, and the notes say it is below the quality bar so the reviewer can decide not to.
    const belowBar = failures > MAX_NO_READINGS;
    if (belowBar && !lastSlot) return finish("failed", [`${failures} assets failed their checks (limit ${MAX_NO_READINGS}): nothing written`, ...problems, ...sectionNotes], { counts });
    if (belowBar) problems.unshift(`below the quality bar: ${failures} assets failed their checks (limit ${MAX_NO_READINGS}); written because this is the last slot, a reviewer may choose not to approve it`);

    await loadMarket();
    const okSections = results.filter((r) => r.section.status === "ok").map((r) => r.section);
    let summary: Summary;
    let capHit: string | null = b.cap > 0 ? null : capMessage;
    try {
      summary = await summarize(weekOf, market, okSections, assets, s, capHit === null);
    } catch (e) {
      await b.idle();
      if (!(e instanceof CostAbort)) return finish("failed", [`run error: ${msg(e)}`, ...problems], { counts });
      capHit = e.message;
      summary = fallbackSummary(weekOf, prepareFacts((market as MarketResearchInput | null)?.facts ?? []).facts, okSections);
    }
    if (capHit) {
      problems.push(`${capHit}: summary built in code`);
      await alert(`weekly run ${runId} (final) hit a spend cap, summary built in code: ${capHit}`);
    }

    // Every published idea must rest on facts of the report; ideas that do not are dropped.
    const ids = citableIds({ market: summary.market, assets: results.map((r) => r.section) });
    const ranked = summary.ranked.filter((i) => ideaProblems([i], ids).length === 0).map((i, n) => ({ ...i, rank: n + 1 }));
    if (ranked.length < summary.ranked.length) problems.push(`${summary.ranked.length - ranked.length} ideas dropped: they did not cite facts of the report`);

    const [previous, scores] = await Promise.all([deps.store.weekliesBefore(weekOf, 4).catch(() => []), deps.store.scores(null, addDays(weekOf, -120)).catch(() => [])]);
    const lastWeek = previous[0]?.report ?? null;
    const later = lastWeek ? await deps.store.notes(null, lastWeek.weekOf, date).catch(() => []) : [];
    const bar = qualityBar(previous, scores);
    const okItems = results.filter((r) => r.section.status === "ok").map((r) => ({ asset: assets.find((a) => a.assetId === r.section.assetId)!, view: r.section.view.view }));
    const exampleSplits: ExampleSplit[] = (["cautious", "growth"] as const).map((profile) => ({
      profile,
      slices: exampleSplit(profile, okItems),
      why: summary.splitWhy?.[profile] ?? { text: SPLIT_WHY[profile], factIds: [] },
    }));

    const report: WeeklyReport = {
      kind: "live",
      weekOf,
      generatedAt: now,
      runId,
      beta: !bar.met,
      market: { ...summary.market, facts: displayableFacts(summary.market.facts) },
      assets: results.map((r) => r.section),
      ideas: { ranked, exampleSplits },
      scorecard: weeklyScorecard(lastWeek, later, scores),
      review: {
        approved: !belowBar && results.every((r) => r.section.status !== "ok" || r.approved),
        sentBack: counts.sentBack,
        removedClaims: counts.removedClaims,
        notes: [...noReadingLines, ...problems, ...(summary.ok ? [] : ["summary step failed: ideas built in code from the approved sections"]), ...results.flatMap((r) => r.notes)].slice(0, 60),
      },
      model: { analysts: model, editor: model },
      // All spend of the week: every weekly run row (overwritten and killed attempts included, at
      // their recorded figure) plus this call.
      ...(spentWeek === null ? {} : { costUsd: Math.round((spentWeek + b.spent) * 10_000) / 10_000 }),
      disclaimer: RESEARCH_DISCLAIMER,
    };
    const inputs = { market, sections: [...byAsset.values()].map((x) => ({ assetId: x.assetId, runId: x.runId })) };
    const shape = weeklyProblems(report);
    if (shape.length) return finish("failed", ["whole-report check failed: nothing written", ...shape.slice(0, 20), ...problems], { counts, inputs });
    let wrote: boolean;
    try {
      wrote = await deps.store.writeWeekly(runId, report);
    } catch (e) {
      return finish("failed", [`write failed: ${msg(e)}`, ...problems], { counts, inputs });
    }
    if (!wrote) return finish("skipped", ["another run wrote this week's report first: it was left as it is", ...problems], { counts, inputs });
    return finish("ok", problems, { counts, written: true, inputs, report });
  }
}
