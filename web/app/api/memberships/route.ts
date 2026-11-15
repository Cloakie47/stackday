import { configured, db, isWallet, json, needSignIn, notConfigured, sessionWallet } from "@/lib/server/backend";

/**
 * A person answers a team invitation.
 * Accepting lets that business see the person's attendance. Declining removes them from the list.
 * Neither changes anything on-chain: being paid never needs an invitation.
 */
export async function POST(request: Request) {
  if (!configured()) return notConfigured();
  const wallet = sessionWallet(request);
  if (!wallet) return needSignIn();
  const body = ((await request.json().catch(() => null)) ?? {}) as { employer?: string; action?: string };
  if (!isWallet(body.employer) || (body.action !== "accept" && body.action !== "decline"))
    return json({ error: "Bad request." }, 400);
  const employer = body.employer.toLowerCase();

  const scope = db().from("employees");
  const result =
    body.action === "accept"
      ? await scope.update({ status: "accepted" }).eq("employer_wallet", employer).eq("employee_wallet", wallet).select("status")
      : await scope.delete().eq("employer_wallet", employer).eq("employee_wallet", wallet).select("status");
  if (result.error) return json({ error: "Could not save your answer." }, 500);
  if ((result.data ?? []).length === 0) return json({ error: "That invitation no longer exists." }, 404);
  return json({ ok: true, status: body.action === "accept" ? "accepted" : "declined" });
}
