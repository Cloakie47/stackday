import type { Hex } from "./mix.ts";

/**
 * Gift status as the chain reports it (GiftBox.Status), plus the one state the chain does not
 * store: a pending box past its expiry, which only waits for `refundExpired`. Pure, tested in
 * status.test.ts. The chain is always the truth for status; the database only holds messages.
 */

export const STATUS = { None: 0, Pending: 1, Opened: 2, Revoked: 3, Declined: 4, Refunded: 5 } as const;

export type GiftState = "pending" | "expired" | "opened" | "revoked" | "declined" | "refunded" | "none";

export const STATE_LABEL: Record<GiftState, string> = {
  pending: "Waiting to be opened",
  expired: "Expired, refund on the way",
  opened: "Opened",
  revoked: "Taken back",
  declined: "Declined",
  refunded: "Refunded",
  none: "Unknown",
};

/** One box as read from GiftBox.giftOf, with its id. */
export type ChainGift = {
  id: bigint;
  sender: Hex;
  recipient: Hex;
  usdc: bigint;
  expiresAt: number;
  kind: number;
  status: number;
};

export function giftState(g: Pick<ChainGift, "status" | "expiresAt">, nowSeconds: number): GiftState {
  switch (g.status) {
    case STATUS.Pending:
      return nowSeconds >= g.expiresAt ? "expired" : "pending";
    case STATUS.Opened:
      return "opened";
    case STATUS.Revoked:
      return "revoked";
    case STATUS.Declined:
      return "declined";
    case STATUS.Refunded:
      return "refunded";
    default:
      return "none";
  }
}

/** Ids to read: the newest `max` boxes (ids run 1 to nextId - 1), newest first. */
export function recentIds(nextId: bigint, max: number): bigint[] {
  const out: bigint[] = [];
  for (let id = nextId - 1n; id >= 1n && out.length < max; id--) out.push(id);
  return out;
}

/** Splits boxes into the ones this wallet received and the ones it sent, newest first. */
export function giftsFor(all: ChainGift[], wallet: string | undefined) {
  const me = (wallet ?? "").toLowerCase();
  const byNewest = [...all].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return {
    received: me ? byNewest.filter((g) => g.recipient.toLowerCase() === me) : [],
    sent: me ? byNewest.filter((g) => g.sender.toLowerCase() === me) : [],
  };
}

/** Boxes the recipient can still open now. */
export const openable = (received: ChainGift[], nowSeconds: number) => received.filter((g) => giftState(g, nowSeconds) === "pending");

/** "in 3 days", "in 5 hours", "in 12 minutes", "in 1 minute". */
export function expiresIn(expiresAt: number, nowSeconds: number): string {
  const s = expiresAt - nowSeconds;
  if (s <= 0) return "expired";
  if (s >= 2 * 86_400) return `in ${Math.floor(s / 86_400)} days`;
  if (s >= 2 * 3_600) return `in ${Math.floor(s / 3_600)} hours`;
  const m = Math.max(1, Math.floor(s / 60));
  return `in ${m} minute${m === 1 ? "" : "s"}`;
}
