"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReadContract, useReadContracts } from "wagmi";
import { giftBoxAbi } from "@/lib/abis";
import { GIFT_BOX, type Address } from "@/lib/contracts";
import { useSession } from "@/lib/useAccount";
import type { MixLeg } from "./mix";
import { giftsFor, openable, recentIds, type ChainGift } from "./status";

/** Newest boxes read from the chain. GiftBox has no per-wallet list, so the page reads recent ids. */
const MAX_READ = 200;

export type Gift = ChainGift & { legs: MixLeg[] };

/** Seconds since 1970, ticking every 15 seconds (0 until the page is in the browser). */
export function useNowSeconds() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Every gift box this wallet sent or received, read straight from GiftBox (giftOf and legsOf for the
 * newest boxes). The chain is the truth for status. Messages come from /api/gifts when the account
 * database is connected and the wallet is signed in.
 */
export function useGifts(address: string | undefined) {
  const enabled = !!GIFT_BOX && !!address;
  const next = useReadContract({
    address: GIFT_BOX,
    abi: giftBoxAbi,
    functionName: "nextId",
    query: { enabled, refetchInterval: 20_000 },
  });
  const ids = useMemo(() => (next.data ? recentIds(next.data as bigint, MAX_READ) : []), [next.data]);
  const reads = useReadContracts({
    contracts: ids.flatMap((id) => [
      { address: GIFT_BOX!, abi: giftBoxAbi, functionName: "giftOf", args: [id] } as const,
      { address: GIFT_BOX!, abi: giftBoxAbi, functionName: "legsOf", args: [id] } as const,
    ]),
    query: { enabled: enabled && ids.length > 0 },
  });

  const all = useMemo<Gift[]>(() => {
    const out: Gift[] = [];
    ids.forEach((id, i) => {
      const g = reads.data?.[i * 2]?.result as
        | { sender: Address; recipient: Address; usdc: bigint; expiresAt: number; kind: number; status: number }
        | undefined;
      const legs = (reads.data?.[i * 2 + 1]?.result as readonly { asset: Address; weightBps: number }[] | undefined) ?? [];
      if (!g || Number(g.status) === 0) return;
      out.push({
        id,
        sender: g.sender,
        recipient: g.recipient,
        usdc: g.usdc,
        expiresAt: Number(g.expiresAt),
        kind: Number(g.kind),
        status: Number(g.status),
        legs: legs.map((l) => ({ token: l.asset, weightBps: Number(l.weightBps) })),
      });
    });
    return out;
  }, [ids, reads.data]);

  const { received, sent } = useMemo(() => giftsFor(all, address), [all, address]);
  const mineIds = useMemo(() => [...received, ...sent].map((g) => g.id.toString()).sort(), [received, sent]);

  const session = useSession();
  const messages = useQuery({
    queryKey: ["gift-messages", address?.toLowerCase(), mineIds.join(",")],
    queryFn: async () => {
      const res = await fetch(`/api/gifts?ids=${mineIds.join(",")}`);
      if (!res.ok) return {} as Record<string, string>;
      return ((await res.json()) as { messages: Record<string, string> }).messages ?? {};
    },
    enabled: session.configured && session.signedIn && mineIds.length > 0,
    staleTime: 30_000,
  });

  return {
    deployed: !!GIFT_BOX,
    received: received as Gift[],
    sent: sent as Gift[],
    messages: messages.data ?? {},
    loading: enabled && (next.isLoading || (ids.length > 0 && reads.isLoading)),
    error: next.error ?? reads.error,
    refetch: async () => {
      await next.refetch();
      await reads.refetch();
    },
  };
}

/** How many gifts this wallet can open right now (for the menu badge and the Home card). */
export function usePendingGifts(address: string | undefined) {
  const g = useGifts(address);
  const now = useNowSeconds();
  const list = now ? (openable(g.received, now) as Gift[]) : [];
  return { list, count: list.length, messages: g.messages };
}
