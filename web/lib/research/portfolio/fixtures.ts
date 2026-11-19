import type { Action, Confidence, Fact, NoteStatus, Outlook, ResearchNote, ResearchSnapshot, Stance } from "../types.ts";
import { TIMEFRAMES } from "../types.ts";

/**
 * TEST FIXTURES ONLY. Round made-up numbers so tests can check the arithmetic; they are not
 * market prices and are never shown in the app. Every fact says "Test fixture" as its source.
 */

const SOURCE = { name: "Test fixture (not market data)" };
export const FIXTURE_TIME = "2026-11-19T21:00:00Z";

export type NoteSpec = {
  assetId: string;
  /** Omit for a note without a price fact. */
  price?: number;
  action?: Action;
  confidence?: Confidence;
  status?: NoteStatus;
  /** Stance for every timeframe, or per timeframe. */
  stance?: Stance | Partial<Record<(typeof TIMEFRAMES)[number], Stance>>;
  previousAction?: Action;
};

export function makeNote(s: NoteSpec, date = "2026-11-19"): ResearchNote {
  const facts: Fact[] = [];
  if (s.price !== undefined) facts.push({ id: "px.last", kind: "price", label: "Last price", value: s.price, unit: "USD", source: SOURCE, asOf: FIXTURE_TIME });
  facts.push({ id: "ind.rsi14", kind: "indicator", label: "RSI 14", value: 50, source: SOURCE, asOf: FIXTURE_TIME });
  const stanceFor = (tf: (typeof TIMEFRAMES)[number]): Stance => (typeof s.stance === "string" ? s.stance : (s.stance?.[tf] ?? "neutral"));
  const outlook = Object.fromEntries(TIMEFRAMES.map((tf) => [tf, { text: `Fixture outlook ${tf}`, factIds: ["ind.rsi14"], stance: stanceFor(tf) } satisfies Outlook])) as ResearchNote["outlook"];
  const r = { text: "Fixture reason", factIds: ["ind.rsi14"] };
  return {
    assetId: s.assetId,
    date,
    generatedAt: FIXTURE_TIME,
    dataAsOf: FIXTURE_TIME,
    status: s.status ?? "ok",
    summary: `Fixture note for ${s.assetId}.`,
    action: s.action ?? "hold",
    confidence: s.confidence ?? "medium",
    levels: null,
    reasons: [r],
    opportunities: [r],
    risks: [r],
    scenarios: { bull: { ...r, likelihood: "low" }, base: { ...r, likelihood: "medium" }, bear: { ...r, likelihood: "low" } },
    outlook,
    facts,
    model: { triage: "fixture" },
    ...(s.previousAction ? { previousAction: s.previousAction } : {}),
  };
}

export function makeSnapshot(notes: NoteSpec[], opts: { date?: string; runId?: string } = {}): ResearchSnapshot {
  const date = opts.date ?? "2026-11-19";
  return {
    kind: "sample",
    date,
    generatedAt: FIXTURE_TIME,
    runId: opts.runId ?? `fixture-${date}`,
    market: { date, summary: "Fixture market summary.", developments: [{ text: "Fixture development", factIds: ["mkt.1"] }], facts: [{ id: "mkt.1", kind: "macro", label: "Fixture", value: 1, source: SOURCE, asOf: FIXTURE_TIME }] },
    notes: notes.map((n) => makeNote(n, date)),
  };
}
