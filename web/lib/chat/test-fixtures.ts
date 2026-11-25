import { ASSETS, type Address } from "../contracts.ts";
import type { BuildContext, PositionLike } from "./buildCalls.ts";

/** Test fixtures for the chat builder tests. Made-up balances; real asset list and contract addresses. */

export const ME = "0x1111111111111111111111111111111111111111" as Address;
export const VAULT = "0x2222222222222222222222222222222222222222" as Address;
export const ATTACKER = "0x9999999999999999999999999999999999999999" as Address;
export const usd = (n: number) => BigInt(Math.round(n * 1e6));
export const tokens = (n: number, decimals: number) => BigInt(Math.round(n * 1e6)) * 10n ** BigInt(decimals - 6);

/** One position per deployed asset at its start price, nothing held unless `overrides` says so. */
export function positions(overrides: Record<string, Partial<PositionLike>> = {}): PositionLike[] {
  return ASSETS.map((asset) => ({
    asset,
    price: asset.startPrice,
    idle: 0n,
    wallet: 0n,
    collateral: 0n,
    debt: 0n,
    fee: 0n,
    liquidity: asset.borrowable ? usd(100_000) : undefined,
    transfersPaused: false,
    recurring: undefined,
    ...overrides[asset.symbol],
  }));
}

export function ctx(over: Partial<BuildContext> = {}): BuildContext {
  return {
    me: ME,
    vault: VAULT,
    predictedVault: VAULT,
    positions: positions(),
    borrowCapBps: 5000n,
    walletUsdc: usd(1000),
    routerAllowance: 0n,
    vaultUsdcAllowance: 0n,
    assetAllowance: { toVault: 0n, toDesk: 0n },
    quotes: {},
    nowSec: 1_800_000_000,
    ...over,
  };
}

/** Every address that appears in a call's arguments, lowercased. */
export function addressArgs(args: readonly unknown[] | undefined): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) out.push(v.toLowerCase());
    else if (Array.isArray(v)) v.forEach(walk);
  };
  walk(args ?? []);
  return out;
}
