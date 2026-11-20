import type { AccessCheck, IsoDateTime, PortfolioInput } from "../types.ts";
import type { ReportRequest } from "../access/gate.ts";
import { analyzePortfolio, mergeHoldings, type PriceQuote } from "./analyze.ts";
import type { Catalog } from "./catalog.ts";
import { readResearch, type ResearchLoader } from "./research-source.ts";
import { parsePortfolioInput } from "./validate.ts";

/**
 * Framework-free handlers behind the portfolio routes (docs/research/PLAN.md, API contract).
 * Everything with a side effect (session, database, access gate, clock, research, price feed) is
 * passed in, so the handlers are unit tested and the routes stay a few lines each.
 *
 * - POST /api/research/portfolio/preview: no sign-in, nothing saved, returns `{ analysis, reportKind }`.
 * - GET/PUT /api/research/portfolio: signed in, saves manual holdings only.
 */

export type Result = { status: number; body: unknown };

/** The database side. `null` store means the account database is not connected. */
export interface PortfolioStore {
  loadPortfolio(wallet: string): Promise<PortfolioInput | null>;
  savePortfolio(wallet: string, input: PortfolioInput): Promise<void>;
}

/** Reads prices for assets research had no price for (the Stackday test price feeds). */
export type FeedPriceReader = (assetIds: string[]) => Promise<Partial<Record<string, PriceQuote>>>;

export type Deps = {
  wallet: string | null;
  store: PortfolioStore | null;
  catalog: Catalog;
  loadResearch: ResearchLoader;
  readFeedPrices: FeedPriceReader;
  checkAccess: (req: ReportRequest) => Promise<AccessCheck>;
  now: () => Date;
  onError?: (where: string, e: unknown) => void;
};

const REFUSAL: Record<Extract<AccessCheck, { allowed: false }>["reason"], Result> = {
  "sign-in": { status: 401, body: { reason: "sign-in", error: "Sign in with your wallet first." } },
  "payment-required": { status: 402, body: { reason: "payment-required", error: "This needs a plan." } },
  "rate-limited": { status: 429, body: { reason: "rate-limited", error: "Too many requests for now. Try again later." } },
};

const bad = (error: string): Result => ({ status: 400, body: { error } });
const notConnected: Result = { status: 503, body: { configured: false, error: "The account database is not connected yet." } };

async function gate(deps: Deps): Promise<Result | null> {
  const access = await deps.checkAccess({ product: "portfolio-check", wallet: deps.wallet });
  if (!access.allowed) return REFUSAL[access.reason];
  return deps.wallet ? null : REFUSAL["sign-in"];
}

/** POST /api/research/portfolio/preview: facts about the holdings sent, saved nowhere. */
export async function handlePreviewPortfolio(deps: Deps, rawBody: unknown): Promise<Result> {
  const p = parsePortfolioInput(rawBody, deps.catalog, { allowVault: true });
  if (!p.ok) return bad(p.error);

  let research;
  try {
    const { weekly, snapshot } = await deps.loadResearch();
    research = readResearch(weekly, snapshot);
  } catch (e) {
    deps.onError?.("portfolio: research", e);
    research = readResearch(null, null);
  }

  // Holdings research had no price for are valued from the Stackday test price feeds, labelled so.
  const missing = [...new Set(mergeHoldings(p.value.holdings).map((h) => h.assetId))].filter((id) => !research.prices[id]);
  let feed: Partial<Record<string, PriceQuote>> = {};
  if (missing.length) {
    try {
      feed = await deps.readFeedPrices(missing);
    } catch (e) {
      deps.onError?.("portfolio: feed prices", e);
    }
  }

  const asOf: IsoDateTime = research.asOf ?? deps.now().toISOString();
  const analysis = analyzePortfolio(p.value, {
    kind: research.kind,
    asOf,
    catalog: deps.catalog,
    views: research.views,
    viewSource: research.viewSource,
    prices: { ...feed, ...research.prices },
  });
  return { status: 200, body: { analysis, reportKind: research.kind } };
}

/** GET /api/research/portfolio: saved manual holdings. */
export async function handleGetPortfolio(deps: Deps): Promise<Result> {
  const refused = await gate(deps);
  if (refused) return refused;
  if (!deps.store) return { status: 200, body: { configured: false, input: null } };
  try {
    return { status: 200, body: { configured: true, input: await deps.store.loadPortfolio(deps.wallet!) } };
  } catch (e) {
    deps.onError?.("portfolio: get", e);
    return { status: 500, body: { error: "Could not load your portfolio." } };
  }
}

/** PUT /api/research/portfolio: save manual holdings (vault rows are refused: they are read from the chain). */
export async function handleSavePortfolio(deps: Deps, rawBody: unknown): Promise<Result> {
  const refused = await gate(deps);
  if (refused) return refused;
  if (!deps.store) return notConnected;
  const p = parsePortfolioInput(rawBody, deps.catalog, { allowVault: false });
  if (!p.ok) return bad(p.error);
  try {
    await deps.store.savePortfolio(deps.wallet!, p.value);
  } catch (e) {
    deps.onError?.("portfolio: save", e);
    return { status: 500, body: { error: "Could not save your portfolio." } };
  }
  return { status: 200, body: { input: p.value } };
}
