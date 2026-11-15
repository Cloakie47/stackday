import { test } from "node:test";
import assert from "node:assert/strict";
import { assetForUsdc, assetValue, fmtAsset, fmtHealth, fmtPct, fmtUsdc, parseAmount, parseUsdc, WAD } from "./format.ts";

test("fmtUsdc groups thousands and pads decimals", () => {
  assert.equal(fmtUsdc(1_234_567_890n), "1,234.56");
  assert.equal(fmtUsdc(5_000_000n, 0), "5");
  assert.equal(fmtUsdc(undefined), "…");
});

test("fmtAsset trims zeros and shows tiny amounts", () => {
  assert.equal(fmtAsset(150_000_000n, 8), "1.5");
  assert.equal(fmtAsset(1n, 8), "0.00000001");
  assert.equal(fmtAsset(0n, 18), "0");
});

test("fmtHealth shows no loan above the cap", () => {
  assert.equal(fmtHealth(2n * WAD), "2.00");
  assert.equal(fmtHealth(10_000n * WAD), "No loan");
});

test("fmtPct from basis points", () => {
  assert.equal(fmtPct(2500), "25%");
  assert.equal(fmtPct(125), "1.25%");
});

test("asset value and asset amount round trip at an 8 decimal price", () => {
  const price = 357_00000000n; // 357 dollars
  const amount = assetForUsdc(357_000_000n, price, 8); // 357 USDC
  assert.equal(amount, 100_000_000n); // 1 whole token
  assert.equal(assetValue(amount, price, 8), 357_000_000n);
  assert.equal(assetForUsdc(1n, 0n, 8), 0n);
});

test("parseUsdc and parseAmount never throw on bad input", () => {
  assert.equal(parseUsdc("1,000.5"), 1_000_500_000n);
  assert.equal(parseUsdc(""), 0n);
  assert.equal(parseAmount("abc", 6), 0n);
});
