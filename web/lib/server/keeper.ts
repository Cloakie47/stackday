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
