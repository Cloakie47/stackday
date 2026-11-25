/**
 * SAMPLE DATA: daily notes for the reviewer page, used only when /api/research/snapshot is
 * missing or fails. Built from the sample weekly report so both stay consistent. No real prices:
 * the only prices are the testnet mock start prices. Every page that shows it carries a visible
 * "Sample data" label because `kind` is "sample".
 */
import type { DailyScore, ResearchNote, ResearchSnapshot, Scorecard } from "@/lib/research/types";
import { SAMPLE_WEEKLY, mockPrice } from "./sample-weekly";

export const SAMPLE_DATE = "2026-11-19";
export const SAMPLE_AT = "2026-11-19T22:35:00Z";

function note(i: number): ResearchNote {
  const s = SAMPLE_WEEKLY.assets[i];
  return {
    assetId: s.assetId,
    date: SAMPLE_DATE,
    generatedAt: SAMPLE_AT,
    dataAsOf: "2026-11-19T21:00:00Z",
    status: "ok",
    summary: `Sample daily note. ${s.view.reasons[0]?.text.replace(/^Sample: (.)/, (_, c: string) => c.toUpperCase()) ?? ""}`,
    view: s.view.view,
    conviction: s.view.conviction,
    levels: s.view.levels,
    reasons: s.view.reasons,
    risks: [{ text: "Sample risk written for the demo. Prices can fall.", factIds: ["px.1d.last"] }],
    facts: s.facts,
    chart: s.chart,
    model: { triage: "none (sample fixture)" },
    previousView: s.view.view,
  };
}

export const SAMPLE_SNAPSHOT: ResearchSnapshot = {
  kind: "sample",
  date: SAMPLE_DATE,
  generatedAt: SAMPLE_AT,
  runId: "sample-fixture",
  market: { ...SAMPLE_WEEKLY.market, date: SAMPLE_DATE },
  notes: SAMPLE_WEEKLY.assets.map((_, i) => note(i)),
};

const DAYS = ["2026-11-19", "2026-11-18", "2026-11-17", "2026-11-16", "2026-11-13", "2026-11-12"];

/** Sample automatic scores for one asset: demo numbers with wrong calls included. */
export function sampleScores(assetId: string): { scores: DailyScore[]; calibration: Scorecard["calibration"] } {
  const s = SAMPLE_WEEKLY.assets.find((a) => a.assetId === assetId);
  const p = mockPrice(assetId) ?? 100;
  if (!s) return { scores: [], calibration: [] };
  const scores: DailyScore[] = DAYS.map((date, i) => ({
    assetId,
    date,
    view: s.view.view,
    conviction: s.view.conviction,
    priceAtNote: p,
    change1d: i === 0 ? undefined : [0.004, -0.011, 0.007, -0.002, 0.013][i - 1],
    change5d: i < 5 ? undefined : -0.018,
    direction1d: i === 0 ? undefined : i % 3 !== 2,
    direction5d: i < 5 ? undefined : false,
    levelsHeld: i < 5 ? undefined : true,
    factsShare: i === 3 ? 0.9 : 1,
    humanGrade: i === 1 ? 4 : i === 4 ? 3 : undefined,
  }));
  return { scores, calibration: SAMPLE_WEEKLY.scorecard?.calibration ?? [] };
}
