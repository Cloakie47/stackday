import { createPublicClient, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { routerAbi } from "@/lib/abis";
import { ADDR, ASSETS } from "@/lib/contracts";
import { configured, db, isWallet, json, notConfigured } from "@/lib/server/backend";

/**
 * Tell the trigger bot about a recurring plan, so it runs the buys on time.
 * No sign-in needed: the plan itself on the blockchain is the proof. The row is stored only if
 * that wallet really has a plan for that asset, and the bot re-checks the chain before every buy.
 */
export async function POST(request: Request) {
  if (!configured()) return notConfigured();
  const body = (await request.json().catch(() => null)) as { wallet?: unknown; asset?: unknown } | null;
  const wallet = body?.wallet;
  const asset = body?.asset;
  if (!isWallet(wallet) || !isWallet(asset)) return json({ error: "Wallet and asset addresses are needed." }, 400);
  if (!ASSETS.some((a) => a.token.toLowerCase() === asset.toLowerCase())) return json({ error: "Unknown asset." }, 400);

  const pub = createPublicClient({ chain: baseSepolia, transport: http(process.env.KEEPER_RPC_URL || "https://sepolia.base.org") });
  const plan = (await pub.readContract({
    address: ADDR.router,
    abi: routerAbi,
    functionName: "planOf",
    args: [wallet as Address, asset as Address],
  })) as readonly [Address, bigint, number, number, number];
  if (plan[1] === 0n) return json({ error: "No recurring plan for this wallet and asset." }, 404);

  const { error } = await db()
    .from("recurring_plans")
    .upsert({ wallet: wallet.toLowerCase(), asset: asset.toLowerCase() }, { onConflict: "wallet,asset" });
  if (error) return json({ error: "Could not save." }, 500);
  return json({ ok: true });
}
