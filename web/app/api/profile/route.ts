import { configured, db, isWallet, json, needSignIn, notConfigured, sessionWallet } from "@/lib/server/backend";
import { USERNAME_RULE } from "@/lib/signin";

/** Public: look up the names of up to 100 wallets. Only the wallet and its chosen name are returned. */
export async function GET(request: Request) {
  if (!configured()) return json({ configured: false, profiles: {} });
  const wallets = (new URL(request.url).searchParams.get("wallets") ?? "")
    .split(",")
    .filter(isWallet)
    .map((w) => w.toLowerCase())
    .slice(0, 100);
  if (wallets.length === 0) return json({ configured: true, profiles: {} });
  const { data, error } = await db().from("profiles").select("wallet, username").in("wallet", wallets);
  if (error) return json({ error: "Could not load names." }, 500);
  return json({ configured: true, profiles: Object.fromEntries((data ?? []).map((p) => [p.wallet, p.username])) });
}

/** Choose or change your unique name. One name per wallet. */
export async function POST(request: Request) {
  if (!configured()) return notConfigured();
  const wallet = sessionWallet(request);
  if (!wallet) return needSignIn();
  const body = await request.json().catch(() => null);
  const username = String((body as { username?: string } | null)?.username ?? "")
    .trim()
    .toLowerCase();
  if (!USERNAME_RULE.test(username))
    return json({ error: "Use 3 to 20 characters: lowercase letters, numbers or underscore." }, 400);

  const { error } = await db().from("profiles").upsert({ wallet, username }, { onConflict: "wallet" });
  if (error) {
    if (error.code === "23505") return json({ error: "That name is taken. Try another." }, 409);
    return json({ error: "Could not save the name." }, 500);
  }
  return json({ wallet, username });
}
