"use client";

import { useEffect, useRef, useState } from "react";
import { erc20Abi, type Abi, type ReadContractParameters } from "viem";
import { usePublicClient } from "wagmi";
import { factoryAbi, mockSellDeskAbi, routerAbi, vaultAbi } from "../abis";
import { ADDR, ASSETS, EARN_FEE_BPS, GIFT_BOX, ZERO, type Address } from "../contracts";
import { parseUsdc } from "../format";
import { surpriseMix } from "../gifts/mix";
import { searchPeople } from "../useAccount";
import type { Portfolio } from "../usePortfolio";
import { assetBySymbol, earnFeeNow, type BuildContext, type BuildResult, type Plan, type RecipientInfo } from "./buildCalls";
import type { Intent } from "./intent";
import { makeCard, type CardReads } from "./plan";
import { decidePrecheck, needsPrecheck, PRECHECK_TIMEOUT_MS, type PrecheckState, type SimOutcome } from "./precheck";
import { pickRecipient, typedAddress } from "./recipient";

type Client = NonNullable<ReturnType<typeof usePublicClient>>;
type Read = <T>(c: ReadContractParameters) => Promise<T | undefined>;

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

/** A Stackday ID or username to one person, through /api/people (exactly one exact match, not me). */
async function byId(asked: string, me: Address, read: Read): Promise<RecipientInfo> {
  let people;
  try {
    people = (await searchPeople(asked)).people;
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? `Could not look them up: ${e.message}` : "Could not look them up right now." };
  }
  const picked = pickRecipient(asked, people, me);
  if (!picked.ok) return picked;
  const vault = await read<Address>({ address: ADDR.factory, abi: factoryAbi, functionName: "vaultOf", args: [picked.person.wallet] });
  return { ok: true, typed: false, wallet: picked.person.wallet, uid: picked.person.uid, username: picked.person.username, vault: vault && vault !== ZERO ? vault : undefined };
}

/** The one address the person typed in this message; its Stackday name if it has a profile (best effort). */
async function byTypedAddress(userText: string | undefined, own: (string | undefined)[]): Promise<RecipientInfo> {
  const t = typedAddress(userText, own);
  if (!t.ok) return t;
  let uid: string | null = null;
  let username: string | null = null;
  try {
    const hit = (await searchPeople(t.address)).people.filter((x) => x.wallet.toLowerCase() === t.address.toLowerCase());
    if (hit.length === 1) ({ uid, username } = hit[0]);
  } catch {
    /* a name is only a nicety: the send works without it */
  }
  return { ok: true, typed: true, wallet: t.address, uid, username };
}

/**
 * Reads what one intent needs from the chain (oracle quote, sell desk spread and reserve, allowances,
 * earning position) and, for a gift or send, resolves the recipient; then builds the card once with
 * lib/chat/plan.ts (buildPlan) for the CONNECTED wallet, and pre-checks it: every call is simulated in
 * order on Base Sepolia (lib/chat/precheck.ts says what the card shows).
 *
 * `userText` is the person's own typed text of the message that produced this intent, unredacted and
 * held only in the browser. A typed_address send takes its address from there and nowhere else.
 *
 * The card is frozen from then on: it never changes its amounts while the person looks at it, and it
 * expires after two minutes (CARD_TTL_SEC). A new `nonce` for the same intent (the "Refresh numbers"
 * button) reads the chain again, rebuilds through the same path with a fresh expiry, and checks again.
 * When the person confirms, useTx simulates each step again before the wallet opens if the wallet
 * signs step by step; a wallet that signs a batch at once is not simulated again by useTx.
 */
export function usePlan(intent: Intent | null, nonce: number, p: Portfolio, me: Address | undefined, userText?: string): { result: BuildResult | null; check?: PrecheckState } {
  const client = usePublicClient();
  const [built, setBuilt] = useState<{ intent: Intent; nonce: number; result: BuildResult } | null>(null);
  const [checked, setChecked] = useState<{ plan: Plan; state: PrecheckState } | null>(null);
  const latest = useRef({ p, userText });
  useEffect(() => {
    latest.current = { p, userText };
  });
  const ready = !!intent && !!me && !!client && !p.loading;

  useEffect(() => {
    if (!intent || !me || !client || !ready) return;
    let cancelled = false;
    const { p, userText } = latest.current;
    (async () => {
      const vault = p.vault ?? p.predictedVault;
      const assetSym = "asset" in intent.params ? (intent.params.asset as string | undefined) : undefined;
      const asset = assetSym ? assetBySymbol(assetSym) : undefined;
      const read: Read = <T,>(c: ReadContractParameters) =>
        client
          .readContract(c)
          .then((x) => x as T)
          .catch(() => undefined);
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
      if ((intent.action === "repay" || intent.action === "earn") && vault && vault !== ZERO) {
        reads.vaultUsdcAllowance = (await read<bigint>({ address: ADDR.usdc, abi: erc20Abi, functionName: "allowance", args: [me, vault] })) ?? 0n;
      }
      if (intent.action === "earn" || intent.action === "stop_earning") {
        reads.yieldAdapter = await read<Address>({ address: ADDR.factory, abi: factoryAbi, functionName: "yieldAdapter" });
        if (p.vault) {
          const [balance, principal, owed, at] = await Promise.all([
            read<bigint>({ address: p.vault, abi: vaultAbi, functionName: "earningBalance" }),
            read<bigint>({ address: p.vault, abi: vaultAbi, functionName: "earnPrincipal" }),
            read<bigint>({ address: p.vault, abi: vaultAbi, functionName: "earnFeeOwed" }),
            read<number>({ address: p.vault, abi: vaultAbi, functionName: "earnFeeUpdatedAt" }),
          ]);
          if (balance !== undefined && principal !== undefined) {
            reads.earning = { balance, principal, feeOwed: earnFeeNow(owed ?? 0n, principal, BigInt(at ?? 0), EARN_FEE_BPS, Math.floor(Date.now() / 1000)) };
          }
        }
      }
      if (intent.action === "gift") {
        reads.recipient = await byId(intent.params.recipient_id, me, read);
        const allowance = GIFT_BOX ? await read<bigint>({ address: ADDR.usdc, abi: erc20Abi, functionName: "allowance", args: [me, GIFT_BOX] }) : 0n;
        let researchReady = false;
        if (intent.params.box === "research_pick") {
          researchReady = await fetch("/api/gifts/research")
            .then((r) => r.json())
            .then((b: { pick?: unknown }) => !!b.pick)
            .catch(() => false);
        }
        reads.gift = { allowance: allowance ?? 0n, researchReady, ...(intent.params.box === "surprise" ? { surprise: surpriseMix(ASSETS.map((a) => a.token)) } : {}) };
      }
      if (intent.action === "send") {
        reads.recipient = intent.params.to.kind === "id" ? await byId(intent.params.to.id, me, read) : await byTypedAddress(userText, [me, p.vault, p.predictedVault]);
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
