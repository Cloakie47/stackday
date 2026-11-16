import { randomBytes } from "node:crypto";
import { parseSiweMessage } from "viem/siwe";

/**
 * Server-side checks for a sign-in request. No framework code in here, so it is unit tested
 * (signin-check.test.ts). The API route supplies the real nonce store (database) and the real
 * signature check (a chain node, so smart contract wallets work too).
 */

const TTL_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 60_000;

/** A fresh single-use code: 32 hex characters from the operating system's secure random source. */
export function newNonce() {
  return randomBytes(16).toString("hex");
}

export const NONCE_RULE = /^[a-f0-9]{32}$/;

export interface NonceStore {
  /** Remember a new nonce until `expiresAt`. */
  put(nonce: string, expiresAt: Date): Promise<void>;
  /** Use up a nonce. True only the first time, and only before it expires. Must be atomic. */
  take(nonce: string, now: Date): Promise<boolean>;
}

export type SignatureCheck = (p: { address: `0x${string}`; message: string; signature: `0x${string}` }) => Promise<boolean>;

export type SignInResult = { ok: true; address: string } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): SignInResult => ({ ok: false, status, error });

export async function checkSignIn(p: {
  message: unknown;
  signature: unknown;
  /** The domains this server accepts (its own host). */
  domains: string[];
  chainId: number;
  now: Date;
  store: NonceStore;
  verify: SignatureCheck;
}): Promise<SignInResult> {
  if (typeof p.message !== "string" || p.message.length > 2000) return fail(400, "Bad request.");
  if (typeof p.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(p.signature)) return fail(400, "Bad request.");

  const m = parseSiweMessage(p.message);
  if (!m.address || !m.domain || !m.nonce || !m.uri || m.version !== "1" || m.chainId === undefined)
    return fail(400, "Bad request.");
  if (!m.issuedAt || !m.expirationTime || Number.isNaN(m.issuedAt.getTime()) || Number.isNaN(m.expirationTime.getTime()))
    return fail(400, "Bad request.");

  if (!p.domains.map((d) => d.toLowerCase()).includes(m.domain.toLowerCase()))
    return fail(401, "This sign-in request was made for another site.");
  if (m.chainId !== p.chainId) return fail(401, "This sign-in request is for another network.");

  const now = p.now.getTime();
  const issued = m.issuedAt.getTime();
  const expires = m.expirationTime.getTime();
  if (issued > now + CLOCK_SKEW_MS || expires <= now || expires - issued > TTL_MS || now - issued > TTL_MS + CLOCK_SKEW_MS)
    return fail(400, "That sign-in request expired. Try again.");
  if (m.notBefore && m.notBefore.getTime() > now + CLOCK_SKEW_MS) return fail(400, "Bad request.");

  // Use up the nonce before the (slower) signature check: a replayed or made-up request stops
  // here without calling the chain node, and the same nonce can never pass twice.
  if (!NONCE_RULE.test(m.nonce) || !(await p.store.take(m.nonce, p.now)))
    return fail(400, "That sign-in request was already used or has expired. Try again.");

  const ok = await p
    .verify({ address: m.address, message: p.message, signature: p.signature as `0x${string}` })
    .catch(() => false);
  if (!ok) return fail(401, "The signature does not match this wallet.");

  return { ok: true, address: m.address.toLowerCase() };
}

/** A store kept in memory. Used by the tests. Not for production (serverless instances do not share memory). */
export function memoryNonceStore(): NonceStore {
  const map = new Map<string, number>();
  return {
    async put(nonce, expiresAt) {
      map.set(nonce, expiresAt.getTime());
    },
    async take(nonce, now) {
      const exp = map.get(nonce);
      map.delete(nonce);
      return exp !== undefined && exp > now.getTime();
    },
  };
}

export const NONCE_TTL_MS = TTL_MS;
