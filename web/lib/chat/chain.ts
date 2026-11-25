import { createPublicClient, erc20Abi, http, type ContractFunctionParameters } from "viem";
import { baseSepolia } from "viem/chains";
import { factoryAbi, lendingAdapterAbi, mockFeedAbi, routerAbi, vaultAbi } from "../abis.ts";
import { ADDR, ASSETS, ZERO, type Address } from "../contracts.ts";
import type { Holding, Snapshot } from "./summary.ts";

/**
 * Server only: reads one wallet's balances, loans and plans from Base Sepolia for the chat read
 * tools, with view calls only (never a transaction). The same contract reads usePortfolio makes in
 * the browser, in one multicall. Addresses stay here; summary.ts turns this into symbol-only text.
 */

const PER = 10;

export async function readSnapshot(wallet: Address): Promise<Snapshot> {
  const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org", { timeout: 8_000 }) });
  const vault = (await client.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: "vaultOf", args: [wallet] })) as Address;
  const hasVault = vault !== ZERO;
  const v = hasVault ? vault : ZERO;
  const calls = ASSETS.flatMap((a) => [
    { address: a.feed, abi: mockFeedAbi, functionName: "latestRoundData" },
    { address: a.token, abi: erc20Abi, functionName: "balanceOf", args: [v] },
    { address: a.token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] },
    { address: a.adapter, abi: lendingAdapterAbi, functionName: "collateralOf", args: [v] },
    { address: a.adapter, abi: lendingAdapterAbi, functionName: "debtOf", args: [v] },
    { address: a.adapter, abi: lendingAdapterAbi, functionName: "maxDebt", args: [v] },
    { address: a.adapter, abi: lendingAdapterAbi, functionName: "healthFactor", args: [v] },
    { address: a.adapter, abi: lendingAdapterAbi, functionName: "availableLiquidity" },
    { address: ADDR.router, abi: routerAbi, functionName: "planOf", args: [wallet, a.token] },
    { address: v, abi: vaultAbi, functionName: "borrowFeeOf", args: [a.token] },
  ]);
  const tail = [
    { address: ADDR.usdc, abi: erc20Abi, functionName: "balanceOf", args: [wallet] },
    { address: ADDR.usdc, abi: erc20Abi, functionName: "balanceOf", args: [v] },
    { address: v, abi: vaultAbi, functionName: "borrowCapBps" },
  ];
  const res = await client.multicall({ contracts: [...calls, ...tail] as unknown as readonly ContractFunctionParameters[], allowFailure: true });
  const get = <T>(i: number): T | undefined => (res[i]?.status === "success" ? (res[i].result as T) : undefined);

  const holdings: Holding[] = ASSETS.map((asset, n) => {
    const o = n * PER;
    const round = get<readonly [bigint, bigint, bigint, bigint, bigint]>(o);
    const plan = get<readonly [Address, bigint, number, number, number]>(o + 8);
    const lend = asset.borrowable && hasVault;
    return {
      asset,
      price: round?.[1],
      priceUpdatedAt: round?.[3],
      idle: hasVault ? (get<bigint>(o + 1) ?? 0n) : 0n,
      wallet: get<bigint>(o + 2) ?? 0n,
      collateral: lend ? (get<bigint>(o + 3) ?? 0n) : 0n,
      debt: lend ? (get<bigint>(o + 4) ?? 0n) : 0n,
      maxDebt: lend ? (get<bigint>(o + 5) ?? 0n) : 0n,
      health: lend ? get<bigint>(o + 6) : undefined,
      liquidity: asset.borrowable ? get<bigint>(o + 7) : undefined,
      recurring: plan && plan[1] > 0n ? { usdcPerBuy: plan[1], interval: plan[2], nextBuyAt: plan[3] } : undefined,
      fee: lend ? (get<bigint>(o + 9) ?? 0n) : 0n,
    };
  });
  const t = ASSETS.length * PER;
  return {
    hasVault,
    walletUsdc: get<bigint>(t) ?? 0n,
    vaultUsdc: hasVault ? (get<bigint>(t + 1) ?? 0n) : 0n,
    borrowCapBps: BigInt(hasVault ? (get<number>(t + 2) ?? 5000) : 5000),
    holdings,
  };
}
