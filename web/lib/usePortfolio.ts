"use client";

import { erc20Abi, type ContractFunctionParameters } from "viem";
import { useReadContracts } from "wagmi";
import { factoryAbi, lendingAdapterAbi, mockFeedAbi, mockStockAbi, payrollAbi, routerAbi, vaultAbi } from "./abis";
import { ADDR, ASSETS, ZERO, type Address, type Asset } from "./contracts";
import { assetValue } from "./format";

type Calls = readonly ContractFunctionParameters[];
const REFRESH = 10_000;

export type Position = {
  asset: Asset;
  price?: bigint; // 8 decimals
  priceUpdatedAt?: bigint;
  feedFrozen?: boolean;
  transfersPaused?: boolean;
  idle: bigint; // in vault, not collateral
  wallet: bigint;
  collateral: bigint;
  debt: bigint; // USDC
  maxDebt: bigint; // USDC debt at which liquidation starts
  health?: bigint;
  ratePerSecond?: bigint;
  liquidity?: bigint;
  value: bigint; // USDC value of idle + collateral
  /** Recurring buy plan from the wallet (no employer needed). */
  recurring?: { usdcPerBuy: bigint; interval: number; nextBuyAt: number; slippageBps: number };
};

export type Schedule = {
  id: bigint;
  employer: Address;
  interval: number;
  nextPayAt: number;
  active: boolean;
  total: bigint;
  employees: readonly Address[];
  amounts: readonly bigint[];
  /** Salary of the viewed address in this schedule (0 if not in it). */
  mine: bigint;
};

export type Portfolio = ReturnType<typeof usePortfolio>;

function r<T>(data: readonly { result?: unknown }[] | undefined, i: number): T | undefined {
  return data?.[i]?.result as T | undefined;
}

/** Everything the app shows about one address, refreshed every 10 seconds. */
export function usePortfolio(user: Address | undefined) {
  const who = user ?? ZERO;

  const base = useReadContracts({
    contracts: [
      { address: ADDR.factory, abi: factoryAbi, functionName: "vaultOf", args: [who] },
      { address: ADDR.factory, abi: factoryAbi, functionName: "predictVault", args: [who] },
      { address: ADDR.payroll, abi: payrollAbi, functionName: "runIdsOf", args: [who] },
      { address: ADDR.payroll, abi: payrollAbi, functionName: "sipPlan", args: [who] },
      { address: ADDR.payroll, abi: payrollAbi, functionName: "emergencyRuleOf", args: [who] },
      { address: ADDR.payroll, abi: payrollAbi, functionName: "emergencyActive", args: [who] },
      { address: ADDR.usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] },
      { address: ADDR.payroll, abi: payrollAbi, functionName: "employerBalance", args: [who] },
      { address: ADDR.payroll, abi: payrollAbi, functionName: "schedulesOfEmployee", args: [who] },
      { address: ADDR.payroll, abi: payrollAbi, functionName: "schedulesOfEmployer", args: [who] },
    ] as unknown as Calls,
    query: { refetchInterval: REFRESH },
  });

  const vault = r<Address>(base.data, 0);
  const hasVault = !!vault && vault !== ZERO;
  const predictedVault = r<Address>(base.data, 1);
  const runIds = (r<readonly bigint[]>(base.data, 2) ?? []).slice(-60);
  const asEmployee = user ? (r<readonly bigint[]>(base.data, 8) ?? []).slice(-12) : [];
  const asEmployer = user ? (r<readonly bigint[]>(base.data, 9) ?? []).slice(-12) : [];
  const scheduleIds = Array.from(new Set([...asEmployee, ...asEmployer].map((x) => x.toString()))).map(BigInt);
  const v = hasVault ? vault! : ZERO;

  const PER = 12;
  const assetCalls = ASSETS.flatMap((a) => [
    { address: a.feed, abi: mockFeedAbi, functionName: "latestRoundData" },
    { address: a.feed, abi: mockFeedAbi, functionName: "frozen" },
    { address: a.token, abi: mockStockAbi, functionName: "transfersPaused" },
    { address: a.token, abi: erc20Abi, functionName: "balanceOf", args: [v] },
    { address: a.token, abi: erc20Abi, functionName: "balanceOf", args: [who] },
    { address: a.adapter, abi: lendingAdapterAbi, functionName: "collateralOf", args: [v] },
    { address: a.adapter, abi: lendingAdapterAbi, functionName: "debtOf", args: [v] },
    { address: a.adapter, abi: lendingAdapterAbi, functionName: "maxDebt", args: [v] },
    { address: a.adapter, abi: lendingAdapterAbi, functionName: "healthFactor", args: [v] },
    { address: a.adapter, abi: lendingAdapterAbi, functionName: "borrowRatePerSecond" },
    { address: a.adapter, abi: lendingAdapterAbi, functionName: "availableLiquidity" },
    { address: ADDR.router, abi: routerAbi, functionName: "planOf", args: [who, a.token] },
  ]);
  const vaultCalls = hasVault
    ? [
        { address: v, abi: vaultAbi, functionName: "borrowCapBps" },
        { address: v, abi: vaultAbi, functionName: "earningBalance" },
        { address: ADDR.usdc, abi: erc20Abi, functionName: "balanceOf", args: [v] },
      ]
    : [];
  const claimCalls = runIds.map((id) => ({
    address: ADDR.payroll,
    abi: payrollAbi,
    functionName: "claimable",
    args: [id, who],
  }));
  const scheduleCalls = scheduleIds.map((id) => ({
    address: ADDR.payroll,
    abi: payrollAbi,
    functionName: "getSchedule",
    args: [id],
  }));

  const detail = useReadContracts({
    contracts: [...assetCalls, ...vaultCalls, ...claimCalls, ...scheduleCalls] as unknown as Calls,
    query: { refetchInterval: REFRESH, enabled: base.isSuccess },
  });

  const positions: Position[] = ASSETS.map((asset, n) => {
    const o = n * PER;
    const round = r<readonly [bigint, bigint, bigint, bigint, bigint]>(detail.data, o);
    const price = round?.[1];
    const idle = hasVault ? (r<bigint>(detail.data, o + 3) ?? 0n) : 0n;
    const collateral = r<bigint>(detail.data, o + 5) ?? 0n;
    const plan = r<readonly [Address, bigint, number, number, number]>(detail.data, o + 11);
    return {
      asset,
      price,
      priceUpdatedAt: round?.[3],
      feedFrozen: r<boolean>(detail.data, o + 1),
      transfersPaused: r<boolean>(detail.data, o + 2),
      idle,
      wallet: user ? (r<bigint>(detail.data, o + 4) ?? 0n) : 0n,
      collateral,
      debt: r<bigint>(detail.data, o + 6) ?? 0n,
      maxDebt: r<bigint>(detail.data, o + 7) ?? 0n,
      health: r<bigint>(detail.data, o + 8),
      ratePerSecond: r<bigint>(detail.data, o + 9),
      liquidity: r<bigint>(detail.data, o + 10),
      value: price ? assetValue(idle + collateral, price, asset.decimals) : 0n,
      recurring:
        user && plan && plan[1] > 0n
          ? { usdcPerBuy: plan[1], interval: plan[2], nextBuyAt: plan[3], slippageBps: plan[4] }
          : undefined,
    };
  });

  const vo = ASSETS.length * PER;
  const borrowCapBps = hasVault ? (r<number>(detail.data, vo) ?? 5000) : 5000;
  const earning = hasVault ? (r<bigint>(detail.data, vo + 1) ?? 0n) : 0n;
  const vaultUsdc = hasVault ? (r<bigint>(detail.data, vo + 2) ?? 0n) : 0n;
  const co = vo + vaultCalls.length;
  const claims = runIds
    .map((id, i) => ({ runId: id, amount: r<bigint>(detail.data, co + i) ?? 0n }))
    .filter((c) => c.amount > 0n)
    .reverse();
  const so = co + claimCalls.length;
  const schedules: Schedule[] = scheduleIds
    .map((id, i) => {
      const s = r<readonly [Address, number, number, boolean, bigint, readonly Address[], readonly bigint[]]>(
        detail.data,
        so + i,
      );
      if (!s) return undefined;
      const idx = s[5].findIndex((e) => e.toLowerCase() === who.toLowerCase());
      return {
        id,
        employer: s[0],
        interval: s[1],
        nextPayAt: s[2],
        active: s[3],
        total: s[4],
        employees: s[5],
        amounts: s[6],
        mine: idx >= 0 ? s[6][idx] : 0n,
      };
    })
    .filter((s): s is Schedule => !!s);

  const plan = r<readonly [readonly Address[], readonly number[]]>(base.data, 3);
  const emergencyRule = r<readonly [Address, number, bigint]>(base.data, 4);

  return {
    user,
    loading: base.isLoading || detail.isLoading,
    vault: hasVault ? vault! : undefined,
    predictedVault,
    positions,
    claims,
    totalClaimable: claims.reduce((a, c) => a + c.amount, 0n),
    borrowCapBps: BigInt(borrowCapBps),
    earning,
    vaultUsdc,
    walletUsdc: user ? (r<bigint>(base.data, 6) ?? 0n) : 0n,
    employerBalance: user ? (r<bigint>(base.data, 7) ?? 0n) : 0n,
    /** Standing instruction: share of every salary per asset. */
    sipPlan: plan && user ? plan[0].map((asset, i) => ({ asset, bps: BigInt(plan[1][i]) })) : [],
    emergencyRule:
      emergencyRule && emergencyRule[1] > 0
        ? { asset: emergencyRule[0], bps: BigInt(emergencyRule[1]), threshold: emergencyRule[2] }
        : undefined,
    emergencyActive: r<boolean>(base.data, 5) ?? false,
    schedulesPayingMe: schedules.filter((s) => s.mine > 0n),
    schedulesIRun: schedules.filter((s) => user && s.employer.toLowerCase() === user.toLowerCase()),
    totalAssetValue: positions.reduce((a, p) => a + p.value, 0n),
    totalDebt: positions.reduce((a, p) => a + p.debt, 0n),
  };
}
