import type { Fact, ResearchSnapshot, View, WeeklyReport } from "../types.ts";
import { VIEWS, isDisplayable } from "../types.ts";
import type { PriceQuote, ViewSource } from "./analyze.ts";

/**
 * Reads the general research the portfolio check links to: the latest Monday weekly report, or the
 * daily snapshot when there is no report yet. Only the views (one per asset, the same for every
 * reader) and the code-made price facts are taken. Nothing personal comes from here.
 *
 * The default loader reads the newest published Monday report from the research tables directly
 * (`publishedWeeklyLoader` in store.ts).
 */

export type ResearchRead = {
  kind: "live" | "sample";
  viewSource: ViewSource | null;
  views: Partial<Record<string, View>>;
  prices: Partial<Record<string, PriceQuote>>;
  /** Newest generation time of what was read. */
  asOf: string | null;
};

export type ResearchLoader = () => Promise<{ weekly: WeeklyReport | null; snapshot: ResearchSnapshot | null }>;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isDate = (x: unknown) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
const isView = (x: unknown): x is View => typeof x === "string" && (VIEWS as readonly string[]).includes(x);

/** Light shape check of `{ snapshot }` or a bare snapshot: enough that reading views and prices cannot crash. */
export function asSnapshot(x: unknown): ResearchSnapshot | null {
  const s = isObj(x) && isObj(x.snapshot) ? x.snapshot : x;
  if (!isObj(s)) return null;
  if (s.kind !== "live" && s.kind !== "sample") return null;
  if (!isDate(s.date) || typeof s.generatedAt !== "string" || !Array.isArray(s.notes)) return null;
  for (const n of s.notes) {
    if (!isObj(n) || typeof n.assetId !== "string" || !isView(n.view) || typeof n.status !== "string" || !Array.isArray(n.facts)) return null;
  }
  return s as unknown as ResearchSnapshot;
}

/** Light shape check of `{ report }` or a bare weekly report. */
export function asWeeklyReport(x: unknown): WeeklyReport | null {
  const r = isObj(x) && isObj(x.report) ? x.report : x;
  if (!isObj(r)) return null;
  if (r.kind !== "live" && r.kind !== "sample") return null;
  if (!isDate(r.weekOf) || typeof r.generatedAt !== "string" || !Array.isArray(r.assets)) return null;
  for (const a of r.assets) {
    if (!isObj(a) || typeof a.assetId !== "string" || typeof a.status !== "string" || !isObj(a.view) || !isView(a.view.view) || !Array.isArray(a.facts)) return null;
  }
  return r as unknown as WeeklyReport;
}

/** The last daily close from a list of facts: "px.1d.last" first, then any other "px.*.last" price fact. */
export function lastPriceFact(facts: Fact[]): Fact | null {
  // A fact marked not for display (licence) never values a holding on the page.
  const good = (f: Fact) => isDisplayable(f) && f.kind === "price" && typeof f.value === "number" && Number.isFinite(f.value) && f.value > 0;
  return facts.find((f) => f.id === "px.1d.last" && good(f)) ?? facts.find((f) => /^px\.[^.]+\.last$/.test(f.id) && good(f)) ?? null;
}

/**
 * Assets whose research price is not the price of one token, so it must never value a holding.
 * The S&P 500 is researched on the index or the SPY fund, while one deSPXA token has its own price
 * (read from the feed instead).
 */
export const RESEARCH_PRICE_NOT_TOKEN_PRICE = new Set(["mSPX"]);

const quote = (f: Fact): PriceQuote => ({ price: f.value as number, source: f.source, asOf: f.asOf });

/**
 * Views from the weekly report when there is one (it is the product), otherwise from the daily
 * notes. Prices from the daily notes first (fresher), then the weekly report. A section or note
 * with no reading gives no view.
 *
 * `kind` is "sample" whenever anything read is the labelled sample, so a sample price can never sit
 * under a live label: a sample snapshot next to a live weekly report is ignored entirely.
 */
export function readResearch(weekly: WeeklyReport | null, snapshot: ResearchSnapshot | null): ResearchRead {
  const out: ResearchRead = { kind: "live", viewSource: null, views: {}, prices: {}, asOf: null };
  if (weekly?.kind === "live" && snapshot?.kind === "sample") snapshot = null;
  if (!weekly && !snapshot) return { ...out, kind: "sample" };
  if (weekly?.kind === "sample" || snapshot?.kind === "sample") out.kind = "sample";
  if (weekly) {
    out.viewSource = { product: "weekly-report", weekOf: weekly.weekOf };
    for (const a of weekly.assets) if (a.status === "ok") out.views[a.assetId] = a.view.view;
  } else if (snapshot) {
    out.viewSource = { product: "daily-note", date: snapshot.date };
    for (const n of snapshot.notes) if (n.status !== "no-reading") out.views[n.assetId] = n.view;
  }
  for (const n of snapshot?.notes ?? []) {
    if (RESEARCH_PRICE_NOT_TOKEN_PRICE.has(n.assetId)) continue;
    const f = lastPriceFact(n.facts);
    if (f) out.prices[n.assetId] = quote(f);
  }
  for (const a of weekly?.assets ?? []) {
    if (out.prices[a.assetId] || RESEARCH_PRICE_NOT_TOKEN_PRICE.has(a.assetId)) continue;
    const f = lastPriceFact(a.facts);
    if (f) out.prices[a.assetId] = quote(f);
  }
  const times = [weekly?.generatedAt, snapshot?.generatedAt].filter((t): t is string => typeof t === "string").sort();
  out.asOf = times.at(-1) ?? null;
  return out;
}

/** Loader that always returns the given research. For tests and fixtures. */
export const staticResearchLoader =
  (weekly: WeeklyReport | null, snapshot: ResearchSnapshot | null): ResearchLoader =>
  async () => ({ weekly, snapshot });
