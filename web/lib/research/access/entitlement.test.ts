import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entitlement } from "../types.ts";
import { PLANS } from "../types.ts";
import {
  applyPayment,
  decideAccess,
  effectiveEntitlement,
  freeEntitlement,
  isSpendableWeek,
  isWeekOf,
  MAX_UNLOCKED_WEEKS,
  monthlyActive,
  priceUnits,
  unlockWeek,
} from "./entitlement.ts";
import { MAX_CREDITS_PER_PAYMENT, PRICE_LIST, PRICING_STATUS, PURPOSES, planCards } from "./prices.ts";

const W = "0x00000000000000000000000000000000000000a1";
// The Tuesday after MON, so MON is a past Monday a credit may be spent on.
const NOW = new Date("2026-11-24T12:00:00Z");
const DAY = 86_400_000;
const MON = "2026-11-23";
const iso = (ms: number) => new Date(ms).toISOString();
const ent = (o: Partial<Entitlement> = {}): Entitlement => ({ ...freeEntitlement(W), ...o });
const weekly = (o: Partial<{ wallet: string | null; weekOf: string }> = {}) => ({ wallet: W, product: "weekly-report" as const, weekOf: MON, ...o });

test("price list: one Monday report and a monthly plan, a labelled proposal in test USDC on Base Sepolia", () => {
  assert.equal(PRICE_LIST.status, PRICING_STATUS);
  assert.match(PRICING_STATUS, /proposal, founder to decide/);
  assert.equal(PRICE_LIST.chainId, 84532);
  assert.deepEqual([...PURPOSES].sort(), ["monthly", "weekly-single"]);
  assert.deepEqual(Object.keys(PRICE_LIST.items).sort(), [...PURPOSES].sort());
  for (const p of PURPOSES) assert.ok(priceUnits(p) > BigInt(0), p);
  // Small placeholders.
  assert.ok(priceUnits("weekly-single") <= BigInt(5_000_000));
  assert.ok(priceUnits("monthly") <= BigInt(20_000_000));
  assert.ok(priceUnits("monthly") > priceUnits("weekly-single"));
  assert.equal(PRICE_LIST.items.monthly.days, 30, "30 days always hold four or five Mondays");
  assert.deepEqual(planCards().map((c) => c.plan), [...PLANS]);
});

test("monthly plan is active only before valid_until", () => {
  assert.equal(monthlyActive(ent({ plan: "monthly", validUntil: iso(NOW.getTime() + 1) }), NOW), true);
  assert.equal(monthlyActive(ent({ plan: "monthly", validUntil: NOW.toISOString() }), NOW), false);
  assert.equal(monthlyActive(ent({ plan: "monthly", validUntil: null }), NOW), false);
  assert.equal(monthlyActive(ent({ plan: "weekly-single", validUntil: iso(NOW.getTime() + DAY) }), NOW), false);
  assert.equal(monthlyActive(ent({ plan: "monthly", validUntil: "garbage" }), NOW), false);
});

test("expired monthly plan falls back and keeps credits and unlocked Mondays", () => {
  const expired = ent({ plan: "monthly", validUntil: iso(NOW.getTime() - 1), weeklyCredits: 2, unlockedWeeks: ["2026-11-16"] });
  assert.deepEqual(effectiveEntitlement(expired, NOW), { ...expired, plan: "weekly-single", validUntil: null });
  assert.equal(effectiveEntitlement(ent({ plan: "monthly", validUntil: iso(NOW.getTime() - 1) }), NOW).plan, "free");
  const active = ent({ plan: "monthly", validUntil: iso(NOW.getTime() + DAY) });
  assert.equal(effectiveEntitlement(active, NOW), active);
});

test("paid-mode decision for the weekly report", () => {
  assert.deepEqual(decideAccess(weekly({ wallet: null }), null, NOW), { allowed: false, reason: "sign-in" });
  assert.deepEqual(decideAccess(weekly(), null, NOW), { allowed: false, reason: "payment-required" });
  assert.deepEqual(decideAccess(weekly(), ent({ plan: "monthly", validUntil: iso(NOW.getTime() + DAY) }), NOW), { allowed: true, consumesCredit: false });
  assert.deepEqual(decideAccess(weekly(), ent({ plan: "monthly", validUntil: iso(NOW.getTime() - DAY) }), NOW), { allowed: false, reason: "payment-required" });
  assert.deepEqual(decideAccess(weekly(), ent({ weeklyCredits: 1 }), NOW), { allowed: true, consumesCredit: true });
  // Reopening an unlocked Monday is free, even with no credits left.
  assert.deepEqual(decideAccess(weekly(), ent({ unlockedWeeks: [MON] }), NOW), { allowed: true, consumesCredit: false });
  assert.deepEqual(decideAccess(weekly({ weekOf: "2026-11-30" }), ent({ unlockedWeeks: [MON] }), NOW), { allowed: false, reason: "payment-required" });
  // A credit needs to know which Monday it opens.
  assert.deepEqual(decideAccess({ wallet: W, product: "weekly-report" }, ent({ weeklyCredits: 1 }), NOW), { allowed: false, reason: "payment-required" });
});

test("paid-mode decision for the portfolio check: sign-in only, never paid", () => {
  assert.deepEqual(decideAccess({ wallet: null, product: "portfolio-check" }, null, NOW), { allowed: false, reason: "sign-in" });
  assert.deepEqual(decideAccess({ wallet: W, product: "portfolio-check" }, null, NOW), { allowed: true, consumesCredit: false });
});

test("unlockWeek spends one credit per new Monday and nothing on a reopen", () => {
  const u = unlockWeek(ent({ plan: "weekly-single", weeklyCredits: 2 }), MON, NOW);
  assert.equal(u.kind, "unlocked");
  if (u.kind !== "unlocked") return;
  assert.equal(u.next.weeklyCredits, 1);
  assert.deepEqual(u.next.unlockedWeeks, [MON]);
  assert.equal(u.next.plan, "weekly-single");
  assert.deepEqual(unlockWeek(u.next, MON, NOW), { kind: "already-unlocked" });
  assert.deepEqual(unlockWeek(ent(), MON, NOW), { kind: "no-credit" });
  // With an active monthly plan the plan stays monthly.
  const m = unlockWeek(ent({ plan: "monthly", validUntil: iso(NOW.getTime() + DAY), weeklyCredits: 1 }), MON, NOW);
  assert.ok(m.kind === "unlocked" && m.next.plan === "monthly");
  // The list is capped, dropping the oldest Monday.
  const LATER = new Date("2030-02-01T00:00:00Z");
  const many = Array.from({ length: MAX_UNLOCKED_WEEKS }, (_, i) => iso(Date.UTC(2020, 0, 6) + i * 7 * DAY).slice(0, 10));
  const capped = unlockWeek(ent({ weeklyCredits: 1, unlockedWeeks: many }), "2030-01-07", LATER);
  assert.ok(capped.kind === "unlocked" && capped.next.unlockedWeeks.length === MAX_UNLOCKED_WEEKS && capped.next.unlockedWeeks.at(-1) === "2030-01-07");
  // At the cap, unlocking a Monday OLDER than every kept one still keeps it (it is never charged twice).
  const recent = Array.from({ length: MAX_UNLOCKED_WEEKS }, (_, i) => iso(Date.UTC(2025, 0, 6) + i * 7 * DAY).slice(0, 10));
  const old = unlockWeek(ent({ weeklyCredits: 1, unlockedWeeks: recent }), "2024-12-30", LATER);
  assert.ok(old.kind === "unlocked" && old.next.unlockedWeeks.includes("2024-12-30") && old.next.unlockedWeeks.length === MAX_UNLOCKED_WEEKS);
  assert.deepEqual(unlockWeek(old.kind === "unlocked" ? old.next : ent(), "2024-12-30", LATER), { kind: "already-unlocked" });
  // Malformed, non-Monday and future weeks are refused.
  assert.deepEqual(unlockWeek(ent({ weeklyCredits: 1 }), "2026-11-25", NOW), { kind: "bad-week" });
  assert.deepEqual(unlockWeek(ent({ weeklyCredits: 1 }), "2026-11-30", NOW), { kind: "bad-week" });
  assert.deepEqual(unlockWeek(ent({ weeklyCredits: 1 }), "2026-02-30", NOW), { kind: "bad-week" });
});

test("weekly-single payment adds credits per full price, refuses more than the cap, names any remainder", () => {
  const one = priceUnits("weekly-single");
  const g = applyPayment(ent(), "weekly-single", one * BigInt(3) + BigInt(1), NOW);
  assert.ok(g.ok && g.next.weeklyCredits === 3 && g.next.plan === "weekly-single");
  assert.ok(g.ok && /0\.000001 test USDC above the price was not counted/.test(g.summary));
  const max = applyPayment(ent(), "weekly-single", one * BigInt(MAX_CREDITS_PER_PAYMENT), NOW);
  assert.ok(max.ok && max.next.weeklyCredits === MAX_CREDITS_PER_PAYMENT && !/not counted/.test(max.summary));
  const big = applyPayment(ent(), "weekly-single", one * BigInt(1000), NOW);
  assert.ok(!big.ok && /more than 10 Monday reports/.test(big.error), "never kept with nothing granted for it");
  const low = applyPayment(ent(), "weekly-single", one - BigInt(1), NOW);
  assert.equal(low.ok, false);
  // Buying a single Monday during a monthly plan keeps the plan monthly.
  const during = applyPayment(ent({ plan: "monthly", validUntil: iso(NOW.getTime() + DAY) }), "weekly-single", one, NOW);
  assert.ok(during.ok && during.next.plan === "monthly" && during.next.weeklyCredits === 1);
});

test("monthly payment adds 30 days to the later of now and the current end", () => {
  const fresh = applyPayment(ent(), "monthly", priceUnits("monthly"), NOW);
  assert.ok(fresh.ok && fresh.next.plan === "monthly" && fresh.next.validUntil === iso(NOW.getTime() + 30 * DAY));
  const end = NOW.getTime() + 10 * DAY;
  const extend = applyPayment(ent({ plan: "monthly", validUntil: iso(end) }), "monthly", priceUnits("monthly"), NOW);
  assert.ok(extend.ok && extend.next.validUntil === iso(end + 30 * DAY));
  const lapsed = applyPayment(ent({ plan: "monthly", validUntil: iso(NOW.getTime() - DAY), weeklyCredits: 2 }), "monthly", priceUnits("monthly"), NOW);
  assert.ok(lapsed.ok && lapsed.next.validUntil === iso(NOW.getTime() + 30 * DAY) && lapsed.next.weeklyCredits === 2);
  assert.equal(applyPayment(ent(), "monthly", priceUnits("monthly") - BigInt(1), NOW).ok, false);
});

test("isWeekOf accepts real dates only", () => {
  assert.equal(isWeekOf(MON), true);
  assert.equal(isWeekOf("2026-02-30"), false, "rolled-over dates are not real");
  assert.equal(isSpendableWeek(MON, NOW), true);
  assert.equal(isSpendableWeek("2026-11-30", NOW), false, "future Monday");
  assert.equal(isSpendableWeek("2026-11-24", NOW), false, "not a Monday");
  assert.equal(isWeekOf("2026-13-40"), false);
  assert.equal(isWeekOf("23/11/2026"), false);
  assert.equal(isWeekOf(20261123), false);
});
