import { configured, dbNonceStore, json, notConfigured } from "@/lib/server/backend";
import { NONCE_TTL_MS, newNonce } from "@/lib/server/signin-check";

/** Step 1 of sign-in: a fresh single-use code for the wallet to sign. Valid for 10 minutes. */
export async function POST() {
  if (!configured()) return notConfigured();
  const nonce = newNonce();
  try {
    await dbNonceStore.put(nonce, new Date(Date.now() + NONCE_TTL_MS));
  } catch {
    return json({ error: "Could not start sign-in. Try again." }, 500);
  }
  return json({ nonce });
}
