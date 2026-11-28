import deployment from "../../deployment.json" with { type: "json" };
import { ESCALATION_TRIGGERS, RESEARCH_MODELS } from "../flags.ts";
import type { AssetResearchInput, Confidence, DailyScore, Fact, IsoDate, Levels, ResearchNote, ResearchSnapshot, View } from "../types.ts";
import { NO_CURRENT_PRICE, VIEWS } from "../types.ts";
import { researchableUniverse, type UniverseAsset } from "../universe.ts";
import { defaultAlert, type AlertFn } from "./alert.ts";
import { callErrors, costBudget, CostAbort, guardedCall, pool, type Budget } from "./budget.ts";
import { cutInput, cutLine, dailyCutoff } from "./cutoff.ts";
import { chartBlock, chartLevels, displayableInput, ensurePriceFacts, factBlock, hashInputs, isUntrusted, patternFacts, prepareFacts, priceProblem, sentFacts } from "./facts.ts";
import { computeLevels } from "./levels.ts";
import { buildMarketOverview } from "./market.ts";
import { worstCaseCost, type ModelFn } from "./model.ts";
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
 * 3. Triage answers that fail the checks get one pass on `RESEARCH_MODELS.dailyEscalation`, and so
 *    do answers that pass when a trigger fires (`escalationTriggers`): a big mover (a one-day move
 *    above 2 x the daily ATR, or a pattern completed today), a market crisis (Bitcoin or the S&P 500
 *    down sharply in a day), a stale price feed, or low conviction near the invalidation level
 *    (thresholds in flags.ts ESCALATION_TRIGGERS). The cap (`maxEscalations`, default 3) holds for
 *    all of them; the three newer triggers leave its last slot for answers that failed the checks
 *    and big movers. An escalation the run budget cannot cover, together with the cheap first pass
 *    of the assets still to come, is skipped with a note instead of stopping the run.
 * 4. Code risk check: claims without valid fact ids, links, unbacked numbers and banned phrases are
 *    removed; conviction is capped at low on thin data or a view that fights the daily trend.
 * 5. Buy zone and invalidation computed in code from support, resistance and ATR.
 * Failure policy: at most 2 assets may end with no reading; more than that, a failed whole-run
 * check, or the cost guard (per run and per day) means the run writes nothing and the last good
 * snapshot stays live. If today's spend cannot be read the run is blocked (the day cap fails closed),
 * and every hit cap raises an alert (alert.ts).
 * Time: the whole run stays inside `timeLimitMs` (default 270 s, under the route's 300 s limit); a
 * model call never gets more than the time left.
 * No look-ahead: every fact known or published after the note's cut-off (its real run time) is
 * dropped before the model sees it, with a line in the run log (engine/cutoff.ts).
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

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const pctText = (x: number) => `${(Math.abs(x) * 100).toFixed(1)}%`;
const pxLast = (input: AssetResearchInput) => (input.facts ?? []).find((f) => f.id === "px.last" && isNum(f.value) && f.value > 0);

/** The latest price: "px.last", else the last daily close. */
function latestPrice(input: AssetResearchInput): number | null {
  const px = pxLast(input);
  if (px) return px.value as number;
  const last = input.indicators?.["1d"]?.last;
  return isNum(last) && last > 0 ? last : null;
}

/**
 * The move "in a day" for the crisis trigger: the worse of the last closed daily bar's change and
 * the move from that close to the latest price ("px.last"). For crypto at 22:30 UTC the last closed
 * daily bar is yesterday's, so today's fall shows in the second part; for stocks the first part is
 * today's session. Null when neither is known.
 */
export function dayMove(input: AssetResearchInput): number | null {
  const d = input.indicators?.["1d"];
  const moves: number[] = [];
  if (isNum(d?.changePct?.bar1)) moves.push(d.changePct.bar1);
  const px = pxLast(input);
  if (px && d && isNum(d.last) && d.last > 0) moves.push((px.value as number) / d.last - 1);
  return moves.length ? Math.min(...moves) : null;
}

/** Market crisis, for every asset: Bitcoin or the S&P 500 down more than its threshold in a day. Unknown is no crisis. */
export function marketCrisis(btc: AssetResearchInput | null | undefined, spx: AssetResearchInput | null | undefined): string | null {
  const t = ESCALATION_TRIGGERS;
  const b = btc ? dayMove(btc) : null;
  if (b !== null && b < -t.btcDayDropPct / 100) return `market crisis: Bitcoin down ${pctText(b)} in a day (trigger ${t.btcDayDropPct}%)`;
  const s = spx ? dayMove(spx) : null;
  if (s !== null && s < -t.spxDayDropPct / 100) return `market crisis: S&P 500 down ${pctText(s)} in a day (trigger ${t.spxDayDropPct}%)`;
  return null;
}

/**
 * Stale price feed for one asset: the data step could not read the current price (`NO_CURRENT_PRICE`
 * in its problems, for example the Base RPC down so the bars came from stored history only), or for
 * crypto the latest price is older than `stalePriceHoursCrypto` at the run time.
 */
export function staleFeed(input: AssetResearchInput, crypto: boolean, nowMs: number): string | null {
  if ((input.problems ?? []).some((p) => typeof p === "string" && p.includes(NO_CURRENT_PRICE))) return "stale price feed: the current price could not be read";
  const px = pxLast(input);
  if (crypto && px) {
    const hours = (nowMs - Date.parse(px.asOf)) / 3_600_000;
    if (Number.isFinite(hours) && hours > ESCALATION_TRIGGERS.stalePriceHoursCrypto) return `stale price feed: the latest price is ${hours.toFixed(1)} hours old`;
  }
  return null;
}

/** Low conviction while the latest price is within `nearInvalidationAtr` daily ATRs of the invalidation level. */
export function nearInvalidation(conviction: Confidence, levels: Levels | null, input: AssetResearchInput): string | null {
  if (conviction !== "low" || !levels || !isNum(levels.invalidation)) return null;
  const atr = input.indicators?.["1d"]?.atr14;
  const price = latestPrice(input);
  if (!isNum(atr) || atr <= 0 || price === null) return null;
  const gap = Math.abs(price - levels.invalidation) / atr;
  return gap <= ESCALATION_TRIGGERS.nearInvalidationAtr ? `low conviction ${gap.toFixed(1)} ATR from the invalidation level ${levels.invalidation}` : null;
}

/**
 * Why an answer that PASSED the checks still goes to the stronger model; empty when it does not.
 * Pure: the market inputs (Bitcoin and the S&P 500, null when not researched or closed today) and
 * the clock are passed in. `reading` is the checked conviction and the code levels of the answer.
 */
export function escalationTriggers(a: {
  input: AssetResearchInput;
  crypto: boolean;
  nowMs: number;
  market: { btc?: AssetResearchInput | null; spx?: AssetResearchInput | null };
  reading: { conviction: Confidence; levels: Levels | null };
}): string[] {
  const out = [isBigMover(a.input) ? "big mover" : null, marketCrisis(a.market.btc, a.market.spx), staleFeed(a.input, a.crypto, a.nowMs), nearInvalidation(a.reading.conviction, a.reading.levels, a.input)];
  return out.filter((x): x is string => x !== null);
}

/**
 * Escalations left in a run. `reserved` slots are kept for the cases that escalated before the
 * newer triggers existed (answers that failed the checks, big movers), so a crisis that fires for
 * every asset cannot use them all up.
 */
export type EscalationSlots = { left: number; reserved: number };

export function escalationSlots(max: number): EscalationSlots {
  const left = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  return { left, reserved: left >= 2 ? 1 : 0 };
}

/** True when a slot is free for this kind of escalation (`priority`: failed checks or a big mover). */
export const slotFree = (s: EscalationSlots, priority: boolean): boolean => s.left > 0 && (priority || s.left > s.reserved);

/** Takes a slot when one is free for this kind of escalation. */
export function takeSlot(s: EscalationSlots, priority: boolean): boolean {
  if (!slotFree(s, priority)) return false;
  s.left--;
  return true;
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

/**
 * Shared by the assets of one run: one gather per asset, the market inputs for the crisis trigger,
 * the escalation slots, and how many assets have not finished yet (their cheap first pass must
 * still fit in the budget when an escalation is considered).
 */
type RunCtx = {
  gather: GatherFn;
  marketInputs: () => Promise<{ btc: AssetResearchInput | null; spx: AssetResearchInput | null }>;
  slots: EscalationSlots;
  maxEscalations: number;
  unfinished: number;
};

async function researchAsset(asset: UniverseAsset, date: IsoDate, now: string, previous: ResearchNote | undefined, deps: DailyDeps, budget: Budget, run: RunCtx): Promise<AssetResult> {
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
    input = await run.gather(asset.assetId, date);
    if (!input || input.assetId !== asset.assetId) throw new Error("gather returned another asset");
  } catch (e) {
    const problem = `${asset.assetId}: data failed (${e instanceof Error ? e.message.slice(0, 120) : "unknown"})`;
    return { note: noReadingNote(asset, date, now, "No reading today: market data could not be loaded, so nothing is shown instead of a guess.", previous), failed: true, escalated: false, factsShare: 1, problems: [problem] };
  }
  if (!marketOpen(asset, date, input)) return { ...carry(), input };

  // Nothing from the future: facts known or published after the note's cut-off are dropped here.
  const readAt = (deps.now ?? (() => new Date()))();
  const cut = cutInput(input, dailyCutoff(date, readAt), readAt);
  const cutNote = cutLine(asset.assetId, cut.dropped, cut.cutoffMs);
  // Only what may be shown reaches the model and the note (display flag on facts and series).
  const view = displayableInput(cut.input).input;
  const chart = view.chart ?? {};
  const withCode = ensurePriceFacts(view);
  const noPrice = priceProblem(withCode, date, asset.assetClass === "crypto");
  if (noPrice) return { note: noReadingNote(asset, date, now, "No reading today: no fresh price could be read, so nothing is shown instead of a guess.", previous), failed: true, escalated: false, factsShare: 1, problems: [`${asset.assetId}: ${noPrice}`], input };
  const { facts: prepared, screened } = prepareFacts([...withCode, ...patternFacts(chart, withCode, view.series)]);
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

  const problems: string[] = [...(cutNote ? [cutNote] : []), ...(screened.length ? [`${asset.assetId}: ${screened.length} news items screened as possible injection`] : [])];
  let parsed = await ask(RESEARCH_MODELS.dailyTriage, "daily.triage", TRIAGE_MAX_TOKENS, "low");
  let escalated = false;
  // Failed answers and big movers escalate as before; the newer triggers only with a free slot.
  const priority = parsed === null || isBigMover(view);
  let reasons: string[];
  if (parsed === null) reasons = ["the triage answer failed the checks"];
  else {
    const triaged = parsed.reading;
    const args = {
      input: { ...view, facts: withCode },
      crypto: asset.assetClass === "crypto",
      nowMs: readAt.getTime(),
      reading: { conviction: dailyRiskCheck(triaged, view, facts).conviction, levels: computeLevels(triaged.view, view.indicators?.["1d"], chart["1d"]) },
    };
    reasons = escalationTriggers({ ...args, market: {} });
    // The crisis check needs the Bitcoin and S&P 500 inputs (gathered from the start of the run):
    // only wait for them when nothing else fired and a slot is still free.
    if (!reasons.length && slotFree(run.slots, false)) reasons = escalationTriggers({ ...args, market: await run.marketInputs() });
  }
  if (reasons.length) {
    const why = reasons.join("; ");
    const worst = worstCaseCost({ model: RESEARCH_MODELS.dailyEscalation, system: DAILY_SYSTEM, user, maxTokens: ESCALATE_MAX_TOKENS });
    // The cheap first pass of every other asset not finished yet must still fit after this call.
    const othersTriage = Math.max(0, run.unfinished - 1) * worstCaseCost({ model: RESEARCH_MODELS.dailyTriage, system: DAILY_SYSTEM, user, maxTokens: TRIAGE_MAX_TOKENS });
    if (!takeSlot(run.slots, priority)) {
      problems.push(`${asset.assetId}: not escalated (${why}): the cap of ${run.maxEscalations} escalations per run is used${priority ? "" : " or kept for failed answers and big movers"}`);
    } else if (budget.headroom() < worst + othersTriage) {
      // The run budget stays a hard limit: skip this call rather than risk stopping the whole run.
      run.slots.left++;
      problems.push(`${asset.assetId}: not escalated (${why}): the run budget left does not cover the call`);
    } else {
      const second = await ask(RESEARCH_MODELS.dailyEscalation, "daily.escalation", ESCALATE_MAX_TOKENS, "medium");
      if (second) {
        parsed = second;
        escalated = true;
        problems.push(`${asset.assetId}: escalated to the stronger model (${why})`);
      }
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
  const check = dailyRiskCheck(reading, view, facts);
  const flagged = new Set(reading.injectionFactIds);
  const kept = facts.filter((f) => !flagged.has(f.id));
  const note: ResearchNote = {
    assetId: asset.assetId,
    date,
    generatedAt: now,
    dataAsOf: newest(kept, view, now),
    status: "ok",
    summary: reading.summary,
    view: reading.view,
    conviction: check.conviction,
    levels: computeLevels(reading.view, view.indicators?.["1d"], chart["1d"]),
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
    recordOutputs: (calls) => deps.store.recordOutputs(runId, calls),
    timeLimitMs: deps.timeLimitMs ?? RUN_TIME_LIMIT_MS,
  });
  const maxEscalations = deps.maxEscalations ?? 3;
  // One gather per asset in this run, shared with the crisis trigger (it needs the Bitcoin and S&P
  // 500 inputs), so no source is asked twice.
  const gathered = new Map<string, Promise<AssetResearchInput>>();
  const gatherOnce: GatherFn = (assetId, d) => {
    let p = gathered.get(assetId);
    if (!p) {
      p = deps.gather(assetId, d);
      p.catch(() => {});
      gathered.set(assetId, p);
    }
    return p;
  };
  const marketInput = async (assetId: string): Promise<AssetResearchInput | null> => {
    const a = assets.find((x) => x.assetId === assetId);
    if (!a || !marketOpen(a, date)) return null;
    try {
      const input = await gatherOnce(assetId, date);
      return input && input.assetId === assetId && marketOpen(a, date, input) ? input : null;
    } catch {
      return null;
    }
  };
  let crisisInputs: Promise<{ btc: AssetResearchInput | null; spx: AssetResearchInput | null }> | null = null;
  const run: RunCtx = {
    gather: gatherOnce,
    marketInputs: () =>
      (crisisInputs ??= Promise.all([marketInput(ESCALATION_TRIGGERS.btcAssetId), marketInput(ESCALATION_TRIGGERS.spxAssetId)]).then(([btc, spx]) => ({ btc, spx }))),
    slots: escalationSlots(maxEscalations),
    maxEscalations,
    unfinished: assets.length,
  };

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
    problems = [...problems, ...callErrors(budget.calls)];
    if (status === "aborted-cost") await (deps.alert ?? defaultAlert)(`daily run ${runId} stopped by the cost guard: ${problems[0] ?? ""}`);
    else if (status === "failed") await (deps.alert ?? defaultAlert)(`daily run ${runId} ${status}: ${[...problems, ...callErrors(budget.calls)].slice(0, 3).join(" | ")}`);
    const inputs = results.map((r) => r.input ?? null);
    const dataHash = results.some((r) => r.input) ? hashInputs(inputs) : null;
    const detail = [`${status}: ${counts.ok} ok, ${counts.carried} carried, ${counts.noReading} no reading, ${counts.escalated} escalated, ${counts.calls} model calls`, ...problems].join("\n");
    await budget.drain();
    await deps.store.finishRun(runId, { status, costUsd: budget.spent, detail, dataHash, inputs: dataHash ? inputs : null, outputs: budget.calls });
    return { runId, kind: "daily", date, status, written, costUsd: budget.spent, counts, problems };
  };

  if (spentToday === null) return finish("aborted-cost", [], ["cost guard: today's spend could not be read, so the run is blocked"], false);
  if (!(budget.cap > 0)) return finish("aborted-cost", [], [`cost guard: the day cap $${deps.maxDayCostUsd} is already used (spent today $${spentToday.toFixed(2)})`], false);

  // Start the Bitcoin and S&P 500 gathers now (shared with their own assets), so the crisis check
  // rarely has to wait for them.
  void run.marketInputs();
  let results: AssetResult[];
  try {
    results = await pool(assets, deps.concurrency ?? 3, (a) => researchAsset(a, date, now, previous.get(a.assetId), deps, budget, run).finally(() => void run.unfinished--));
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
