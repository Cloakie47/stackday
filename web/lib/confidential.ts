"use client";

/**
 * Private pay through Fairblock StableTrust confidential transfers (real, not mocked).
 * https://docs.fairblock.network/ct/get-started/architecture
 *
 * USDC goes into Fairblock's contract on Base; balances and amounts are then encrypted, and only the
 * owner can decrypt them in their own browser with keys made from one wallet signature. Addresses
 * stay visible. Fairblock's network (FairyRing) processes each step, which can take a few minutes.
 *
 * This runs beside Stackday's Payroll contract, not inside it: the keys live in each person's
 * browser, so a contract cannot send private payments by itself. Stackday holds nothing here.
 */
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletClient } from "wagmi";
import type { ConfidentialTransferClient as Client } from "@fairblock/stabletrust";
import { ADDR, CHAIN_ID } from "./contracts";

/** Fairblock state lives on the real Base Sepolia chain, so reads always go there. */
const RPC = "https://sepolia.base.org";

let clientPromise: Promise<Client> | undefined;
/** One shared client: it caches each wallet's keys, so people sign once per visit. */
function getClient(): Promise<Client> {
  clientPromise ??= import("@fairblock/stabletrust").then((m) => new m.ConfidentialTransferClient(RPC, CHAIN_ID));
  return clientPromise;
}

/** Amounts move in whole cents: Fairblock keeps two decimals. */
export const CENT = 10_000n; // 0.01 USDC in 6-decimal units
export const isCents = (v: bigint) => v > 0n && v % CENT === 0n;

export type PrivateStatus = "off" | "confirming" | "processing" | "on";

/** A decrypted private balance. `pending` is incoming money not yet applied; `spendable` can be paid out now. */
export type PrivateBalance = { owner: string; total: bigint; pending: bigint; spendable: bigint; at: number };

/** Round down to whole cents, the smallest amount Fairblock moves. */
export const toCents = (v: bigint) => (v / CENT) * CENT;

/**
 * Has new private pay arrived that is not collected yet? Reads the encrypted incoming ("pending")
 * balance, which anyone can see exists but nobody can read: no signature, no amount. It is empty
 * once the person collects (a withdrawal applies it).
 */
export function usePrivatePayWaiting(address: string | undefined) {
  return useQuery({
    queryKey: ["private-waiting", address?.toLowerCase()],
    enabled: !!address,
    refetchInterval: 60_000,
    queryFn: async () => {
      const c = await getClient();
      const info = await c.getAccountInfo(address!);
      if (!info.exists) return false;
      // The SDK exposes the contract; getPending returns the two encrypted parts, "0x" when empty.
      const [c1] = (await (c as unknown as { contract: { getPending: (a: string, t: string) => Promise<[string, string]> } }).contract.getPending(
        address!,
        ADDR.usdc,
      )) as [string, string];
      return !!c1 && c1 !== "0x";
    },
  });
}

/** A person's standing split for private paydays. Percentages only, never amounts. Kept on this device. */
export type PrivateSplit = { pct: number; symbols: string[]; weights?: Record<string, number>; rest: "keep" | "withdraw" };
const SPLIT_KEY = (a: string) => `stackday-private-split-${a.toLowerCase()}`;
export function loadPrivateSplit(address: string | undefined): PrivateSplit | undefined {
  if (!address) return undefined;
  try {
    const v = JSON.parse(window.localStorage.getItem(SPLIT_KEY(address)) ?? "null");
    if (!v || typeof v.pct !== "number") return undefined;
    // Earlier saves held one asset as `symbol`.
    const symbols: string[] = Array.isArray(v.symbols) ? v.symbols : typeof v.symbol === "string" ? [v.symbol] : [];
    return symbols.length ? { pct: v.pct, symbols, weights: v.weights, rest: v.rest === "withdraw" ? "withdraw" : "keep" } : undefined;
  } catch {
    return undefined;
  }
}
export function savePrivateSplit(address: string | undefined, split: PrivateSplit | undefined) {
  if (!address) return;
  try {
    if (split) window.localStorage.setItem(SPLIT_KEY(address), JSON.stringify(split));
    else window.localStorage.removeItem(SPLIT_KEY(address));
  } catch {
    /* private window: not remembered */
  }
}

/**
 * A record of private payments on this device, for the person's own books and for sharing with an
 * accountant or auditor. Amounts are only stored here, in this browser; nothing goes to Stackday.
 */
export type PrivateRecord = {
  at: number;
  kind: "paid" | "collected" | "invested";
  who?: string;
  name?: string;
  amount: string;
  tx?: string;
  /** Which payday a payment belongs to (its start time), so the log can group them. */
  payday?: number;
  /** True for a private (Fairblock) payment, false for a normal Payroll payment. */
  private?: boolean;
};
const RECORDS_KEY = (a: string) => `stackday-private-records-${a.toLowerCase()}`;
const RECORDS_EVENT = "stackday-private-records";
export function loadPrivateRecords(address: string | undefined): PrivateRecord[] {
  if (!address) return [];
  try {
    const v = JSON.parse(window.localStorage.getItem(RECORDS_KEY(address)) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function addPrivateRecord(address: string | undefined, r: PrivateRecord) {
  if (!address) return;
  try {
    const all = [r, ...loadPrivateRecords(address)].slice(0, 500);
    window.localStorage.setItem(RECORDS_KEY(address), JSON.stringify(all));
    window.dispatchEvent(new Event(RECORDS_EVENT));
  } catch {
    /* private window: not recorded */
  }
}
export function usePrivateRecords(address: string | undefined) {
  const [records, setRecords] = useState<PrivateRecord[]>([]);
  useEffect(() => {
    const read = () => setRecords(loadPrivateRecords(address));
    read();
    window.addEventListener(RECORDS_EVENT, read);
    return () => window.removeEventListener(RECORDS_EVENT, read);
  }, [address]);
  return records;
}
/** CSV of the records, for an accountant or auditor. */
export function recordsCsv(records: PrivateRecord[]) {
  const head = "date,payday,type,private,person,wallet,amount_usdc,transaction";
  const esc = (s: string | undefined) => `"${(s ?? "").replace(/"/g, '""')}"`;
  const rows = records.map((r) =>
    [new Date(r.at).toISOString(), r.payday ? new Date(r.payday).toISOString() : "", r.kind, r.private === undefined ? "" : r.private ? "yes" : "no", esc(r.name), r.who ?? "", r.amount, r.tx ?? ""].join(","),
  );
  return [head, ...rows].join("\n");
}
export const fmt6 = (v: bigint) => (Number(v) / 1e6).toFixed(2);
const txHash = (r: unknown) => {
  const x = r as { hash?: string; transactionHash?: string } | undefined;
  return x?.hash ?? x?.transactionHash;
};

/**
 * Wait until Fairblock has finished the account's last step (each deposit, transfer or withdrawal is
 * processed by Fairblock's network and the account takes one step at a time). Testnet steps can take
 * a few minutes.
 */
export async function waitForFairblock(address: string, timeoutMs = 15 * 60_000) {
  const c = await getClient();
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const info = await c.getAccountInfo(address);
    if (info.exists && info.finalized && !info.pendingAction) return;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Fairblock is taking longer than usual. Your money is safe; refresh in a few minutes.");
}

/** What a withdrawal of `amount` delivers to the wallet after Fairblock's fees. */
export async function withdrawQuote(amount: bigint) {
  const c = await getClient();
  return c.getWithdrawalFeeQuote(ADDR.usdc, amount);
}

/** Can each of these addresses receive private pay right now? */
export async function readyToReceive(addresses: string[]): Promise<Record<string, boolean>> {
  const c = await getClient();
  const out: Record<string, boolean> = {};
  await Promise.all(
    addresses.map(async (a) => {
      try {
        const info = await c.getAccountInfo(a);
        out[a.toLowerCase()] = !!info.exists && !!info.finalized;
      } catch {
        out[a.toLowerCase()] = false;
      }
    }),
  );
  return out;
}

/** Account status for any address (no signature needed). */
export function usePrivateStatus(address: string | undefined) {
  return useQuery({
    queryKey: ["private-status", address?.toLowerCase()],
    enabled: !!address,
    queryFn: async (): Promise<PrivateStatus> => {
      const c = await getClient();
      const info = await c.getAccountInfo(address!);
      if (!info.exists) return "off";
      if (!info.finalized) return "confirming";
      return info.pendingAction ? "processing" : "on";
    },
    refetchInterval: (q) => (q.state.data === "confirming" || q.state.data === "processing" ? 6000 : false),
  });
}

export function usePrivatePay(address: string | undefined) {
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();
  const status = usePrivateStatus(address);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  // The decrypted balance is shared by every panel on the page (one unlock per visit), via the query cache.
  const balanceKey = ["private-balance", address?.toLowerCase()];
  const { data: balance } = useQuery<PrivateBalance | null>({ queryKey: balanceKey, queryFn: () => null, enabled: false, staleTime: Infinity });
  const setBalance = useCallback((b: PrivateBalance) => queryClient.setQueryData(["private-balance", b.owner], b), [queryClient]);

  const signer = useCallback(async () => {
    if (!walletClient) throw new Error("Connect your wallet first.");
    const { BrowserProvider, JsonRpcSigner } = await import("ethers");
    const provider = new BrowserProvider(walletClient.transport, { chainId: CHAIN_ID, name: "base-sepolia" });
    return new JsonRpcSigner(provider, walletClient.account.address);
  }, [walletClient]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["private-status"] });
    queryClient.invalidateQueries({ queryKey: ["private-waiting"] });
    queryClient.invalidateQueries({ queryKey: ["portfolio"] });
  }, [queryClient]);

  const act = useCallback(
    async (label: string, fn: (c: Client, s: Awaited<ReturnType<typeof signer>>) => Promise<unknown>, message: string) => {
      setError(undefined);
      setDone(undefined);
      setBusy(label);
      try {
        const [c, s] = await Promise.all([getClient(), signer()]);
        await fn(c, s);
        setDone(message);
        return true;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        setError(
          /user rejected|denied/i.test(m)
            ? "You cancelled in your wallet."
            : /Insufficient/i.test(m)
              ? "Not enough USDC for that."
              : m.replace(/^Failed to [^:]+: /, ""),
        );
        return false;
      } finally {
        setBusy(undefined);
        refresh();
      }
    },
    [signer, refresh],
  );

  /** Decrypt the balance with the keys (cached after the first signature of the visit). */
  const readBalance = useCallback(
    async (c: Client, s: Awaited<ReturnType<typeof signer>>) => {
      const owner = (await s.getAddress()).toLowerCase();
      const keys = await c.ensureAccount(s, { waitForFinalization: false });
      const b = await c.getConfidentialBalance(owner, keys.privateKey, ADDR.usdc);
      const total = BigInt(b.amount);
      const pending = BigInt(b.pending.amount);
      const next: PrivateBalance = { owner, total, pending, spendable: total - pending, at: Date.now() };
      setBalance(next);
      return next;
    },
    [setBalance],
  );

  const reveal = useCallback(
    () => act("Unlocking your private balance", readBalance, "Only you can see this balance. It was decrypted in your browser."),
    [act, readBalance],
  );

  /** Run a step, then (if the balance was unlocked) wait for Fairblock and show the new balance. */
  const step = (label: string, fn: (c: Client, s: Awaited<ReturnType<typeof signer>>) => Promise<unknown>, message: string) =>
    act(
      label,
      async (c, s) => {
        await fn(c, s);
        if (balance) {
          await waitForFairblock(await s.getAddress());
          await readBalance(c, s);
        }
      },
      message,
    );

  return {
    status: status.data,
    statusLoading: status.isLoading,
    busy,
    error,
    done,
    balance: balance ?? undefined,
    reveal,
    turnOn: () =>
      act("Turning on private pay", (c, s) => c.ensureAccount(s, { waitForFinalization: false }), "Private pay is on. Fairblock confirms it in a few minutes."),
    deposit: (amount: bigint) =>
      step(
        "Depositing into your private balance",
        (c, s) => c.confidentialDeposit(s, ADDR.usdc, amount, { waitForFinalization: false }),
        "Deposited. It is in your private balance once Fairblock confirms (usually a minute).",
      ),
    pay: (to: string, amount: bigint) =>
      act("Paying privately", (c, s) => c.confidentialTransfer(s, to, ADDR.usdc, amount, { waitForFinalization: false }), "Paid. The amount is encrypted on chain; only you and the receiver can read it."),
    withdraw: (amount: bigint) =>
      step(
        "Withdrawing to your wallet",
        (c, s) => c.withdraw(s, ADDR.usdc, amount, { waitForFinalization: false }),
        "Withdrawn. The USDC arrives in your wallet once Fairblock confirms.",
      ),

    /**
     * Private payday, paid only from the private balance (never straight from the wallet): checks the
     * balance covers everyone, then pays each person in turn, waiting for Fairblock between steps.
     */
    payMany: (items: { to: string; amount: bigint; name?: string }[], onProgress: (done: number, note: string) => void, payday = Date.now()) =>
      act(
        "Paying your team privately",
        async (c, s) => {
          const me = await s.getAddress();
          await c.ensureAccount(s, { waitForFinalization: false });
          await waitForFairblock(me);
          const total = items.reduce((a, i) => a + i.amount, 0n);
          const bal = await readBalance(c, s);
          if (bal.spendable < total) {
            throw new Error(`Your private balance holds ${fmt6(bal.spendable)} USDC; this payday needs ${fmt6(total)}. Deposit the difference first.`);
          }
          for (let i = 0; i < items.length; i++) {
            onProgress(i, `Paying ${i + 1} of ${items.length}`);
            const r = await c.confidentialTransfer(s, items[i].to, ADDR.usdc, items[i].amount, { waitForFinalization: false });
            await waitForFairblock(me);
            addPrivateRecord(me, { at: Date.now(), kind: "paid", who: items[i].to, name: items[i].name, amount: fmt6(items[i].amount), tx: txHash(r), payday, private: true });
          }
          onProgress(items.length, "Done");
          await readBalance(c, s);
        },
        `Paid ${items.length} ${items.length === 1 ? "person" : "people"} privately. Only each person can read their amount.`,
      ),

    /** Withdraw `amount` from the private balance to the wallet and wait until Fairblock has delivered it. */
    collect: (amount: bigint, onProgress: (note: string) => void) =>
      act(
        "Collecting your pay",
        async (c, s) => {
          const me = await s.getAddress();
          await c.ensureAccount(s, { waitForFinalization: false });
          onProgress("Withdrawing from your private balance");
          const r = await c.withdraw(s, ADDR.usdc, amount, { waitForFinalization: false });
          onProgress("Waiting for Fairblock to deliver it (usually a few minutes)");
          await waitForFairblock(me);
          addPrivateRecord(me, { at: Date.now(), kind: "collected", amount: fmt6(amount), tx: txHash(r) });
        },
        "Collected. The USDC is in your wallet.",
      ),
  };
}
