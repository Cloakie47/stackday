import { createPublicClient, createWalletClient, erc20Abi, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { giftBoxAbi, payrollAbi, routerAbi } from "@/lib/abis";
import { ADDR, GIFT_BOX } from "@/lib/contracts";
import { configured, db, json } from "@/lib/server/backend";
import { MAX_TX_PER_RUN, cronAuthorized, planDecision, refundExpiredGifts, scheduleDecision } from "@/lib/server/keeper";

/**
 * The trigger bot. Vercel's cron calls this on a timer (vercel.json). It runs every due payroll
 * schedule and every due recurring buy, so "invest on a schedule" happens without anyone clicking.
 * It also sends expired, unopened gift boxes back to their senders (GiftBox.refundExpired).
 *
 * Server-only settings (set in Vercel, never in the repo or chat):
 *   CRON_SECRET          shared secret Vercel sends with each cron call
 *   KEEPER_PRIVATE_KEY   a dedicated bot wallet that only pays gas (holds no user money)
 *   KEEPER_RPC_URL       optional, defaults to the public Base Sepolia RPC
 * Without them the route does nothing and says it is not set up.
 */
export const maxDuration = 60;

type Tx = { kind: "payday" | "buy" | "gift-refund"; id: string; hash?: string; error?: string };

export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) return json({ error: "Not allowed." }, 401);
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return json({ error: "The trigger bot is not set up." }, 503);

  const transport = http(process.env.KEEPER_RPC_URL || "https://sepolia.base.org");
  const pub = createPublicClient({ chain: baseSepolia, transport });
  const account = privateKeyToAccount(key as `0x${string}`);
  const wallet = createWalletClient({ chain: baseSepolia, transport, account });
  const now = Math.floor(Date.now() / 1000);
  const sent: Tx[] = [];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);

  // Simulate first (the contract's own checks decide), then send. A failure is reported, never retried here.
  async function send(kind: Tx["kind"], id: string, call: Parameters<typeof pub.simulateContract>[0]) {
    if (sent.length >= MAX_TX_PER_RUN) return skip("run-limit");
    try {
      const { request: req } = await pub.simulateContract({ ...call, account });
      const hash = await wallet.writeContract(req);
      await pub.waitForTransactionReceipt({ hash });
      sent.push({ kind, id, hash });
    } catch (e) {
      sent.push({ kind, id, error: e instanceof Error ? e.message.split("\n")[0].slice(0, 160) : "failed" });
    }
  }

  // 1. Payroll schedules: every schedule ever created is numbered 1..scheduleCount.
  const count = Number(await pub.readContract({ address: ADDR.payroll, abi: payrollAbi, functionName: "scheduleCount" }));
  for (let id = 1; id <= count; id++) {
    const s = (await pub.readContract({ address: ADDR.payroll, abi: payrollAbi, functionName: "getSchedule", args: [BigInt(id)] })) as readonly [
      Address, number, number, boolean, bigint, readonly Address[], readonly bigint[],
    ];
    const balance = await pub.readContract({ address: ADDR.payroll, abi: payrollAbi, functionName: "employerBalance", args: [s[0]] });
    const d = scheduleDecision({ active: s[3], nextPayAt: Number(s[2]), total: s[4], employerBalance: balance as bigint }, now);
    if (d !== "run") skip(`payday-${d}`);
    else await send("payday", String(id), { address: ADDR.payroll, abi: payrollAbi, functionName: "runSchedule", args: [BigInt(id)] });
  }

  // 2. Gift boxes: every box is numbered 1..nextId-1 on the contract (no database needed). A pending box
  // past its expiry is refunded; the contract only ever pays the sender. Runs before the database step,
  // which can stop the run early.
  const giftBox = GIFT_BOX;
  if (giftBox) {
    try {
      await refundExpiredGifts(
        {
          nextId: async () => (await pub.readContract({ address: giftBox, abi: giftBoxAbi, functionName: "nextId" })) as bigint,
          giftsOf: async (ids) =>
            (await pub.multicall({
              allowFailure: false,
              contracts: ids.map((id) => ({ address: giftBox, abi: giftBoxAbi, functionName: "giftOf", args: [id] }) as const),
            })) as { status: number; expiresAt: number }[],
          refund: async (id) => {
            await send("gift-refund", String(id), { address: giftBox, abi: giftBoxAbi, functionName: "refundExpired", args: [id] });
          },
          skip,
        },
        now,
      );
    } catch {
      skip("gifts-read-failed"); // a read error never stops the recurring buys below
    }
  } else skip("gifts-not-deployed");

  // 3. Recurring buys: the plans people registered when they saved them (account database).
  if (configured()) {
    const { data, error } = await db().from("recurring_plans").select("wallet, asset").limit(500);
    if (error) return json({ error: "Could not load plans.", sent }, 500);
    for (const row of data ?? []) {
      const user = row.wallet as Address;
      const asset = row.asset as Address;
      const [plan, allowance, walletUsdc] = await Promise.all([
        pub.readContract({ address: ADDR.router, abi: routerAbi, functionName: "planOf", args: [user, asset] }),
        pub.readContract({ address: ADDR.usdc, abi: erc20Abi, functionName: "allowance", args: [user, ADDR.router] }),
        pub.readContract({ address: ADDR.usdc, abi: erc20Abi, functionName: "balanceOf", args: [user] }),
      ]);
      const p = plan as readonly [Address, bigint, number, number, number];
      const d = planDecision({ usdcPerBuy: p[1], nextBuyAt: Number(p[3]), allowance, walletUsdc }, now);
      if (d === "cancelled") {
        await db().from("recurring_plans").delete().eq("wallet", row.wallet).eq("asset", row.asset);
        skip("buy-cancelled");
      } else if (d !== "run") skip(`buy-${d}`);
      else await send("buy", `${user}:${asset}`, { address: ADDR.router, abi: routerAbi, functionName: "executePlan", args: [user, asset] });
    }
  } else skip("buys-no-database");

  return json({ bot: account.address, sent, skipped });
}
