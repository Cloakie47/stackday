import { configured, db, ensureProfile, isWallet, json, needSignIn, notConfigured, sessionWallet } from "@/lib/server/backend";

/** Public: the business names of up to 100 owner wallets, so employees see a name and not an address. */
export async function GET(request: Request) {
  if (!configured()) return json({ configured: false, businesses: {} });
  const wallets = (new URL(request.url).searchParams.get("wallets") ?? "")
    .split(",")
    .filter(isWallet)
    .map((w) => w.toLowerCase())
    .slice(0, 100);
  if (wallets.length === 0) return json({ configured: true, businesses: {} });
  const { data, error } = await db().from("businesses").select("owner_wallet, name, description").in("owner_wallet", wallets);
  if (error) return json({ error: "Could not load businesses." }, 500);
  return json({
    configured: true,
    businesses: Object.fromEntries((data ?? []).map((b) => [b.owner_wallet, { name: b.name, description: b.description }])),
  });
}

/** Create or update the signed-in wallet's own business profile. */
export async function POST(request: Request) {
  if (!configured()) return notConfigured();
  const wallet = sessionWallet(request);
  if (!wallet) return needSignIn();
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  // Collapse whitespace so two names cannot differ only by invisible spacing.
  const name = String(body.name ?? "").replace(/\s+/g, " ").trim();
  const description = String(body.description ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 60) return json({ error: "The business name must be 2 to 60 characters." }, 400);
  if (description.length > 400) return json({ error: "Keep the description under 400 characters." }, 400);

  await ensureProfile(wallet);
  const { error } = await db()
    .from("businesses")
    .upsert({ owner_wallet: wallet, name, description }, { onConflict: "owner_wallet" });
  if (error) return json({ error: "Could not save the business." }, 500);
  await db().from("profiles").update({ account_type: "business" }).eq("wallet", wallet);
  return json({ name, description });
}
