/**
 * What Themes can choose from: the tokenized assets that exist on Base, grouped into themes.
 * Built only from tokens that are really issued (Coinbase tokenized stocks with a Chainlink
 * price on November 15, 2026, plus cbBTC and WETH). See docs/themes/concept.md.
 *
 * On Base Sepolia only some of these have a Stackday mock (see `MOCK_FOR`); the rest are shown
 * as a preview and never bought.
 */

export type AssetKind = "stock" | "crypto";

export type CatalogAsset = {
  /** The real ticker on Base mainnet. */
  ticker: string;
  name: string;
  kind: AssetKind;
  /** Moves like crypto (for example a bitcoin holding company): counts toward the crypto cap. */
  cryptoLike?: boolean;
  /** Too volatile or too new for the core: only ever in the small risk bucket. */
  riskOnly?: boolean;
  /** Belongs to the AI and chips cluster, which has its own cap. */
  aiChips?: boolean;
};

export const CATALOG: CatalogAsset[] = [
  { ticker: "AAPLc", name: "Apple", kind: "stock" },
  { ticker: "AMZNc", name: "Amazon", kind: "stock" },
  { ticker: "GOOGLc", name: "Alphabet", kind: "stock" },
  { ticker: "METAc", name: "Meta", kind: "stock" },
  { ticker: "MSFTc", name: "Microsoft", kind: "stock", aiChips: true },
  { ticker: "NVDAc", name: "NVIDIA", kind: "stock", aiChips: true },
  { ticker: "INTCc", name: "Intel", kind: "stock", aiChips: true },
  { ticker: "SNDKc", name: "Sandisk", kind: "stock", aiChips: true, riskOnly: true },
  { ticker: "TSLAc", name: "Tesla", kind: "stock" },
  { ticker: "SPCXc", name: "SpaceX", kind: "stock", riskOnly: true },
  { ticker: "MSTRc", name: "Strategy", kind: "stock", cryptoLike: true, riskOnly: true },
  { ticker: "CRCLc", name: "Circle", kind: "stock", cryptoLike: true },
  { ticker: "cbBTC", name: "Bitcoin", kind: "crypto" },
  { ticker: "WETH", name: "Ether", kind: "crypto" },
];

export type Theme = {
  id: string;
  name: string;
  /** One line shown on the theme card. Information, not advice. */
  thesis: string;
  tickers: string[];
};

export const THEMES: Theme[] = [
  {
    id: "ai-chips",
    name: "AI and chips",
    thesis: "The companies building and running AI: chips, memory and the clouds that use them.",
    tickers: ["NVDAc", "MSFTc", "GOOGLc", "METAc", "INTCc", "SNDKc"],
  },
  {
    id: "big-tech",
    name: "Big tech core",
    thesis: "The largest US tech companies, as a steady core.",
    tickers: ["AAPLc", "AMZNc", "GOOGLc", "MSFTc", "METAc"],
  },
  {
    id: "future-movers",
    name: "Future movers",
    thesis: "Cars, rockets and other bets on what comes next. Volatile, so kept small.",
    tickers: ["TSLAc", "SPCXc"],
  },
  {
    id: "crypto-native",
    name: "Crypto native",
    thesis: "Bitcoin and Ether, plus companies whose business is crypto.",
    tickers: ["cbBTC", "WETH", "MSTRc", "CRCLc"],
  },
];

/** Shown as locked cards until the tokens exist on Base. */
export const COMING_SOON = ["Clean energy", "Healthcare", "Global stocks"];

/** Stackday's testnet mock for each real ticker, where one exists. */
export const MOCK_FOR: Record<string, string> = {
  AAPLc: "mAAPL",
  NVDAc: "mNVDA",
  cbBTC: "mcbBTC",
  WETH: "mWETH",
};

export const assetOf = (ticker: string) => CATALOG.find((a) => a.ticker === ticker);
export const themeOf = (id: string) => THEMES.find((t) => t.id === id);
