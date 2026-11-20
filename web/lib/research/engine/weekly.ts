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
import { costBudget, CostAbort, guardedCall, pool, type Budget } from "./budget.ts";
import { defaultAssets, MAX_NO_READINGS, newRunId, type GatherFn, type RunOutcome } from "./daily.ts";
import { calendarFacts, chartBlock, chartLevels, ensurePriceFacts, factBlock, factsFor, hashInputs, isUntrusted, patternFacts, prepareFacts, sentFacts } from "./facts.ts";
import { computeLevels, levelNumbers, roundPrice } from "./levels.ts";
import type { ModelFn, ModelRequest } from "./model.ts";
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
import type { ResearchStore } from "./store.ts";
import { weeklyProblems } from "./validate.ts";

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
 *    that may send ONE section back once. What still fails is fixed in code and recorded.
 * 5. Week-ahead calendar, buy zone, invalidation and borrowing note are added by code.
 * Then one summary call (market mood, ranked ideas, example split explanations; split shares are
 * computed in code) and the scorecard of last week's views, computed in code.
 * Same failure policy and cost guard as the daily run: a failed or over-budget run writes nothing.
 */

export type GatherMarketFn = (date: IsoDate) => Promise<MarketResearchInput>;

export type WeeklyDeps = {
  gather: GatherFn;
  gatherMarket: GatherMarketFn;
  model: ModelFn;
  store: ResearchStore;
  maxRunCostUsd: number;
  maxDayCostUsd: number;
  now?: () => Date;
  assets?: UniverseAsset[];
  concurrency?: number;
};

export const MAX_TOKENS = { analyst: 3000, case: 2500, rebuttal: 1500, editor: 6000, review: 1500, revise: 6000, summary: 5000 } as const;
const ROLES = ["technical", "macro", "news", "fundamentals"] as const;
type Role = (typeof ROLES)[number];
type Stance = "bullish" | "neutral" | "bearish";
type AnalystNote = { role: Role; stance: Stance; points: Reasoned[]; chart?: Partial<Record<ChartInterval, Reasoned[]>> };

/** Monday of the week that contains `date` (UTC). */
export function mondayOf(date: IsoDate): IsoDate {
  const d = new Date(`${date}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}
const addDays = (date: IsoDate, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const reasonedLines = (items: Reasoned[]) => items.map((r) => `- ${r.text} [${r.factIds.join(", ")}]`).join("\n") || "- (none)";

type StepCtx = { deps: WeeklyDeps; budget: Budget; model: string };

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

function noReadingSection(asset: UniverseAsset, weekAhead: CalendarEvent[]): WeeklyAssetSection {
  const s = placeholderScenario("No reading this week.");
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
};

const relevant = (e: CalendarEvent, assetId: string) => e.assetIds.length === 0 || e.assetIds.includes(assetId);

async function researchSection(asset: UniverseAsset, weekOf: IsoDate, date: IsoDate, market: MarketResearchInput | null, s: StepCtx): Promise<SectionResult> {
  const marketCal = (market?.calendar ?? []).filter((e) => relevant(e, asset.assetId));
  let input: AssetResearchInput;
  try {
    input = await s.deps.gather(asset.assetId, date);
    if (!input || input.assetId !== asset.assetId) throw new Error("gather returned another asset");
  } catch (e) {
    return { section: noReadingSection(asset, marketCal), failed: true, approved: false, sentBack: 0, removed: 0, notes: [`${asset.assetId}: data failed (${e instanceof Error ? e.message.slice(0, 120) : "unknown"})`] };
  }
  const weekAhead = [...(input.calendar ?? []), ...marketCal].filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i).sort((a, b) => a.date.localeCompare(b.date));
  const chart = input.chart ?? {};
  const own = ensurePriceFacts(input);
  const { facts: prepared, screened } = prepareFacts([...own, ...patternFacts(chart, own), ...calendarFacts(weekAhead), ...(market?.facts ?? [])]);
  const extra = chartLevels(chart);
  const header = `Asset: ${asset.assetId} (${asset.name}, underlying ${asset.underlying}), class ${asset.assetClass}, sector ${asset.sector}, risk bucket ${asset.risk}.${asset.note ? ` Note: ${asset.note}` : ""}\nWeek of ${weekOf}, data as of ${input.date}.`;
  const notes: string[] = screened.length ? [`${asset.assetId}: ${screened.length} news items screened as possible injection`] : [];
  const fail = (why: string): SectionResult => ({ section: noReadingSection(asset, weekAhead), failed: true, approved: false, sentBack: 0, removed: 0, notes: [...notes, `${asset.assetId}: ${why}`], input });

  // 2. Four analysts, each with only its own facts.
  const analysts = await Promise.all(
    ROLES.map(async (role) => {
      const roleFacts = sentFacts(factsFor(role, prepared));
      const context = [header, role === "technical" ? chartBlock(chart) : "", factBlock(roleFacts)].filter(Boolean).join("\n\n");
      return step(
        s,
        { step: `weekly.analyst.${role}`, context, user: ANALYST_ROLE[role], schema: role === "technical" ? TECHNICAL_SCHEMA : ANALYST_SCHEMA, maxTokens: MAX_TOKENS.analyst, effort: "low" },
        (t) => parseAnalyst(role, t, roleFacts, extra),
      );
    }),
  );
  const okAnalysts = analysts.filter((a): a is NonNullable<typeof a> => a !== null);
  if (okAnalysts.length < 3) return fail(`${4 - okAnalysts.length} analyst steps failed`);
  const flagged = new Set(okAnalysts.flatMap((a) => a.flagged));
  const citable = sentFacts(prepared.filter((f) => !flagged.has(f.id)));
  const analystText = okAnalysts.map((a) => `${a.note.role.toUpperCase()} ANALYST (${a.note.stance}):\n${reasonedLines(a.note.points)}`).join("\n\n");
  // Shared, cached context for every later step on this asset.
  const context = [header, chartBlock(chart), factBlock(citable)].join("\n\n");

  // 3. Bull and bear, then one rebuttal round.
  const cases = await Promise.all(
    (["bull", "bear"] as const).map((side) =>
      step(s, { step: `weekly.${side}`, context, user: `${CASE_ROLE[side]}\n\nANALYST NOTES:\n${analystText}`, schema: CASE_SCHEMA, maxTokens: MAX_TOKENS.case, effort: "low" }, (t) =>
        parsePoints(t, citable, extra, LIMITS.casePoints),
      ),
    ),
  );
  const [bull, bear] = cases;
  if (!bull?.length || !bear?.length) return fail("bull or bear step failed");
  const rebuttals = await Promise.all(
    (["bull", "bear"] as const).map((side) =>
      step(
        s,
        { step: `weekly.${side}.rebuttal`, context, user: `${REBUTTAL_ROLE[side]}\n\n${side === "bull" ? "BEAR" : "BULL"} CASE:\n${reasonedLines(side === "bull" ? bear : bull)}`, schema: CASE_SCHEMA, maxTokens: MAX_TOKENS.rebuttal, effort: "low" },
        (t) => parsePoints(t, citable, extra, LIMITS.rebuttal),
      ),
    ),
  );
  const debate = { bull: [...bull, ...(rebuttals[0] ?? [])], bear: [...bear, ...(rebuttals[1] ?? [])] };

  // 4. Editor draft, risk review, at most one send-back.
  const daily = input.indicators?.["1d"];
  const allowedLevels = [...new Set([...extra, ...(["accumulate", "hold", "reduce"] as View[]).flatMap((v) => levelNumbers(computeLevels(v, daily, chart["1d"])))])].map(roundPrice);
  const allowedNumbers = [...extra, ...allowedLevels];
  const past = await s.deps.store.notes(asset.assetId, addDays(weekOf, -7), addDays(weekOf, -1)).catch(() => []);
  const pastText = past.length ? past.map((n) => `- ${n.date}: ${n.status}, ${n.view}, ${n.conviction} conviction. ${n.summary.replace(/\n/g, " ")}`).join("\n") : "- (no daily notes last week)";
  const editorInputs = [
    `ALLOWED LEVELS (from the code chart read): ${allowedLevels.join(", ") || "none"}`,
    `ANALYST NOTES:\n${analystText}`,
    `BULL CASE AND REBUTTAL:\n${reasonedLines(debate.bull)}`,
    `BEAR CASE AND REBUTTAL:\n${reasonedLines(debate.bear)}`,
    `LAST WEEK'S DAILY NOTES (our own earlier research, context only, not citable):\n${pastText}`,
  ].join("\n\n");
  const ctx = new Ctx(citable, allowedNumbers);
  const draft = await step(s, { step: "weekly.editor", context, user: `${EDITOR_ROLE}\n\n${editorInputs}`, schema: EDITOR_SCHEMA, maxTokens: MAX_TOKENS.editor, effort: "medium" }, (t) => parseDraft(t, ctx, allowedLevels));
  if (!draft) return fail("editor step failed");

  const hasNews = citable.some(isUntrusted);
  const issues = codeIssues(draft, hasNews);
  const reviewCtx = new Ctx(citable);
  const draftJson = JSON.stringify(stripEvidence(draft.draft));
  const review: Review | null = await step(
    s,
    {
      step: "weekly.review",
      context,
      user: `${REVIEW_ROLE}\n\nCODE CHECKS:\n${issues.map((i) => `- ${i.section}: ${i.issue}`).join("\n") || "- none"}\n\nDRAFT:\n${draftJson}`,
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
    const revised = await step(
      s,
      {
        step: "weekly.revise",
        context,
        user: `${REVISE_ROLE}\n\nSEND BACK: ${sendBack}\nREVIEWER NOTES:\n${(review?.notes ?? []).map((n) => `- ${n}`).join("\n") || "- (none)"}\nCODE CHECKS:\n${issues.filter((i) => i.section === sendBack).map((i) => `- ${i.issue}`).join("\n") || "- none"}\n\n${editorInputs}\n\nDRAFT:\n${draftJson}`,
        schema: EDITOR_SCHEMA,
        maxTokens: MAX_TOKENS.revise,
        effort: "medium",
      },
      (t) => parseDraft(t, ctx, allowedLevels),
    );
    if (revised) final = replaceSection(draft, revised, sendBack);
    else notes.push(`${asset.assetId}: revision step failed, the first draft was kept`);
  }
  const remaining = blocking(codeIssues(final, hasNews));
  const { draft: fixed, corrections } = finalizeDraft(final.draft);
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
    ranked: sorted.map((a, i) => ideaFromSection(a, i + 1)),
    splitWhy: null,
    ok: false,
  };
}

function ideaFromSection(a: WeeklyAssetSection, rank: number, over: Partial<InvestmentIdea> = {}): InvestmentIdea {
  const first = a.view.reasons[0] ?? a.recap[0] ?? { text: "Thin evidence this week.", factIds: [] };
  return {
    rank,
    assetId: a.assetId,
    view: a.view.view,
    reasons: a.view.reasons.slice(0, 2).map((r) => prefixed(a.assetId, r)),
    dependsOn: prefixed(a.assetId, a.market[0] ?? first),
    mainRisk: prefixed(a.assetId, { text: a.scenarios.bear.text, factIds: a.scenarios.bear.factIds }),
    ...over,
  };
}

async function summarize(weekOf: IsoDate, market: MarketResearchInput | null, okSections: WeeklyAssetSection[], assets: UniverseAsset[], s: StepCtx): Promise<Summary> {
  const marketFacts = prepareFacts(market?.facts ?? []).facts;
  if (okSections.length === 0) return fallbackSummary(weekOf, marketFacts, okSections);
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
  const ctx = new Ctx([...marketFacts, ...sectionFacts], okSections.flatMap((a) => [...chartLevels(a.chart), ...levelNumbers(a.view.levels)]));
  const parsed = await step(
    s,
    { step: "weekly.summary", context: factBlock(marketFacts), user: `${SUMMARY_ROLE}\n\n${digest}`, schema: summarySchema(ids), maxTokens: MAX_TOKENS.summary, effort: "medium" },
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
  const ranked = parsed.ranking.map((id, i) => ideaFromSection(okSections.find((a) => a.assetId === id)!, i + 1, parsed.byAsset.get(id)));
  return { market: { date: weekOf, summary: parsed.lines.join("\n"), developments: parsed.developments, facts: marketFacts }, ranked, splitWhy: parsed.splitWhy, ok: true };
}

const SPLIT_WHY: Record<ExampleSplit["profile"], string> = {
  cautious: "Example only: leans on the core assets and trims assets with a cautious view this week. General research, not an order for anyone.",
  growth: "Example only: gives more room to growth and crypto assets where the view allows it. General research, not an order for anyone.",
};

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

export async function runWeekly(deps: WeeklyDeps): Promise<RunOutcome & { report?: WeeklyReport }> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const date = now.slice(0, 10);
  const weekOf = mondayOf(date);
  const runId = newRunId(date, "weekly");
  const assets = deps.assets ?? defaultAssets();
  const spentToday = await deps.store.daySpend(date).catch(() => 0);
  const budget = costBudget({ maxRunUsd: deps.maxRunCostUsd, maxDayUsd: deps.maxDayCostUsd, spentTodayUsd: spentToday });
  const model = RESEARCH_MODELS.weekly;
  const s: StepCtx = { deps, budget, model };

  await deps.store.startRun({ runId, kind: "weekly", date, models: { analysts: model, debate: model, reviewer: model, editor: model, summary: model }, promptVersion: PROMPT_VERSION });
  let market: MarketResearchInput | null = null;
  const inputs: (AssetResearchInput | MarketResearchInput | null)[] = [];

  const finish = async (status: RunOutcome["status"], results: SectionResult[], problems: string[], written: boolean, report?: WeeklyReport) => {
    const counts = {
      ok: results.filter((r) => r.section.status === "ok").length,
      noReading: results.filter((r) => r.section.status === "no-reading").length,
      sentBack: results.reduce((t, r) => t + r.sentBack, 0),
      removedClaims: results.reduce((t, r) => t + r.removed, 0),
      calls: budget.calls.length,
    };
    if (status === "aborted-cost") console.warn(`[research] weekly run ${runId} stopped by the cost guard: ${problems[0] ?? ""}`);
    const all = [market, ...results.map((r) => r.input ?? null), ...inputs];
    const dataHash = all.some(Boolean) ? hashInputs(all) : null;
    const detail = [`${status}: ${counts.ok} ok, ${counts.noReading} no reading, ${counts.sentBack} sent back, ${counts.removedClaims} claims removed, ${counts.calls} model calls`, ...problems].join("\n");
    await deps.store.finishRun(runId, { status, costUsd: budget.spent, detail, dataHash });
    return { runId, kind: "weekly" as const, date, status, written, costUsd: budget.spent, counts, problems, ...(report ? { report } : {}) };
  };

  if (!(budget.cap > 0)) return finish("aborted-cost", [], [`cost guard: the day cap $${deps.maxDayCostUsd} is already used (spent today $${spentToday.toFixed(2)})`], false);

  const problems: string[] = [];
  try {
    market = await deps.gatherMarket(date);
  } catch (e) {
    problems.push(`market data failed (${e instanceof Error ? e.message.slice(0, 120) : "unknown"}): sections use asset facts only`);
  }

  let results: SectionResult[];
  let summary: Summary;
  try {
    results = await pool(assets, deps.concurrency ?? 3, (a) => researchSection(a, weekOf, date, market, s));
    const failures = results.filter((r) => r.failed).length;
    if (failures > MAX_NO_READINGS) {
      return finish("failed", results, [`${failures} assets had no reading (limit ${MAX_NO_READINGS}): nothing written`, ...problems, ...results.flatMap((r) => r.notes)], false);
    }
    summary = await summarize(weekOf, market, results.filter((r) => r.section.status === "ok").map((r) => r.section), assets, s);
  } catch (e) {
    if (e instanceof CostAbort) return finish("aborted-cost", [], [e.message, ...problems], false);
    return finish("failed", [], [`run error: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`, ...problems], false);
  }

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
    market: summary.market,
    assets: results.map((r) => r.section),
    ideas: { ranked: summary.ranked, exampleSplits },
    scorecard: weeklyScorecard(lastWeek, later, scores),
    review: {
      approved: results.every((r) => r.section.status !== "ok" || r.approved),
      sentBack: results.reduce((t, r) => t + r.sentBack, 0),
      removedClaims: results.reduce((t, r) => t + r.removed, 0),
      notes: [...problems, ...(summary.ok ? [] : ["summary step failed: ideas built in code from the approved sections"]), ...results.flatMap((r) => r.notes)].slice(0, 60),
    },
    model: { analysts: model, editor: model },
    costUsd: Math.round(budget.spent * 10_000) / 10_000,
    disclaimer: RESEARCH_DISCLAIMER,
  };
  const shape = weeklyProblems(report);
  if (shape.length) return finish("failed", results, ["whole-report check failed: nothing written", ...shape.slice(0, 20), ...problems], false);
  try {
    await deps.store.writeWeekly(runId, report);
  } catch (e) {
    return finish("failed", results, [`write failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`], false);
  }
  return finish("ok", results, problems, true, report);
}
