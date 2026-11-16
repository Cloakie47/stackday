import { createSiweMessage } from "viem/siwe";

/**
 * Sign-in message, shared by the browser and the server.
 *
 * It follows "Sign-In with Ethereum" (EIP-4361). The text names the site (domain), the chain
 * and a single-use code (nonce) from our server, so a signature cannot be reused later or
 * collected by another site and replayed here. Wallets that understand EIP-4361 also warn the
 * person when the domain in the text does not match the site asking for the signature.
 */

/** Base Sepolia. */
export const SIGN_IN_CHAIN_ID = 84532;
/** How long a sign-in request (and its nonce) stays valid. */
export const SIGN_IN_TTL_MS = 10 * 60_000;
export const SIGN_IN_STATEMENT =
  "Sign in to Stackday. This proves you own this wallet. It costs nothing and sends no transaction.";

export function buildSignInMessage(p: {
  address: `0x${string}`;
  /** The site's host, for example "stackday-rho.vercel.app" or "localhost:3000". */
  domain: string;
  /** The site's origin, for example "https://stackday-rho.vercel.app". */
  uri: string;
  nonce: string;
  issuedAt: Date;
  chainId?: number;
}) {
  return createSiweMessage({
    address: p.address,
    chainId: p.chainId ?? SIGN_IN_CHAIN_ID,
    domain: p.domain,
    uri: p.uri,
    nonce: p.nonce,
    issuedAt: p.issuedAt,
    expirationTime: new Date(p.issuedAt.getTime() + SIGN_IN_TTL_MS),
    statement: SIGN_IN_STATEMENT,
    version: "1",
  });
}

export const USERNAME_RULE = /^[a-z0-9_]{3,20}$/;
