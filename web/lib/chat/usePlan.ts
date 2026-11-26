"use client";

import { useEffect, useRef, useState } from "react";
import { erc20Abi, type Abi } from "viem";
import { usePublicClient } from "wagmi";
import { mockSellDeskAbi, routerAbi } from "../abis";
import { ADDR, ZERO, type Address } from "../contracts";
import { parseUsdc } from "../format";
import type { Portfolio } from "../usePortfolio";
import { assetBySymbol, type BuildContext, type BuildResult, type Plan } from "./buildCalls";
import type { Intent } from "./intent";
import { makeCard, type CardReads } from "./plan";
import { decidePrecheck, needsPrecheck, PRECHECK_TIMEOUT_MS, type PrecheckState, type SimOutcome } from "./precheck";

type Client = NonNullable<ReturnType<typeof usePublicClient>>;

/** One shared object, so the state stays the same between renders while a check runs. */
const CHECKING: PrecheckState = { status: "checking" };

/** Simulates every call of the card in order, from the connected wallet, in one eth_simulateV1 request. */
async function simulate(client: Client, me: Address, plan: Plan): Promise<SimOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("pre-check timed out")), PRECHECK_TIMEOUT_MS);
  });
  try {
    const r = await Promise.race([
      client.simulateCalls({
        account: me,
        calls: plan.calls.map((c) => ({ to: c.address, abi: c.abi as Abi, functionName: c.functionName, args: c.args ?? [] })),
      }),
      timeout,
    ]);
    const results = r.results as readonly { status: "success" | "failure"; error?: Error }[];
    return { kind: "results", results: results.map((x) => ({ status: x.status, error: x.error })) };
  } catch {
    return { kind: "rpc-error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads what one intent needs from the chain (oracle quote, sell desk spread and reserve, allowances),
 * builds the card once with lib/chat/plan.ts (buildPlan) for the CONNECTED wallet, then pre-checks it:
 * every call is simulated in order on Base Sepolia (lib/chat/precheck.ts says what the card shows).
 *
 * The card is frozen from then on: it never changes its amounts while the person looks at it, and it
 * expires after two minutes (CARD_TTL_SEC). A new `nonce` for the same intent (the "Refresh numbers"
 * button) reads the chain again, rebuilds through the same path with a fresh expiry, and checks again.
 * When the person confirms, useTx simulates each step again before the wallet opens if the wallet
 * signs step by step; a wallet that signs a batch at once is not simulated again by useTx.
 */
export function usePlan(intent: Intent | null, nonce: number, p: Portfolio, me: Address | undefined): { result: BuildResult | null; check?: PrecheckState } {
  const client = usePublicClient();
  const [built, setBuilt] = useState<{ intent: Intent; nonce: number; result: BuildResult } | null>(null);
  const [checked, setChecked] = useState<{ plan: Plan; state: PrecheckState } | null>(null);
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
      const reads: CardReads = { quotes, toVault: 0n, toDesk: 0n, vaultUsdcAllowance: 0n };
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
        reads.toDesk = allowance ?? 0n;
      }
      if (intent.action === "borrow" && asset && vault && vault !== ZERO) {
        reads.toVault = (await read<bigint>({ address: asset.token, abi: erc20Abi, functionName: "allowance", args: [me, vault] })) ?? 0n;
      }
      if (intent.action === "repay" && p.vault) {
        reads.vaultUsdcAllowance = (await read<bigint>({ address: ADDR.usdc, abi: erc20Abi, functionName: "allowance", args: [me, p.vault] })) ?? 0n;
      }
      const result = makeCard(intent, p, me, reads, Math.floor(Date.now() / 1000));
      if (cancelled) return;
      // Show the card at once; the pre-check result arrives a moment later.
      setBuilt({ intent, nonce, result });
      if (!needsPrecheck(result)) return;
      const outcome = await simulate(client, me, result);
      if (!cancelled) setChecked({ plan: result, state: decidePrecheck(outcome, result) });
    })();
    return () => {
      cancelled = true;
    };
  }, [intent, nonce, me, client, ready]);

  const result = intent && built && built.intent === intent && built.nonce === nonce ? built.result : null;
  // "checking" is derived: the card exists and its own check has not come back yet.
  const check: PrecheckState | undefined = !needsPrecheck(result) ? undefined : checked?.plan === result ? checked.state : CHECKING;
  return { result, check };
}
