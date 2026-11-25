/**
 * The trigger bot's decisions, kept pure so they can be unit tested (keeper.test.ts).
 *
 * The contracts let anyone trigger a due recurring buy (SipRouter.executePlan) or a due payday
 * (Payroll.runSchedule), but they can only ever do what the person or employer set up: that amount,
 * that asset, into that person's own vault, within their price limit. The bot just presses the
 * button on time. It holds no user funds; its wallet only pays gas.
 */

export type PlanState = {
  usdcPerBuy: bigint;
  nextBuyAt: number;
  /** USDC the user still allows SipRouter to take. A plan's "how long" lives here. */
  allowance: bigint;
  walletUsdc: bigint;
};

export type PlanDecision = "run" | "not-due" | "cancelled" | "finished" | "no-usdc";

export function planDecision(p: PlanState, now: number): PlanDecision {
  if (p.usdcPerBuy === 0n) return "cancelled";
  if (p.nextBuyAt > now) return "not-due";
  if (p.allowance < p.usdcPerBuy) return "finished";
  if (p.walletUsdc < p.usdcPerBuy) return "no-usdc";
  return "run";
}

export type ScheduleState = {
  active: boolean;
  nextPayAt: number;
  total: bigint;
  employerBalance: bigint;
};

export type ScheduleDecision = "run" | "paused" | "not-due" | "underfunded";

export function scheduleDecision(s: ScheduleState, now: number): ScheduleDecision {
  if (!s.active) return "paused";
  if (s.nextPayAt > now) return "not-due";
  if (s.employerBalance < s.total) return "underfunded";
  return "run";
}

export type GiftState = { status: number; expiresAt: number };

export type GiftDecision = "refund" | "not-pending" | "not-expired";

/**
 * Gift boxes (src/GiftBox.sol): a box still pending (status 1) at or after its expiry can be
 * refunded by anyone, and the USDC can only ever go back to its sender. The bot presses that button.
 */
export function giftDecision(g: GiftState, now: number): GiftDecision {
  if (g.status !== 1) return "not-pending";
  if (now < g.expiresAt) return "not-expired";
  return "refund";
}

/** Most gift boxes one run reads, newest first (ids run 1 to nextId - 1). */
export const MAX_GIFTS_PER_RUN = 1000;
/** Boxes read per multicall. */
export const GIFT_READ_CHUNK = 100;

export type GiftStepDeps = {
  nextId(): Promise<bigint>;
  /** giftOf for each id, in the same order. */
  giftsOf(ids: bigint[]): Promise<GiftState[]>;
  /** Simulates and sends refundExpired(id); reports its own failures. */
  refund(id: bigint): Promise<void>;
  skip(why: string): void;
};

/**
 * The keeper's gift step: read the newest boxes in chunks and refund every pending box that has
 * expired. Returns the ids it tried to refund. The contract re-checks everything on the refund.
 */
export async function refundExpiredGifts(deps: GiftStepDeps, now: number): Promise<bigint[]> {
  const nextId = await deps.nextId();
  const ids: bigint[] = [];
  for (let id = nextId - 1n; id >= 1n && ids.length < MAX_GIFTS_PER_RUN; id--) ids.push(id);
  const tried: bigint[] = [];
  for (let i = 0; i < ids.length; i += GIFT_READ_CHUNK) {
    const chunk = ids.slice(i, i + GIFT_READ_CHUNK);
    const gifts = await deps.giftsOf(chunk);
    for (let j = 0; j < chunk.length; j++) {
      const d = giftDecision({ status: Number(gifts[j].status), expiresAt: Number(gifts[j].expiresAt) }, now);
      if (d === "refund") {
        tried.push(chunk[j]);
        await deps.refund(chunk[j]);
      } else if (d === "not-expired") deps.skip("gift-not-expired");
    }
  }
  return tried;
}

/** Most transactions one run may send, so a backlog cannot drain the bot's gas in one go. */
export const MAX_TX_PER_RUN = 25;

/** The cron call must carry the shared secret Vercel sends (Authorization: Bearer <CRON_SECRET>). */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
