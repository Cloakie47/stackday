import type { Fact, FactKind, IsoDate, IsoDateTime } from "../types.ts";

/**
 * Nothing from the future (founder plan item 6): a report graded later must only rest on what was
 * known when it was written. Every run has a cut-off, the same one the data step already uses:
 * - the Monday weekly report (every slot, 12:00 to 21:00 UTC): 12:00 UTC on the run date;
 * - the daily note: its real run time on the run date (`dailyCutAt`, PR #82).
 * The data step cuts price bars at it (data/gather.ts `cutSeries`) and the news, filing and funding
 * fetchers filter by it. The engine checks every fact again before anything reaches a model
 * (`cutFacts`), drops what is too new and logs why.
 *
 * Which time counts depends on what the fact's `asOf` means (read from data/):
 * - news: `asOf` is the item's publishedAt; filings: the SEC acceptance time (or the filing date);
 *   macro: the observation date (the data step only keeps observations released by the cut-off).
 *   These must be at or before the cut-off.
 * - market readings (price, indicator, pattern, flow): bars are already cut by the data step, and
 *   their `asOf` is a bar close. A live run (run date is today) also reads current values, such as
 *   the on-chain feed and pool price or the stablecoin supply, stamped with the read time, which
 *   PR #82 allows on purpose ("uses the current price and pool facts as read"). So a live run
 *   keeps a reading up to the moment its data was read, never later; a run for an earlier date
 *   keeps readings up to the cut-off only.
 * - calendar: never dropped by `asOf`. Its `asOf` is either the time we read the calendar or, for
 *   the week-ahead events, the event's own date (next week, by design). Neither is when the
 *   schedule was published, and the official calendars publish their dates well in advance. Never
 *   dropping by event date keeps the Week ahead calendar.
 */

/** The weekly cut time on the run date. Same value as RUN_TIME_UTC in data/gather.ts (cutoff.test.ts checks). */
export const WEEKLY_CUT_UTC = "12:00:00";

/** The daily note's cut time: its real run time when the run date is today, otherwise none (12:00 UTC). */
export function dailyCutAt(date: IsoDate, now: Date = new Date()): string | undefined {
  return date === now.toISOString().slice(0, 10) ? now.toISOString() : undefined;
}

/** 12:00 UTC on the run date, never later than `now` (data/gather.ts `runCutoff` without `cutAt`). */
export function noonCutoff(date: IsoDate, now: Date): number {
  return Math.min(Date.parse(`${date}T${WEEKLY_CUT_UTC}Z`), now.getTime());
}

/** The daily note's cut-off in ms: `dailyCutAt`, or 12:00 UTC for a run date that is not today. */
export function dailyCutoff(date: IsoDate, now: Date): number {
  const at = dailyCutAt(date, now);
  return at ? Date.parse(at) : noonCutoff(date, now);
}

/** Fact kinds whose `asOf` is when the source published or observed them. */
const PUBLISHED: ReadonlySet<FactKind> = new Set(["news", "filing", "macro", "fundamental"]);

export type CutDrop = { id: string; kind: FactKind; asOf: IsoDateTime; why: string };

/**
 * Splits facts into those known by the cut-off and those dropped (with why). `readAtMs` is when the
 * run had its data in hand; `live` is true when the run date is today. A fact with an unreadable
 * time is left to `prepareFacts`, which already drops it.
 */
export function cutFacts(facts: Fact[], opts: { cutoffMs: number; readAtMs: number; live: boolean }): { kept: Fact[]; dropped: CutDrop[] } {
  const kept: Fact[] = [];
  const dropped: CutDrop[] = [];
  const iso = (ms: number) => new Date(ms).toISOString();
  for (const f of facts ?? []) {
    const t = Date.parse(f?.asOf);
    if (!f || f.kind === "calendar" || !Number.isFinite(t)) {
      if (f) kept.push(f);
      continue;
    }
    if (PUBLISHED.has(f.kind)) {
      if (t <= opts.cutoffMs) kept.push(f);
      else dropped.push({ id: f.id, kind: f.kind, asOf: f.asOf, why: `published ${f.asOf}, after the cut-off ${iso(opts.cutoffMs)}` });
      continue;
    }
    const limit = opts.live ? Math.max(opts.cutoffMs, opts.readAtMs) : opts.cutoffMs;
    if (t <= limit) kept.push(f);
    else dropped.push({ id: f.id, kind: f.kind, asOf: f.asOf, why: opts.live ? `stamped ${f.asOf}, after the data was read at ${iso(opts.readAtMs)}` : `stamped ${f.asOf}, after the cut-off ${iso(opts.cutoffMs)}` });
  }
  return { kept, dropped };
}

/**
 * The cut-off for one input: the one the data step recorded (`cutAt`), never later than the
 * run's own (`fallbackMs`), or the run's own when the input has none (fakes, older logs).
 */
export function inputCutoff(cutAt: string | undefined, fallbackMs: number): number {
  const t = cutAt === undefined ? NaN : Date.parse(cutAt);
  return Number.isFinite(t) ? Math.min(t, fallbackMs) : fallbackMs;
}

/** Applies `cutFacts` to an asset or market input (its calendar events are never touched). */
export function cutInput<T extends { date: IsoDate; facts: Fact[]; cutAt?: IsoDateTime }>(input: T, runCutoffMs: number, readAt: Date): { input: T; dropped: CutDrop[]; cutoffMs: number } {
  const cutoffMs = inputCutoff(input.cutAt, runCutoffMs);
  const live = input.date >= readAt.toISOString().slice(0, 10);
  const { kept, dropped } = cutFacts(input.facts ?? [], { cutoffMs, readAtMs: readAt.getTime(), live });
  return { input: dropped.length ? { ...input, facts: kept } : input, dropped, cutoffMs };
}

/** One log line for the dropped facts of an asset or the market input, or null when none. */
export function cutLine(scope: string, dropped: CutDrop[], cutoffMs: number): string | null {
  if (!dropped.length) return null;
  const shown = dropped.slice(0, 4).map((d) => `${d.id} ${d.why.split(",")[0]}`);
  const more = dropped.length > shown.length ? `, and ${dropped.length - shown.length} more` : "";
  return `${scope}: ${dropped.length} fact${dropped.length > 1 ? "s" : ""} dropped, known or published after the cut-off ${new Date(cutoffMs).toISOString()} (${shown.join("; ")}${more})`;
}
