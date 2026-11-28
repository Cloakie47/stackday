import { getAddress, isAddress } from "viem";
import type { Address } from "../contracts.ts";
import type { Intent } from "./intent.ts";

/**
 * Who a gift or a send goes to (docs/features/CHAT-AND-GIFTS.md, 1.3). Pure helpers shared by the
 * server (agent.ts: was the recipient typed by the person in this message?) and the browser
 * (usePlan.ts: resolve it to exactly one wallet).
 *
 * - An ID or username must appear in the person's own latest message, as a whole word. The model may
 *   only repeat it, never invent or pick one from research or tool text.
 * - A raw address is never written by the model. The browser takes the one 0x address in the person's
 *   own typed text, and refuses none, several, their own wallet or vault, or a bad checksum.
 */

export type PersonLike = { uid: string | null; username: string | null };
export type PersonWithWallet = PersonLike & { wallet: string };

/** "@name" for the one exact match that has a username, else null (the card then shows the ID alone). */
export function recipientName(asked: string, people: readonly PersonLike[]): string | null {
  const byId = /^SD-/.test(asked);
  const matches = people.filter((p) => (byId ? p.uid === asked : p.username === asked));
  if (matches.length !== 1 || !matches[0].username) return null;
  return `@${matches[0].username}`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when `id` (a Stackday ID or username, as the schema allows) is in the person's latest message
 * as a whole word: "SD-7KQ2M9XA", "@maria" or "maria". Case does not matter (IDs are read aloud and
 * typed in lower case too); nothing else is accepted, so a name the model saw elsewhere is refused.
 */
export function recipientInText(id: string, text: string): boolean {
  if (!id) return false;
  return new RegExp(`(^|[^A-Za-z0-9_-])@?${escape(id)}($|[^A-Za-z0-9_-])`, "i").test(text);
}

/** Every 0x address in a text, whole (not part of a longer hex run). */
const ADDRESS_IN_TEXT = /(?<![0-9A-Za-z])0x[0-9a-fA-F]{40}(?![0-9A-Za-z])/g;
export const addressesIn = (text: string): string[] => text.match(ADDRESS_IN_TEXT) ?? [];
/** The server's check for a typed_address send: the latest message has at least one address. */
export const hasTypedAddress = (text: string) => addressesIn(text).length > 0;

/**
 * A gift or send must name a recipient the person typed in their latest message: the same ID or
 * username, or (typed_address) an address. Null when the intent passes, or has no recipient.
 */
export function recipientProblem(intent: Intent, latest: string): string | null {
  if (intent.action === "gift") return recipientInText(intent.params.recipient_id, latest) ? null : "gift recipient not in the latest user message";
  if (intent.action === "send") {
    const to = intent.params.to;
    if (to.kind === "id") return recipientInText(to.id, latest) ? null : "send recipient not in the latest user message";
    return hasTypedAddress(latest) ? null : "typed_address send without an address in the latest user message";
  }
  return null;
}

export type Resolved = { ok: true; address: Address } | { ok: false; reason: string };

/**
 * The one address the person typed in their own message. Refused: none, two different ones, a
 * mixed-case address whose checksum is wrong, the zero address, or the person's own wallet or vault.
 */
export function typedAddress(text: string | undefined, own: readonly (string | undefined)[]): Resolved {
  if (!text) return { ok: false, reason: "I can only send to an address you type yourself in your message. Type it again with the amount." };
  const found = addressesIn(text);
  const distinct = [...new Set(found.map((a) => a.toLowerCase()))];
  if (distinct.length === 0) return { ok: false, reason: "I could not find a full 0x address in your message. Type the whole address (42 characters)." };
  if (distinct.length > 1) return { ok: false, reason: "Your message has more than one address. Send again with just the one you mean." };
  for (const a of found) {
    const body = a.slice(2);
    const mixed = body !== body.toLowerCase() && body !== body.toUpperCase();
    if (mixed && !isAddress(a, { strict: true })) return { ok: false, reason: "That address has a typo (its capital letters do not match its checksum). Copy it again." };
  }
  const address = getAddress(distinct[0]);
  if (/^0x0{40}$/i.test(address)) return { ok: false, reason: "That is the zero address. Nothing can be sent there." };
  if (own.some((o) => o && o.toLowerCase() === address.toLowerCase())) return { ok: false, reason: "That is your own wallet or vault. Sends go to someone else." };
  return { ok: true, address };
}

export type Picked = { ok: true; person: PersonWithWallet & { wallet: Address } } | { ok: false; reason: string };

/**
 * The /api/people lookup (a prefix search) to exactly one person: the one whose ID or username is
 * exactly what was asked. None, two, or the person themselves is refused.
 */
export function pickRecipient(asked: string, people: readonly PersonWithWallet[], me: string): Picked {
  const byId = /^SD-/i.test(asked);
  const want = byId ? asked.toUpperCase() : asked.replace(/^@/, "").toLowerCase();
  const matches = people.filter((p) => (byId ? p.uid === want : p.username === want));
  const label = byId ? want : `@${want}`;
  if (matches.length === 0) return { ok: false, reason: `Nobody on Stackday has the ${byId ? "ID" : "username"} ${label}. Check it and ask again.` };
  if (matches.length > 1) return { ok: false, reason: `More than one person matches ${label}. Use their Stackday ID instead.` };
  const p = matches[0];
  if (!isAddress(p.wallet, { strict: false })) return { ok: false, reason: `Could not read the wallet for ${label}.` };
  if (p.wallet.toLowerCase() === me.toLowerCase()) return { ok: false, reason: "That is you. Sends and gifts go to someone else." };
  return { ok: true, person: { ...p, wallet: getAddress(p.wallet) } };
}

/** The last 6 hex characters of an address: what the person types before a raw-address send. */
export const confirmSuffixOf = (address: string) => address.slice(-6);
