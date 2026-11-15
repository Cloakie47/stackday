import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { clearCookie, configured, isWallet, json, notConfigured, sessionCookie, sessionWallet } from "@/lib/server/backend";
import { signInMessage } from "@/lib/signin";

const chain = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org"),
});

/** Who is signed in, and whether the account database is connected at all. */
export async function GET(request: Request) {
  return json({ configured: configured(), address: sessionWallet(request) });
}

/** Sign in: the wallet signs a short message, we check the signature and set a session cookie. */
export async function POST(request: Request) {
  if (!configured()) return notConfigured();
  const body = await request.json().catch(() => null);
  const { address, issuedAt, signature } = (body ?? {}) as Record<string, string>;
  if (!isWallet(address) || typeof issuedAt !== "string" || typeof signature !== "string")
    return json({ error: "Bad request." }, 400);

  const age = Date.now() - Date.parse(issuedAt);
  if (!(age >= -60_000 && age < 10 * 60_000)) return json({ error: "That sign-in request expired. Try again." }, 400);

  // Works for normal wallets and for smart contract wallets.
  const ok = await chain
    .verifyMessage({
      address: address as `0x${string}`,
      message: signInMessage(address, issuedAt),
      signature: signature as `0x${string}`,
    })
    .catch(() => false);
  if (!ok) return json({ error: "The signature does not match this wallet." }, 401);

  return json({ configured: true, address: address.toLowerCase() }, 200, { "Set-Cookie": sessionCookie(address) });
}

export async function DELETE() {
  return json({ address: null }, 200, { "Set-Cookie": clearCookie() });
}
