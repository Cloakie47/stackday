import type { AssetResearchInput, Confidence, Fact, IsoDate, Outlook, ResearchNote, ResearchSnapshot, Timeframe } from "../types.ts";
import { TIMEFRAMES } from "../types.ts";
import { UNIVERSE, type UniverseAsset } from "../universe.ts";
import { computeLevels } from "./levels.ts";
import { buildMarketOverview } from "./market.ts";
import { MODELS, worstCaseCost, type ModelFn, type ModelTier } from "./model.ts";
import { parseReading, type Reading } from "./parse.ts";
import { READING_SCHEMA, SYSTEM_PROMPT, buildUserMessage, prepareFacts } from "./prompt.ts";
import type { ResearchStore } from "./store.ts";
import { snapshotProblems } from "./validate.ts";

/**
 * One daily research run (docs/research/PLAN.md):
 * 1. For every asset: market closed today -> carry the last note forward ("carried").
 *    Otherwise gather facts (data branch), ask the triage model, re-ask the escalation model for
 *    material cases, validate in code, compute levels in code.
 * 2. Founder failure policy: at most 2 assets may end as "no reading". More than that, a failed
 *    whole-run check, or the cost guard means the run writes nothing and the last good snapshot
 *    stays live.
 * 3. Cost guard: before each model call the worst case cost of that call is reserved; if the run
 *    would pass `maxRunCostUsd` it aborts and writes nothing.
 */

/** Gathers one asset's facts. The data branch's `gatherAsset` plugs in here. */
export type GatherFn = (assetId: string, date: IsoDate) => Promise<AssetResearchInput>;

export type RunDeps = {
  gather: GatherFn;
  model: ModelFn;
  store: ResearchStore;
  maxRunCostUsd: number;
  now?: () => Date;
  assets?: UniverseAsset[];
  /** Assets researched at the same time. */
  concurrency?: number;
  /** Most escalation calls in one run (keeps the expensive model rare). */
  maxEscalations?: number;
};

export type RunOutcome = {
  runId: string;
  date: IsoDate;
  status: "ok" | "failed" | "aborted-cost";
  written: boolean;
  costUsd: number;
  counts: { ok: number; carried: number; noReading: number; escalated: number };
  problems: string[];
};

export const MAX_NO_READINGS = 2;
export const TRIAGE_MAX_TOKENS = 4000;
export const ESCALATE_MAX_TOKENS = 8000;
/** A one-day move at least this large (in percent) counts as material. */
export const BIG_MOVE_PCT = { default: 4, crypto: 8 } as const;

class CostAbort extends Error {}

/** Tracks spend, including the worst case of calls still in flight. */
export function costBudget(max: number) {
  let spent = 0;
  let reserved = 0;
  return {
    get spent() {
      return spent;
    },
    reserve(worst: number) {
      if (!(max > 0) || spent + reserved + worst > max) throw new CostAbort(`cost guard: run would pass $${max}`);
      reserved += worst;
    },
    settle(worst: number, actual: number) {
      reserved -= worst;
      spent += actual;
    },
  };
}
type Budget = ReturnType<typeof costBudget>;

const isWeekend = (date: IsoDate) => {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

/** US stock assets research on weekdays only; crypto (and the gold token) every day. Holidays come from the data branch. */
export function marketOpen(asset: UniverseAsset, date: IsoDate, input?: AssetResearchInput): boolean {
  if (asset.calendar === "XNYS" && isWeekend(date)) return false;
  return input ? input.marketOpenToday : true;
}

function noView(): Record<Timeframe, Outlook> {
  const out = {} as Record<Timeframe, Outlook>;
  for (const t of TIMEFRAMES) out[t] = { text: "No view from the facts available.", factIds: [], stance: "no-view" };
  return out;
}

function noReadingNote(asset: UniverseAsset, date: IsoDate, now: string, summary: string, previous?: ResearchNote): ResearchNote {
  const empty = { text: "No reading today.", factIds: [], likelihood: "low" as const };
  return {
    assetId: asset.assetId,
    date,
    generatedAt: now,
    dataAsOf: now,
    status: "no-reading",
    summary,
    action: "watch",
    confidence: "low",
    levels: null,
    reasons: [],
    opportunities: [],
    risks: [],
    scenarios: { bull: empty, base: empty, bear: empty },
    outlook: noView(),
    facts: [],
    model: { triage: MODELS.triage },
    ...(previous && previous.status !== "no-reading" ? { previousAction: previous.action } : {}),
  };
}

function bigMove(asset: UniverseAsset, input: AssetResearchInput): boolean {
  const pct = input.indicators["1d"]?.changePct?.["1d"];
  if (typeof pct !== "number" || !Number.isFinite(pct)) return false;
  return Math.abs(pct) >= (asset.assetClass === "crypto" ? BIG_MOVE_PCT.crypto : BIG_MOVE_PCT.default);
}

/** Material cases get a second read by the escalation model. */
export function needsEscalation(reading: Reading | null, asset: UniverseAsset, input: AssetResearchInput, previous?: ResearchNote): boolean {
  if (!reading) return true; // triage answer failed the checks: one retry on the stronger model
  if (reading.materialEvent) return true;
  if (previous && previous.status !== "no-reading" && previous.action !== reading.action) return true;
  return bigMove(asset, input);
}

const CONF_ORDER: Confidence[] = ["low", "medium", "high"];
const capConfidence = (c: Confidence, cap: Confidence) => (CONF_ORDER.indexOf(c) > CONF_ORDER.indexOf(cap) ? cap : c);

function newest(facts: Fact[], input: AssetResearchInput, fallback: string): string {
  const times = [...facts.map((f) => f.asOf), ...Object.values(input.series).map((s) => s?.fetchedAt)]
    .filter((t): t is string => typeof t === "string" && Number.isFinite(Date.parse(t)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return times.at(-1) ?? fallback;
}

type AssetResult = { note: ResearchNote; failed: boolean; escalated: boolean; problem?: string };

async function ask(tier: ModelTier, user: string, facts: Fact[], context: string, deps: RunDeps, budget: Budget): Promise<Reading | null> {
  const maxTokens = tier === "triage" ? TRIAGE_MAX_TOKENS : ESCALATE_MAX_TOKENS;
  const worst = worstCaseCost(tier, Math.ceil((SYSTEM_PROMPT.length + user.length + 4000) / 3), maxTokens);
  budget.reserve(worst);
  let actual = worst;
  try {
    const res = await deps.model({ tier, system: SYSTEM_PROMPT, user, schema: READING_SCHEMA, maxTokens });
    actual = res.costUsd;
    return parseReading(res.text, facts, context);
  } catch (e) {
    if (e instanceof CostAbort) throw e;
    return null;
  } finally {
    budget.settle(worst, actual);
  }
}

async function researchAsset(
  asset: UniverseAsset,
  date: IsoDate,
  now: string,
  previous: ResearchNote | undefined,
  deps: RunDeps,
  budget: Budget,
  escalations: { left: number },
): Promise<AssetResult> {
  const carry = (): AssetResult =>
    previous
      ? { note: { ...previous, status: previous.status === "no-reading" ? "no-reading" : "carried", date, generatedAt: now, previousAction: previous.action }, failed: false, escalated: false }
      : { note: noReadingNote(asset, date, now, "Market closed today and there is no earlier note to carry forward."), failed: false, escalated: false };

  if (!marketOpen(asset, date)) return carry();

  let input: AssetResearchInput;
  try {
    input = await deps.gather(asset.assetId, date);
    if (!input || input.assetId !== asset.assetId) throw new Error("gather returned another asset");
  } catch (e) {
    const problem = `${asset.assetId}: data failed (${e instanceof Error ? e.message.slice(0, 120) : "unknown"})`;
    return { note: noReadingNote(asset, date, now, "No reading today: market data could not be loaded, so nothing is shown instead of a guess.", previous), failed: true, escalated: false, problem };
  }
  if (!marketOpen(asset, date, input)) return carry();

  const { facts } = prepareFacts(input.facts ?? []);
  const context = `${asset.name} ${asset.note ?? ""}`;
  const daily = input.indicators["1d"];
  const prevAction = previous && previous.status !== "no-reading" ? previous.action : undefined;
  const user = buildUserMessage({ asset, input, facts, levels: computeLevels(asset, daily, "buy"), previousAction: prevAction });

  let reading = await ask("triage", user, facts, context, deps, budget);
  let escalated = false;
  if (needsEscalation(reading, asset, input, previous) && escalations.left > 0) {
    escalations.left--;
    const second = await ask("escalate", user, facts, context, deps, budget);
    if (second) {
      reading = second;
      escalated = true;
    }
  }
  if (!reading) {
    return { note: noReadingNote(asset, date, now, "No reading today: the analysis did not pass our checks, so nothing is shown instead of a guess.", previous), failed: true, escalated: false, problem: `${asset.assetId}: model answer failed the checks` };
  }

  const flagged = new Set(reading.injectionFactIds);
  const kept = facts.filter((f) => !flagged.has(f.id));
  const trustedCount = kept.filter((f) => f.kind !== "news" && f.kind !== "filing").length;
  const confidence = trustedCount < 3 ? capConfidence(reading.confidence, "low") : reading.confidence;

  const note: ResearchNote = {
    assetId: asset.assetId,
    date,
    generatedAt: now,
    dataAsOf: newest(kept, input, now),
    status: "ok",
    summary: reading.summary,
    action: reading.action,
    confidence,
    levels: computeLevels(asset, daily, reading.action),
    reasons: reading.reasons,
    opportunities: reading.opportunities,
    risks: reading.risks,
    scenarios: reading.scenarios,
    outlook: reading.outlook,
    facts: kept,
    model: escalated ? { triage: MODELS.triage, escalated: MODELS.escalate } : { triage: MODELS.triage },
    ...(prevAction ? { previousAction: prevAction } : {}),
  };
  return { note, failed: false, escalated };
}

/** Runs `fn` over items, `size` at a time. After the first error no new item starts; the error is rethrown. */
async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let firstError: unknown;
  const worker = async () => {
    while (next < items.length && firstError === undefined) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (e) {
        firstError ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, size) }, worker));
  if (firstError !== undefined) throw firstError;
  return out;
}

export async function runResearch(deps: RunDeps): Promise<RunOutcome> {
  const nowDate = (deps.now ?? (() => new Date()))();
  const now = nowDate.toISOString();
  const date = now.slice(0, 10);
  const runId = `${date}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const assets = deps.assets ?? UNIVERSE;
  const budget = costBudget(deps.maxRunCostUsd);
  const escalations = { left: deps.maxEscalations ?? 5 };

  await deps.store.startRun(runId, date);
  const last = await deps.store.latestSnapshot().catch(() => null);
  const previous = new Map((last?.notes ?? []).map((n) => [n.assetId, n]));

  const finish = async (status: RunOutcome["status"], results: AssetResult[], problems: string[], written: boolean): Promise<RunOutcome> => {
    const counts = {
      ok: results.filter((r) => r.note.status === "ok").length,
      carried: results.filter((r) => r.note.status === "carried").length,
      noReading: results.filter((r) => r.note.status === "no-reading").length,
      escalated: results.filter((r) => r.escalated).length,
    };
    const detail = [`${status}: ${counts.ok} ok, ${counts.carried} carried, ${counts.noReading} no reading, ${counts.escalated} escalated`, ...problems].join("\n");
    await deps.store.finishRun(runId, status, budget.spent, detail);
    return { runId, date, status, written, costUsd: budget.spent, counts, problems };
  };

  let results: AssetResult[];
  try {
    results = await pool(assets, deps.concurrency ?? 4, (a) => researchAsset(a, date, now, previous.get(a.assetId), deps, budget, escalations));
  } catch (e) {
    if (e instanceof CostAbort) return finish("aborted-cost", [], [e.message], false);
    return finish("failed", [], [`run error: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`], false);
  }

  const problems = results.flatMap((r) => (r.problem ? [r.problem] : []));
  const failures = results.filter((r) => r.failed).length;
  if (failures > MAX_NO_READINGS) {
    return finish("failed", results, [`${failures} assets had no reading (limit ${MAX_NO_READINGS}): nothing written, last good snapshot stays live`, ...problems], false);
  }

  const notes = results.map((r) => r.note);
  const market = buildMarketOverview(date, notes);
  const snapshot: ResearchSnapshot = { kind: "live", date, generatedAt: now, runId, market, notes, costUsd: budget.spent };
  const shape = snapshotProblems(snapshot);
  if (notes.length !== assets.length) shape.push(`expected ${assets.length} notes, got ${notes.length}`);
  if (shape.length) return finish("failed", results, ["whole-run check failed: nothing written", ...shape.slice(0, 20), ...problems], false);

  try {
    await deps.store.writeSnapshot(runId, date, notes, market);
  } catch (e) {
    return finish("failed", results, [`write failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`, ...problems], false);
  }
  return finish("ok", results, problems, true);
}
