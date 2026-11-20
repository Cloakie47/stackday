import type { Confidence, DailyScore, IsoDate, ResearchNote, Scorecard, ScorecardRow, View, WeeklyReport, WeeklyAssetSection } from "../types.ts";
import type { StoredWeekly } from "./store.ts";

/**
 * Track record and quality bar (founder spec section 7), all computed in code from our own notes:
 * - each daily note is scored after 1 and 5 trading days (later fresh notes of the same asset):
 *   direction, whether the nearest support and resistance held, and the facts share;
 * - calibration: for each conviction level, how often the 5 day direction was right;
 * - the weekly scorecard: every view of last week's report and what happened since;
 * - the quality bar: four Mondays in a row with every claim sourced, no corrections, an average
 *   human grade of 4 or more and calibration not clearly off. Until then the report stays "beta".
 * Wrong calls are always kept and shown.
 */

const CONVICTIONS: Confidence[] = ["low", "medium", "high"];

const factNumber = (facts: { id: string; value: string | number }[], id: string): number | null => {
  const f = facts.find((x) => x.id === id);
  return f && typeof f.value === "number" && Number.isFinite(f.value) && f.value > 0 ? f.value : null;
};

/** Close on the note's date: the code fact "px.1d.last" (or "px.last" from older notes). */
export function notePrice(n: { facts: { id: string; value: string | number }[] }): number | null {
  return factNumber(n.facts, "px.1d.last") ?? factNumber(n.facts, "px.last");
}

export const noteAtrPct = (n: { facts: { id: string; value: string | number }[] }, price: number): number | null => {
  const atr = factNumber(n.facts, "ind.1d.atr14");
  return atr && price > 0 ? atr / price : null;
};

/**
 * Width of the Hold band in daily ATRs, scaled by the square root of the days. A backtest on
 * 2023 to 2026 prices found that a full ATR let "always Hold" score 84% right, which would make
 * a Hold-heavy agent look skilled. Half an ATR puts a Hold at roughly a coin flip, like a
 * directional call (daily close-to-close moves are about 0.8 ATR).
 */
export const HOLD_BAND_ATR = 0.5;

/**
 * Did price move the way the view implied over `days` trading days? Accumulate: up. Reduce and
 * avoid new buys: down. Hold: within HOLD_BAND_ATR daily ATRs scaled by the square root of the
 * days (a random walk band), or the same share of a 2% move when the ATR is unknown.
 */
export function directionRight(view: View, change: number, atrPct: number | null, days: number): boolean {
  if (view === "accumulate") return change > 0;
  if (view === "reduce" || view === "avoid-new-buys") return change < 0;
  const band = HOLD_BAND_ATR * (atrPct ?? 0.02) * Math.sqrt(days);
  return Math.abs(change) <= band;
}

export const isDirectional = (view: View) => view !== "hold";

/**
 * Levels closer than this many daily ATRs to price are skipped when scoring: price crosses a line
 * that close about as often as not, so "broke" would say nothing about the level. The backtest
 * found the nearest daily levels sit about 0.5 ATR from price.
 */
export const LEVEL_MIN_DISTANCE_ATR = 1;

/**
 * The levels a view relies on, skipping any closer than LEVEL_MIN_DISTANCE_ATR: Accumulate relies
 * on support, Reduce and Avoid new buys on resistance, Hold on both (a range). Null when none
 * qualifies.
 */
export function levelsToScore(view: View, levels: { support: number[]; resistance: number[] }, price: number, atrPct: number | null): { support?: number; resistance?: number } | null {
  const minGap = LEVEL_MIN_DISTANCE_ATR * (atrPct ?? 0.02) * price;
  const support = view === "reduce" || view === "avoid-new-buys" ? undefined : levels.support.find((l) => price - l >= minGap);
  const resistance = view === "accumulate" ? undefined : levels.resistance.find((l) => l - price >= minGap);
  return support === undefined && resistance === undefined ? null : { support, resistance };
}

/** First automatic score of a fresh note, written with the note itself. */
export function initialScore(n: ResearchNote, factsShare: number): DailyScore | null {
  const price = notePrice(n);
  if (n.status !== "ok" || price === null) return null;
  return { assetId: n.assetId, date: n.date, view: n.view, conviction: n.conviction, priceAtNote: price, factsShare: Math.round(factsShare * 1000) / 1000 };
}

/**
 * Fills in the 1 day and 5 day results for scores that are still open. `notes` must hold the
 * scored notes and every later note of the same assets. Returns only rows that changed.
 */
export function updateScores(scores: DailyScore[], notes: ResearchNote[]): DailyScore[] {
  const byAsset = new Map<string, ResearchNote[]>();
  for (const n of notes) {
    if (n.status !== "ok" || notePrice(n) === null) continue;
    const list = byAsset.get(n.assetId) ?? [];
    list.push(n);
    byAsset.set(n.assetId, list);
  }
  for (const list of byAsset.values()) list.sort((a, b) => a.date.localeCompare(b.date));

  const changed: DailyScore[] = [];
  for (const s of scores) {
    if (s.change5d !== undefined && s.levelsHeld !== undefined) continue;
    const list = byAsset.get(s.assetId) ?? [];
    const own = list.find((n) => n.date === s.date);
    const later = list.filter((n) => n.date > s.date);
    const atrPct = own ? noteAtrPct(own, s.priceAtNote) : null;
    const next: DailyScore = { ...s };
    if (later[0] && s.change1d === undefined) {
      next.change1d = round4(notePrice(later[0])! / s.priceAtNote - 1);
      next.direction1d = directionRight(s.view, next.change1d, atrPct, 1);
    }
    if (later[4] && s.change5d === undefined) {
      next.change5d = round4(notePrice(later[4])! / s.priceAtNote - 1);
      next.direction5d = directionRight(s.view, next.change5d, atrPct, 5);
    }
    if (later.length >= 5 && s.levelsHeld === undefined && own?.levels) {
      const lv = levelsToScore(s.view, own.levels, s.priceAtNote, atrPct);
      if (lv) {
        const closes = later.slice(0, 5).map((n) => notePrice(n)!);
        next.levelsHeld = closes.every((c) => (lv.support === undefined || c >= lv.support) && (lv.resistance === undefined || c <= lv.resistance));
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(s)) changed.push(next);
  }
  return changed;
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/**
 * For each conviction: how many directional 5 day calls (Accumulate, Reduce, Avoid new buys) were
 * scored and how many were right. Holds are left out so leaning on Hold cannot make a conviction
 * level look calibrated; they still show in each note's own score.
 */
export function calibration(scores: DailyScore[]): Scorecard["calibration"] {
  return CONVICTIONS.map((conviction) => {
    const scored = scores.filter((s) => s.conviction === conviction && isDirectional(s.view) && s.direction5d !== undefined);
    return { conviction, calls: scored.length, right: scored.filter((s) => s.direction5d).length };
  });
}

/** Hit rate each conviction level should roughly reach, and how far off counts as "clearly off". */
export const CALIBRATION_TARGET: Record<Confidence, number> = { low: 0.45, medium: 0.6, high: 0.75 };
export const CALIBRATION_TOLERANCE = 0.2;
export const CALIBRATION_MIN_CALLS = 10;

export function calibrationClearlyOff(cal: Scorecard["calibration"]): boolean {
  return cal.some((c) => c.calls >= CALIBRATION_MIN_CALLS && Math.abs(c.right / c.calls - CALIBRATION_TARGET[c.conviction]) > CALIBRATION_TOLERANCE);
}

function scoreSection(a: WeeklyAssetSection, later: ResearchNote[]): ScorecardRow {
  const priceAtCall = notePrice(a) ?? 0;
  const prices = later.filter((n) => n.assetId === a.assetId && n.status === "ok").map((n) => notePrice(n)).filter((p): p is number => p !== null);
  const base = { assetId: a.assetId, view: a.view.view, conviction: a.view.conviction, priceAtCall };
  if (!priceAtCall || prices.length === 0) return { ...base, priceAfter: null, change: null, invalidated: false, result: "no-data", why: "No price after the call yet." };
  const priceAfter = prices.at(-1)!;
  const change = round4(priceAfter / priceAtCall - 1);
  const inv = a.view.levels?.invalidation;
  const cautious = a.view.view === "reduce" || a.view.view === "avoid-new-buys";
  const invalidated = inv !== undefined && prices.some((p) => (cautious ? p > inv : p < inv));
  const atrPct = noteAtrPct(a, priceAtCall);
  const pct = `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%`;
  if (invalidated) return { ...base, priceAfter, change, invalidated, result: "wrong", why: `Price crossed the invalidation level ${inv}; moved ${pct}.` };
  const right = directionRight(a.view.view, change, atrPct, prices.length);
  const small = a.view.view !== "hold" && Math.abs(change) < 0.25 * (atrPct ?? 0.02);
  const result: ScorecardRow["result"] = small ? "mixed" : right ? "right" : "wrong";
  return { ...base, priceAfter, change, invalidated, result, why: `Moved ${pct} over ${prices.length} trading days${small ? ", too small to call" : ""}.` };
}

/** Last week's views against the daily closes since that report. */
export function weeklyScorecard(previous: WeeklyReport | null, later: ResearchNote[], scores: DailyScore[]): Scorecard | null {
  if (!previous || previous.kind !== "live") return null;
  const rows = previous.assets.filter((a) => a.status === "ok").map((a) => scoreSection(a, later.filter((n) => n.date >= previous.weekOf)));
  return { weekOf: previous.weekOf, rows, calibration: calibration(scores) };
}

const addDays = (date: IsoDate, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export type QualityWeek = { weekOf: IsoDate; ok: boolean; why: string[] };

/**
 * The quality bar for one report: every claim sourced and nothing corrected (the risk reviewer
 * removed no claim and sent nothing back), an average human grade of 4 or more on the notes of its
 * week, and calibration not clearly off. `met` needs four Mondays in a row.
 */
export function qualityBar(previous: StoredWeekly[], scores: DailyScore[]): { met: boolean; weeks: QualityWeek[] } {
  const weeks = previous.slice(0, 4).map(({ report }): QualityWeek => {
    const why: string[] = [];
    if (report.kind !== "live") why.push("not a live report");
    if (report.review.removedClaims > 0) why.push(`${report.review.removedClaims} claims removed`);
    if (report.review.sentBack > 0) why.push(`${report.review.sentBack} sections corrected`);
    const end = addDays(report.weekOf, 6);
    const graded = scores.filter((s) => s.date >= report.weekOf && s.date <= end && typeof s.humanGrade === "number");
    const avg = graded.length ? graded.reduce((t, s) => t + s.humanGrade!, 0) / graded.length : 0;
    if (!graded.length) why.push("no human grades");
    else if (avg < 4) why.push(`human grade ${avg.toFixed(1)} below 4`);
    const cal = calibration(scores.filter((s) => s.date <= end));
    const directional = cal.reduce((t, c) => t + c.calls, 0);
    if (directional < CALIBRATION_MIN_CALLS) why.push(`only ${directional} scored directional calls, too few to judge calibration`);
    else if (calibrationClearlyOff(cal)) why.push("calibration clearly off");
    return { weekOf: report.weekOf, ok: why.length === 0, why };
  });
  const consecutive = weeks.length === 4 && weeks.every((w, i) => w.ok && (i === 0 || addDays(w.weekOf, 7) === weeks[i - 1].weekOf));
  return { met: consecutive, weeks };
}
