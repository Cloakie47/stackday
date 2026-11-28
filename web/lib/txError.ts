import { BaseError, ContractFunctionRevertedError } from "viem";

/**
 * Plain words for a failed or refused transaction. Shared by useTx (when a step fails) and the chat
 * card's pre-check (lib/chat/precheck.ts), so both say the same thing for the same failure.
 */

const KNOWN: Record<string, string> = {
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
  YieldNotAvailable: "Earning interest is not available on this network right now.",
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

function revertOf(e: unknown): ContractFunctionRevertedError | undefined {
  if (!(e instanceof BaseError)) return undefined;
  const revert = e.walk((err) => err instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError ? revert : undefined;
}

/**
 * The contract's own error name, if the revert carried one. A plain `require` message comes back as
 * the built-in `Error(string)` and a panic as `Panic(uint256)`; those are not names, so undefined.
 */
export function revertName(e: unknown): string | undefined {
  const name = revertOf(e)?.data?.errorName;
  return name && name !== "Error" && name !== "Panic" ? name : undefined;
}

/** What an arithmetic underflow or overflow (Panic 0x11) means here: a balance moved after the card was made. */
export const BALANCES_CHANGED = "Your balances changed since this card was made. Close it and ask again.";

/** True for Solidity's arithmetic underflow or overflow panic (Panic(0x11)). */
export function isArithmeticPanic(e: unknown): boolean {
  const data = revertOf(e)?.data;
  return data?.errorName === "Panic" && data.args?.[0] === 0x11n;
}

/** Plain words for a contract revert, or undefined when the failure says nothing readable. */
export function revertText(e: unknown): string | undefined {
  const revert = revertOf(e);
  if (!revert) return undefined;
  if (isArithmeticPanic(e)) return BALANCES_CHANGED;
  const name = revertName(e);
  if (name && KNOWN[name]) return KNOWN[name];
  if (name) return `The contract refused: ${name}`;
  if (revert.reason) return `The contract refused: ${revert.reason}`;
  return undefined;
}

/** Plain words for any failure while sending: the revert if there is one, else the error's own message. */
export function explainTxError(e: unknown): string {
  const text = revertText(e);
  if (text) return text;
  if (e instanceof BaseError) return e.shortMessage || e.message;
  return e instanceof Error ? e.message : String(e);
}
