import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_HOLDINGS, parseHolding, parsePortfolioInput } from "./validate.ts";
import { FIXTURE_CATALOG as C } from "./fixtures.ts";

const ok = { holdings: [{ assetId: "mAAPL", amount: 1.5, origin: "manual", costUsd: 300, loanUsd: 50 }] };

test("a valid portfolio parses unchanged", () => {
  assert.deepEqual(parsePortfolioInput(ok, C, { allowVault: false }), { ok: true, value: ok });
});

test("origin defaults to manual; vault rows only where allowed", () => {
  assert.deepEqual(parseHolding({ assetId: "mAAPL", amount: 1 }, C, { allowVault: false }), { ok: true, value: { assetId: "mAAPL", amount: 1, origin: "manual" } });
  assert.equal(parseHolding({ assetId: "mAAPL", amount: 1, origin: "vault" }, C, { allowVault: false }).ok, false);
  assert.equal(parseHolding({ assetId: "mAAPL", amount: 1, origin: "vault" }, C, { allowVault: true }).ok, true);
});

test("invest-only Stackday assets are accepted, but not with a loan", () => {
  assert.equal(parseHolding({ assetId: "mMSFT", amount: 1 }, C, { allowVault: true }).ok, true);
  assert.equal(parseHolding({ assetId: "mMSFT", amount: 1, loanUsd: 0 }, C, { allowVault: true }).ok, true);
  const r = parseHolding({ assetId: "mMSFT", amount: 1, loanUsd: 5 }, C, { allowVault: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /invest only/);
});

test("bad input is refused with a message, including the old horizon and risk fields", () => {
  const bad: unknown[] = [
    null,
    [],
    "x",
    { holdings: "x" },
    { ...ok, horizon: "long" },
    { ...ok, risk: "low" },
    { ...ok, monthlyNewMoneyUsd: 100 },
    { ...ok, loanUsd: 5 },
    { holdings: [{ assetId: "mFAKE", amount: 1 }] },
    { holdings: [{ assetId: "mAAPL", amount: 0 }] },
    { holdings: [{ assetId: "mAAPL", amount: Infinity }] },
    { holdings: [{ assetId: "mAAPL", amount: 1e13 }] },
    { holdings: [{ assetId: "mAAPL", amount: 1, origin: "exchange" }] },
    { holdings: [{ assetId: "mAAPL", amount: 1, costUsd: -3 }] },
    { holdings: [{ assetId: "mAAPL", amount: 1, loanUsd: -1 }] },
    { holdings: [{ assetId: "mAAPL", amount: 1, loanUsd: "5" }] },
    { holdings: [{ assetId: "mAAPL", amount: 1, note: "hi" }] },
    { holdings: Array.from({ length: MAX_HOLDINGS + 1 }, () => ({ assetId: "mAAPL", amount: 1 })) },
  ];
  for (const b of bad) {
    const r = parsePortfolioInput(b, C, { allowVault: true });
    assert.equal(r.ok, false, JSON.stringify(b)?.slice(0, 80));
    if (!r.ok) assert.ok(r.error.length > 5);
  }
});
