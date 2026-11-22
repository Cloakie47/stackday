import deployment from "../../deployment.json" with { type: "json" };
import { RESEARCH_MODELS } from "../flags.ts";
import type { AssetResearchInput, Confidence, DailyScore, Fact, IsoDate, ResearchNote, ResearchSnapshot, View } from "../types.ts";
import { VIEWS } from "../types.ts";
import { researchableUniverse, type UniverseAsset } from "../universe.ts";
import { defaultAlert, type AlertFn } from "./alert.ts";
import { costBudget, CostAbort, guardedCall, pool, type Budget } from "./budget.ts";
import { chartBlock, chartLevels, ensurePriceFacts, factBlock, hashInputs, isUntrusted, patternFacts, prepareFacts, sentFacts } from "./facts.ts";
import { computeLevels } from "./levels.ts";
import { buildMarketOverview } from "./market.ts";
import type { ModelFn } from "./model.ts";
import { Ctx, NUMBERS_IN, oneOf, parseJsonObject, StepRejected, stringList } from "./parse.ts";
import { DAILY_SCHEMA, DAILY_SYSTEM, LIMITS, PROMPT_VERSION } from "./prompts.ts";
import { initialScore } from "./scores.ts";
import type { ResearchStore } from "./store.ts";
import { snapshotProblems } from "./validate.ts";

/**
 * The daily note run (founder spec section 2, internal while testing), after the US close:
 * 1. For each researchable asset: market closed today -> carry the last note ("carried").
 * 2. Data step (code, injected `gather`), then one short technical plus news pass on the cheaper
 *    model (`RESEARCH_MODELS.dailyTriage`).
 * 3. Big movers (a one-day move above 2 x the daily ATR, or a pattern completed today) and triage
 *    answers that fail the checks get one pass on `RESEARCH_MODELS.dailyEscalation`.
 * 4. Code risk check: claims without valid fact ids, links, unbacked numbers and banned phrases are
 *    removed; conviction is capped at low on thin data or a view that fights the daily trend.
 * 5. Buy zone and invalidation computed in code from support, resistance and ATR.
 * Failure policy: at most 2 assets may end with no reading; more than that, a failed whole-run
 * check, or the cost guard (per run and per day) means the run writes nothing and the last good
 * snapshot stays live. If today's spend cannot be read the run is blocked (the day cap fails closed),
 * and every hit cap raises an alert (alert.ts).
 * Time: the whole run stays inside `timeLimitMs` (default 270 s, under the route's 300 s limit); a
 * model call never gets more than the time left.
 */

export type GatherFn = (assetId: string, date: IsoDate) => Promise<AssetResearchInput>;

export type DailyDeps = {
  gather: GatherFn;
  model: ModelFn;
  store: ResearchStore;
  maxRunCostUsd: number;
  maxDayCostUsd: number;
  now?: () => Date;
  assets?: UniverseAsset[];
  concurrency?: number;
  /** Most escalation calls in one run (keeps the stronger model rare). */
  maxEscalations?: number;
  /** Wall-clock limit of the whole run in ms (default RUN_TIME_LIMIT_MS). */
  timeLimitMs?: number;
  /** Called when a spend cap stops the run (default: warning plus optional webhook). */
  alert?: AlertFn;
};

export type RunOutcome = {
  runId: string;
  kind: "daily" | "weekly";
  date: IsoDate;
  status: "ok" | "failed" | "aborted-cost" | "skipped";
  written: boolean;
  costUsd: number;
  counts: Record<string, number>;
  problems: string[];
};

export const MAX_NO_READINGS = 2;
/** Room for adaptive thinking plus the JSON answer (thinking counts toward max_tokens). */
export const TRIAGE_MAX_TOKENS = 8000;
export const ESCALATE_MAX_TOKENS = 12000;
/** A run's time limit: the routes allow 300 s (Vercel Hobby), this keeps a margin for the writes. */
export const RUN_TIME_LIMIT_MS = 270_000;
/** A one-day move larger than this many daily ATRs counts as a big mover. */
export const BIG_MOVE_ATR = 2;

const DAILY_KINDS = new Set(["price", "indicator", "pattern", "news", "filing"]);

export const defaultAssets = () => researchableUniverse(deployment as Record<string, unknown>).assets;

const isWeekend = (date: IsoDate) => {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

/** US stock assets research on weekdays only; crypto and the gold token any day. Holidays come from the data step. */
export function marketOpen(asset: UniverseAsset, date: IsoDate, input?: AssetResearchInput): boolean {
  if (asset.calendar === "XNYS" && isWeekend(date)) return false;
  return input ? input.marketOpenToday : true;
}

/** Big mover: |1 day move| above 2 x ATR% of the close, or a daily pattern completed on the run date. */
export function isBigMover(input: AssetResearchInput): boolean {
  const d = input.indicators?.["1d"];
  const move = d?.changePct?.bar1;
  if (d && typeof move === "number" && typeof d.atr14 === "number" && d.last > 0 && Math.abs(move) > BIG_MOVE_ATR * (d.atr14 / d.last)) return true;
  return (input.chart?.["1d"]?.patterns ?? []).some((p) => p.asOf.slice(0, 10) === input.date);
}

export type DailyReading = { view: View; conviction: Confidence; summary: string; reasons: ResearchNote["reasons"]; risks: ResearchNote["risks"]; injectionFactIds: string[] };

/** Strict parse of a daily answer. Throws StepRejected when it must become "no reading". */
export function parseDaily(text: string, facts: Fact[], extraNumbers: number[]): { reading: DailyReading; ctx: Ctx } {
  const raw = parseJsonObject(text, Object.keys((DAILY_SCHEMA as { properties: object }).properties));
  if (!oneOf(VIEWS, raw.view)) throw new StepRejected("bad view");
  if (!oneOf(["low", "medium", "high"] as const, raw.conviction)) throw new StepRejected("bad conviction");
  const flagged = stringList(raw.injectionFactIds, "injectionFactIds");
  const ctx = new Ctx(facts, extraNumbers, flagged);
  const lines = stringList(raw.summaryLines, "summaryLines").slice(0, 3);
  const kept = lines.map((l) => ctx.text(l, LIMITS.summaryLine)).filter((l): l is string => l !== null);
  const summary = kept.join("\n");
  if (kept.length === 0 || summary.length > LIMITS.summary) throw new StepRejected("no clean summary");
  const reasons = ctx.list(raw.reasons, LIMITS.text, LIMITS.dailyReasons);
  const risks = ctx.list(raw.risks, LIMITS.text, LIMITS.dailyRisks);
  if (reasons.length === 0) throw new StepRejected("no reason with a valid fact");
  return { reading: { view: raw.view, conviction: raw.conviction, summary, reasons, risks, injectionFactIds: flagged }, ctx };
}

const ORDER: Confidence[] = ["low", "medium", "high"];
const cap = (c: Confidence, max: Confidence) => (ORDER.indexOf(c) > ORDER.indexOf(max) ? max : c);

/** Code risk check on a parsed reading: conviction capped on thin evidence or a view that fights the trend. */
export function dailyRiskCheck(r: DailyReading, input: AssetResearchInput, citable: Fact[]): { conviction: Confidence; notes: string[] } {
  const notes: string[] = [];
  let conviction = r.conviction;
  const trusted = citable.filter((f) => !isUntrusted(f) && !r.injectionFactIds.includes(f.id)).length;
  if (trusted < 3) {
    conviction = cap(conviction, "low");
    notes.push("fewer than 3 trusted facts: conviction capped at low");
  }
  const c = input.chart?.["1d"];
  if (c) {
    const bullish = c.patterns.some((p) => p.direction === "bullish");
    const bearish = c.patterns.some((p) => p.direction === "bearish");
    if (r.view === "accumulate" && c.trend === "lower-highs-lower-lows" && !bullish) {
      conviction = cap(conviction, "low");
      notes.push("accumulate against a falling daily trend with no bullish pattern: conviction capped at low");
    }
    if ((r.view === "reduce" || r.view === "avoid-new-buys") && c.trend === "higher-highs-higher-lows" && !bearish) {
      conviction = cap(conviction, "low");
      notes.push("cautious view against a rising daily trend with no bearish pattern: conviction capped at low");
    }
  }
  return { conviction, notes };
}

function noReadingNote(asset: UniverseAsset, date: IsoDate, now: string, summary: string, previous?: ResearchNote): ResearchNote {
  return {
    assetId: asset.assetId,
    date,
    generatedAt: now,
    dataAsOf: now,
    status: "no-reading",
    summary,
    view: "hold",
    conviction: "low",
    levels: null,
    reasons: [],
    risks: [],
    facts: [],
    chart: {},
    model: { triage: RESEARCH_MODELS.dailyTriage },
    ...(previous && previous.status !== "no-reading" ? { previousView: previous.view } : {}),
  };
}

function newest(facts: Fact[], input: AssetResearchInput, fallback: string): string {
  const times = [...facts.map((f) => f.asOf), ...Object.values(input.series ?? {}).map((s) => s?.fetchedAt)]
    .filter((t): t is string => typeof t === "string" && Number.isFinite(Date.parse(t)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return times.at(-1) ?? fallback;
}

type AssetResult = { note: ResearchNote; failed: boolean; escalated: boolean; factsShare: number; input?: AssetResearchInput; problems: string[] };

async function researchAsset(asset: UniverseAsset, date: IsoDate, now: string, previous: ResearchNote | undefined, deps: DailyDeps, budget: Budget, escalations: { left: number }): Promise<AssetResult> {
  const carry = (): AssetResult => ({
    note: previous
      ? { ...previous, status: previous.status === "no-reading" ? "no-reading" : "carried", date, generatedAt: now, ...(previous.status !== "no-reading" ? { previousView: previous.view } : {}) }
      : noReadingNote(asset, date, now, "Market closed today and there is no earlier note to carry forward."),
    failed: false,
    escalated: false,
    factsShare: 1,
    problems: [],
  });
  if (!marketOpen(asset, date)) return carry();

  let input: AssetResearchInput;
  try {
    input = await deps.gather(asset.assetId, date);
    if (!input || input.assetId !== asset.assetId) throw new Error("gather returned another asset");
  } catch (e) {
    const problem = `${asset.assetId}: data failed (${e instanceof Error ? e.message.slice(0, 120) : "unknown"})`;
    return { note: noReadingNote(asset, date, now, "No reading today: market data could not be loaded, so nothing is shown instead of a guess.", previous), failed: true, escalated: false, factsShare: 1, problems: [problem] };
  }
  if (!marketOpen(asset, date, input)) return { ...carry(), input };

  const chart = input.chart ?? {};
  const withCode = ensurePriceFacts(input);
  const { facts: prepared, screened } = prepareFacts([...withCode, ...patternFacts(chart, withCode)]);
  const facts = sentFacts(prepared.filter((f) => DAILY_KINDS.has(f.kind)));
  const extra = [...chartLevels(chart), ...assetNumbers(asset)];
  const prevView = previous && previous.status !== "no-reading" ? previous.view : undefined;
  const user = [
    `Asset: ${asset.assetId} (${asset.name}, underlying ${asset.underlying}), class ${asset.assetClass}, sector ${asset.sector}.`,
    asset.note ? `Note: ${asset.note}` : "",
    `Date: ${input.date}.`,
    prevView ? `Previous view: ${prevView}.` : "No previous note.",
    "",
    chartBlock(chart),
    "",
    factBlock(facts),
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");

  const ask = async (model: string, step: string, maxTokens: number, effort: "low" | "medium") => {
    const res = await guardedCall(deps.model, { model, step, system: DAILY_SYSTEM, user, schema: DAILY_SCHEMA, maxTokens, effort }, budget);
    if (!res || !res.text) return null;
    try {
      return parseDaily(res.text, facts, extra);
    } catch (e) {
      if (e instanceof StepRejected) return null;
      throw e;
    }
  };

  const problems: string[] = screened.length ? [`${asset.assetId}: ${screened.length} news items screened as possible injection`] : [];
  let parsed = await ask(RESEARCH_MODELS.dailyTriage, "daily.triage", TRIAGE_MAX_TOKENS, "low");
  let escalated = false;
  if ((parsed === null || isBigMover(input)) && escalations.left > 0) {
    escalations.left--;
    const second = await ask(RESEARCH_MODELS.dailyEscalation, "daily.escalation", ESCALATE_MAX_TOKENS, "medium");
    if (second) {
      parsed = second;
      escalated = true;
    }
  }
  if (!parsed) {
    return {
      note: noReadingNote(asset, date, now, "No reading today: the analysis did not pass our checks, so nothing is shown instead of a guess.", previous),
      failed: true,
      escalated: false,
      factsShare: 0,
      input,
      problems: [...problems, `${asset.assetId}: model answer failed the checks`],
    };
  }
  const { reading, ctx } = parsed;
  const check = dailyRiskCheck(reading, input, facts);
  const flagged = new Set(reading.injectionFactIds);
  const kept = facts.filter((f) => !flagged.has(f.id));
  const note: ResearchNote = {
    assetId: asset.assetId,
    date,
    generatedAt: now,
    dataAsOf: newest(kept, input, now),
    status: "ok",
    summary: reading.summary,
    view: reading.view,
    conviction: check.conviction,
    levels: computeLevels(reading.view, input.indicators?.["1d"], chart["1d"]),
    reasons: reading.reasons,
    risks: reading.risks,
    facts: kept,
    chart,
    model: escalated ? { triage: RESEARCH_MODELS.dailyTriage, escalated: RESEARCH_MODELS.dailyEscalation } : { triage: RESEARCH_MODELS.dailyTriage },
    ...(prevView ? { previousView: prevView } : {}),
  };
  const removed = ctx.removed.map((r) => `${asset.assetId}: removed "${r.text.slice(0, 60)}" (${r.why})`);
  return { note, failed: false, escalated, factsShare: ctx.factsShare(), input, problems: [...problems, ...removed, ...check.notes.map((n) => `${asset.assetId}: ${n}`)] };
}

/** Numbers in the asset's own name (for example "S&P 500") may be written: they come from code, not the model. */
export const assetNumbers = (asset: UniverseAsset) => NUMBERS_IN(`${asset.name} ${asset.underlying}`);

/** Today's spend, or null when it cannot be read (the caller then blocks the run). */
export async function readSpend(read: () => Promise<number>): Promise<number | null> {
  try {
    const n = await read();
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function newRunId(date: IsoDate, kind: string) {
  return `${date}-${kind}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
}

export async function runDaily(deps: DailyDeps): Promise<RunOutcome> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const date = now.slice(0, 10);
  const runId = newRunId(date, "daily");
  const assets = deps.assets ?? defaultAssets();
  const spentToday = await readSpend(() => deps.store.daySpend(date));
  const budget = costBudget({
    maxRunUsd: deps.maxRunCostUsd,
    maxDayUsd: deps.maxDayCostUsd,
    spentTodayUsd: spentToday ?? Infinity,
    record: (usd) => deps.store.recordSpend(runId, usd),
    timeLimitMs: deps.timeLimitMs ?? RUN_TIME_LIMIT_MS,
  });
  const escalations = { left: deps.maxEscalations ?? 3 };

  await deps.store.startRun({ runId, kind: "daily", date, models: { triage: RESEARCH_MODELS.dailyTriage, escalation: RESEARCH_MODELS.dailyEscalation }, promptVersion: PROMPT_VERSION });
  const last = await deps.store.latestSnapshot().catch(() => null);
  const previous = new Map((last?.notes ?? []).map((n) => [n.assetId, n]));

  const finish = async (status: Exclude<RunOutcome["status"], "skipped">, results: AssetResult[], problems: string[], written: boolean): Promise<RunOutcome> => {
    const counts = {
      ok: results.filter((r) => r.note.status === "ok").length,
      carried: results.filter((r) => r.note.status === "carried").length,
      noReading: results.filter((r) => r.note.status === "no-reading").length,
      escalated: results.filter((r) => r.escalated).length,
      calls: budget.calls.length,
    };
    if (status === "aborted-cost") await (deps.alert ?? defaultAlert)(`daily run ${runId} stopped by the cost guard: ${problems[0] ?? ""}`);
    const inputs = results.map((r) => r.input ?? null);
    const dataHash = results.some((r) => r.input) ? hashInputs(inputs) : null;
    const detail = [`${status}: ${counts.ok} ok, ${counts.carried} carried, ${counts.noReading} no reading, ${counts.escalated} escalated, ${counts.calls} model calls`, ...problems].join("\n");
    await deps.store.finishRun(runId, { status, costUsd: budget.spent, detail, dataHash, inputs: dataHash ? inputs : null, outputs: budget.calls });
    return { runId, kind: "daily", date, status, written, costUsd: budget.spent, counts, problems };
  };

  if (spentToday === null) return finish("aborted-cost", [], ["cost guard: today's spend could not be read, so the run is blocked"], false);
  if (!(budget.cap > 0)) return finish("aborted-cost", [], [`cost guard: the day cap $${deps.maxDayCostUsd} is already used (spent today $${spentToday.toFixed(2)})`], false);

  let results: AssetResult[];
  try {
    results = await pool(assets, deps.concurrency ?? 3, (a) => researchAsset(a, date, now, previous.get(a.assetId), deps, budget, escalations));
  } catch (e) {
    if (e instanceof CostAbort) return finish("aborted-cost", [], [e.message], false);
    return finish("failed", [], [`run error: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`], false);
  }

  const problems = results.flatMap((r) => r.problems);
  const failures = results.filter((r) => r.failed).length;
  if (failures > MAX_NO_READINGS) return finish("failed", results, [`${failures} assets had no reading (limit ${MAX_NO_READINGS}): nothing written, last good snapshot stays live`, ...problems], false);

  const notes = results.map((r) => r.note);
  const market = buildMarketOverview(date, notes);
  const snapshot: ResearchSnapshot = { kind: "live", date, generatedAt: now, runId, market, notes, costUsd: budget.spent };
  const shape = snapshotProblems(snapshot);
  if (notes.length !== assets.length) shape.push(`expected ${assets.length} notes, got ${notes.length}`);
  if (shape.length) return finish("failed", results, ["whole-run check failed: nothing written", ...shape.slice(0, 20), ...problems], false);

  const scores = results.map((r) => (r.note.status === "ok" ? initialScore(r.note, r.factsShare) : null)).filter((s): s is DailyScore => s !== null);
  try {
    await deps.store.writeDaily(runId, date, notes, market, scores);
  } catch (e) {
    return finish("failed", results, [`write failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`, ...problems], false);
  }
  return finish("ok", results, problems, true);
}
