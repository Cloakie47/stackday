import { test } from "node:test";
import assert from "node:assert/strict";
import { freeEntitlement } from "./entitlement.ts";
import { checkReportAccess, checkReportAccessWith, consumeReportCredit, consumeReportCreditWith, NoReportCreditError, type GateDeps } from "./gate.ts";
import { memoryAccessStore, type AccessStore } from "./store.ts";

const W = "0x00000000000000000000000000000000000000a1";
// The Tuesday after MON, so MON is a past Monday a credit may be spent on.
const NOW = new Date("2026-11-24T12:00:00Z");
const MON = "2026-11-23";

test("paywall off: everything free, sign-in only for the portfolio check, store never read", async () => {
  // A store that would refuse everything proves it is not even read.
  const hostile: AccessStore = {
    load: async () => {
      throw new Error("must not be called");
    },
    save: async () => {
      throw new Error("must not be called");
    },
    recordPaymentAndGrant: async () => {
      throw new Error("must not be called");
    },
  };
  const deps: GateDeps = { paywallEnabled: false, store: hostile, now: NOW };
  const free = { allowed: true, consumesCredit: false };
  assert.deepEqual(await checkReportAccessWith({ wallet: W, product: "weekly-report", weekOf: MON }, deps), free);
  assert.deepEqual(await checkReportAccessWith({ wallet: null, product: "weekly-report", weekOf: MON }, deps), free);
  assert.deepEqual(await checkReportAccessWith({ wallet: null, product: "weekly-report" }, deps), free);
  assert.deepEqual(await checkReportAccessWith({ wallet: W, product: "portfolio-check" }, deps), free);
  assert.deepEqual(await checkReportAccessWith({ wallet: null, product: "portfolio-check" }, deps), { allowed: false, reason: "sign-in" });
  await consumeReportCreditWith(W, MON, deps); // no-op, store untouched
});

test("default exports read the env flag: off unless RESEARCH_PAYWALL_ENABLED is set", async () => {
  const before = process.env.RESEARCH_PAYWALL_ENABLED;
  delete process.env.RESEARCH_PAYWALL_ENABLED;
  try {
    assert.deepEqual(await checkReportAccess({ wallet: null, product: "weekly-report", weekOf: MON }), { allowed: true, consumesCredit: false });
    assert.deepEqual(await checkReportAccess({ wallet: null, product: "portfolio-check" }), { allowed: false, reason: "sign-in" });
    await consumeReportCredit(W, MON);
  } finally {
    if (before !== undefined) process.env.RESEARCH_PAYWALL_ENABLED = before;
  }
});

test("paywall on: entitlement decides, and a database error keeps the weekly report closed", async () => {
  const store = memoryAccessStore([{ ...freeEntitlement(W), plan: "weekly-single", weeklyCredits: 1 }]);
  const deps: GateDeps = { paywallEnabled: true, store, now: NOW };
  assert.deepEqual(await checkReportAccessWith({ wallet: W, product: "weekly-report", weekOf: MON }, deps), { allowed: true, consumesCredit: true });
  assert.deepEqual(await checkReportAccessWith({ wallet: null, product: "weekly-report", weekOf: MON }, deps), { allowed: false, reason: "sign-in" });
  assert.deepEqual(await checkReportAccessWith({ wallet: W, product: "portfolio-check" }, deps), { allowed: true, consumesCredit: false });

  const broken = { ...store, load: async () => Promise.reject(new Error("down")) };
  const d2: GateDeps = { paywallEnabled: true, store: broken, now: NOW };
  assert.deepEqual(await checkReportAccessWith({ wallet: W, product: "weekly-report", weekOf: MON }, d2), { allowed: false, reason: "payment-required" });
  assert.deepEqual(await checkReportAccessWith({ wallet: W, product: "portfolio-check" }, d2), { allowed: true, consumesCredit: false });
  const noDb: GateDeps = { paywallEnabled: true, store: null, now: NOW };
  assert.deepEqual(await checkReportAccessWith({ wallet: W, product: "weekly-report", weekOf: MON }, noDb), { allowed: false, reason: "payment-required" });
});

test("consumeReportCredit unlocks the Monday, and reopening it is free", async () => {
  const store = memoryAccessStore([{ ...freeEntitlement(W), plan: "weekly-single", weeklyCredits: 1 }]);
  const deps: GateDeps = { paywallEnabled: true, store, now: NOW };
  await consumeReportCreditWith(W, MON, deps);
  assert.equal(store.peek(W)?.weeklyCredits, 0);
  assert.deepEqual(store.peek(W)?.unlockedWeeks, [MON]);
  assert.deepEqual(await checkReportAccessWith({ wallet: W, product: "weekly-report", weekOf: MON }, deps), { allowed: true, consumesCredit: false });
  await consumeReportCreditWith(W, MON, deps); // already unlocked: nothing spent, no error
  assert.equal(store.peek(W)?.weeklyCredits, 0);
  await assert.rejects(consumeReportCreditWith(W, "2026-11-30", deps), NoReportCreditError);
});

test("consumeReportCredit is atomic: 3 credits, 20 parallel spends on different Mondays, exactly 3 succeed", async () => {
  const store = memoryAccessStore([{ ...freeEntitlement(W), plan: "weekly-single", weeklyCredits: 3 }]);
  const deps: GateDeps = { paywallEnabled: true, store, now: new Date("2027-06-01T00:00:00Z") };
  const weeks = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 10, 23) + i * 7 * 86_400_000).toISOString().slice(0, 10));
  const results = await Promise.allSettled(weeks.map((w) => consumeReportCreditWith(W, w, deps)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
  for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof NoReportCreditError || /busy/.test(String(r.reason)));
  assert.equal(store.peek(W)?.weeklyCredits, 0);
  assert.equal(store.peek(W)?.unlockedWeeks.length, 3);
});

test("the same Monday opened many times at once costs one credit", async () => {
  const store = memoryAccessStore([{ ...freeEntitlement(W), plan: "weekly-single", weeklyCredits: 3 }]);
  const deps: GateDeps = { paywallEnabled: true, store, now: NOW };
  await Promise.allSettled(Array.from({ length: 10 }, () => consumeReportCreditWith(W, MON, deps)));
  assert.equal(store.peek(W)?.weeklyCredits, 2);
  assert.deepEqual(store.peek(W)?.unlockedWeeks, [MON]);
});

test("consumeReportCredit refuses when there is no credit or no database", async () => {
  const store = memoryAccessStore();
  await assert.rejects(consumeReportCreditWith(W, MON, { paywallEnabled: true, store, now: NOW }), NoReportCreditError);
  await assert.rejects(consumeReportCreditWith(W, MON, { paywallEnabled: true, store: null, now: NOW }), NoReportCreditError);
  assert.equal(store.peek(W), undefined, "nothing written");
});

test("a credit is never spent on a malformed, non-Monday, future or unpublished week", async () => {
  const store = memoryAccessStore([{ ...freeEntitlement(W), plan: "weekly-single", weeklyCredits: 2 }]);
  const published = new Set([MON]);
  const deps: GateDeps = { paywallEnabled: true, store, now: NOW, isPublished: async (w) => published.has(w) };
  for (const bad of ["2026-11-31", "nope", "2026-11-25", "2026-11-30", "2026-11-16"]) {
    await assert.rejects(consumeReportCreditWith(W, bad, deps), NoReportCreditError, bad);
  }
  assert.equal(store.peek(W)?.weeklyCredits, 2, "nothing spent");
  assert.deepEqual(await checkReportAccessWith({ wallet: W, product: "weekly-report", weekOf: "2026-11-30" }, deps), { allowed: false, reason: "payment-required" });
  // A failed published check counts as not published.
  await assert.rejects(consumeReportCreditWith(W, MON, { ...deps, isPublished: async () => { throw new Error("db"); } }), NoReportCreditError);
  await consumeReportCreditWith(W, MON, deps);
  assert.equal(store.peek(W)?.weeklyCredits, 1);
});
