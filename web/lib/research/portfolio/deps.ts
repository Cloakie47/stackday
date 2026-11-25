import { sessionWallet } from "../../server/backend.ts";
import { ASSETS } from "../../contracts.ts";
import { checkReportAccess } from "../access/gate.ts";
import { makeCatalog, type Catalog } from "./catalog.ts";
import { readStackdayFeedPrices } from "./feed-prices.ts";
import type { Deps, Result } from "./handlers.ts";
import { portfolioStore, publishedWeeklyLoader } from "./store.ts";

/** Every Stackday asset in this deployment, with its liquidation limit (0 when invest only). */
export const stackdayCatalog = (): Catalog =>
  makeCatalog(ASSETS.map((a) => ({ assetId: a.symbol, name: a.name, assetClass: a.kind, lltv: a.borrowable ? Number(a.lltv) / 1e18 : 0 })));

/** Real dependencies for one request: session cookie, Supabase (if connected), access gate, published research, price feeds. */
export function requestDeps(request: Request): Deps {
  const catalog = stackdayCatalog();
  return {
    wallet: sessionWallet(request),
    store: portfolioStore(catalog),
    catalog,
    loadResearch: publishedWeeklyLoader,
    readFeedPrices: readStackdayFeedPrices,
    checkAccess: checkReportAccess,
    now: () => new Date(),
    // Only the place and the message: never request bodies, wallets or keys.
    onError: (where, e) => console.error(`research ${where}:`, e instanceof Error ? e.message : "error"),
  };
}

/** Largest request body the portfolio routes read, in bytes. */
export const MAX_BODY_BYTES = 32_000;

/** Reads a JSON body, refusing anything too large or not JSON. Returns undefined on failure. */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const respond = (r: Result) => Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
