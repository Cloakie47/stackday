import { configured, db, json, needSignIn, notConfigured, sessionWallet } from "@/lib/server/backend";

/**
 * Find people to add to a team, by unique ID (SD-XXXXXXXX), by name, or by wallet address.
 * Signed-in only, at most 8 results, and only what is needed to recognise and pay someone:
 * their ID, their chosen name and their wallet address (which is public on-chain anyway).
 *
 * Lookups use the unique ID or the ASCII-only name, never free text, so lookalike
 * characters cannot be used to impersonate someone.
 */
export async function GET(request: Request) {
  if (!configured()) return notConfigured();
  const me = sessionWallet(request);
  if (!me) return needSignIn();

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const select = "wallet, uid, username";
  let query = db().from("profiles").select(select).neq("wallet", me).limit(8);

  if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
    query = query.eq("wallet", q.toLowerCase());
  } else if (/^sd-?[0-9a-z]{2,8}$/i.test(q)) {
    const tail = q.toUpperCase().replace(/^SD-?/, "");
    query = query.like("uid", `SD-${tail}%`);
  } else if (/^@?[a-z0-9_]{2,20}$/i.test(q)) {
    query = query.like("username", `${q.replace(/^@/, "").toLowerCase()}%`);
  } else {
    return json({ people: [], hint: "Type at least 2 characters of a name, an ID like SD-7K3F9Q2M, or a wallet address." });
  }

  const { data, error } = await query;
  if (error) return json({ error: "Search failed." }, 500);
  return json({ people: data ?? [] });
}
