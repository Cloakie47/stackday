import { connection } from "next/server";
import { configured, db, json, sessionWallet } from "@/lib/server/backend";
import { ADDR } from "@/lib/contracts";
import { researchFlags } from "@/lib/research/flags";
import { currentEntitlement } from "@/lib/research/access/gate";
import { paymentConfig } from "@/lib/research/access/pay";
import { PRICE_LIST, planCards } from "@/lib/research/access/prices";
import { supabaseAccessStore } from "@/lib/research/access/store";

/**
 * GET /api/research/access: `{ paywallEnabled, prices, entitlement | null }` plus where to pay.
 * Prices are placeholders (a proposal, founder to decide) in test USDC on Base Sepolia. The paywall
 * stays off until the quality bar (four Mondays) and a legal check are done. Works without the
 * account database: then the entitlement is null.
 */
export async function GET(request: Request) {
  // Per-visitor and env-dependent: never prerender at build time.
  await connection();
  const wallet = sessionWallet(request);
  const paywallEnabled = researchFlags().paywallEnabled;
  const cfg = paymentConfig(process.env, ADDR.usdc);
  let entitlement = null;
  if (wallet && configured()) {
    entitlement = await currentEntitlement(wallet, supabaseAccessStore(db), new Date()).catch(() => null);
  }
  return json({
    paywallEnabled,
    prices: { ...PRICE_LIST, plans: planCards() },
    entitlement,
    payment: { enabled: Boolean(cfg) && paywallEnabled, payTo: cfg?.treasury ?? null, usdc: ADDR.usdc },
  });
}
