import { formatUnits, parseUnits } from "viem";

export const USDC_DEC = 6;
export const WAD = 10n ** 18n;

function group(whole: string) {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function fmtUsdc(v: bigint | undefined, decimals = 2) {
  if (v === undefined) return "…";
  const s = formatUnits(v, USDC_DEC);
  const [whole, frac = ""] = s.split(".");
  const padded = (frac + "000000").slice(0, decimals);
  return `${group(whole)}${decimals ? "." + padded : ""}`;
}

/** Asset amount with up to 6 decimals shown, whatever the token's own decimals. */
export function fmtAsset(v: bigint | undefined, tokenDecimals: number, show = 6) {
  if (v === undefined) return "…";
  const [whole, frac = ""] = formatUnits(v, tokenDecimals).split(".");
  let f = frac.slice(0, show).replace(/0+$/, "");
  // Very small amounts (for example a few dollars of Bitcoin) would round to 0: show more digits instead.
  if (!f && whole === "0" && v > 0n) f = frac.slice(0, Math.min(tokenDecimals, 10)).replace(/0+$/, "");
  return f ? `${group(whole)}.${f}` : group(whole);
}

/** Price with 8 decimals to a dollar string. */
export function fmtPrice(v: bigint | undefined) {
  if (v === undefined) return "…";
  return fmtUsdc(v / 100n, 2);
}

/** Health factor: 1.00 is the liquidation line. */
export function fmtHealth(v: bigint | undefined) {
  if (v === undefined) return "…";
  if (v > 1000n * WAD) return "No loan";
  return (Number(v / 10n ** 14n) / 10_000).toFixed(2);
}

export function fmtPct(bps: bigint | number, decimals = 2) {
  return `${(Number(bps) / 100).toFixed(decimals).replace(/\.?0+$/, "")}%`;
}

/** USDC value (6 decimals) of an asset amount at a price (8 decimals). */
export function assetValue(amount: bigint, price: bigint, tokenDecimals: number) {
  return (amount * price) / 10n ** BigInt(tokenDecimals + 2);
}

/** Asset amount that a USDC amount (6 decimals) buys at a price (8 decimals). */
export function assetForUsdc(usdc: bigint, price: bigint, tokenDecimals: number) {
  if (price === 0n) return 0n;
  return (usdc * 10n ** BigInt(tokenDecimals + 2)) / price;
}

export function parseUsdc(s: string): bigint {
  return parseAmount(s, USDC_DEC);
}

export function parseAmount(s: string, decimals: number): bigint {
  try {
    const clean = s.trim().replace(/,/g, "");
    if (!clean) return 0n;
    return parseUnits(clean as `${number}`, decimals);
  } catch {
    return 0n;
  }
}

export function shortAddr(a?: string) {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Yearly rate in percent from Morpho's per-second rate (1e18 = 100%). */
export function aprFromPerSecond(rate: bigint | undefined) {
  if (rate === undefined) return undefined;
  return (Number(rate) / 1e18) * 31_536_000 * 100;
}

export function ago(timestamp: bigint | undefined, now: number) {
  if (timestamp === undefined) return "…";
  const s = Math.max(0, now - Number(timestamp));
  if (s < 90) return `${s} seconds ago`;
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 172800) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** "in 3 days", "in 2 hours", or "now" for a future unix time. */
export function until(timestamp: number, now: number) {
  const s = timestamp - now;
  if (s <= 0) return "now";
  if (s < 90) return `in ${s} seconds`;
  if (s < 5400) return `in ${Math.round(s / 60)} minutes`;
  if (s < 172800) return `in ${Math.round(s / 3600)} hours`;
  return `in ${Math.round(s / 86400)} days`;
}

export function intervalLabel(seconds: number) {
  if (seconds === 60) return "Every minute (demo)";
  if (seconds === 86400) return "Daily";
  if (seconds === 604800) return "Weekly";
  if (seconds === 1209600) return "Every 2 weeks";
  if (seconds === 2592000) return "Monthly";
  if (seconds % 86400 === 0) return `Every ${seconds / 86400} days`;
  return `Every ${Math.round(seconds / 60)} minutes`;
}
