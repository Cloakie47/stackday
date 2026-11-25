import { cleanMessage } from "./mix.ts";
import { STATUS } from "./status.ts";

/**
 * Who may attach or read a gift message. Pure, tested in message.test.ts; app/api/gifts uses it.
 * The server reads the gift from the chain first, so nobody can attach a note to someone else's gift
 * or pick a recipient that is not the one on the chain.
 */

export type GiftOnChain = { sender: string; recipient: string; status: number };

export type AttachDecision = { ok: true; row: { gift_id: string; sender: string; recipient: string; message: string } } | { ok: false; status: number; error: string };

export function attachDecision(me: string, id: unknown, raw: unknown, gift: GiftOnChain | null): AttachDecision {
  if (typeof id !== "string" || !/^[1-9][0-9]{0,18}$/.test(id)) return { ok: false, status: 400, error: "Bad gift id." };
  const message = cleanMessage(raw);
  if (message === null) return { ok: false, status: 400, error: "A message is at most 140 characters, plain text." };
  if (message === "") return { ok: false, status: 400, error: "The message is empty." };
  if (!gift || gift.status === STATUS.None) return { ok: false, status: 404, error: "That gift does not exist." };
  if (gift.sender.toLowerCase() !== me.toLowerCase()) return { ok: false, status: 403, error: "Only the sender can add a message." };
  if (gift.status !== STATUS.Pending) return { ok: false, status: 409, error: "That gift is no longer waiting to be opened." };
  return { ok: true, row: { gift_id: id, sender: gift.sender.toLowerCase(), recipient: gift.recipient.toLowerCase(), message } };
}

/** Ids from "?ids=1,2,3": numbers only, at most 200, no repeats. */
export function parseIds(raw: string | null): string[] {
  const ids = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[1-9][0-9]{0,18}$/.test(s));
  return Array.from(new Set(ids)).slice(0, 200);
}
