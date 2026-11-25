import { connection } from "next/server";
import { configured, db, json, sessionWallet } from "@/lib/server/backend";
import { ADDR } from "@/lib/contracts";
import { researchFlags } from "@/lib/research/flags";
import { currentEntitlement } from "@/lib/research/access/gate";
import deployment from "@/lib/deployment.json";
import { paymentConfig, stackdayContracts } from "@/lib/research/access/pay";
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
  // Same refusal list as POST /pay, so GET never shows a treasury that could never be credited.
  const cfg = paymentConfig(process.env, ADDR.usdc, stackdayContracts(deployment));
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
