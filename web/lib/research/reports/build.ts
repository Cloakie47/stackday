import type {
  Fact,
  Outlook,
  PortfolioAnalysis,
  PortfolioInput,
  Reasoned,
  Report,
  ReportPeriod,
  ReportScope,
  ResearchNote,
  ResearchSnapshot,
  Timeframe,
} from "../types.ts";
import { RESEARCH_DISCLAIMER, TIMEFRAMES } from "../types.ts";
import { universeAsset } from "../universe.ts";
import { analyzePortfolio, lastPrice, type PortfolioAnalysisResult } from "../portfolio/analyze.ts";

/**
 * Report builder (docs/research/PLAN.md, "Reports on demand and on a schedule"). Pure: the route
 * passes in the snapshot, the person's portfolio, the previous report of the same period, an id
 * and the time, so the same inputs always give the same report.
 *
 * Depth:
 * - premium: every note in full (all six timeframes) and the full portfolio analysis.
 * - free: summary depth. Each note keeps its summary, action, levels, the outlook for the report's
 *   own timeframe plus the daily one, two reasons, one opportunity and one risk; the other
 *   outlooks say they are in premium reports. The portfolio keeps totals, allocation,
 *   concentration, overlap and the health score, without per-holding verdicts.
 *
 * Fact ids in `changes` use the form "<assetId>:<factId>", meaning fact <factId> in that asset's
 * note in this report (the same convention as the portfolio analysis).
 */

export type BuildReportInput = {
  id: string;
  createdAt: string;
  scope: ReportScope;
  period: ReportPeriod;
  /** Lowercase wallet, or null for the public market report. */
  owner: string | null;
  premium: boolean;
  snapshot: ResearchSnapshot;
  /** Required for scope "asset". */
  assetId?: string;
  /** Required for scopes "portfolio" and "full". */
  portfolio?: PortfolioInput;
  /** The person's previous report of the same period, for "what changed". */
  previous?: Report | null;
};

/** Timeframe that matches each period, kept in free reports. */
export const PERIOD_TIMEFRAME: Record<ReportPeriod, Timeframe> = { daily: "1d", weekly: "1w", monthly: "1m", "on-demand": "1d" };
export const PREMIUM_ONLY_TEXT = "Available in premium reports.";

const PERIOD_LABEL: Record<ReportPeriod, string> = { daily: "daily", weekly: "weekly", monthly: "monthly", "on-demand": "on-demand" };
const ACTION_LABEL = { buy: "Buy", hold: "Hold", sell: "Sell", watch: "Watch" } as const;
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(Math.round(x * 1000) / 10).toFixed(1)}%`;
const money = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export class ReportInputError extends Error {}

/** Facts a list of reasoned items cites, in note order. */
function citedFacts(facts: Fact[], items: Reasoned[], always: string[] = []): Fact[] {
  const ids = new Set([...always, ...items.flatMap((r) => r.factIds)]);
  return facts.filter((f) => ids.has(f.id));
}

/** A note cut down to summary depth for free reports. */
export function summarizeNote(note: ResearchNote, period: ReportPeriod): ResearchNote {
  const keep = new Set<Timeframe>(["1d", PERIOD_TIMEFRAME[period]]);
  const outlook = Object.fromEntries(
    TIMEFRAMES.map((tf): [Timeframe, Outlook] => [tf, keep.has(tf) ? note.outlook[tf] : { text: PREMIUM_ONLY_TEXT, factIds: [], stance: "no-view" }]),
  ) as Record<Timeframe, Outlook>;
  const reasons = note.reasons.slice(0, 2);
  const opportunities = note.opportunities.slice(0, 1);
  const risks = note.risks.slice(0, 1);
  const hidden = { text: PREMIUM_ONLY_TEXT, factIds: [] };
  const scenarios = {
    bull: { ...hidden, likelihood: note.scenarios.bull.likelihood },
    base: note.scenarios.base,
    bear: { ...hidden, likelihood: note.scenarios.bear.likelihood },
  };
  const kept = [...reasons, ...opportunities, ...risks, scenarios.base, ...[...keep].map((tf) => note.outlook[tf])];
  return { ...note, outlook, reasons, opportunities, risks, scenarios, facts: citedFacts(note.facts, kept, ["px.last"]) };
}

/** A portfolio analysis cut down to summary depth for free reports. */
export function summarizePortfolio(a: PortfolioAnalysis): PortfolioAnalysis {
  const rebalanceIdeas = a.rebalanceIdeas.slice(0, 1);
  const kept = [...a.concentration, ...a.overlaps, ...rebalanceIdeas];
  // Spreading keeps `unpriced` when `a` is a PortfolioAnalysisResult.
  return { ...a, holdings: [], rebalanceIdeas, facts: citedFacts(a.facts, kept) };
}

function notesForScope(input: BuildReportInput, analysis: PortfolioAnalysisResult | undefined): ResearchNote[] {
  const all = input.snapshot.notes;
  switch (input.scope) {
    case "market":
    case "full":
      return all;
    case "asset": {
      const note = all.find((n) => n.assetId === input.assetId);
      return note ? [note] : [];
    }
    case "portfolio": {
      const held = new Set([...(analysis?.holdings.map((h) => h.assetId) ?? []), ...(analysis?.unpriced.map((u) => u.assetId) ?? [])]);
      return all.filter((n) => held.has(n.assetId));
    }
  }
}

/** What changed since the previous report of the same period. */
export function changesSince(
  previous: Report | null | undefined,
  current: { snapshotDate: string; notes: ResearchNote[]; portfolio?: PortfolioAnalysis; period: ReportPeriod },
): Reasoned[] {
  const label = PERIOD_LABEL[current.period];
  if (!previous) return [{ text: `This is your first ${label} report of this kind, so there is nothing to compare with yet.`, factIds: [] }];
  const since = `since your last ${label} report (research of ${previous.snapshotDate})`;
  if (previous.snapshotDate === current.snapshotDate) {
    return [{ text: `The research has not been updated ${since}: it is from the same day, so nothing has changed.`, factIds: [] }];
  }
  const out: Reasoned[] = [];
  const prevNotes = new Map(previous.notes.map((n) => [n.assetId, n]));
  for (const note of current.notes) {
    const name = universeAsset(note.assetId)?.name ?? note.assetId;
    const before = prevNotes.get(note.assetId);
    const pxNow = lastPrice(note);
    const priceIds = pxNow ? [`${note.assetId}:px.last`] : [];
    if (!before) continue;
    if (note.status === "no-reading" && before.status !== "no-reading") {
      out.push({ text: `${name} has no research reading today, so its suggestion is not shown.`, factIds: [] });
      continue;
    }
    if (before.action !== note.action && note.status !== "no-reading") {
      out.push({ text: `${name}: the suggested action changed from ${ACTION_LABEL[before.action]} to ${ACTION_LABEL[note.action]} ${since}.`, factIds: priceIds });
    }
    const pxBefore = lastPrice(before);
    if (pxNow && pxBefore) {
      const move = pxNow.price / pxBefore.price - 1;
      if (Math.abs(move) >= 0.05) {
        out.push({ text: `${name} moved ${pct(move)}, from ${money(pxBefore.price)} to ${money(pxNow.price)}, ${since}.`, factIds: priceIds });
      }
    }
  }
  if (current.portfolio && previous.portfolio) {
    const a = previous.portfolio;
    const b = current.portfolio;
    const ids = b.facts.filter((f) => f.id.endsWith(":px.last")).map((f) => f.id);
    if (a.health.score !== b.health.score) {
      out.push({ text: `Your portfolio health score went from ${a.health.score} to ${b.health.score} ${since}.`, factIds: ids });
    }
    if (a.totalUsd > 0 && b.totalUsd > 0 && Math.abs(b.totalUsd / a.totalUsd - 1) >= 0.01) {
      out.push({ text: `The value of your priced holdings went from ${money(a.totalUsd)} to ${money(b.totalUsd)} (${pct(b.totalUsd / a.totalUsd - 1)}) ${since}. This includes anything you added.`, factIds: ids });
    }
  }
  if (!out.length) out.push({ text: `No suggested action changed and no price moved 5% or more ${since}.`, factIds: [] });
  return out;
}

export function buildReport(input: BuildReportInput): Report {
  const { scope, period, snapshot, premium } = input;
  if (scope === "asset") {
    if (!input.assetId || !universeAsset(input.assetId)) throw new ReportInputError("Choose a Stackday asset for an asset report.");
  }
  const personal = scope === "portfolio" || scope === "full";
  if (personal && !input.portfolio) throw new ReportInputError("A portfolio report needs your holdings, horizon and risk answers.");

  const analysis = personal ? analyzePortfolio(input.portfolio!, snapshot) : undefined;
  const fullNotes = notesForScope(input, analysis);
  const notes = premium ? fullNotes : fullNotes.map((n) => summarizeNote(n, period));
  const portfolio = analysis ? (premium ? analysis : summarizePortfolio(analysis)) : undefined;

  const report: Report = {
    id: input.id,
    scope,
    period,
    owner: input.owner,
    createdAt: input.createdAt,
    snapshotDate: snapshot.date,
    premium,
    notes,
    changes: changesSince(input.previous, { snapshotDate: snapshot.date, notes: fullNotes, portfolio: analysis, period }),
    disclaimer: RESEARCH_DISCLAIMER,
  };
  if (scope === "market" || scope === "full") report.market = snapshot.market;
  if (portfolio) report.portfolio = portfolio;
  if (scope === "asset" && !fullNotes.length) {
    report.changes.unshift({ text: `There is no research note for ${universeAsset(input.assetId!)?.name ?? input.assetId} in today's snapshot.`, factIds: [] });
  }
  if (snapshot.kind === "sample") {
    report.changes.unshift({ text: "Built from the labelled sample snapshot, not live research.", factIds: [] });
  }
  return report;
}
