import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entitlement } from "../types.ts";
import {
  applyPayment,
  decideAccess,
  effectiveEntitlement,
  freeEntitlement,
  priceUnits,
  subscriptionActive,
  useCredit,
} from "./entitlement.ts";
import { MAX_CREDITS_PER_PAYMENT, PRICE_LIST, PRICING_STATUS, PURPOSES } from "./prices.ts";

const W = "0x00000000000000000000000000000000000000a1";
const NOW = new Date("2026-11-19T12:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const ent = (o: Partial<Entitlement> = {}): Entitlement => ({ ...freeEntitlement(W), ...o });

test("price list is a labelled proposal in test USDC on Base Sepolia", () => {
  assert.equal(PRICE_LIST.status, PRICING_STATUS);
  assert.match(PRICING_STATUS, /needs founder approval/);
  assert.equal(PRICE_LIST.chainId, 84532);
  assert.deepEqual(Object.keys(PRICE_LIST.items).sort(), [...PURPOSES].sort());
  for (const p of PURPOSES) assert.ok(priceUnits(p) > BigInt(0), p);
  assert.equal(priceUnits("report"), BigInt(2_000_000));
  assert.deepEqual(PRICE_LIST.freeScopes, ["market", "asset"]);
});

test("subscription is active only before valid_until", () => {
  assert.equal(subscriptionActive(ent({ plan: "monthly", validUntil: iso(NOW.getTime() + 1) }), NOW), true);
  assert.equal(subscriptionActive(ent({ plan: "monthly", validUntil: NOW.toISOString() }), NOW), false);
  assert.equal(subscriptionActive(ent({ plan: "yearly", validUntil: null }), NOW), false);
  assert.equal(subscriptionActive(ent({ plan: "pay-per-report", validUntil: iso(NOW.getTime() + DAY) }), NOW), false);
  assert.equal(subscriptionActive(ent({ plan: "monthly", validUntil: "garbage" }), NOW), false);
});

test("expired plan falls back to pay-per-report or free and keeps credits and premium", () => {
  const expired = ent({ plan: "monthly", validUntil: iso(NOW.getTime() - 1), reportCredits: 2, premium: true });
  assert.deepEqual(effectiveEntitlement(expired, NOW), { ...expired, plan: "pay-per-report", validUntil: null });
  assert.equal(effectiveEntitlement({ ...expired, reportCredits: 0 }, NOW).plan, "free");
});

test("decideAccess: free tier, sign-in, plans, credits, premium", () => {
  const r = (scope: "market" | "asset" | "portfolio" | "full", premium = false, wallet: string | null = W) => ({ wallet, scope, premium });
  const free = ent();
  // Public reports are free, even signed out.
  assert.deepEqual(decideAccess(r("market", false, null), null, NOW), { allowed: true, consumesCredit: false });
  assert.deepEqual(decideAccess(r("asset", false, null), null, NOW), { allowed: true, consumesCredit: false });
  // Personal or premium needs sign-in.
  assert.deepEqual(decideAccess(r("portfolio", false, null), null, NOW), { allowed: false, reason: "sign-in" });
  assert.deepEqual(decideAccess(r("market", true, null), null, NOW), { allowed: false, reason: "sign-in" });
  // Free wallet: personal reports need payment, premium needs the add-on.
  assert.deepEqual(decideAccess(r("portfolio"), free, NOW), { allowed: false, reason: "payment-required" });
  assert.deepEqual(decideAccess(r("full"), null, NOW), { allowed: false, reason: "payment-required" });
  assert.deepEqual(decideAccess(r("asset", true), free, NOW), { allowed: false, reason: "premium-required" });
  // Credits.
  assert.deepEqual(decideAccess(r("full"), ent({ reportCredits: 1 }), NOW), { allowed: true, consumesCredit: true });
  // Active plan beats credits: no credit used.
  const sub = ent({ plan: "monthly", validUntil: iso(NOW.getTime() + DAY), reportCredits: 3 });
  assert.deepEqual(decideAccess(r("portfolio"), sub, NOW), { allowed: true, consumesCredit: false });
  // Expired plan without credits.
  const old = ent({ plan: "yearly", validUntil: iso(NOW.getTime() - DAY) });
  assert.deepEqual(decideAccess(r("portfolio"), old, NOW), { allowed: false, reason: "payment-required" });
  // Premium alone does not open personal reports, but does add depth to free ones.
  const prem = ent({ premium: true });
  assert.deepEqual(decideAccess(r("portfolio", true), prem, NOW), { allowed: false, reason: "payment-required" });
  assert.deepEqual(decideAccess(r("market", true), prem, NOW), { allowed: true, consumesCredit: false });
  assert.deepEqual(decideAccess(r("full", true), { ...sub, premium: true }, NOW), { allowed: true, consumesCredit: false });
  // Premium request without premium is refused even with a plan.
  assert.deepEqual(decideAccess(r("full", true), sub, NOW), { allowed: false, reason: "premium-required" });
});

test("useCredit takes one credit and never goes below zero", () => {
  assert.equal(useCredit(ent(), NOW), null);
  const two = ent({ plan: "pay-per-report", reportCredits: 2 });
  const one = useCredit(two, NOW)!;
  assert.equal(one.reportCredits, 1);
  assert.equal(one.plan, "pay-per-report");
  const zero = useCredit(one, NOW)!;
  assert.deepEqual([zero.reportCredits, zero.plan], [0, "free"]);
  assert.equal(useCredit(zero, NOW), null);
  // During an active plan the plan stays.
  const sub = ent({ plan: "monthly", validUntil: iso(NOW.getTime() + DAY), reportCredits: 1 });
  assert.equal(useCredit(sub, NOW)!.plan, "monthly");
});

test("applyPayment: report credits, multiples, cap and underpayment", () => {
  const p = priceUnits("report");
  const g1 = applyPayment(ent(), "report", p, NOW);
  assert.ok(g1.ok);
  assert.deepEqual([g1.next.reportCredits, g1.next.plan], [1, "pay-per-report"]);

  const g3 = applyPayment(ent({ reportCredits: 2 }), "report", p * BigInt(3) + BigInt(1), NOW);
  assert.ok(g3.ok);
  assert.equal(g3.next.reportCredits, 5, "remainder below one price is not counted");

  const big = applyPayment(ent(), "report", p * BigInt(1000), NOW);
  assert.ok(big.ok);
  assert.equal(big.next.reportCredits, MAX_CREDITS_PER_PAYMENT);

  const low = applyPayment(ent(), "report", p - BigInt(1), NOW);
  assert.equal(low.ok, false);

  // Buying credits during a plan keeps the plan.
  const sub = ent({ plan: "yearly", validUntil: iso(NOW.getTime() + DAY) });
  const g = applyPayment(sub, "report", p, NOW);
  assert.ok(g.ok);
  assert.equal(g.next.plan, "yearly");
});

test("applyPayment: subscriptions start now or extend the current end", () => {
  const m = priceUnits("monthly");
  const fresh = applyPayment(ent(), "monthly", m, NOW);
  assert.ok(fresh.ok);
  assert.equal(fresh.next.plan, "monthly");
  assert.equal(fresh.next.validUntil, iso(NOW.getTime() + 30 * DAY));

  const active = ent({ plan: "monthly", validUntil: iso(NOW.getTime() + 10 * DAY), reportCredits: 4 });
  const ext = applyPayment(active, "monthly", m, NOW);
  assert.ok(ext.ok);
  assert.equal(ext.next.validUntil, iso(NOW.getTime() + 40 * DAY));
  assert.equal(ext.next.reportCredits, 4);

  const expired = ent({ plan: "monthly", validUntil: iso(NOW.getTime() - 5 * DAY) });
  const renew = applyPayment(expired, "monthly", m, NOW);
  assert.ok(renew.ok);
  assert.equal(renew.next.validUntil, iso(NOW.getTime() + 30 * DAY), "lost days are not given back");

  const y = applyPayment(ent(), "yearly", priceUnits("yearly"), NOW);
  assert.ok(y.ok);
  assert.deepEqual([y.next.plan, y.next.validUntil], ["yearly", iso(NOW.getTime() + 365 * DAY)]);

  // A month added to an active year stays a yearly plan; a year added to a month becomes yearly.
  const yearly = ent({ plan: "yearly", validUntil: iso(NOW.getTime() + 100 * DAY) });
  const addMonth = applyPayment(yearly, "monthly", m, NOW);
  assert.ok(addMonth.ok);
  assert.deepEqual([addMonth.next.plan, addMonth.next.validUntil], ["yearly", iso(NOW.getTime() + 130 * DAY)]);
  const addYear = applyPayment(active, "yearly", priceUnits("yearly"), NOW);
  assert.ok(addYear.ok);
  assert.deepEqual([addYear.next.plan, addYear.next.validUntil], ["yearly", iso(NOW.getTime() + 375 * DAY)]);

  assert.equal(applyPayment(ent(), "yearly", m, NOW).ok, false, "monthly price does not buy a year");
});

test("applyPayment: premium sets the flag and nothing else", () => {
  const before = ent({ reportCredits: 2 });
  const g = applyPayment(before, "premium", priceUnits("premium"), NOW);
  assert.ok(g.ok);
  assert.deepEqual(g.next, { ...before, plan: "pay-per-report", premium: true });
  assert.equal(applyPayment(before, "premium", priceUnits("premium") - BigInt(1), NOW).ok, false);
});
