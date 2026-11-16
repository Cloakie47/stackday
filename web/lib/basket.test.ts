import { test } from "node:test";
import assert from "node:assert/strict";
import { capLimitOf, splitBorrow, splitRepay, summarize, yearly, type Leg } from "./basket.ts";

const WAD = 10n ** 18n;
const usd = (n: number) => BigInt(Math.round(n * 1e6));
const CAP = 5000n; // 50 percent of the liquidation limit
const stock = (value: number, debt = 0): Leg => ({ value: usd(value), lltv: (625n * WAD) / 1000n, debt: usd(debt) });
const crypto = (value: number, debt = 0): Leg => ({ value: usd(value), lltv: (86n * WAD) / 100n, debt: usd(debt) });

test("one dollar of each asset is a four dollar basket", () => {
  const s = summarize([stock(1), stock(1), crypto(1), crypto(1)], CAP);
  assert.equal(s.locked, usd(4));
  // 0.625 + 0.625 + 0.86 + 0.86 = 2.97 at liquidation, half of that under the cap
  assert.equal(s.maxDebt, usd(2.97));
  assert.equal(s.limit, usd(1.485));
  assert.equal(s.available, usd(1.485));
  assert.equal(s.health, undefined);
});

test("a borrow is split so every leg ends at the same share of its cap", () => {
  const legs = [stock(100), crypto(100)];
  const parts = splitBorrow(usd(50), legs, CAP)!;
  assert.equal(parts[0] + parts[1], usd(50));
  const ratio = (i: number) => Number(parts[i]) / Number(capLimitOf(legs[i], CAP));
  assert.ok(Math.abs(ratio(0) - ratio(1)) < 1e-6);
});

test("a borrow tops up the leg that is behind first", () => {
  const legs = [stock(100, 20), crypto(100, 0)];
  const parts = splitBorrow(usd(10), legs, CAP)!;
  assert.equal(parts[0], 0n);
  assert.equal(parts[1], usd(10));
});

test("a borrow above what the basket can lend is refused", () => {
  assert.equal(splitBorrow(usd(2), [stock(1), stock(1), crypto(1), crypto(1)], CAP), undefined);
});

test("a borrow respects a market that is short of cash", () => {
  const legs = [{ ...stock(100), liquidity: usd(1) }, crypto(100)];
  const parts = splitBorrow(usd(30), legs, CAP)!;
  assert.equal(parts[0], usd(1));
  assert.equal(parts[1], usd(29));
});

test("repay pays the most stretched leg first and never overpays a leg", () => {
  const legs = [stock(100, 30), crypto(100, 5)];
  const parts = splitRepay(usd(10), legs, CAP);
  assert.equal(parts[0] + parts[1], usd(10));
  assert.ok(parts[0] > parts[1]);
  assert.deepEqual(splitRepay(usd(1000), legs, CAP), [usd(30), usd(5)]);
});

test("combined and weakest health", () => {
  const s = summarize([stock(100, 31.25), crypto(100, 21.5)], CAP);
  // 62.5 / 31.25 = 2.0 and 86 / 21.5 = 4.0, combined 148.5 / 52.75
  assert.equal(s.weakest, 2n * WAD);
  assert.ok(s.health! > 2n * WAD && s.health! < 4n * WAD);
});

test("yield is dividends earned minus interest paid", () => {
  const perSecond = (5n * WAD) / 100n / 31_536_000n; // about 5 percent a year
  const y = yearly([
    { ...stock(1000, 100), dividendBps: 40, ratePerSecond: perSecond },
    { ...crypto(1000), dividendBps: 0, ratePerSecond: perSecond },
  ]);
  assert.equal(y.earn, usd(4));
  assert.ok(y.cost > usd(4.99) && y.cost <= usd(5));
  assert.equal(y.net, y.earn - y.cost);
});
