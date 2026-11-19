import type { Holding, Horizon, PortfolioInput, RiskTolerance } from "../types.ts";
import { universeAsset } from "../universe.ts";

/**
 * Strict checks for portfolio input that arrives over the network (saved manual holdings, or
 * holdings the browser read from the person's vault). Pure, so it is unit tested. Anything
 * unexpected is refused with a plain message instead of being cleaned up silently.
 */

export const MAX_HOLDINGS = 40;
/** Generous ceilings that still stop absurd numbers from reaching the analysis. */
export const MAX_AMOUNT = 1e12;
export const MAX_USD = 1e12;

const HORIZONS: Horizon[] = ["short", "medium", "long"];
const RISKS: RiskTolerance[] = ["low", "medium", "high"];
const ORIGINS: Holding["origin"][] = ["vault", "manual"];

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown, max: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max;

function onlyKeys(o: Record<string, unknown>, allowed: string[]): string | null {
  const extra = Object.keys(o).find((k) => !allowed.includes(k));
  return extra ? `Unknown field "${extra.slice(0, 40)}".` : null;
}

export function parseHolding(x: unknown, opts: { allowVault: boolean }): Parsed<Holding> {
  if (!isObj(x)) return { ok: false, error: "Each holding must be an object." };
  const extra = onlyKeys(x, ["assetId", "amount", "origin", "costUsd"]);
  if (extra) return { ok: false, error: extra };
  if (typeof x.assetId !== "string" || !universeAsset(x.assetId)) return { ok: false, error: "Unknown asset in holdings." };
  if (!isNum(x.amount, MAX_AMOUNT) || x.amount <= 0) return { ok: false, error: "Each holding needs an amount above 0." };
  const origin = x.origin ?? "manual";
  if (typeof origin !== "string" || !ORIGINS.includes(origin as Holding["origin"])) return { ok: false, error: "Holding origin must be vault or manual." };
  if (origin === "vault" && !opts.allowVault) return { ok: false, error: "Saved holdings must be manual: vault holdings are read from the chain each time." };
  if (x.costUsd !== undefined && !isNum(x.costUsd, MAX_USD)) return { ok: false, error: "Cost must be a number of 0 or more." };
  const h: Holding = { assetId: x.assetId, amount: x.amount, origin: origin as Holding["origin"] };
  if (x.costUsd !== undefined) h.costUsd = x.costUsd as number;
  return { ok: true, value: h };
}

/**
 * Parses a full `PortfolioInput`. `allowVault` is false for what gets saved (only manual
 * holdings are stored, per supabase/schema.sql) and true for a report request.
 */
export function parsePortfolioInput(x: unknown, opts: { allowVault: boolean }): Parsed<PortfolioInput> {
  if (!isObj(x)) return { ok: false, error: "Send a portfolio object." };
  const extra = onlyKeys(x, ["holdings", "horizon", "risk", "monthlyNewMoneyUsd", "loanUsd"]);
  if (extra) return { ok: false, error: extra };
  if (!Array.isArray(x.holdings)) return { ok: false, error: "holdings must be a list." };
  if (x.holdings.length > MAX_HOLDINGS) return { ok: false, error: `At most ${MAX_HOLDINGS} holdings.` };
  const holdings: Holding[] = [];
  for (const raw of x.holdings) {
    const h = parseHolding(raw, opts);
    if (!h.ok) return h;
    holdings.push(h.value);
  }
  if (typeof x.horizon !== "string" || !HORIZONS.includes(x.horizon as Horizon)) return { ok: false, error: "horizon must be short, medium or long." };
  if (typeof x.risk !== "string" || !RISKS.includes(x.risk as RiskTolerance)) return { ok: false, error: "risk must be low, medium or high." };
  const out: PortfolioInput = { holdings, horizon: x.horizon as Horizon, risk: x.risk as RiskTolerance };
  if (x.monthlyNewMoneyUsd !== undefined) {
    if (!isNum(x.monthlyNewMoneyUsd, MAX_USD)) return { ok: false, error: "Monthly new money must be a number of 0 or more." };
    out.monthlyNewMoneyUsd = x.monthlyNewMoneyUsd;
  }
  if (x.loanUsd !== undefined) {
    if (!isNum(x.loanUsd, MAX_USD)) return { ok: false, error: "Loan must be a number of 0 or more." };
    out.loanUsd = x.loanUsd;
  }
  return { ok: true, value: out };
}

/**
 * Saved manual holdings plus vault holdings sent with a request. Vault rows replace nothing:
 * both are kept and the analysis adds amounts of the same asset together.
 */
export function mergeInputs(saved: PortfolioInput | null, request: PortfolioInput): PortfolioInput {
  if (!saved) return request;
  const manual = saved.holdings.filter((h) => h.origin === "manual");
  const requestManual = request.holdings.some((h) => h.origin === "manual");
  return {
    ...request,
    // If the request already carries manual holdings, it is the newer list; otherwise use the saved ones.
    holdings: requestManual ? request.holdings : [...request.holdings, ...manual],
  };
}
