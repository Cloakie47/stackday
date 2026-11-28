import type { Asset } from "../contracts.ts";
import { assetValue, fmtAsset, fmtHealth, fmtPrice, fmtUsdc, intervalLabel, WAD } from "../format.ts";
import { RESEARCH_DISCLAIMER, VIEW_LABEL, type WeeklyReport } from "../research/types.ts";
import { universeAsset } from "../research/universe.ts";
import type { ResearchNote, WeeklyAnswer } from "./agent.ts";

/**
 * What the read tools tell the model, as plain text keyed by asset symbol. Built in code from chain
 * reads (server/chain.ts) or the approved weekly report. No addresses, no keys: only symbols,
 * amounts and prices. Pure, unit tested in summary.test.ts.
 */

export type Holding = {
  asset: Asset;
  price?: bigint;
  priceUpdatedAt?: bigint;
  idle: bigint;
  wallet: bigint;
  collateral: bigint;
  debt: bigint;
  fee: bigint;
  maxDebt: bigint;
  health?: bigint;
  liquidity?: bigint;
  recurring?: { usdcPerBuy: bigint; interval: number; nextBuyAt: number };
};

export type Snapshot = {
  hasVault: boolean;
  walletUsdc: bigint;
  vaultUsdc: bigint;
  borrowCapBps: bigint;
  holdings: Holding[];
  /** USDC earning interest in the vault: balance with interest, principal put in, Stackday fee owed now. */
  earning?: { balance: bigint; principal: bigint; feeOwed: bigint };
  /** The factory has an interest venue (yield adapter) set. */
  earnAvailable?: boolean;
};

/** The earning line for the model: how much is earning, the interest so far and the fee, all in USDC. */
export function earningText(s: Snapshot): string {
  if (s.earnAvailable === false) return "Earning interest: not available on this network.";
  const e = s.earning;
  if (!s.hasVault || !e || e.balance === 0n) return "Earning interest: nothing earning right now.";
  const interest = e.balance > e.principal ? e.balance - e.principal : 0n;
  const fee = e.feeOwed < interest ? e.feeOwed : interest;
  return `Earning interest (MOCK venue on testnet): ${usd(e.balance)} now, of which ${usd(e.principal)} put in and ${usd(interest)} interest so far. Stackday earn fee owed: ${usd(fee)}, taken only from the interest. Taking it all back now gives about ${usd(e.balance - fee)}.`;
}

const usd = (v: bigint) => `${fmtUsdc(v)} USDC`;

/** Price fall a loan survives, in whole percent, from its health (WAD). */
const dropOf = (health: bigint) => (health === 0n ? 0 : Math.max(0, 100 - Number((100n * WAD) / health)));

export function portfolioText(s: Snapshot): string {
  const lines = [
    "Network: Base Sepolia testnet, test USDC and mock tokens.",
    `Wallet USDC: ${usd(s.walletUsdc)}.`,
    s.hasVault ? `Vault: yes. Idle USDC in vault: ${usd(s.vaultUsdc)}. Vault safety cap: ${Number(s.borrowCapBps) / 100}% of the liquidation limit.` : "Vault: not created yet (the first buy creates it).",
    earningText(s),
  ];
  let total = 0n;
  let owed = 0n;
  for (const h of s.holdings) {
    const held = h.idle + h.collateral;
    if (held === 0n && h.wallet === 0n && h.debt === 0n && !h.recurring) continue;
    const value = h.price ? assetValue(held, h.price, h.asset.decimals) : 0n;
    total += value;
    owed += h.debt + h.fee;
    const parts = [`${h.asset.symbol} (${h.asset.name}): vault ${fmtAsset(h.idle, h.asset.decimals)} free, ${fmtAsset(h.collateral, h.asset.decimals)} locked, worth ${usd(value)}`];
    if (h.wallet > 0n) parts.push(`${fmtAsset(h.wallet, h.asset.decimals)} in the wallet (not in the vault)`);
    if (h.debt > 0n) parts.push(`loan ${usd(h.debt)} plus ${usd(h.fee)} Stackday fee, health ${fmtHealth(h.health)}`);
    if (h.recurring) parts.push(`recurring buy ${usd(h.recurring.usdcPerBuy)} ${intervalLabel(h.recurring.interval).toLowerCase()}`);
    lines.push(`- ${parts.join("; ")}.`);
  }
  if (lines.length === 4) lines.push("No assets yet.");
  lines.push(`Total in the vault: ${usd(total)}. Total owed: ${usd(owed)}.`);
  return lines.join("\n");
}

export function loanText(s: Snapshot, symbol: string): string {
  const h = s.holdings.find((x) => x.asset.symbol === symbol);
  if (!h) return `${symbol} is not a Stackday asset.`;
  if (!h.asset.borrowable) return `${h.asset.name} is invest only: it cannot be borrowed against.`;
  const lockedValue = h.price ? assetValue(h.collateral, h.price, h.asset.decimals) : 0n;
  const limit = (h.maxDebt * s.borrowCapBps) / 10_000n;
  if (h.debt === 0n) {
    return `No loan against ${h.asset.name}. Locked: ${fmtAsset(h.collateral, h.asset.decimals)} ${h.asset.symbol} worth ${usd(lockedValue)}. Could borrow up to ${usd(limit)} at the vault cap.`;
  }
  const liqPrice = h.price && h.maxDebt > 0n ? (h.price * h.debt) / h.maxDebt : undefined;
  return [
    `Loan against ${h.asset.name}: ${usd(h.debt)} owed to the lending market, plus ${usd(h.fee)} Stackday borrow fee (paid first on repayment).`,
    `Health ${fmtHealth(h.health)} (1.00 is the liquidation line). It survives about a ${h.health ? dropOf(h.health) : 0}% price fall.`,
    `Borrow limit at the vault cap: ${usd(limit)}, ${limit > 0n ? Number((h.debt * 100n) / limit) : 0}% used.`,
    liqPrice ? `Liquidation price: $${fmtPrice(liqPrice)} per ${h.asset.symbol} (now $${fmtPrice(h.price)}).` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function pricesText(s: Snapshot, symbols: string[]): string {
  const want = symbols.length ? s.holdings.filter((h) => symbols.includes(h.asset.symbol)) : s.holdings;
  const rows = want.map((h) => `${h.asset.symbol} (${h.asset.name}): $${fmtPrice(h.price)}${h.priceUpdatedAt ? `, updated ${new Date(Number(h.priceUpdatedAt) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}`);
  return ["Mock test prices from Stackday's price feeds on Base Sepolia (not live market data):", ...rows].join("\n");
}

/**
 * The general view for one asset (or all) from an APPROVED weekly report. The text goes to the model
 * as untrusted (it was written from the news); the notes (date, view, disclaimer) go to the browser
 * straight from code.
 */
export function weeklyAnswer(report: WeeklyReport | null, assetId: string): WeeklyAnswer {
  if (!report) return { text: "There is no approved Stackday weekly report yet. Say so; do not guess a view.", notes: [] };
  const sections = report.assets.filter((a) => (assetId === "all" || a.assetId === assetId) && a.status === "ok");
  if (!sections.length) {
    const researched = universeAsset(assetId);
    return {
      text: researched
        ? `The approved report for the week of ${report.weekOf} has no reading for ${researched.name}.`
        : `Stackday's weekly research covers Bitcoin, Ether, Gold, NVIDIA, Apple and the S&P 500 only, not ${assetId}.`,
      notes: [],
    };
  }
  const notes: ResearchNote[] = sections.map((a) => ({
    assetId: a.assetId,
    name: universeAsset(a.assetId)?.name ?? a.assetId,
    weekOf: report.weekOf,
    view: VIEW_LABEL[a.view.view],
    conviction: a.view.conviction,
    disclaimer: report.disclaimer || RESEARCH_DISCLAIMER,
  }));
  const text = [
    `Approved Stackday weekly report, week of ${report.weekOf}. General research for every reader, not advice for this person.`,
    ...sections.map((a) =>
      [`${universeAsset(a.assetId)?.name ?? a.assetId}: view ${VIEW_LABEL[a.view.view]}, conviction ${a.view.conviction}.`, ...a.view.reasons.slice(0, 3).map((r) => `  reason: ${r.text.slice(0, 400)}`)].join("\n"),
    ),
  ].join("\n");
  return { text, notes };
}
