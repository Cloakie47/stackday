import type { Address } from "../contracts.ts";
import { buildPlan, type BuildContext, type BuildResult } from "./buildCalls.ts";
import type { Intent } from "./intent.ts";

/**
 * The one path from an intent to a card. usePlan calls it when a card is first shown AND when the
 * person presses "Refresh numbers" on an expired card: same stored intent, fresh chain reads, a fresh
 * expiry, and buildPlan's own limits (500 test USDC per card, the checkCalls allowlist, the receiver
 * set to the connected wallet). No model call and no /api/chat request is involved in a refresh.
 */

/** The parts of usePortfolio the card needs (a Portfolio fits). */
export type PortfolioForCard = Pick<BuildContext, "vault" | "predictedVault" | "positions" | "borrowCapBps" | "walletUsdc" | "routerAllowance">;

/** What usePlan reads from the chain for one intent. */
export type CardReads = {
  quotes: BuildContext["quotes"];
  /** The intent's asset allowance to the vault and to the sell desk. */
  toVault: bigint;
  toDesk: bigint;
  vaultUsdcAllowance: bigint;
};

export function makeCard(intent: Intent, p: PortfolioForCard, me: Address, reads: CardReads, nowSec: number): BuildResult {
  return buildPlan(intent, {
    me,
    vault: p.vault,
    predictedVault: p.predictedVault,
    positions: p.positions,
    borrowCapBps: p.borrowCapBps,
    walletUsdc: p.walletUsdc,
    routerAllowance: p.routerAllowance,
    vaultUsdcAllowance: reads.vaultUsdcAllowance,
    assetAllowance: { toVault: reads.toVault, toDesk: reads.toDesk },
    quotes: reads.quotes,
    nowSec,
  });
}
