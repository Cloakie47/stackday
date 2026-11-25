import { encodeFunctionData, type Abi } from "viem";
import { vaultAbi } from "./abis.ts";
import type { Address } from "./contracts.ts";
import type { Call } from "./useTx.ts";

/**
 * Folds every call to the vault into one `multicall` transaction, so locking four assets or
 * borrowing against four is one signature instead of four. Calls to other contracts (token
 * approvals) stay separate and go first, because the vault calls rely on them.
 *
 * Safe by construction: the vault runs each inner call with the same caller and all of its own
 * checks (owner only, borrow cap), and undoes the whole batch if any part fails.
 */
export function vaultBatch(vault: Address, calls: Call[], label: string): Call[] {
  const isVault = (c: Call) => c.address.toLowerCase() === vault.toLowerCase();
  const inner = calls.filter(isVault);
  if (inner.length <= 1) return calls;
  const data = inner.map((c) => encodeFunctionData({ abi: c.abi as Abi, functionName: c.functionName, args: c.args ?? [] }));
  return [...calls.filter((c) => !isVault(c)), { label, address: vault, abi: vaultAbi, functionName: "multicall", args: [data] }];
}
