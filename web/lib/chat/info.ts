import { ASSETS, type Address, type Asset } from "../contracts.ts";
import { assetValue, fmtAsset, fmtPrice, fmtUsdc, WAD } from "../format.ts";
import type { Portfolio } from "../usePortfolio.ts";
import { assetBySymbol, healthNumber, maxBorrowAt, usdcText, type BuildContext, type PositionLike } from "./buildCalls.ts";
import { commandChip, tickerResearchChip, type Chip } from "./chips.ts";
import type { CommandMeta, InfoView } from "./commands.ts";
import { CARD_CAP_UNITS } from "./intent.ts";

/**
 * Info views for slash commands and $ tickers (/balance, /positions, $NVDA, /borrow $NVDA, /help).
 * Pure: every number comes from usePortfolio data passed in (infoContext), formatted here. Nothing in
 * a view comes from the model or research text, and no view prepares a transaction: a view's chips
 * only send a command or a question, the same as typing it.
 */

/** What the info views need, built from usePortfolio data (infoContext). */
export type InfoContext = {
  me: Address;
  vault?: Address;
  predictedVault?: Address;
  positions: PositionLike[];
  borrowCapBps: bigint;
  walletUsdc: bigint;
  /** Idle USDC in the vault (not earning). */
  vaultUsdc: bigint;
  /** USDC earning interest, with its interest. */
  earning: bigint;
  nowSec: number;
};

/** The info context for the connected wallet, from usePortfolio. */
export function infoContext(p: Portfolio, me: Address): InfoContext {
  return {
    me,
    vault: p.vault,
    predictedVault: p.predictedVault,
    positions: p.positions,
    borrowCapBps: p.borrowCapBps,
    walletUsdc: p.walletUsdc,
    vaultUsdc: p.vaultUsdc,
    earning: p.earning,
    nowSec: Math.floor(Date.now() / 1000),
  };
}

/** The app symbols the person holds anything of (vault, locked or wallet), for CommandContext.held. */
export const heldSymbols = (positions: readonly PositionLike[]): string[] =>
  positions.filter((p) => p.idle + p.collateral + p.wallet > 0n).map((p) => p.asset.symbol);

// ---- Tickers --------------------------------------------------------------------------------------

/** Common names for three assets whose ticker people do not type. Only used when the symbol exists. */
export const TICKER_ALIASES: Record<string, string> = { BTC: "mcbBTC", ETH: "mWETH", GOLD: "mPAXG" };

/** The ticker people type for an app symbol: the symbol without its leading "m" (mcbBTC -> cbBTC). */
export function tickerOf(symbol: string): string {
  return /^m[A-Za-z]/.test(symbol) ? symbol.slice(1) : symbol;
}

/**
 * "$NVDA", "nvda", "BTC" or "mNVDA" to the app symbol, case-insensitive, ASCII letters only (a
 * look-alike character never matches). Null for anything else, USDC included.
 */
export function symbolOfTicker(t: string): string | null {
  const s = t.startsWith("$") ? t.slice(1) : t;
  if (!/^[A-Za-z]{1,12}$/.test(s)) return null;
  const up = s.toUpperCase();
  const alias = TICKER_ALIASES[up];
  if (alias && assetBySymbol(alias)) return alias;
  const byTicker = ASSETS.find((a) => tickerOf(a.symbol).toUpperCase() === up);
  if (byTicker) return byTicker.symbol;
  return ASSETS.find((a) => a.symbol.toUpperCase() === up)?.symbol ?? null;
}

// ---- Formatting -----------------------------------------------------------------------------------

const usd = (v: bigint) => `${fmtUsdc(v)} USDC`;
const tok = (v: bigint, a: Asset) => `${fmtAsset(v, a.decimals)} ${tickerOf(a.symbol)}`;
const RISK_LABEL = { low: "Low", mid: "Mid", high: "High" } as const;
const position = (info: InfoContext, symbol: string) => info.positions.find((p) => p.asset.symbol === symbol);
const vaultValue = (p: PositionLike) => (p.price ? assetValue(p.idle + p.collateral, p.price, p.asset.decimals) : 0n);

/** The BuildContext maxBorrowAt needs (allowances do not change how much a borrow card accepts). */
export function buildContextOf(info: InfoContext): BuildContext {
  return {
    me: info.me,
    vault: info.vault,
    predictedVault: info.predictedVault,
    positions: info.positions,
    borrowCapBps: info.borrowCapBps,
    walletUsdc: info.walletUsdc,
    routerAllowance: 0n,
    vaultUsdcAllowance: 0n,
    assetAllowance: { toVault: 0n, toDesk: 0n },
    quotes: {},
    nowSec: info.nowSec,
    vaultUsdc: info.vaultUsdc,
  };
}

// ---- Views ----------------------------------------------------------------------------------------

/** /balance: USDC in the wallet, idle in the vault, earning interest, and the three together. */
export function balanceView(info: InfoContext): Extract<InfoView, { kind: "balance" }> {
  return {
    kind: "balance",
    walletUsdc: usd(info.walletUsdc),
    vaultUsdc: usd(info.vaultUsdc),
    earning: usd(info.earning),
    total: usd(info.walletUsdc + info.vaultUsdc + info.earning),
  };
}

/** Price at which a loan reaches its liquidation limit, or null without a loan or price. */
function liquidationPrice(p: PositionLike): bigint | null {
  if (p.debt <= 0n || !p.price || p.collateral <= 0n) return null;
  const maxDebt = (assetValue(p.collateral, p.price, p.asset.decimals) * p.asset.lltv) / WAD;
  return maxDebt > 0n ? (p.price * p.debt) / maxDebt : null;
}

/**
 * /positions: what is in the vault (free and locked, largest value first), every loan (owed includes
 * the Stackday borrow fee built up so far), USDC earning, and the total in the vault (assets at their
 * test price, idle USDC and earning USDC; loans are not subtracted).
 */
export function positionsView(info: InfoContext): Extract<InfoView, { kind: "positions" }> {
  const held = info.positions.filter((p) => p.idle + p.collateral > 0n).sort((x, y) => (vaultValue(y) > vaultValue(x) ? 1 : vaultValue(y) < vaultValue(x) ? -1 : 0));
  const holdings = held.map((p) => ({ ticker: tickerOf(p.asset.symbol), name: p.asset.name, free: tok(p.idle, p.asset), locked: tok(p.collateral, p.asset), value: usd(vaultValue(p)) }));
  const loans = info.positions
    .filter((p) => p.debt > 0n)
    .map((p) => {
      const liq = liquidationPrice(p);
      const h = healthNumber(p, p.collateral, p.debt);
      return { ticker: tickerOf(p.asset.symbol), owed: usd(p.debt + p.fee), health: h === null ? null : Math.round(h * 100) / 100, liquidationPrice: liq === null ? null : `$${fmtPrice(liq)}` };
    });
  const assets = info.positions.reduce((s, p) => s + vaultValue(p), 0n);
  return { kind: "positions", holdings, loans, earning: usd(info.earning), total: usd(assets + info.vaultUsdc + info.earning) };
}

/**
 * $NVDA: price and what the person holds of it, with chips: "Buy $20 of NVIDIA", "How much can I
 * borrow" (borrowable assets only) and a question for this week's research (sent to the model).
 */
export function tickerView(symbol: string, info: InfoContext): Extract<InfoView, { kind: "ticker" }> | null {
  const a = assetBySymbol(symbol);
  if (!a) return null;
  const p = position(info, symbol);
  const ticker = tickerOf(a.symbol);
  const wallet = p?.wallet ?? 0n;
  const idle = p?.idle ?? 0n;
  const locked = p?.collateral ?? 0n;
  const chips: Chip[] = [commandChip(`Buy $20 of ${a.name}`, `/buy $${ticker} 20$`)];
  if (a.borrowable) chips.push(commandChip(`How much can I borrow against ${a.name}?`, `/borrow $${ticker}`, "question"));
  chips.push(tickerResearchChip(a.name));
  return {
    kind: "ticker",
    ticker,
    symbol: a.symbol,
    name: a.name,
    price: p?.price ? `$${fmtPrice(p.price)}` : null,
    wallet: tok(wallet, a),
    vault: tok(idle, a),
    locked: tok(locked, a),
    value: usd(p?.price ? assetValue(wallet + idle + locked, p.price, a.decimals) : 0n),
    borrowable: a.borrowable,
    chips,
  };
}

/**
 * /borrow $NVDA: the most a borrow card accepts right now at each risk level (maxBorrowAt, the same
 * check the card makes), each with a chip for that exact card, or a note when there is nothing to borrow.
 */
export function borrowMaxView(symbol: string, info: InfoContext): Extract<InfoView, { kind: "borrow_max" }> | null {
  const a = assetBySymbol(symbol);
  if (!a) return null;
  const ticker = tickerOf(a.symbol);
  const base = { kind: "borrow_max" as const, ticker, symbol: a.symbol, name: a.name };
  const p = position(info, symbol);
  if (!a.borrowable) return { ...base, levels: [], reason: `${a.name} is invest only: there is no lending market to borrow against it.` };
  const ctx = buildContextOf(info);
  const levels = (["low", "mid", "high"] as const).map((risk) => {
    const max = p ? maxBorrowAt(p, ctx, risk) : 0n;
    if (max <= 0n) return { risk, max: usd(0n), chip: null, note: `Nothing more to borrow at ${RISK_LABEL[risk]} risk right now.` };
    const amount = usdcText(max);
    return {
      risk,
      max: usd(max),
      chip: commandChip(`Borrow ${amount} USDC at ${RISK_LABEL[risk]} risk`, `/borrow $${ticker} ${amount}$ ${risk}`),
      ...(max >= CARD_CAP_UNITS ? { note: `One card borrows at most ${fmtUsdc(CARD_CAP_UNITS, 0)} test USDC.` } : {}),
    };
  });
  let reason: string | undefined;
  if (!p?.price) reason = `There is no price for ${a.name} right now.`;
  else if (p.idle + p.collateral + p.wallet <= 0n) reason = `You have no ${a.name} yet. Buy some first, then you can borrow against it.`;
  else if (p.liquidity !== undefined && p.liquidity <= 0n) reason = `The ${a.name} market has no USDC to lend right now.`;
  else if (levels.every((l) => l.chip === null) && p.debt > 0n) reason = `Your ${a.name} loan is already at or above these levels. Repay some or add more ${a.name} to borrow more.`;
  return { ...base, levels, ...(reason ? { reason } : {}) };
}

/** /help: every command with its usage and an example. */
export function helpView(commands: CommandMeta[]): Extract<InfoView, { kind: "help" }> {
  return { kind: "help", commands };
}
