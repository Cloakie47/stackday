import type { Address } from "../contracts.ts";
import type { Portfolio } from "../usePortfolio.ts";
import type { PositionLike } from "./buildCalls.ts";

/** What the info views need, built from usePortfolio data (infoContext). */
export type InfoContext = {
  me: Address;
  vault?: Address;
  predictedVault?: Address;
  positions: PositionLike[];
  borrowCapBps: bigint;
  walletUsdc: bigint;
  /** Idle USDC in the vault (not earning). */
  vaultUsdc: bigint;
  /** USDC earning interest, with its interest. */
  earning: bigint;
  nowSec: number;
};

export function infoContext(p: Portfolio, me: Address): InfoContext {
  void p;
  void me;
  throw new Error("not implemented yet");
}
