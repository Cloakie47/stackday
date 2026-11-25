import { erc20Abi, parseEventLogs, type Log } from "viem";
import { giftBoxAbi } from "../abis.ts";
import { KIND, OPEN_SLIPPAGE_BPS, mixProblem, type Hex, type MixLeg } from "./mix.ts";

/**
 * The transactions behind each gift action, built as plain call lists that lib/useTx.ts sends (it
 * simulates each one first). Pure: addresses come in as arguments, so the Gifts page and the chat
 * assistant share this. Unit tested in calls.test.ts.
 */

/** Same shape as `Call` in lib/useTx.ts. */
export type GiftCall = {
  label: string;
  address: Hex;
  abi: typeof giftBoxAbi | typeof erc20Abi;
  functionName: string;
  args: readonly unknown[];
};

export type CreateInput = {
  giftBox: Hex;
  usdc: Hex;
  sender: Hex;
  recipient: Hex;
  /** 6-decimal USDC. */
  amount: bigint;
  expiresAt: number;
  /** Fixed mix, or "research" for a box whose mix is picked when it is opened. */
  mix: MixLeg[] | "research";
  /** The sender's current USDC allowance to the GiftBox; an approval is added only when it is short. */
  allowance: bigint;
};

/** Approve (only if needed) and create: one signature on wallets that batch, two steps otherwise. */
export function buildCreateCalls(i: CreateInput): GiftCall[] {
  if (i.recipient.toLowerCase() === i.sender.toLowerCase()) throw new Error("You cannot send a gift to yourself.");
  if (/^0x0{40}$/i.test(i.recipient) || i.recipient.toLowerCase() === i.giftBox.toLowerCase()) throw new Error("That recipient address is not valid.");
  let kind: number = KIND.Research;
  let assets: Hex[] = [];
  let weights: number[] = [];
  if (i.mix !== "research") {
    const problem = mixProblem(i.mix);
    if (problem) throw new Error(problem);
    kind = KIND.Fixed;
    assets = i.mix.map((l) => l.token);
    weights = i.mix.map((l) => l.weightBps);
  }
  const calls: GiftCall[] = [];
  if (i.allowance < i.amount) {
    calls.push({ label: "Allow the gift box to take the USDC", address: i.usdc, abi: erc20Abi, functionName: "approve", args: [i.giftBox, i.amount] });
  }
  calls.push({
    label: "Wrap the gift",
    address: i.giftBox,
    abi: giftBoxAbi,
    functionName: "create",
    args: [i.recipient, i.amount, i.expiresAt, kind, assets, weights],
  });
  return calls;
}

/** Open a box. A research box carries its mix (picked from the approved report); a fixed box carries none. */
export function buildOpenCall(giftBox: Hex, id: bigint, researchMix?: MixLeg[]): GiftCall {
  if (researchMix) {
    const problem = mixProblem(researchMix);
    if (problem) throw new Error(problem);
  }
  return {
    label: "Open the gift",
    address: giftBox,
    abi: giftBoxAbi,
    functionName: "open",
    args: [id, OPEN_SLIPPAGE_BPS, researchMix?.map((l) => l.token) ?? [], researchMix?.map((l) => l.weightBps) ?? []],
  };
}

export const buildDeclineCall = (giftBox: Hex, id: bigint): GiftCall => ({
  label: "Decline the gift",
  address: giftBox,
  abi: giftBoxAbi,
  functionName: "decline",
  args: [id],
});

export const buildRevokeCall = (giftBox: Hex, id: bigint): GiftCall => ({
  label: "Take the gift back",
  address: giftBox,
  abi: giftBoxAbi,
  functionName: "revoke",
  args: [id],
});

export const buildRefundCall = (giftBox: Hex, id: bigint): GiftCall => ({
  label: "Refund the expired gift",
  address: giftBox,
  abi: giftBoxAbi,
  functionName: "refundExpired",
  args: [id],
});

type ReceiptLog = Pick<Log, "address" | "topics" | "data">;

/** The id of the box a confirmed create transaction made (from its GiftCreated log). */
export function createdGiftId(giftBox: Hex, logs: ReceiptLog[]): bigint | null {
  const events = parseEventLogs({ abi: giftBoxAbi, eventName: "GiftCreated", logs: logs as Log[], strict: true });
  const mine = events.filter((e) => e.address.toLowerCase() === giftBox.toLowerCase());
  return mine.length ? mine[mine.length - 1].args.id : null;
}

export type BoughtPart = { asset: Hex; usdcIn: bigint; assetOut: bigint };

/** What an opening really bought, from the confirmed receipt's GiftPartBought logs for that box. */
export function boughtParts(giftBox: Hex, id: bigint, logs: ReceiptLog[]): BoughtPart[] {
  return parseEventLogs({ abi: giftBoxAbi, eventName: "GiftPartBought", logs: logs as Log[], strict: true })
    .filter((e) => e.address.toLowerCase() === giftBox.toLowerCase() && e.args.id === id)
    .map((e) => ({ asset: e.args.asset as Hex, usdcIn: e.args.usdcIn, assetOut: e.args.assetOut }));
}
