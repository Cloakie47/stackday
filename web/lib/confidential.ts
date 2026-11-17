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
import { useCallback, useState } from "react";
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

/** Round down to whole cents, the smallest amount Fairblock moves. */
export const toCents = (v: bigint) => (v / CENT) * CENT;

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
  const [balance, setBalance] = useState<{ total: bigint; pending: bigint }>();

  const signer = useCallback(async () => {
    if (!walletClient) throw new Error("Connect your wallet first.");
    const { BrowserProvider, JsonRpcSigner } = await import("ethers");
    const provider = new BrowserProvider(walletClient.transport, { chainId: CHAIN_ID, name: "base-sepolia" });
    return new JsonRpcSigner(provider, walletClient.account.address);
  }, [walletClient]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["private-status"] });
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

  const reveal = useCallback(
    () =>
      act(
        "Unlocking your private balance",
        async (c, s) => {
          const keys = await c.ensureAccount(s, { waitForFinalization: false });
          const b = await c.getConfidentialBalance(await s.getAddress(), keys.privateKey, ADDR.usdc);
          setBalance({ total: b.amount, pending: b.pending.amount });
        },
        "Only you can see this balance. It was decrypted in your browser.",
      ),
    [act],
  );

  return {
    status: status.data,
    statusLoading: status.isLoading,
    busy,
    error,
    done,
    balance,
    reveal,
    turnOn: () =>
      act("Turning on private pay", (c, s) => c.ensureAccount(s, { waitForFinalization: false }), "Private pay is on. Fairblock confirms it in a few minutes."),
    deposit: (amount: bigint) =>
      act("Moving USDC into your private balance", (c, s) => c.confidentialDeposit(s, ADDR.usdc, amount, { waitForFinalization: false }), "Sent. Fairblock adds it to your private balance in a few minutes."),
    pay: (to: string, amount: bigint) =>
      act("Paying privately", (c, s) => c.confidentialTransfer(s, to, ADDR.usdc, amount, { waitForFinalization: false }), "Paid. The amount is encrypted on chain; only you and the receiver can read it."),
    withdraw: (amount: bigint) =>
      act("Withdrawing to your wallet", (c, s) => c.withdraw(s, ADDR.usdc, amount, { waitForFinalization: false }), "Withdrawn. The USDC arrives in your wallet once Fairblock confirms."),

    /**
     * Private payday: top up the private balance from the wallet if needed, then pay each person in
     * turn, waiting for Fairblock between steps. `onProgress` reports how many are done.
     */
    payMany: (items: { to: string; amount: bigint }[], onProgress: (done: number, note: string) => void) =>
      act(
        "Paying your team privately",
        async (c, s) => {
          const me = await s.getAddress();
          const keys = await c.ensureAccount(s, { waitForFinalization: false });
          await waitForFairblock(me);
          const total = items.reduce((a, i) => a + i.amount, 0n);
          const bal = await c.getConfidentialBalance(me, keys.privateKey, ADDR.usdc);
          const spendable = BigInt(bal.amount) - BigInt(bal.pending.amount);
          if (spendable < total) {
            onProgress(0, "Moving USDC into your private balance");
            await c.confidentialDeposit(s, ADDR.usdc, total - spendable, { waitForFinalization: false });
            await waitForFairblock(me);
          }
          for (let i = 0; i < items.length; i++) {
            onProgress(i, `Paying ${i + 1} of ${items.length}`);
            await c.confidentialTransfer(s, items[i].to, ADDR.usdc, items[i].amount, { waitForFinalization: false });
            await waitForFairblock(me);
          }
          onProgress(items.length, "Done");
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
          await c.withdraw(s, ADDR.usdc, amount, { waitForFinalization: false });
          onProgress("Waiting for Fairblock to deliver it (usually a few minutes)");
          await waitForFairblock(me);
        },
        "Collected. The USDC is in your wallet.",
      ),
  };
}
