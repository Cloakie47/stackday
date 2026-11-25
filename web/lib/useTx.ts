"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { erc20Abi, type Abi, type WalletClient, BaseError, ContractFunctionRevertedError } from "viem";
import { useAccount, usePublicClient, useWalletClient, useWriteContract } from "wagmi";
import { CHAIN_ID, type Address } from "./contracts";

export type Call = {
  label: string;
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

export type TxState = {
  busy: boolean;
  step?: string;
  error?: string;
  hash?: `0x${string}`;
  /** Every transaction hash of the last run, in order (one for a batch, one per step otherwise). */
  hashes?: `0x${string}`[];
  done?: string;
};

function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((err) => err instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.reason;
      const known: Record<string, string> = {
        BorrowCapExceeded: "That is more than your borrow limit allows.",
        NothingToClaim: "There is nothing to claim for this payday.",
        InsufficientBalance: "The employer treasury does not hold enough USDC for this.",
        ScheduleNotActive: "This schedule is paused.",
        NotEmployer: "Only the employer who set this up can do that.",
        BadInterval: "That payday rhythm is shorter than this network allows.",
        BpsTooHigh: "The shares add up to more than 100%.",
        TooManyAllocations: "You can split a salary across at most 6 assets.",
        StalePrice: "The reference price is too old right now (market closed). Try again later.",
        NotDueYet: "That is not due yet.",
        NoPlan: "There is no recurring plan to run.",
        TransfersPaused: "Transfers of this asset are paused right now.",
        SlippageExceeded: "The price moved too much. Try again.",
        BadThreshold: "The health threshold must be between 1.0 and 10.",
        UnsupportedStock: "This asset is not supported.",
        ZeroAmount: "Enter an amount above zero.",
        // GiftBox
        SelfGift: "You cannot send a gift to yourself.",
        TooSmall: "A gift is at least 1 USDC.",
        BadExpiry: "Pick an expiry between 1 and 365 days.",
        BadMix: "The mix is not valid: up to 6 different assets whose shares add up to 100%.",
        UnsupportedAsset: "One of the assets cannot go in a gift box.",
        NotPending: "This gift was already opened, declined, taken back or refunded.",
        NotRecipient: "Only the person the gift is for can do that.",
        NotSender: "Only the sender can take this gift back.",
        Expired: "This gift has expired. It goes back to the sender.",
        NotExpired: "This gift has not expired yet.",
        BuyFailed: "One part of the gift could not be bought right now. Try again later.",
      };
      if (name && known[name]) return known[name];
      if (name) return `The contract refused: ${name}`;
    }
    return e.shortMessage || e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Sends one or more transactions.
 * - Wallets that can sign a batch atomically (EIP-5792, for example Coinbase Smart Wallet or a
 *   MetaMask smart account) get every step in ONE signature, all or nothing.
 * - Other wallets get the steps one after another, each simulated first (so a failure is caught
 *   before the wallet opens) and sent with 60% extra gas, because lending market interest can
 *   make the real cost higher than the estimate.
 * Pages also fold their vault steps into one multicall (lib/batch.ts), so even plain wallets sign
 * once for the vault part.
 */
/** True when the wallet says it can run a batch of calls atomically on this chain (EIP-5792). */
export async function canBatchAtomically(
  walletClient: WalletClient,
  account: Address,
): Promise<boolean> {
  try {
    const caps = (await walletClient.getCapabilities({ account, chainId: CHAIN_ID })) as { atomic?: { status?: string } };
    return caps.atomic?.status === "supported" || caps.atomic?.status === "ready";
  } catch {
    return false; // the wallet does not support EIP-5792: send the steps one by one
  }
}

export function useTx() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>({ busy: false });
  // The hashes of the last run, readable right after `run` resolves (state updates land later).
  const lastHashes = useRef<`0x${string}`[]>([]);

  const run = useCallback(
    async (calls: Call[], doneMessage = "Done.") => {
      if (!address || !publicClient) {
        setState({ busy: false, error: "Connect your wallet first." });
        return false;
      }
      let hash: `0x${string}` | undefined;
      const hashes: `0x${string}`[] = [];
      lastHashes.current = hashes;
      try {
        if (calls.length > 1 && walletClient && (await canBatchAtomically(walletClient, address))) {
          setState({ busy: true, step: `${calls.length} steps in one signature` });
          const { id } = await walletClient.sendCalls({
            account: address,
            forceAtomic: true,
            calls: calls.map((c) => ({ to: c.address, abi: c.abi as Abi, functionName: c.functionName, args: c.args ?? [] })),
          });
          const result = await walletClient.waitForCallsStatus({ id, timeout: 180_000 });
          hash = result.receipts?.at(-1)?.transactionHash;
          for (const r of result.receipts ?? []) if (r.transactionHash && !hashes.includes(r.transactionHash)) hashes.push(r.transactionHash);
          if (result.status !== "success") throw new Error("The batch failed on-chain. Nothing in it was applied.");
          await queryClient.invalidateQueries();
          setState({ busy: false, hash, hashes, done: doneMessage });
          return hash ?? true;
        }
        for (const [i, call] of calls.entries()) {
          setState({ busy: true, step: calls.length > 1 ? `Step ${i + 1} of ${calls.length}: ${call.label}` : call.label, hashes: [...hashes] });
          const request = {
            account: address,
            address: call.address,
            abi: call.abi as Abi,
            functionName: call.functionName,
            args: call.args ?? [],
          };
          await publicClient.simulateContract(request);
          const gas = await publicClient.estimateContractGas(request);
          hash = await writeContractAsync({
            address: request.address,
            abi: request.abi,
            functionName: request.functionName,
            args: request.args,
            gas: (gas * 16n) / 10n,
          });
          hashes.push(hash);
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") throw new Error(`"${call.label}" failed on-chain.`);
        }
        await queryClient.invalidateQueries();
        setState({ busy: false, hash, hashes, done: doneMessage });
        return hash ?? true;
      } catch (e) {
        setState({ busy: false, error: explain(e), hash, hashes });
        return false;
      }
    },
    [address, publicClient, writeContractAsync, walletClient, queryClient],
  );

  /** Adds a USDC or token approval step only when the current allowance is too small. */
  const withApproval = useCallback(
    async (token: Address, spender: Address, amount: bigint, label: string): Promise<Call[]> => {
      if (!address || !publicClient || amount === 0n) return [];
      const allowance = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, spender],
      });
      if (allowance >= amount) return [];
      return [{ label, address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] }];
    },
    [address, publicClient],
  );

  const reset = useCallback(() => setState({ busy: false }), []);
  /** Every transaction hash of the last run, in order. */
  const hashesOfLastRun = useCallback(() => [...lastHashes.current], []);
  return { state, run, withApproval, reset, hashesOfLastRun };
}
