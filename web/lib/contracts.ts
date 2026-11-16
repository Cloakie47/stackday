import deployment from "./deployment.json";

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
};

export const SIP_FEE_BPS = BigInt(d.sipFeeBps as number);
/** Shortest payroll schedule the contract allows on this network, in seconds. */
export const MIN_SCHEDULE_INTERVAL = Number(d.minScheduleInterval ?? 86400);

export type Asset = {
  symbol: string;
  name: string;
  /** The real token this mock stands in for on Base mainnet. */
  realTicker: string;
  kind: "stock" | "crypto";
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
};

/** Mock asset tokens on Base Sepolia. On Base mainnet these would be the real tokens named in `realTicker`. */
export const ASSETS: Asset[] = (d.assetSymbols as string[]).map((symbol) => ({
  symbol,
  ...META[symbol],
  token: d[symbol] as Address,
  feed: d[`${symbol}Feed`] as Address,
  adapter: d[`${symbol}LendingAdapter`] as Address,
  marketId: d[`${symbol}MarketId`] as `0x${string}`,
  lltv: BigInt(d[`${symbol}Lltv`] as number | string),
}));

export const assetByToken = (token?: string) =>
  ASSETS.find((a) => a.token.toLowerCase() === (token ?? "").toLowerCase());

export const ZERO: Address = "0x0000000000000000000000000000000000000000";
export const MAX_UINT = (1n << 256n) - 1n;
