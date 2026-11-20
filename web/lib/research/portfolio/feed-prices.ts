import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { mockFeedAbi } from "../../abis.ts";
import { ASSETS } from "../../contracts.ts";
import type { PriceQuote } from "./analyze.ts";
import type { FeedPriceReader } from "./handlers.ts";

/**
 * Prices for holdings research has no price for (assets outside the six, or a day with no reading),
 * read from Stackday's test price feeds on Base Sepolia. These are mock prices for the testnet demo,
 * labelled as such in every fact. Server only; read calls, never a transaction.
 */
const SOURCE = { name: "Stackday test price feed on Base Sepolia (mock price, not market data)", url: "https://sepolia.basescan.org" };
const FEED_DECIMALS = 1e8;

export const readStackdayFeedPrices: FeedPriceReader = async (assetIds) => {
  const assets = ASSETS.filter((a) => assetIds.includes(a.symbol) && /^0x[0-9a-fA-F]{40}$/.test(a.feed ?? ""));
  if (!assets.length) return {};
  const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org", { timeout: 5_000 }) });
  const results = await client.multicall({
    contracts: assets.map((a) => ({ address: a.feed, abi: mockFeedAbi, functionName: "latestRoundData" }) as const),
    allowFailure: true,
  });
  const out: Partial<Record<string, PriceQuote>> = {};
  results.forEach((r, i) => {
    if (r.status !== "success") return;
    const [, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
    const price = Number(answer) / FEED_DECIMALS;
    if (!(price > 0)) return;
    out[assets[i].symbol] = { price, source: SOURCE, asOf: new Date(Number(updatedAt) * 1000).toISOString() };
  });
  return out;
};
