import type { Action, IsoDate, ResearchNote } from "../types.ts";

/**
 * The public suggestion log for one asset: how each past suggestion turned out, next to plain
 * weekly buying. It is a record, not a performance claim: the sample is small, and docs/07 found
 * no evidence that a weekly signal beats plain weekly buying.
 *
 * Prices come from each note: the "px.last" fact (numeric) when present, else the code-computed
 * entry level. Notes without a price (SpaceX, no-reading days) are listed without an outcome.
 */

export const OUTCOME_DAYS = 7;

export type SuggestionOutcome = {
  date: IsoDate;
  action: Action;
  status: ResearchNote["status"];
  confidence: ResearchNote["confidence"];
  price: number | null;
  /** Price change in percent from this note to the first note at least 7 days later (or the newest note). */
  changePct: number | null;
  /** buy right if price rose, sell right if it fell; hold and watch are not scored. */
  verdict: "right" | "wrong" | "not-scored" | "too-early";
};

export type StrategyResult = { investedUsd: number; valueUsd: number; returnPct: number; buys: number };

export type TrackRecord = {
  assetId: string;
  outcomes: SuggestionOutcome[];
  scored: { right: number; wrong: number };
  /** Same weekly budget: one buy each week at that week's first note. */
  plainWeekly: StrategyResult | null;
  /** Same weekly budget, but the week's money stays in cash when the suggestion that day was sell or watch. */
  followSuggestions: StrategyResult | null;
  note: string;
};

const DAY = 86_400_000;
const WEEKLY_USD = 100;

export function notePrice(n: ResearchNote): number | null {
  const fact = n.facts.find((f) => f.id === "px.last");
  if (fact && typeof fact.value === "number" && Number.isFinite(fact.value) && fact.value > 0) return fact.value;
  if (n.levels && n.levels.entry > 0) return n.levels.entry;
  return null;
}

const isoWeek = (date: IsoDate) => Math.floor((Date.parse(`${date}T00:00:00Z`) / DAY + 3) / 7); // weeks since a Thursday-aligned epoch

function strategy(points: { date: IsoDate; price: number; action: Action }[], last: number, follow: boolean): StrategyResult | null {
  const seenWeeks = new Set<number>();
  let invested = 0;
  let units = 0;
  let cash = 0;
  let buys = 0;
  for (const p of points) {
    const w = isoWeek(p.date);
    if (seenWeeks.has(w)) continue;
    seenWeeks.add(w);
    invested += WEEKLY_USD;
    if (follow && (p.action === "sell" || p.action === "watch")) cash += WEEKLY_USD;
    else {
      units += WEEKLY_USD / p.price;
      buys++;
    }
  }
  if (invested === 0) return null;
  const value = units * last + cash;
  return { investedUsd: invested, valueUsd: Math.round(value * 100) / 100, returnPct: Math.round(((value - invested) / invested) * 10_000) / 100, buys };
}

/** `notes` oldest first, for one asset. */
export function trackRecord(assetId: string, notes: ResearchNote[]): TrackRecord {
  const sorted = [...notes].filter((n) => n.assetId === assetId).sort((a, b) => a.date.localeCompare(b.date));
  // A carried note repeats an earlier suggestion; only fresh notes count as suggestions.
  const fresh = sorted.filter((n) => n.status === "ok");
  const priced = sorted.map((n) => ({ n, price: notePrice(n) })).filter((x): x is { n: ResearchNote; price: number } => x.price !== null);
  const newest = priced.at(-1);

  const outcomes: SuggestionOutcome[] = fresh.map((n) => {
    const price = notePrice(n);
    const start = Date.parse(`${n.date}T00:00:00Z`);
    const later = priced.find((x) => Date.parse(`${x.n.date}T00:00:00Z`) >= start + OUTCOME_DAYS * DAY);
    const end = later ?? (newest && newest.n.date > n.date ? newest : undefined);
    const changePct = price !== null && end ? Math.round(((end.price - price) / price) * 10_000) / 100 : null;
    let verdict: SuggestionOutcome["verdict"] = "not-scored";
    if (n.action === "buy" || n.action === "sell") {
      if (changePct === null || !later) verdict = "too-early";
      else verdict = (n.action === "buy" ? changePct > 0 : changePct < 0) ? "right" : "wrong";
    }
    return { date: n.date, action: n.action, status: n.status, confidence: n.confidence, price, changePct, verdict };
  });

  const points = fresh.flatMap((n) => {
    const price = notePrice(n);
    return price === null ? [] : [{ date: n.date, price, action: n.action }];
  });
  const lastPrice = newest?.price;

  return {
    assetId,
    outcomes,
    scored: { right: outcomes.filter((o) => o.verdict === "right").length, wrong: outcomes.filter((o) => o.verdict === "wrong").length },
    plainWeekly: lastPrice ? strategy(points, lastPrice, false) : null,
    followSuggestions: lastPrice ? strategy(points, lastPrice, true) : null,
    note: `Each week $${WEEKLY_USD} of hypothetical money, priced at the underlying asset's close in our notes. A short record proves nothing either way; no claim is made that following suggestions beats plain weekly buying.`,
  };
}
