import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import {
  clearCookie,
  configured,
  dbNonceStore,
  ensureProfile,
  json,
  notConfigured,
  sessionCookie,
  sessionWallet,
  signInDomains,
} from "@/lib/server/backend";
import { checkSignIn } from "@/lib/server/signin-check";

const chain = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org"),
});

/** Who is signed in, and whether the account database is connected at all. */
export async function GET(request: Request) {
  return json({ configured: configured(), address: sessionWallet(request) });
}

/**
 * Step 2 of sign-in: the wallet signed a "Sign-In with Ethereum" message holding our domain,
 * the chain and a nonce from POST /api/session/nonce. We check all three, use up the nonce,
 * check the signature and set a session cookie.
 */
export async function POST(request: Request) {
  if (!configured()) return notConfigured();
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  const result = await checkSignIn({
    message: body.message,
    signature: body.signature,
    domains: signInDomains(request),
    chainId: baseSepolia.id,
    now: new Date(),
    store: dbNonceStore,
    // Works for normal wallets and for smart contract wallets.
    verify: (p) => chain.verifyMessage(p),
  });
  if (!result.ok) return json({ error: result.error }, result.status);

  // First sign-in creates the wallet's profile and its unique ID.
  const profile = await ensureProfile(result.address).catch(() => null);
  if (!profile) return json({ error: "Could not set up your profile. Try again." }, 500);

  return json({ configured: true, address: result.address, uid: profile.uid }, 200, {
    "Set-Cookie": sessionCookie(result.address),
  });
}

export async function DELETE() {
  return json({ address: null }, 200, { "Set-Cookie": clearCookie() });
}
