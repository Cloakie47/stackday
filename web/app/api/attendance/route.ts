import { configured, db, json, needSignIn, notConfigured, sessionWallet, today } from "@/lib/server/backend";

/**
 * Attendance is a simple daily check-in, recorded off-chain. It is a record for the employer to
 * look at. It does not change what anyone is paid: salaries are set by the employer on-chain.
 */

/** My own check-ins, and (if I am an employer) my team's, for the last `days` days. */
export async function GET(request: Request) {
  if (!configured()) return notConfigured();
  const wallet = sessionWallet(request);
  if (!wallet) return needSignIn();
  const days = Math.min(60, Math.max(1, Number(new URL(request.url).searchParams.get("days") ?? 14)));
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

  const team = await db().from("employees").select("employee_wallet").eq("employer_wallet", wallet);
  if (team.error) return json({ error: "Could not load attendance." }, 500);
  const wallets = Array.from(new Set([wallet, ...(team.data ?? []).map((e) => e.employee_wallet)]));

  const { data, error } = await db()
    .from("attendance")
    .select("employee_wallet, day")
    .in("employee_wallet", wallets)
    .gte("day", since);
  if (error) return json({ error: "Could not load attendance." }, 500);

  const byWallet: Record<string, string[]> = {};
  for (const row of data ?? []) (byWallet[row.employee_wallet] ??= []).push(row.day);
  return json({ today: today(), since, mine: byWallet[wallet] ?? [], team: byWallet });
}

/** Check in for today. One check-in per wallet per day. */
export async function POST(request: Request) {
  if (!configured()) return notConfigured();
  const wallet = sessionWallet(request);
  if (!wallet) return needSignIn();
  const { error } = await db()
    .from("attendance")
    .upsert({ employee_wallet: wallet, day: today() }, { onConflict: "employee_wallet,day", ignoreDuplicates: true });
  if (error) return json({ error: "Could not record the check-in." }, 500);
  return json({ ok: true, day: today() });
}
