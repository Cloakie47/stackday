import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_HOLDINGS, mergeInputs, parseHolding, parsePortfolioInput } from "./validate.ts";
import type { PortfolioInput } from "../types.ts";

const ok = { holdings: [{ assetId: "mAAPL", amount: 1.5, origin: "manual", costUsd: 300 }], horizon: "long", risk: "low", monthlyNewMoneyUsd: 100, loanUsd: 0 };

test("a valid portfolio parses unchanged", () => {
  assert.deepEqual(parsePortfolioInput(ok, { allowVault: false }), { ok: true, value: ok });
});

test("origin defaults to manual; vault rows only where allowed", () => {
  const h = parseHolding({ assetId: "mAAPL", amount: 1 }, { allowVault: false });
  assert.deepEqual(h, { ok: true, value: { assetId: "mAAPL", amount: 1, origin: "manual" } });
  assert.equal(parseHolding({ assetId: "mAAPL", amount: 1, origin: "vault" }, { allowVault: false }).ok, false);
  assert.equal(parseHolding({ assetId: "mAAPL", amount: 1, origin: "vault" }, { allowVault: true }).ok, true);
});

test("bad input is refused with a message", () => {
  const bad: unknown[] = [
    null,
    [],
    "x",
    { ...ok, holdings: "x" },
    { ...ok, horizon: "forever" },
    { ...ok, risk: "max" },
    { ...ok, extra: true },
    { ...ok, monthlyNewMoneyUsd: -1 },
    { ...ok, loanUsd: Number.NaN },
    { ...ok, loanUsd: "5" },
    { ...ok, holdings: [{ assetId: "mFAKE", amount: 1 }] },
    { ...ok, holdings: [{ assetId: "mAAPL", amount: 0 }] },
    { ...ok, holdings: [{ assetId: "mAAPL", amount: Infinity }] },
    { ...ok, holdings: [{ assetId: "mAAPL", amount: 1e13 }] },
    { ...ok, holdings: [{ assetId: "mAAPL", amount: 1, origin: "exchange" }] },
    { ...ok, holdings: [{ assetId: "mAAPL", amount: 1, costUsd: -3 }] },
    { ...ok, holdings: [{ assetId: "mAAPL", amount: 1, note: "hi" }] },
    { ...ok, holdings: Array.from({ length: MAX_HOLDINGS + 1 }, () => ({ assetId: "mAAPL", amount: 1 })) },
  ];
  for (const b of bad) {
    const r = parsePortfolioInput(b, { allowVault: true });
    assert.equal(r.ok, false, JSON.stringify(b)?.slice(0, 80));
    if (!r.ok) assert.ok(r.error.length > 5);
  }
});

test("mergeInputs keeps saved manual holdings unless the request sends its own", () => {
  const saved: PortfolioInput = { holdings: [{ assetId: "mSPX", amount: 2, origin: "manual" }], horizon: "short", risk: "low" };
  const vaultOnly: PortfolioInput = { holdings: [{ assetId: "mAAPL", amount: 1, origin: "vault" }], horizon: "long", risk: "high" };
  const m = mergeInputs(saved, vaultOnly);
  assert.deepEqual(m.holdings.map((h) => h.assetId), ["mAAPL", "mSPX"]);
  assert.equal(m.horizon, "long", "the request's answers win");
  const withManual: PortfolioInput = { ...vaultOnly, holdings: [...vaultOnly.holdings, { assetId: "mGOOGL", amount: 1, origin: "manual" }] };
  assert.deepEqual(mergeInputs(saved, withManual).holdings.map((h) => h.assetId), ["mAAPL", "mGOOGL"]);
  assert.equal(mergeInputs(null, vaultOnly), vaultOnly);
});
