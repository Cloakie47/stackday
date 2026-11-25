"use client";

import { useEffect, useRef, useState } from "react";
import { erc20Abi } from "viem";
import { usePublicClient } from "wagmi";
import { mockSellDeskAbi, routerAbi } from "../abis";
import { ADDR, ZERO, type Address } from "../contracts";
import { parseUsdc } from "../format";
import type { Portfolio } from "../usePortfolio";
import { assetBySymbol, buildPlan, type BuildContext, type BuildResult } from "./buildCalls";
import type { Intent } from "./intent";

/**
 * Reads what one intent needs from the chain (oracle quote, sell desk spread and reserve, allowances),
 * then builds the card once with lib/chat/buildCalls.ts for the CONNECTED wallet. The card is frozen
 * from then on: it never changes its amounts while the person looks at it, and it expires after
 * two minutes (CARD_TTL_SEC). useTx simulates every call again before the wallet opens.
 */
export function usePlan(intent: Intent | null, p: Portfolio, me: Address | undefined) {
  const client = usePublicClient();
  const [result, setResult] = useState<BuildResult | null>(null);
  const [key, setKey] = useState<Intent | null>(null);
  const latest = useRef(p);
  useEffect(() => {
    latest.current = p;
  });
  const ready = !!intent && !!me && !!client && !p.loading;

  useEffect(() => {
    if (!intent || !me || !client || !ready) return;
    let cancelled = false;
    const p = latest.current;
    (async () => {
      const vault = p.vault ?? p.predictedVault;
      const asset = "asset" in intent.params ? assetBySymbol(intent.params.asset as string) : undefined;
      const read = <T,>(c: Parameters<typeof client.readContract>[0]) => client.readContract(c).then((x) => x as T).catch(() => undefined);
      const quotes: BuildContext["quotes"] = {};
      let toVault = 0n;
      let toDesk = 0n;
      let vaultUsdcAllowance = 0n;
      if (intent.action === "buy" && asset) {
        quotes.oracleOut = await read<bigint>({ address: ADDR.router, abi: routerAbi, functionName: "quoteAtOracle", args: [asset.token, parseUsdc(intent.params.usdc)] });
      }
      if (intent.action === "sell" && asset) {
        const [spread, reserve, allowance] = await Promise.all([
          read<number>({ address: ADDR.sellDesk, abi: mockSellDeskAbi, functionName: "spreadBps" }),
          read<bigint>({ address: ADDR.usdc, abi: erc20Abi, functionName: "balanceOf", args: [ADDR.sellDesk] }),
          read<bigint>({ address: asset.token, abi: erc20Abi, functionName: "allowance", args: [me, ADDR.sellDesk] }),
        ]);
        quotes.deskSpreadBps = spread === undefined ? undefined : BigInt(spread);
        quotes.deskReserve = reserve;
        toDesk = allowance ?? 0n;
      }
      if (intent.action === "borrow" && asset && vault && vault !== ZERO) {
        toVault = (await read<bigint>({ address: asset.token, abi: erc20Abi, functionName: "allowance", args: [me, vault] })) ?? 0n;
      }
      if (intent.action === "repay" && p.vault) {
        vaultUsdcAllowance = (await read<bigint>({ address: ADDR.usdc, abi: erc20Abi, functionName: "allowance", args: [me, p.vault] })) ?? 0n;
      }
      const ctx: BuildContext = {
        me,
        vault: p.vault,
        predictedVault: p.predictedVault,
        positions: p.positions,
        borrowCapBps: p.borrowCapBps,
        walletUsdc: p.walletUsdc,
        routerAllowance: p.routerAllowance,
        vaultUsdcAllowance,
        assetAllowance: { toVault, toDesk },
        quotes,
        nowSec: Math.floor(Date.now() / 1000),
      };
      const built = buildPlan(intent, ctx);
      if (!cancelled) {
        setKey(intent);
        setResult(built);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [intent, me, client, ready]);

  return intent && key === intent ? result : null;
}
