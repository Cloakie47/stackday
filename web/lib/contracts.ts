import deployment from "./deployment.json" with { type: "json" };

export type Address = `0x${string}`;

export const CHAIN_ID = 84532; // Base Sepolia
export const EXPLORER = "https://sepolia.basescan.org";

const d = deployment as unknown as Record<string, string | number | string[]>;

export const ADDR = {
  usdc: d.usdc as Address,
  morpho: d.morpho as Address,
  payroll: d.payroll as Address,
  router: d.sipRouter as Address,
  factory: d.vaultFactory as Address,
  mockSwap: d.mockSwapAdapter as Address,
  mockYieldVault: d.mockYieldVault as Address,
  /** MOCK sell desk (testnet only): buys mock assets for test USDC at the feed price minus a spread. */
  sellDesk: d.mockSellDesk as Address,
};

/** GiftBox (issue #77), deployed after the main contracts; undefined on a deployment without it. */
export const GIFT_BOX = (d.giftBox as Address | undefined) || undefined;

export const SIP_FEE_BPS = BigInt(d.sipFeeBps as number);
/** One-time fee on borrowed USDC (0 on deployments before issue #45). */
export const BORROW_FEE_BPS = BigInt((d.borrowFeeBps as number | undefined) ?? 0);
/** Yearly fee on USDC earning interest, taken only out of the interest (0 before issue #45). */
export const EARN_FEE_BPS = BigInt((d.earnFeeBps as number | undefined) ?? 0);
/** "0.15%" style label for a fee in basis points. */
export const feeLabel = (bps: bigint) => `${Number(bps) / 100}%`;
/** Shortest payroll schedule the contract allows on this network, in seconds. */
export const MIN_SCHEDULE_INTERVAL = Number(d.minScheduleInterval ?? 86400);

export type Asset = {
  symbol: string;
  name: string;
  /** The real token this mock stands in for on Base mainnet. */
  realTicker: string;
  kind: "stock" | "fund" | "commodity" | "crypto";
  /** Has a lending market: can be locked and borrowed against. Invest-only assets cannot (issue #60). */
  borrowable: boolean;
  decimals: number;
  token: Address;
  feed: Address;
  adapter: Address;
  marketId: `0x${string}`;
  /** Liquidation limit of this asset's Morpho market (1e18 = 100%). */
  lltv: bigint;
  /** Price the mock feed was deployed with (8 decimals). */
  startPrice: bigint;
  /** Brand colour used for charts and icons. */
  color: string;
  /** Short label inside the round icon. */
  icon: string;
};

const META: Record<string, Pick<Asset, "name" | "realTicker" | "kind" | "decimals" | "startPrice" | "color" | "icon">> = {
  mAAPL: { name: "Apple", realTicker: "AAPLc", kind: "stock", decimals: 8, startPrice: 357n * 10n ** 8n, color: "#111111", icon: "AAPL" },
  mNVDA: { name: "NVIDIA", realTicker: "NVDAc", kind: "stock", decimals: 8, startPrice: 190n * 10n ** 8n, color: "#76b900", icon: "NVDA" },
  mcbBTC: { name: "cbBTC", realTicker: "cbBTC", kind: "crypto", decimals: 8, startPrice: 100_000n * 10n ** 8n, color: "#f7931a", icon: "BTC" },
  mWETH: { name: "Ether", realTicker: "WETH", kind: "crypto", decimals: 18, startPrice: 3500n * 10n ** 8n, color: "#627eea", icon: "ETH" },
  mGOOGL: { name: "Alphabet", realTicker: "GOOGLc", kind: "stock", decimals: 8, startPrice: 280n * 10n ** 8n, color: "#4285f4", icon: "GOOGL" },
  mMETA: { name: "Meta", realTicker: "METAc", kind: "stock", decimals: 8, startPrice: 640n * 10n ** 8n, color: "#0866ff", icon: "META" },
  mSPCX: { name: "SpaceX", realTicker: "SPCXc", kind: "stock", decimals: 8, startPrice: 200n * 10n ** 8n, color: "#005288", icon: "SPCX" },
  mPAXG: { name: "Gold", realTicker: "PAXG", kind: "commodity", decimals: 18, startPrice: 4060n * 10n ** 8n, color: "#c9a227", icon: "Au" },
  // Invest only (issue #60): good buy routes on Base, no Morpho market.
  mTSLA: { name: "Tesla", realTicker: "TSLAc", kind: "stock", decimals: 8, startPrice: 381n * 10n ** 8n, color: "#cc0000", icon: "TSLA" },
  mAMZN: { name: "Amazon", realTicker: "AMZNc", kind: "stock", decimals: 8, startPrice: 257n * 10n ** 8n, color: "#e47911", icon: "AMZN" },
  mMSFT: { name: "Microsoft", realTicker: "MSFTc", kind: "stock", decimals: 8, startPrice: 502n * 10n ** 8n, color: "#0067b8", icon: "MSFT" },
  mMSTR: { name: "Strategy", realTicker: "MSTRc", kind: "stock", decimals: 8, startPrice: 98n * 10n ** 8n, color: "#d9232e", icon: "MSTR" },
  mAMD: { name: "AMD", realTicker: "AMDc", kind: "stock", decimals: 8, startPrice: 489n * 10n ** 8n, color: "#111111", icon: "AMD" },
  mSPX: { name: "S&P 500", realTicker: "deSPXA", kind: "fund", decimals: 18, startPrice: 742n * 10n ** 8n, color: "#1e3a8a", icon: "SPX" },
  mSGOV: { name: "US Treasuries 0-3M", realTicker: "wtSGOV", kind: "fund", decimals: 18, startPrice: 102n * 10n ** 8n, color: "#0f766e", icon: "T" },
};

/** Mock asset tokens on Base Sepolia. On Base mainnet these would be the real tokens named in `realTicker`. */
// An asset the site has no details for yet is left out, so a newer deployment cannot break every page.
export const ASSETS: Asset[] = (d.assetSymbols as string[]).filter((symbol) => symbol in META).map((symbol) => ({
  symbol,
  ...META[symbol],
  token: d[symbol] as Address,
  feed: d[`${symbol}Feed`] as Address,
  adapter: d[`${symbol}LendingAdapter`] as Address,
  borrowable: !!d[`${symbol}LendingAdapter`] && !/^0x0+$/.test(d[`${symbol}LendingAdapter`] as string),
  marketId: d[`${symbol}MarketId`] as `0x${string}`,
  lltv: BigInt((d[`${symbol}Lltv`] as number | string | undefined) ?? 0),
}));

export const assetByToken = (token?: string) =>
  ASSETS.find((a) => a.token.toLowerCase() === (token ?? "").toLowerCase());

export const ZERO: Address = "0x0000000000000000000000000000000000000000";
export const MAX_UINT = (1n << 256n) - 1n;

/** Assets that can be locked and borrowed against. */
export const BORROWABLE = ASSETS.filter((a) => a.borrowable);
