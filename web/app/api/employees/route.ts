import { configured, db, isWallet, json, needSignIn, notConfigured, sessionWallet } from "@/lib/server/backend";

/** An employer's own team list. Only the signed-in employer can read or change it. */
export async function GET(request: Request) {
  if (!configured()) return notConfigured();
  const employer = sessionWallet(request);
  if (!employer) return needSignIn();
  const { data, error } = await db()
    .from("employees")
    .select("employee_wallet, name, role, salary_usdc")
    .eq("employer_wallet", employer)
    .order("created_at", { ascending: true });
  if (error) return json({ error: "Could not load the team." }, 500);
  return json({ employees: data ?? [] });
}

/** Add or update one team member. */
export async function POST(request: Request) {
  if (!configured()) return notConfigured();
  const employer = sessionWallet(request);
  if (!employer) return needSignIn();
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (!isWallet(body.wallet)) return json({ error: "That is not a valid wallet address." }, 400);
  const name = String(body.name ?? "").trim().slice(0, 80);
  const role = String(body.role ?? "").trim().slice(0, 80);
  const salary = Number(body.salary ?? 0);
  if (!name) return json({ error: "Enter a name." }, 400);
  if (!(salary >= 0 && salary < 1e9)) return json({ error: "Enter a valid salary." }, 400);

  const { error } = await db().from("employees").upsert(
    {
      employer_wallet: employer,
      employee_wallet: body.wallet.toLowerCase(),
      name,
      role,
      salary_usdc: salary,
    },
    { onConflict: "employer_wallet,employee_wallet" },
  );
  if (error) return json({ error: "Could not save the team member." }, 500);
  return json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!configured()) return notConfigured();
  const employer = sessionWallet(request);
  if (!employer) return needSignIn();
  const wallet = new URL(request.url).searchParams.get("wallet");
  if (!isWallet(wallet)) return json({ error: "Bad request." }, 400);
  const { error } = await db()
    .from("employees")
    .delete()
    .eq("employer_wallet", employer)
    .eq("employee_wallet", wallet.toLowerCase());
  if (error) return json({ error: "Could not remove the team member." }, 500);
  return json({ ok: true });
}
