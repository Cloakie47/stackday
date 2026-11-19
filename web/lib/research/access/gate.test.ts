import { test } from "node:test";
import assert from "node:assert/strict";
import { freeEntitlement } from "./entitlement.ts";
import { checkReportAccess, checkReportAccessWith, consumeReportCredit, consumeReportCreditWith, NoReportCreditError, type GateDeps } from "./gate.ts";
import { memoryAccessStore, type AccessStore } from "./store.ts";
import type { ReportScope } from "../types.ts";

const W = "0x00000000000000000000000000000000000000a1";
const NOW = new Date("2026-11-19T12:00:00Z");
const SCOPES: ReportScope[] = ["market", "asset", "portfolio", "full"];

test("paywall off: allow without credit for everything, sign-in only for personal reports", async () => {
  // A store that would refuse everything proves it is not even read.
  const hostile: AccessStore = {
    load: async () => { throw new Error("must not be called"); },
    save: async () => { throw new Error("must not be called"); },
    recordPayment: async () => { throw new Error("must not be called"); },
    forgetPayment: async () => { throw new Error("must not be called"); },
  };
  const deps: GateDeps = { paywallEnabled: false, store: hostile, now: NOW };
  for (const scope of SCOPES) {
    for (const premium of [false, true]) {
      const personal = scope === "portfolio" || scope === "full";
      assert.deepEqual(await checkReportAccessWith({ wallet: W, scope, premium }, deps), { allowed: true, consumesCredit: false });
      assert.deepEqual(
        await checkReportAccessWith({ wallet: null, scope, premium }, deps),
        personal ? { allowed: false, reason: "sign-in" } : { allowed: true, consumesCredit: false },
      );
    }
  }
  await consumeReportCreditWith(W, deps); // no-op, store untouched
});

test("default exports read the env flag: off unless RESEARCH_PAYWALL_ENABLED is set", async () => {
  const before = process.env.RESEARCH_PAYWALL_ENABLED;
  delete process.env.RESEARCH_PAYWALL_ENABLED;
  try {
    assert.deepEqual(await checkReportAccess({ wallet: W, scope: "full", premium: true }), { allowed: true, consumesCredit: false });
    assert.deepEqual(await checkReportAccess({ wallet: null, scope: "portfolio", premium: false }), { allowed: false, reason: "sign-in" });
    await consumeReportCredit(W);
  } finally {
    if (before !== undefined) process.env.RESEARCH_PAYWALL_ENABLED = before;
  }
});

test("paywall on: entitlement decides, and a database error keeps paid reports closed", async () => {
  const store = memoryAccessStore([{ ...freeEntitlement(W), plan: "pay-per-report", reportCredits: 1 }]);
  const deps: GateDeps = { paywallEnabled: true, store, now: NOW };
  assert.deepEqual(await checkReportAccessWith({ wallet: W, scope: "full", premium: false }, deps), { allowed: true, consumesCredit: true });
  assert.deepEqual(await checkReportAccessWith({ wallet: W, scope: "market", premium: false }, deps), { allowed: true, consumesCredit: false });

  const broken = { ...store, load: async () => { throw new Error("down"); } };
  const d2: GateDeps = { paywallEnabled: true, store: broken, now: NOW };
  assert.deepEqual(await checkReportAccessWith({ wallet: W, scope: "full", premium: false }, d2), { allowed: false, reason: "payment-required" });
  assert.deepEqual(await checkReportAccessWith({ wallet: W, scope: "asset", premium: false }, d2), { allowed: true, consumesCredit: false });
  const noDb: GateDeps = { paywallEnabled: true, store: null, now: NOW };
  assert.deepEqual(await checkReportAccessWith({ wallet: W, scope: "portfolio", premium: false }, noDb), { allowed: false, reason: "payment-required" });
});

test("consumeReportCredit is atomic: 3 credits, 20 parallel spends, exactly 3 succeed", async () => {
  const store = memoryAccessStore([{ ...freeEntitlement(W), plan: "pay-per-report", reportCredits: 3 }]);
  const deps: GateDeps = { paywallEnabled: true, store, now: NOW };
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => consumeReportCreditWith(W, deps)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
  for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof NoReportCreditError || /busy/.test(String(r.reason)));
  assert.equal(store.peek(W)?.reportCredits, 0);
  assert.equal(store.peek(W)?.plan, "free");
});

test("consumeReportCredit refuses when there is no credit or no database", async () => {
  const store = memoryAccessStore();
  await assert.rejects(consumeReportCreditWith(W, { paywallEnabled: true, store, now: NOW }), NoReportCreditError);
  await assert.rejects(consumeReportCreditWith(W, { paywallEnabled: true, store: null, now: NOW }), NoReportCreditError);
  assert.equal(store.peek(W), undefined, "nothing written");
});
