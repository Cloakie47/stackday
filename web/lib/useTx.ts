"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { erc20Abi, type Abi, BaseError, ContractFunctionRevertedError } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import type { Address } from "./contracts";

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
      };
      if (name && known[name]) return known[name];
      if (name) return `The contract refused: ${name}`;
    }
    return e.shortMessage || e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Sends one or more transactions in order, waiting for each to confirm.
 * Every transaction is simulated first (so a failure is caught before the wallet opens) and
 * sent with 60% extra gas, because lending market interest can make the real cost higher
 * than the estimate.
 */
export function useTx() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>({ busy: false });

  const run = useCallback(
    async (calls: Call[], doneMessage = "Done.") => {
      if (!address || !publicClient) {
        setState({ busy: false, error: "Connect your wallet first." });
        return false;
      }
      let hash: `0x${string}` | undefined;
      try {
        for (const call of calls) {
          setState({ busy: true, step: call.label });
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
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") throw new Error(`"${call.label}" failed on-chain.`);
        }
        await queryClient.invalidateQueries();
        setState({ busy: false, hash, done: doneMessage });
        return true;
      } catch (e) {
        setState({ busy: false, error: explain(e), hash });
        return false;
      }
    },
    [address, publicClient, writeContractAsync, queryClient],
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
  return { state, run, withApproval, reset };
}
