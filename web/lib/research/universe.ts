import type { AssetClass, MarketCalendar } from "./types.ts";

/**
 * The research universe (founder spec docs/research/SPEC.md, section 1): borrowable assets only.
 * Six to start: Bitcoin, Ether, Gold, NVIDIA, Apple and the S&P 500. Alphabet and Meta are
 * borrowable and can be added once these six are good. Microsoft and the other invest-only assets
 * are out because they have no lending market, and SpaceX is out because it has a mock price only.
 *
 * Research is done on the real underlying (prices, news, filings) and shown next to the mock token
 * a person can buy on Base Sepolia. universe.test.ts checks every asset here is borrowable in
 * web/lib/deployment.json with the same liquidation limit, and `checkResearchable` refuses any
 * asset that is not.
 */

export type RiskBucket = "core" | "growth" | "speculative";

export type UniverseAsset = {
  /** Stackday asset symbol, matches deployment.json `assetSymbols`. */
  assetId: string;
  name: string;
  /** Plain ticker of the real market, for display and data lookups. */
  underlying: string;
  /** The tokenized asset on Base mainnet that the mock stands in for. */
  realToken: string;
  assetClass: AssetClass;
  sector: string;
  risk: RiskBucket;
  calendar: MarketCalendar;
  /** Liquidation limit of the asset's lending market, 0.625 = 62.5%. Checked against deployment.json. */
  lltv: number;
  /** SEC company id for EDGAR filings (stocks only). */
  cik?: string;
  /** Extra caution shown on the asset page. */
  note?: string;
};

export const UNIVERSE: UniverseAsset[] = [
  { assetId: "mcbBTC", name: "Bitcoin", underlying: "BTC", realToken: "cbBTC", assetClass: "crypto", sector: "Crypto", risk: "speculative", calendar: "CRYPTO", lltv: 0.86 },
  { assetId: "mWETH", name: "Ether", underlying: "ETH", realToken: "WETH", assetClass: "crypto", sector: "Crypto", risk: "speculative", calendar: "CRYPTO", lltv: 0.86 },
  { assetId: "mPAXG", name: "Gold", underlying: "XAU", realToken: "PAXG", assetClass: "commodity", sector: "Precious metals", risk: "core", calendar: "CRYPTO", lltv: 0.77, note: "PAXG is a token backed by gold and trades every day, while gold futures markets close at weekends." },
  { assetId: "mNVDA", name: "NVIDIA", underlying: "NVDA", realToken: "NVDAc", assetClass: "stock", sector: "Semiconductors", risk: "growth", calendar: "XNYS", lltv: 0.625, cik: "0001045810" },
  { assetId: "mAAPL", name: "Apple", underlying: "AAPL", realToken: "AAPLc", assetClass: "stock", sector: "Technology", risk: "core", calendar: "XNYS", lltv: 0.625, cik: "0000320193" },
  { assetId: "mSPX", name: "S&P 500", underlying: "SPX", realToken: "deSPXA", assetClass: "fund", sector: "Broad US market", risk: "core", calendar: "XNYS", lltv: 0.77, note: "Tracks the S&P 500 index, so it already holds Apple and NVIDIA." },
];

const BY_ID = new Map(UNIVERSE.map((a) => [a.assetId, a]));

export function universeAsset(assetId: string): UniverseAsset | undefined {
  return BY_ID.get(assetId);
}

/** Case-insensitive search by symbol, name or underlying ticker, for the asset list. */
export function searchUniverse(query: string): UniverseAsset[] {
  const q = query.trim().toLowerCase();
  if (!q) return UNIVERSE;
  return UNIVERSE.filter((a) =>
    [a.assetId, a.name, a.underlying, a.realToken, a.sector, a.assetClass].some((s) => s.toLowerCase().includes(q)),
  );
}

/** Deployment record shape we read (web/lib/deployment.json). */
export type DeploymentLike = Record<string, unknown>;

const ZERO_ADDRESS = /^0x0{40}$/i;

/** True when the asset has a lending market in this deployment (same rule as web/lib/contracts.ts). */
export function isBorrowable(assetId: string, deployment: DeploymentLike): boolean {
  const adapter = deployment[`${assetId}LendingAdapter`];
  return typeof adapter === "string" && /^0x[0-9a-f]{40}$/i.test(adapter) && !ZERO_ADDRESS.test(adapter);
}

/** Liquidation limit from the deployment, 0.625 = 62.5%, or 0 when there is none. */
export function deployedLltv(assetId: string, deployment: DeploymentLike): number {
  const raw = deployment[`${assetId}Lltv`];
  if (raw === undefined || raw === null) return 0;
  return Number(BigInt(String(raw))) / 1e18;
}

export type ResearchableCheck = { ok: true; asset: UniverseAsset } | { ok: false; reason: string };

/**
 * The gate every run, page and report uses before researching an asset: it must be in the research
 * universe and borrowable in the current deployment. Anything else is refused with a reason.
 */
export function checkResearchable(assetId: string, deployment: DeploymentLike): ResearchableCheck {
  const asset = universeAsset(assetId);
  if (!asset) return { ok: false, reason: `${assetId} is not in the research universe (borrowable assets only)` };
  if (!isBorrowable(assetId, deployment)) return { ok: false, reason: `${assetId} is not borrowable in this deployment, so it is not researched` };
  return { ok: true, asset };
}

/** The universe filtered to what is borrowable in this deployment, with refusals for the run log. */
export function researchableUniverse(deployment: DeploymentLike): { assets: UniverseAsset[]; refused: string[] } {
  const assets: UniverseAsset[] = [];
  const refused: string[] = [];
  for (const a of UNIVERSE) {
    const c = checkResearchable(a.assetId, deployment);
    if (c.ok) assets.push(c.asset);
    else refused.push(c.reason);
  }
  return { assets, refused };
}
