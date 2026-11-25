import { revertName, revertText } from "../txError.ts";
import type { BuildResult, Plan } from "./buildCalls.ts";

/**
 * The card's pre-check: right after a card is built, every call on it is simulated in order on Base
 * Sepolia (viem simulateCalls, one eth_simulateV1 request) from the connected wallet. This file only
 * turns that answer into what the card shows; lib/chat/usePlan.ts runs the simulation.
 *
 * - passes: every call succeeded in the simulation. Prices can still move before the person signs.
 * - blocked: a call would fail. The card names the step and the reason, and Confirm is off.
 * - unavailable: the network could not answer (RPC error or timeout). The card says so and keeps
 *   today's behaviour: Confirm stays on. useTx then simulates each step before the wallet opens when the
 *   wallet signs step by step; a wallet that signs a batch at once is not simulated again by useTx.
 */

export type PrecheckState =
  | { status: "checking" }
  | { status: "passes" }
  | { status: "blocked"; reason: string; hint?: string }
  | { status: "unavailable" };

/** What the simulation returned: one result per call in order, or no answer at all. */
export type SimOutcome =
  | { kind: "results"; results: readonly { status: "success" | "failure"; error?: unknown }[] }
  | { kind: "rpc-error" };

/** A pre-check that takes longer than this counts as "could not pre-check". */
export const PRECHECK_TIMEOUT_MS = 12_000;

/** Only cards that would send calls are pre-checked: never a refusal or a hand-off (gift). */
export function needsPrecheck(r: BuildResult | null | undefined): r is Plan {
  return !!r && r.ok && !r.handoff && r.calls.length > 0;
}

/** Actions where the amount is what the person can change if the check fails. */
const AMOUNT_ACTIONS: ReadonlySet<Plan["action"]> = new Set(["buy", "sell", "borrow", "withdraw", "repay", "recurring_buy"]);
/** Contract errors that a smaller amount does not fix. */
const NOT_ABOUT_AMOUNT = new Set(["StalePrice", "TransfersPaused", "UnsupportedStock", "UnsupportedAsset", "NoPlan", "NotDueYet"]);

const UNREADABLE = "The contract would refuse it as it stands.";

function hintFor(action: Plan["action"], name: string | undefined): string | undefined {
  if (!AMOUNT_ACTIONS.has(action) || (name && NOT_ABOUT_AMOUNT.has(name))) return undefined;
  if (action === "sell" || action === "borrow")
    return "Testnet markets hold only a few test USDC, so larger amounts can fail. You can ask for a smaller amount, or close this card.";
  return "You can ask for a smaller amount, or close this card.";
}

/** Simulation answer to card state. The first failing call, in order, decides. */
export function decidePrecheck(outcome: SimOutcome, plan: Pick<Plan, "action" | "calls">): PrecheckState {
  if (outcome.kind === "rpc-error") return { status: "unavailable" };
  const n = plan.calls.length;
  // An answer that does not match the calls one to one is not a check.
  if (outcome.results.length !== n || n === 0) return { status: "unavailable" };
  const i = outcome.results.findIndex((r) => r.status !== "success");
  if (i === -1) return { status: "passes" };
  const error = outcome.results[i].error;
  const why = revertText(error) ?? UNREADABLE;
  const where = n > 1 ? `Step ${i + 1} of ${n} (${plan.calls[i].label}) would fail.` : "This would fail.";
  return { status: "blocked", reason: `${where} ${why}`, hint: hintFor(plan.action, revertName(error)) };
}

/** Confirm is on only when the check passed or could not run. Off while checking and when blocked. */
export const confirmAllowed = (check: PrecheckState | undefined) => !check || check.status === "passes" || check.status === "unavailable";

/** The line the card shows for each state. */
export function precheckLine(check: PrecheckState): string {
  switch (check.status) {
    case "checking":
      return "Pre-checking every step on Base Sepolia...";
    case "passes":
      return "Pre-checked on Base Sepolia: passes. Prices can still move before you sign.";
    case "blocked":
      return `Pre-checked on Base Sepolia: ${check.reason}`;
    case "unavailable":
      return "Could not pre-check right now. You can still confirm and review it in your wallet.";
  }
}
