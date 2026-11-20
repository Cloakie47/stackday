import type { Fact, NoteStatus, ResearchNote, ResearchSnapshot, View, WeeklyAssetSection, WeeklyReport } from "../types.ts";
import { makeCatalog, type CatalogAsset } from "./catalog.ts";
import type { PriceQuote } from "./analyze.ts";

/**
 * TEST FIXTURES ONLY. Round made-up numbers so tests can check the arithmetic; they are not
 * market prices and are never shown in the app. Every fact says "Test fixture" as its source.
 */

export const SOURCE = { name: "Test fixture (not market data)" };
export const FIXTURE_TIME = "2026-11-19T21:00:00Z";

/** Stackday assets as the catalog sees them; LLTVs match web/lib/deployment.json (0 = invest only). */
export const FIXTURE_ASSETS: CatalogAsset[] = [
  { assetId: "mAAPL", name: "Apple", assetClass: "stock", lltv: 0.625 },
  { assetId: "mNVDA", name: "NVIDIA", assetClass: "stock", lltv: 0.625 },
  { assetId: "mcbBTC", name: "cbBTC", assetClass: "crypto", lltv: 0.86 },
  { assetId: "mWETH", name: "Ether", assetClass: "crypto", lltv: 0.86 },
  { assetId: "mPAXG", name: "Gold", assetClass: "commodity", lltv: 0.77 },
  { assetId: "mSPX", name: "S&P 500", assetClass: "fund", lltv: 0.77 },
  { assetId: "mGOOGL", name: "Alphabet", assetClass: "stock", lltv: 0.77 },
  { assetId: "mMSFT", name: "Microsoft", assetClass: "stock", lltv: 0 },
  { assetId: "mMSTR", name: "Strategy", assetClass: "stock", lltv: 0 },
];
export const FIXTURE_CATALOG = makeCatalog(FIXTURE_ASSETS);

export const quote = (price: number): PriceQuote => ({ price, source: SOURCE, asOf: FIXTURE_TIME });

const priceFact = (price: number): Fact => ({ id: "px.1d.last", kind: "price", label: "Last daily close", value: price, unit: "USD", source: SOURCE, asOf: FIXTURE_TIME });

export type NoteSpec = { assetId: string; price?: number; view?: View; status?: NoteStatus };

export function makeNote(s: NoteSpec, date = "2026-11-19"): ResearchNote {
  const facts: Fact[] = s.price !== undefined ? [priceFact(s.price)] : [];
  return {
    assetId: s.assetId,
    date,
    generatedAt: FIXTURE_TIME,
    dataAsOf: FIXTURE_TIME,
    status: s.status ?? "ok",
    summary: `Fixture note for ${s.assetId}.`,
    view: s.view ?? "hold",
    conviction: "medium",
    levels: null,
    reasons: [],
    risks: [],
    facts,
    chart: {},
    model: { triage: "fixture" },
  };
}

export function makeSnapshot(notes: NoteSpec[], opts: { date?: string; kind?: "live" | "sample" } = {}): ResearchSnapshot {
  const date = opts.date ?? "2026-11-19";
  return {
    kind: opts.kind ?? "sample",
    date,
    generatedAt: FIXTURE_TIME,
    runId: `fixture-${date}`,
    market: { date, summary: "Fixture market summary.", developments: [], facts: [] },
    notes: notes.map((n) => makeNote(n, date)),
  };
}

/** A weekly report with only the parts the portfolio check reads filled in. */
export function makeWeekly(sections: NoteSpec[], opts: { weekOf?: string; kind?: "live" | "sample" } = {}): WeeklyReport {
  const assets = sections.map(
    (s) =>
      ({
        assetId: s.assetId,
        status: s.status === "no-reading" ? "no-reading" : "ok",
        view: { view: s.view ?? "hold", conviction: "medium", levels: null, reasons: [] },
        facts: s.price !== undefined ? [priceFact(s.price)] : [],
      }) as unknown as WeeklyAssetSection,
  );
  return {
    kind: opts.kind ?? "sample",
    weekOf: opts.weekOf ?? "2026-11-16",
    generatedAt: "2026-11-16T12:00:00Z",
    runId: "fixture-weekly",
    beta: true,
    market: { date: "2026-11-16", summary: "", developments: [], facts: [] },
    assets,
    ideas: { ranked: [], exampleSplits: [] },
    scorecard: null,
    review: { approved: true, sentBack: 0, removedClaims: 0, notes: [] },
    model: { analysts: "fixture", editor: "fixture" },
    disclaimer: "fixture",
  };
}
