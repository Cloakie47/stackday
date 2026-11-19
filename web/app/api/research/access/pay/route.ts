import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { configured, db, json, needSignIn, notConfigured, sessionWallet } from "@/lib/server/backend";
import { ADDR } from "@/lib/contracts";
import { researchFlags } from "@/lib/research/flags";
import { paymentConfig, processPayment } from "@/lib/research/access/pay";
import { isPurpose } from "@/lib/research/access/prices";
import { supabaseAccessStore } from "@/lib/research/access/store";

/**
 * Body: { txHash, purpose: "report" | "monthly" | "yearly" | "premium" }.
 * The signed-in wallet has already sent test USDC to the research treasury on Base Sepolia; we
 * read the receipt, check it, store the hash once and grant credits or plan time.
 * Read only on chain: the server holds no key and sends nothing.
 */
const chain = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RESEARCH_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org"),
});

export async function POST(request: Request) {
  if (!configured()) return notConfigured();
  const wallet = sessionWallet(request);
  if (!wallet) return needSignIn();
  if (!researchFlags().paywallEnabled) return json({ error: "Paid reports are not switched on yet, so no payment is needed." }, 403);
  const cfg = paymentConfig(process.env, ADDR.usdc);
  if (!cfg) return json({ error: "Research payments are not set up yet." }, 503);

  const body = ((await request.json().catch(() => null)) ?? {}) as { txHash?: unknown; purpose?: unknown };
  if (typeof body.txHash !== "string" || !isPurpose(body.purpose)) return json({ error: "Send a transaction hash and what it pays for." }, 400);

  const result = await processPayment({
    txHash: body.txHash,
    wallet,
    purpose: body.purpose,
    reader: chain,
    cfg,
    store: supabaseAccessStore(db),
    now: new Date(),
  });
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ entitlement: result.entitlement, amountUsdc: result.amountUsdc, summary: result.summary });
}
