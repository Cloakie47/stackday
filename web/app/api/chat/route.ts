import { z } from "zod";
import { runChat, type ChatTurn } from "@/lib/chat/agent";
import { readSnapshot } from "@/lib/chat/chain";
import { chatError, createMessage } from "@/lib/chat/model";
import { loanText, portfolioText, pricesText, weeklyAnswer, type Snapshot } from "@/lib/chat/summary";
import { EXPLANATIONS } from "@/lib/chat/tools";
import type { Address } from "@/lib/contracts";
import { researchFlags } from "@/lib/research/flags";
import { supabaseStore } from "@/lib/research/engine/store";
import { configured, db, json, needSignIn, notConfigured, sessionWallet } from "@/lib/server/backend";
import { limitWallet } from "@/lib/server/rate-limit";
import { dbRateLimitStore } from "@/lib/server/rate-limit-store";

/**
 * POST /api/chat { messages: [{ role, text, untrusted? }] } -> { text, intent?, untrusted, research, wallet }
 *
 * The chat assistant (docs/features/CHAT-AND-GIFTS.md, section 1). Needs the wallet sign-in session
 * and is limited per wallet. The model gets read tools for the signed-in wallet's own data and can
 * return at most one action intent, checked against strict schemas (lib/chat/intent.ts). The intent
 * is only a proposal: the browser rebuilds the calls in code for the connected wallet and the person
 * signs them in their own wallet. Nothing here signs, sends or holds a key.
 */
export const maxDuration = 60;

const body = z.strictObject({
  messages: z
    .array(z.strictObject({ role: z.enum(["user", "assistant"]), text: z.string().max(4000), untrusted: z.boolean().optional() }))
    .min(1)
    .max(40),
});

export async function POST(request: Request) {
  if (!configured()) return notConfigured();
  const wallet = sessionWallet(request);
  if (!wallet) return needSignIn();
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "The assistant is not switched on for this site yet." }, 503);

  const limited = await limitWallet({
    wallet,
    secret: process.env.SESSION_SECRET || process.env.SUPABASE_JWT_SECRET || "",
    store: dbRateLimitStore,
    now: new Date(),
    onError: (e) => console.error("chat rate limit unavailable:", e instanceof Error ? e.message : e),
  });
  if (limited.limited) return json({ error: "That is a lot of messages. Wait a moment and try again." }, 429, { "Retry-After": String(limited.retryAfter) });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "That message could not be read." }, 400);
  const history: ChatTurn[] = parsed.data.messages;

  let snap: Snapshot | null = null;
  try {
    snap = await readSnapshot(wallet as Address);
  } catch (e) {
    console.error("chat chain read failed:", e instanceof Error ? e.message.slice(0, 120) : e);
  }
  const noChain = "Could not read the chain right now. Say so.";

  try {
    const result = await runChat({
      history,
      portfolio: snap ? portfolioText(snap) : undefined,
      create: createMessage,
      read: {
        portfolio: async () => (snap ? portfolioText(snap) : noChain),
        loan: async (asset) => (snap ? loanText(snap, asset) : noChain),
        prices: async (assets) => (snap ? pricesText(snap, assets) : noChain),
        weekly: async (asset) => {
          if (researchFlags().paywallEnabled) return { text: "The weekly report is behind the research paywall. Point the person to the Research page.", notes: [] };
          // Approved reports only: never a draft, never the sample.
          const found = await supabaseStore(db()).latestWeekly(true);
          return weeklyAnswer(found?.approved ? found.report : null, asset);
        },
        explain: (topic) => EXPLANATIONS[topic],
      },
    });
    // Log: tool calls and the intent only. No wallet, no message text, no keys.
    console.info("chat turn", JSON.stringify({ tools: result.log, intent: result.intent ?? null, untrusted: result.untrusted }));
    return json({ text: result.text, intent: result.intent ?? null, untrusted: result.untrusted, research: result.research, wallet });
  } catch (e) {
    const { status, message } = chatError(e);
    console.error("chat model call failed:", status, e instanceof Error ? e.name : "error");
    return json({ error: message }, status);
  }
}
