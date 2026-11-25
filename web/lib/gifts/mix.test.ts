import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LEGS,
  amountProblem,
  cleanMessage,
  expiryFrom,
  mixProblem,
  oneStockMix,
  pickToLegs,
  ratiosToBps,
  recipientQuery,
  researchPick,
  splitUsdc,
  surpriseMix,
  type Hex,
  type ReportForMix,
} from "./mix.ts";

const T = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Hex;
const sum = (legs: { weightBps: number }[]) => legs.reduce((s, l) => s + l.weightBps, 0);

/** Deterministic random numbers in [0, 1) for repeatable tests (mulberry32). */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("ratios become whole percents that add up to exactly 10000", () => {
  const r = ratiosToBps([
    { token: T(1), ratio: 20 },
    { token: T(2), ratio: 30 },
    { token: T(3), ratio: 50 },
  ]);
  assert.ok(r.ok);
  assert.deepEqual(r.value.map((l) => l.weightBps), [2000, 3000, 5000]);
});

test("thirds round by largest remainder and still add up to 10000", () => {
  const r = ratiosToBps([1, 1, 1].map((ratio, i) => ({ token: T(i + 1), ratio })));
  assert.ok(r.ok);
  assert.equal(sum(r.value), 10_000);
  assert.deepEqual(r.value.map((l) => l.weightBps), [3400, 3300, 3300]);
});

test("odd ratios across six parts round to whole percents summing to 10000", () => {
  for (const ratios of [[1, 2, 3, 4, 5, 6], [7, 7, 7, 7, 7, 1], [0.1, 0.2, 99.7], [1, 1000]]) {
    const r = ratiosToBps(ratios.map((ratio, i) => ({ token: T(i + 1), ratio })));
    assert.ok(r.ok, `ratios ${ratios}`);
    assert.equal(sum(r.value), 10_000);
    for (const l of r.value) {
      assert.ok(l.weightBps >= 100 && l.weightBps % 100 === 0, `whole percent ${l.weightBps}`);
    }
  }
});

test("a tiny ratio still gets at least 1% so it can buy something", () => {
  const r = ratiosToBps([
    { token: T(1), ratio: 1 },
    { token: T(2), ratio: 1000 },
  ]);
  assert.ok(r.ok);
  assert.deepEqual(r.value.map((l) => l.weightBps), [100, 9900]);
});

test("ratios refuse zero, negative, too many parts and duplicates", () => {
  assert.equal(ratiosToBps([]).ok, false);
  assert.equal(ratiosToBps([{ token: T(1), ratio: 0 }]).ok, false);
  assert.equal(ratiosToBps([{ token: T(1), ratio: -1 }]).ok, false);
  assert.equal(ratiosToBps(Array.from({ length: MAX_LEGS + 1 }, (_, i) => ({ token: T(i + 1), ratio: 1 }))).ok, false);
  assert.equal(ratiosToBps([{ token: T(1), ratio: 1 }, { token: T(1), ratio: 1 }]).ok, false);
});

test("mixProblem mirrors the contract checks", () => {
  assert.equal(mixProblem(oneStockMix(T(1))), null);
  assert.match(mixProblem([])!, /at least one/);
  assert.match(mixProblem([{ token: T(1), weightBps: 5000 }, { token: T(2), weightBps: 4000 }])!, /90%/);
  assert.match(mixProblem([{ token: T(1), weightBps: 5000 }, { token: T(1), weightBps: 5000 }])!, /twice/);
  assert.match(mixProblem([{ token: T(1), weightBps: 10_000 }, { token: T(2), weightBps: 0 }])!, /1%/);
  assert.match(mixProblem([{ token: T(1), weightBps: 9850 }, { token: T(2), weightBps: 150 }])!, /whole/);
});

test("surprise mixes always hold 2 to 4 different assets, at least 10% each, adding to 10000", () => {
  const pool = Array.from({ length: 15 }, (_, i) => T(i + 1));
  const sizes = new Set<number>();
  for (let seed = 1; seed <= 500; seed++) {
    const m = surpriseMix(pool, seeded(seed));
    sizes.add(m.length);
    assert.ok(m.length >= 2 && m.length <= 4, `size ${m.length}`);
    assert.equal(sum(m), 10_000);
    assert.equal(new Set(m.map((l) => l.token)).size, m.length);
    for (const l of m) assert.ok(l.weightBps >= 1000 && l.weightBps % 100 === 0);
    assert.equal(mixProblem(m), null);
  }
  assert.deepEqual([...sizes].sort(), [2, 3, 4], "every size from 2 to 4 shows up");
});

test("surprise works at the edges: rand close to 1, tiny pools", () => {
  const pool = [T(1), T(2), T(3), T(4), T(5)];
  const m = surpriseMix(pool, () => 0.999999);
  assert.equal(m.length, 4);
  assert.equal(sum(m), 10_000);
  assert.equal(surpriseMix([T(1), T(2)], () => 0.5).length, 2);
  assert.deepEqual(surpriseMix([T(1)]), oneStockMix(T(1)));
  assert.deepEqual(surpriseMix([]), []);
});

const RESEARCHED = ["mcbBTC", "mWETH", "mPAXG", "mNVDA", "mAAPL", "mSPX"];
const report = (over: Partial<ReportForMix["ideas"]> = {}, kind: ReportForMix["kind"] = "live"): ReportForMix => ({
  kind,
  weekOf: "2026-11-23",
  ideas: {
    ranked: [
      { rank: 1, assetId: "mPAXG", view: "accumulate" },
      { rank: 2, assetId: "mSPX", view: "hold" },
    ],
    exampleSplits: [
      {
        profile: "cautious",
        slices: [
          { assetId: "mcbBTC", share: 0.05 },
          { assetId: "mPAXG", share: 0.3 },
          { assetId: "mNVDA", share: 0.1 },
          { assetId: "mAAPL", share: 0.25 },
          { assetId: "mSPX", share: 0.3 },
        ],
      },
      { profile: "growth", slices: [{ assetId: "mNVDA", share: 1 }] },
    ],
    ...over,
  },
});

test("the research pick is the report's cautious split, in bps adding to 10000", () => {
  const pick = researchPick(report(), RESEARCHED);
  assert.ok(pick);
  assert.equal(pick.weekOf, "2026-11-23");
  assert.equal(pick.source, "cautious-split");
  assert.deepEqual(pick.legs, [
    { assetId: "mcbBTC", weightBps: 500 },
    { assetId: "mPAXG", weightBps: 3000 },
    { assetId: "mNVDA", weightBps: 1000 },
    { assetId: "mAAPL", weightBps: 2500 },
    { assetId: "mSPX", weightBps: 3000 },
  ]);
});

test("the research pick only uses researched assets and re-rounds what is left", () => {
  const pick = researchPick(
    report({ exampleSplits: [{ profile: "cautious", slices: [{ assetId: "mTSLA", share: 0.4 }, { assetId: "mAAPL", share: 0.3 }, { assetId: "mSPX", share: 0.3 }] }] }),
    RESEARCHED,
  );
  assert.ok(pick);
  assert.deepEqual(pick.legs, [
    { assetId: "mAAPL", weightBps: 5000 },
    { assetId: "mSPX", weightBps: 5000 },
  ]);
});

test("with no usable split the pick falls back to the top accumulate or hold idea", () => {
  const pick = researchPick(
    report({ exampleSplits: [], ranked: [{ rank: 2, assetId: "mSPX", view: "hold" }, { rank: 1, assetId: "mWETH", view: "avoid-new-buys" }] }),
    RESEARCHED,
  );
  assert.deepEqual(pick, { weekOf: "2026-11-23", source: "top-idea", legs: [{ assetId: "mSPX", weightBps: 10_000 }] });
});

test("sample reports, missing reports and empty reports give no pick", () => {
  assert.equal(researchPick(report({}, "sample"), RESEARCHED), null);
  assert.equal(researchPick(null, RESEARCHED), null);
  assert.equal(researchPick(report({ exampleSplits: [], ranked: [{ rank: 1, assetId: "mWETH", view: "reduce" }] }), RESEARCHED), null);
});

test("a pick maps to token addresses, or null when an asset is unknown", () => {
  const pick = researchPick(report(), RESEARCHED)!;
  const tokens: Record<string, Hex> = { mcbBTC: T(1), mPAXG: T(2), mNVDA: T(3), mAAPL: T(4), mSPX: T(5) };
  const legs = pickToLegs(pick, (id) => tokens[id]);
  assert.ok(legs);
  assert.equal(sum(legs), 10_000);
  assert.equal(pickToLegs(pick, (id) => (id === "mSPX" ? undefined : tokens[id])), null);
});

test("splitUsdc matches the contract: rounded down, the last part takes the rest", () => {
  const legs = [
    { token: T(1), weightBps: 3300 },
    { token: T(2), weightBps: 3300 },
    { token: T(3), weightBps: 3400 },
  ];
  const parts = splitUsdc(1_000_001n, legs);
  assert.deepEqual(parts, [330_000n, 330_000n, 340_001n]);
  assert.equal(parts.reduce((a, b) => a + b, 0n), 1_000_001n);
});

test("amount limits: 1 to 500 USDC, and not more than the wallet holds", () => {
  assert.equal(amountProblem(1_000_000n), null);
  assert.equal(amountProblem(500_000_000n), null);
  assert.match(amountProblem(999_999n)!, /at least 1/);
  assert.match(amountProblem(500_000_001n)!, /at most 500/);
  assert.match(amountProblem(5_000_000n, 4_000_000n)!, /does not hold/);
});

test("expiry, message and recipient helpers", () => {
  assert.equal(expiryFrom(1000, 7), 1000 + 7 * 86_400);
  assert.equal(cleanMessage("  Happy birthday!  "), "Happy birthday!");
  assert.equal(cleanMessage("x".repeat(140))?.length, 140);
  assert.equal(cleanMessage("x".repeat(141)), null);
  assert.equal(cleanMessage("bad\u0007bell"), null);
  assert.equal(cleanMessage(42), null);
  assert.deepEqual(recipientQuery("sd-7k3f9q2m"), { kind: "id", q: "SD-7K3F9Q2M" });
  assert.deepEqual(recipientQuery("0xAbCdEf0000000000000000000000000000000001"), { kind: "wallet", q: "0xabcdef0000000000000000000000000000000001" });
  assert.deepEqual(recipientQuery("@Maya"), { kind: "name", q: "maya" });
  assert.equal(recipientQuery("?").kind, "none");
});

test("with no split and no ranked ideas the pick uses the asset views: accumulate first, else hold, equal parts", () => {
  const assets = [
    { assetId: "mcbBTC", view: { view: "hold" } },
    { assetId: "mWETH", view: { view: "hold" } },
    { assetId: "mPAXG", view: { view: "accumulate" } },
    { assetId: "mSPX", view: { view: "accumulate" } },
    { assetId: "mTSLA", view: { view: "accumulate" } },
  ];
  const acc = researchPick({ ...report({ exampleSplits: [], ranked: [] }), assets }, RESEARCHED);
  assert.deepEqual(acc, { weekOf: "2026-11-23", source: "asset-views", legs: [{ assetId: "mPAXG", weightBps: 5000 }, { assetId: "mSPX", weightBps: 5000 }] });

  const holds = assets.map((a) => ({ ...a, view: { view: "hold" } }));
  const h = researchPick({ ...report({ exampleSplits: [], ranked: [] }), assets: holds }, RESEARCHED)!;
  assert.equal(h.source, "asset-views");
  assert.equal(h.legs.reduce((s, l) => s + l.weightBps, 0), 10_000);
  assert.ok(h.legs.every((l) => RESEARCHED.includes(l.assetId)), "only researched assets");

  const none = assets.map((a) => ({ ...a, view: { view: "reduce" } }));
  assert.equal(researchPick({ ...report({ exampleSplits: [], ranked: [] }), assets: none }, RESEARCHED), null);
});
