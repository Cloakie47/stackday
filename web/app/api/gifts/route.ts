import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { giftBoxAbi } from "@/lib/abis";
import { GIFT_BOX } from "@/lib/contracts";
import { attachDecision, parseIds, type GiftOnChain } from "@/lib/gifts/message";
import { configured, db, json, needSignIn, notConfigured, sessionWallet } from "@/lib/server/backend";

/**
 * Gift box messages (the optional note a sender adds). The gift itself lives on the chain, which is
 * the truth for amount, mix and status; this table only holds the note.
 *
 * GET  /api/gifts?ids=1,2,3   messages of those gifts where the signed-in wallet is sender or recipient
 * POST /api/gifts {id, message}  the signed-in sender of a pending gift attaches its note, once
 *
 * Both need the wallet-signature session. Without the account database they answer 503 and the
 * Gifts page simply shows no messages.
 */

const chain = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org"),
});

export async function GET(request: Request) {
  if (!configured()) return notConfigured();
  const me = sessionWallet(request);
  if (!me) return needSignIn();
  const ids = parseIds(new URL(request.url).searchParams.get("ids"));
  if (ids.length === 0) return json({ messages: {} });
  const { data, error } = await db()
    .from("gifts")
    .select("gift_id, message")
    .in("gift_id", ids)
    .or(`sender.eq.${me},recipient.eq.${me}`);
  if (error) return json({ error: "Could not load messages." }, 500);
  const messages: Record<string, string> = {};
  for (const row of data ?? []) messages[String(row.gift_id)] = row.message as string;
  return json({ messages });
}

export async function POST(request: Request) {
  if (!configured()) return notConfigured();
  const me = sessionWallet(request);
  if (!me) return needSignIn();
  if (!GIFT_BOX) return json({ error: "Gift boxes are not deployed on this network." }, 503);
  const body = ((await request.json().catch(() => null)) ?? {}) as { id?: unknown; message?: unknown };
  const id = typeof body.id === "string" ? body.id : undefined;

  let gift: GiftOnChain | null = null;
  if (id && /^[1-9][0-9]{0,18}$/.test(id)) {
    try {
      const g = await chain.readContract({ address: GIFT_BOX, abi: giftBoxAbi, functionName: "giftOf", args: [BigInt(id)] });
      gift = { sender: g.sender, recipient: g.recipient, status: Number(g.status) };
    } catch {
      return json({ error: "Could not read the gift from the chain. Try again." }, 502);
    }
  }
  const d = attachDecision(me, id, body.message, gift);
  if (!d.ok) return json({ error: d.error }, d.status);

  const { error } = await db().from("gifts").insert(d.row);
  if (error?.code === "23505") return json({ error: "This gift already has a message." }, 409);
  if (error) return json({ error: "Could not save the message." }, 500);
  return json({ ok: true });
}
