import { configured, db, ensureProfile, json, needSignIn, notConfigured, sessionWallet } from "@/lib/server/backend";

/**
 * Everything about the signed-in wallet's own account: its profile and unique ID, the business
 * it owns (if any), and the teams it has been added to.
 */
export async function GET(request: Request) {
  if (!configured()) return notConfigured();
  const wallet = sessionWallet(request);
  if (!wallet) return needSignIn();

  const profile = await ensureProfile(wallet).catch(() => null);
  if (!profile) return json({ error: "Could not load your profile." }, 500);

  const [business, teams] = await Promise.all([
    db().from("businesses").select("name, description").eq("owner_wallet", wallet).maybeSingle(),
    db().from("employees").select("employer_wallet, status, role").eq("employee_wallet", wallet),
  ]);
  if (business.error || teams.error) return json({ error: "Could not load your account." }, 500);

  const employers = (teams.data ?? []).map((t) => t.employer_wallet);
  const names = employers.length
    ? await db().from("businesses").select("owner_wallet, name").in("owner_wallet", employers)
    : { data: [], error: null };
  const nameOf = Object.fromEntries((names.data ?? []).map((b) => [b.owner_wallet, b.name]));

  return json({
    profile,
    business: business.data ?? null,
    memberships: (teams.data ?? []).map((t) => ({
      employer: t.employer_wallet,
      businessName: nameOf[t.employer_wallet] ?? null,
      role: t.role,
      status: t.status,
    })),
  });
}

/** Choose or switch the account type. One wallet may use both: this sets which one it opens with. */
export async function POST(request: Request) {
  if (!configured()) return notConfigured();
  const wallet = sessionWallet(request);
  if (!wallet) return needSignIn();
  const body = ((await request.json().catch(() => null)) ?? {}) as { accountType?: string };
  if (body.accountType !== "individual" && body.accountType !== "business")
    return json({ error: "Choose Individual or Business." }, 400);

  await ensureProfile(wallet);
  const { error } = await db().from("profiles").update({ account_type: body.accountType }).eq("wallet", wallet);
  if (error) return json({ error: "Could not save your choice." }, 500);
  return json({ accountType: body.accountType });
}
