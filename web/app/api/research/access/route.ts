import { connection } from "next/server";
import { configured, db, json, sessionWallet } from "@/lib/server/backend";
import { ADDR } from "@/lib/contracts";
import { researchFlags } from "@/lib/research/flags";
import { currentEntitlement } from "@/lib/research/access/gate";
import { paymentConfig } from "@/lib/research/access/pay";
import { PRICE_LIST, planCards } from "@/lib/research/access/prices";
import { supabaseAccessStore } from "@/lib/research/access/store";

/**
 * The price list (a proposal that needs founder approval), whether the paywall is on, where to
 * pay, and the signed-in wallet's entitlement. Works without the account database: then the
 * entitlement is null.
 */
export async function GET(request: Request) {
  // Per-visitor and env-dependent: never prerender at build time.
  await connection();
  const wallet = sessionWallet(request);
  const cfg = paymentConfig(process.env, ADDR.usdc);
  let entitlement = null;
  if (wallet && configured()) {
    entitlement = await currentEntitlement(wallet, supabaseAccessStore(db), new Date()).catch(() => null);
  }
  return json({
    paywallEnabled: researchFlags().paywallEnabled,
    paymentsEnabled: Boolean(cfg) && researchFlags().paywallEnabled,
    treasury: cfg?.treasury ?? null,
    payTo: cfg?.treasury ?? undefined,
    usdc: ADDR.usdc,
    pricingStatus: PRICE_LIST.status,
    plans: planCards(),
    premium: { label: PRICE_LIST.items.premium.label, priceUsdc: Number(PRICE_LIST.items.premium.usdc), features: [PRICE_LIST.items.premium.description] },
    prices: PRICE_LIST,
    wallet,
    entitlement,
  });
}
