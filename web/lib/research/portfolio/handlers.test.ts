import { test } from "node:test";
import assert from "node:assert/strict";
import { handleGetPortfolio, handlePreviewPortfolio, handleSavePortfolio, type Deps, type PortfolioStore } from "./handlers.ts";
import { asSnapshot, asWeeklyReport, fetchResearchLoader, lastPriceFact, readResearch, staticResearchLoader } from "./research-source.ts";
import { FIXTURE_CATALOG, makeSnapshot, makeWeekly, quote } from "./fixtures.ts";
import type { AccessCheck, PortfolioInput } from "../types.ts";
import type { ReportRequest } from "../access/gate.ts";
import type { PortfolioAnalysisResult } from "./analyze.ts";

const WALLET = "0x1111111111111111111111111111111111111111";
const SNAP = makeSnapshot([
  { assetId: "mAAPL", price: 100, view: "hold" },
  { assetId: "mSPX", price: 50, view: "accumulate" },
]);
const WEEKLY = makeWeekly([
  { assetId: "mAAPL", price: 90, view: "accumulate" },
  { assetId: "mSPX", price: 45, view: "hold" },
  { assetId: "mPAXG", price: 40, view: "hold", status: "no-reading" },
]);
const PORTFOLIO: PortfolioInput = { holdings: [{ assetId: "mSPX", amount: 4, origin: "manual" }] };

function memoryStore() {
  const portfolios = new Map<string, PortfolioInput>();
  const store: PortfolioStore = {
    async loadPortfolio(w) {
      return portfolios.get(w) ?? null;
    },
    async savePortfolio(w, i) {
      portfolios.set(w, i);
    },
  };
  return { store, portfolios };
}

/** Same rule as the real gate while the paywall is off: portfolio check needs sign-in only. */
const gate = async (req: ReportRequest): Promise<AccessCheck> => (req.wallet ? { allowed: true, consumesCredit: false } : { allowed: false, reason: "sign-in" });

function deps(over: Partial<Deps> = {}): Deps & { gateCalls: ReportRequest[]; feedAsked: string[][] } {
  const d = {
    gateCalls: [] as ReportRequest[],
    feedAsked: [] as string[][],
    wallet: WALLET as string | null,
    store: null,
    catalog: FIXTURE_CATALOG,
    loadResearch: staticResearchLoader(null, SNAP),
    readFeedPrices: async (ids: string[]) => {
      d.feedAsked.push(ids);
      return { mMSFT: quote(20) };
    },
    checkAccess: async (req: ReportRequest) => {
      d.gateCalls.push(req);
      return gate(req);
    },
    now: () => new Date("2026-11-19T22:00:00Z"),
    ...over,
  };
  return d;
}

test("preview: no sign-in needed, nothing saved, returns analysis and reportKind", async () => {
  const { store, portfolios } = memoryStore();
  const d = deps({ wallet: null, store });
  const r = await handlePreviewPortfolio(d, PORTFOLIO);
  assert.equal(r.status, 200);
  const body = r.body as { analysis: PortfolioAnalysisResult; reportKind: string };
  assert.equal(body.reportKind, "sample");
  assert.equal(body.analysis.totalUsd, 200);
  assert.equal(body.analysis.holdings[0].generalView, "accumulate");
  assert.deepEqual(body.analysis.viewSource, { product: "daily-note", date: "2026-11-19" });
  assert.equal(portfolios.size, 0);
  assert.equal(d.gateCalls.length, 0);
  assert.deepEqual(d.feedAsked, [], "no feed read when research priced everything");
});

test("preview: views from the weekly report when there is one, prices from the daily notes first", async () => {
  const r = await handlePreviewPortfolio(deps({ loadResearch: staticResearchLoader(WEEKLY, SNAP) }), { holdings: [{ assetId: "mAAPL", amount: 1 }] });
  const a = (r.body as { analysis: PortfolioAnalysisResult }).analysis;
  assert.equal(a.holdings[0].generalView, "accumulate", "weekly view");
  assert.equal(a.totalUsd, 100, "daily price");
  assert.deepEqual(a.viewSource, { product: "weekly-report", weekOf: "2026-11-16" });
});

test("preview: holdings research does not price are valued from the feed, labelled not covered", async () => {
  const d = deps();
  const r = await handlePreviewPortfolio(d, { holdings: [{ assetId: "mMSFT", amount: 2, origin: "vault" }, { assetId: "mAAPL", amount: 1 }] });
  assert.equal(r.status, 200);
  assert.deepEqual(d.feedAsked, [["mMSFT"]]);
  const a = (r.body as { analysis: PortfolioAnalysisResult }).analysis;
  assert.equal(a.totalUsd, 140);
  assert.match(a.byAsset.find((s) => s.key === "mMSFT")!.label, /not covered by research/);
});

test("preview: a failing feed or research source still answers, with unpriced holdings", async () => {
  const d = deps({
    loadResearch: async () => {
      throw new Error("down");
    },
    readFeedPrices: async () => {
      throw new Error("rpc down");
    },
  });
  const r = await handlePreviewPortfolio(d, PORTFOLIO);
  assert.equal(r.status, 200);
  const a = (r.body as { analysis: PortfolioAnalysisResult }).analysis;
  assert.equal(a.totalUsd, 0);
  assert.deepEqual(a.unpriced.map((u) => u.assetId), ["mSPX"]);
  assert.equal(a.viewSource, null);
});

test("preview: bad input is a 400", async () => {
  assert.equal((await handlePreviewPortfolio(deps(), undefined)).status, 400);
  assert.equal((await handlePreviewPortfolio(deps(), { holdings: [], horizon: "long" })).status, 400);
});

test("GET and PUT need sign-in through the portfolio-check gate", async () => {
  const { store } = memoryStore();
  const d = deps({ wallet: null, store });
  assert.equal((await handleGetPortfolio(d)).status, 401);
  assert.equal((await handleSavePortfolio(d, PORTFOLIO)).status, 401);
  assert.deepEqual(d.gateCalls, [{ product: "portfolio-check", wallet: null }, { product: "portfolio-check", wallet: null }]);
});

test("PUT saves manual holdings only, GET returns them", async () => {
  const { store, portfolios } = memoryStore();
  const d = deps({ store });
  const saved = await handleSavePortfolio(d, PORTFOLIO);
  assert.equal(saved.status, 200);
  assert.deepEqual(portfolios.get(WALLET), PORTFOLIO);
  const vault = await handleSavePortfolio(d, { holdings: [{ assetId: "mSPX", amount: 1, origin: "vault" }] });
  assert.equal(vault.status, 400);
  const got = await handleGetPortfolio(d);
  assert.deepEqual(got, { status: 200, body: { configured: true, input: PORTFOLIO } });
});

test("without the database: GET says not configured, PUT is a 503", async () => {
  assert.deepEqual(await handleGetPortfolio(deps()), { status: 200, body: { configured: false, input: null } });
  assert.equal((await handleSavePortfolio(deps(), PORTFOLIO)).status, 503);
});

test("store errors become plain 500s", async () => {
  const store: PortfolioStore = {
    async loadPortfolio() {
      throw new Error("db");
    },
    async savePortfolio() {
      throw new Error("db");
    },
  };
  assert.equal((await handleGetPortfolio(deps({ store }))).status, 500);
  assert.equal((await handleSavePortfolio(deps({ store }), PORTFOLIO)).status, 500);
});

test("research source: shape checks, price facts and reading", async () => {
  assert.equal(asSnapshot({ snapshot: SNAP }), SNAP);
  assert.equal(asSnapshot({ kind: "live" }), null);
  assert.equal(asWeeklyReport({ report: WEEKLY }), WEEKLY);
  assert.equal(asWeeklyReport({ report: { ...WEEKLY, assets: [{ assetId: "mAAPL" }] } }), null);
  assert.equal(lastPriceFact([]), null);
  const read = readResearch(WEEKLY, null);
  assert.deepEqual(read.views, { mAAPL: "accumulate", mSPX: "hold" }, "no view for a section with no reading");
  assert.equal(read.prices.mAAPL!.price, 90);
  const urls: string[] = [];
  const fake = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(url.endsWith("/weekly") ? { report: WEEKLY } : { snapshot: SNAP }), { status: 200 });
  }) as unknown as typeof fetch;
  const loaded = await fetchResearchLoader("https://example.test/api/research/portfolio/preview", fake)();
  assert.deepEqual(urls.sort(), ["https://example.test/api/research/snapshot", "https://example.test/api/research/weekly"]);
  assert.equal(loaded.weekly?.weekOf, "2026-11-16");
  assert.equal(loaded.snapshot?.date, "2026-11-19");
  const failing = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await fetchResearchLoader("https://example.test/", failing)(), { weekly: null, snapshot: null });
});
