import type { Holding, PortfolioInput } from "../types.ts";
import type { Catalog } from "./catalog.ts";

/**
 * Strict checks for portfolio input that arrives over the network (saved manual holdings, or
 * holdings the browser read from the person's vault). Pure, so it is unit tested. Anything
 * unexpected is refused with a plain message instead of being cleaned up silently.
 *
 * Any Stackday asset is accepted (an invest-only asset the person holds shows as "not covered by
 * research"). A loan is only accepted against an asset that has a lending market.
 */

export const MAX_HOLDINGS = 40;
/** Generous ceilings that still stop absurd numbers from reaching the analysis. */
export const MAX_AMOUNT = 1e12;
export const MAX_USD = 1e12;

const ORIGINS: Holding["origin"][] = ["vault", "manual"];

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown, max: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max;

function onlyKeys(o: Record<string, unknown>, allowed: string[]): string | null {
  const extra = Object.keys(o).find((k) => !allowed.includes(k));
  return extra ? `Unknown field "${extra.slice(0, 40)}".` : null;
}

export function parseHolding(x: unknown, catalog: Catalog, opts: { allowVault: boolean }): Parsed<Holding> {
  if (!isObj(x)) return { ok: false, error: "Each holding must be an object." };
  const extra = onlyKeys(x, ["assetId", "amount", "origin", "costUsd", "loanUsd"]);
  if (extra) return { ok: false, error: extra };
  const asset = typeof x.assetId === "string" ? catalog.get(x.assetId) : undefined;
  if (!asset) return { ok: false, error: "Unknown asset in holdings." };
  if (!isNum(x.amount, MAX_AMOUNT) || x.amount <= 0) return { ok: false, error: "Each holding needs an amount above 0." };
  const origin = x.origin ?? "manual";
  if (typeof origin !== "string" || !ORIGINS.includes(origin as Holding["origin"])) return { ok: false, error: "Holding origin must be vault or manual." };
  if (origin === "vault" && !opts.allowVault) return { ok: false, error: "Saved holdings must be manual: vault holdings are read from the chain each time." };
  if (x.costUsd !== undefined && !isNum(x.costUsd, MAX_USD)) return { ok: false, error: "Cost must be a number of 0 or more." };
  if (x.loanUsd !== undefined) {
    if (!isNum(x.loanUsd, MAX_USD)) return { ok: false, error: "Loan must be a number of 0 or more." };
    if (x.loanUsd > 0 && !(asset.lltv > 0)) return { ok: false, error: `${asset.name} is invest only and cannot be borrowed against.` };
  }
  const h: Holding = { assetId: asset.assetId, amount: x.amount, origin: origin as Holding["origin"] };
  if (x.costUsd !== undefined) h.costUsd = x.costUsd as number;
  if (x.loanUsd !== undefined) h.loanUsd = x.loanUsd as number;
  return { ok: true, value: h };
}

/**
 * Parses a full `PortfolioInput` (just holdings). `allowVault` is false for what gets saved (only
 * manual holdings are stored, per supabase/schema.sql) and true for a preview.
 */
export function parsePortfolioInput(x: unknown, catalog: Catalog, opts: { allowVault: boolean }): Parsed<PortfolioInput> {
  if (!isObj(x)) return { ok: false, error: "Send a portfolio object." };
  const extra = onlyKeys(x, ["holdings"]);
  if (extra) return { ok: false, error: extra };
  if (!Array.isArray(x.holdings)) return { ok: false, error: "holdings must be a list." };
  if (x.holdings.length > MAX_HOLDINGS) return { ok: false, error: `At most ${MAX_HOLDINGS} holdings.` };
  const holdings: Holding[] = [];
  for (const raw of x.holdings) {
    const h = parseHolding(raw, catalog, opts);
    if (!h.ok) return h;
    holdings.push(h.value);
  }
  return { ok: true, value: { holdings } };
}
