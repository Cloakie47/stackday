import type { AssetClass, MarketCalendar } from "./types.ts";

/**
 * The research universe: every Stackday asset and the real-world market it stands in for.
 * Research is done on the real underlying (prices, news, filings) and shown next to the mock token
 * a person can buy on Base Sepolia. Kept in step with web/lib/deployment.json by universe.test.ts.
 */

export type RiskBucket = "cash-like" | "core" | "growth" | "speculative";

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
  /** SEC company id for EDGAR filings (stocks only). */
  cik?: string;
  /**
   * False when there is no public market price (SpaceX is private): research is news only and
   * entry, target and stop levels are never shown.
   */
  publicPrice: boolean;
  /** Extra caution shown on the asset page. */
  note?: string;
};

export const UNIVERSE: UniverseAsset[] = [
  { assetId: "mAAPL", name: "Apple", underlying: "AAPL", realToken: "AAPLc", assetClass: "stock", sector: "Technology", risk: "core", calendar: "XNYS", cik: "0000320193", publicPrice: true },
  { assetId: "mNVDA", name: "NVIDIA", underlying: "NVDA", realToken: "NVDAc", assetClass: "stock", sector: "Semiconductors", risk: "growth", calendar: "XNYS", cik: "0001045810", publicPrice: true },
  { assetId: "mGOOGL", name: "Alphabet", underlying: "GOOGL", realToken: "GOOGLc", assetClass: "stock", sector: "Communication services", risk: "core", calendar: "XNYS", cik: "0001652044", publicPrice: true },
  { assetId: "mMETA", name: "Meta", underlying: "META", realToken: "METAc", assetClass: "stock", sector: "Communication services", risk: "growth", calendar: "XNYS", cik: "0001326801", publicPrice: true },
  { assetId: "mMSFT", name: "Microsoft", underlying: "MSFT", realToken: "MSFTc", assetClass: "stock", sector: "Technology", risk: "core", calendar: "XNYS", cik: "0000789019", publicPrice: true },
  { assetId: "mAMZN", name: "Amazon", underlying: "AMZN", realToken: "AMZNc", assetClass: "stock", sector: "Consumer discretionary", risk: "core", calendar: "XNYS", cik: "0001018724", publicPrice: true },
  { assetId: "mTSLA", name: "Tesla", underlying: "TSLA", realToken: "TSLAc", assetClass: "stock", sector: "Consumer discretionary", risk: "speculative", calendar: "XNYS", cik: "0001318605", publicPrice: true },
  { assetId: "mAMD", name: "AMD", underlying: "AMD", realToken: "AMDc", assetClass: "stock", sector: "Semiconductors", risk: "growth", calendar: "XNYS", cik: "0000002488", publicPrice: true },
  { assetId: "mMSTR", name: "Strategy", underlying: "MSTR", realToken: "MSTRc", assetClass: "stock", sector: "Bitcoin treasury", risk: "speculative", calendar: "XNYS", cik: "0001050446", publicPrice: true, note: "Moves mostly with bitcoin: its main asset is a large bitcoin holding." },
  { assetId: "mSPCX", name: "SpaceX", underlying: "SPCX", realToken: "SPCXc", assetClass: "stock", sector: "Aerospace", risk: "speculative", calendar: "XNYS", publicPrice: false, note: "Private company with no public market price. Research is news only, and the testnet price is a mock." },
  { assetId: "mSPX", name: "S&P 500", underlying: "SPX", realToken: "deSPXA", assetClass: "fund", sector: "Broad US market", risk: "core", calendar: "XNYS", publicPrice: true, note: "Tracks the S&P 500 index, so it already holds Apple, NVIDIA, Microsoft, Amazon, Alphabet, Meta and Tesla." },
  { assetId: "mSGOV", name: "US Treasuries 0-3M", underlying: "SGOV", realToken: "wtSGOV", assetClass: "fund", sector: "Short-term government bonds", risk: "cash-like", calendar: "XNYS", publicPrice: true, note: "Cash-like: price barely moves and the return is mostly interest, so price targets and stops are not shown." },
  { assetId: "mPAXG", name: "Gold", underlying: "XAU", realToken: "PAXG", assetClass: "commodity", sector: "Precious metals", risk: "core", calendar: "CRYPTO", publicPrice: true, note: "PAXG is a token backed by gold and trades every day, while gold futures markets close at weekends." },
  { assetId: "mcbBTC", name: "Bitcoin", underlying: "BTC", realToken: "cbBTC", assetClass: "crypto", sector: "Crypto", risk: "speculative", calendar: "CRYPTO", publicPrice: true },
  { assetId: "mWETH", name: "Ether", underlying: "ETH", realToken: "WETH", assetClass: "crypto", sector: "Crypto", risk: "speculative", calendar: "CRYPTO", publicPrice: true },
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
