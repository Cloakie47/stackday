import type {
  AllocationSlice,
  AssetClass,
  Fact,
  Holding,
  HoldingFacts,
  IsoDate,
  IsoDateTime,
  PortfolioAnalysis,
  PortfolioInput,
  Reasoned,
  Source,
  View,
} from "../types.ts";
import { borrowNote } from "../borrow.ts";
import { coveredByResearch, type Catalog, type CatalogAsset } from "./catalog.ts";

/**
 * Portfolio check (founder spec docs/research/SPEC.md, sections 3.8 and 6). Pure TypeScript: no
 * network, no clock, no model. Same input and context, same output.
 *
 * It only states facts about one person's holdings: allocation by asset and class, diversification,
 * concentration and overlap, loan health, and a borrowing note per holding. It never tells the
 * person to buy, sell, add or trim. `generalView` is the view from the latest general research (the
 * Monday weekly report, or the daily note when there is no report yet), the same for every reader,
 * passed in by the caller.
 *
 * Honesty rules applied here:
 * - Every price comes from the context with its source and time. A holding without a price is listed
 *   in `unpriced` and left out of every share, never valued with a guessed price.
 * - Holdings outside the research universe (six borrowable assets) are shown in the allocation as
 *   "not covered by research", without a view or a borrowing note.
 * - Every sentence cites the facts it rests on, and those facts are in `facts`.
 */

/** A price for one asset with where it came from. */
export type PriceQuote = {
  price: number;
  source: Source;
  asOf: IsoDateTime;
};

/** Where the general views come from: the Monday weekly report, or the daily note before there is one. */
export type ViewSource = { product: "weekly-report"; weekOf: IsoDate } | { product: "daily-note"; date: IsoDate };

/** Everything the analysis needs besides the holdings. Built by the route, or by tests from fixtures. */
export type PortfolioContext = {
  /** "sample" when the research read is the labelled sample, not live research. */
  kind: "live" | "sample";
  /** Time of the analysis (the newest data used). */
  asOf: IsoDateTime;
  catalog: Catalog;
  /** General views per research asset, from `viewSource`. */
  views: Partial<Record<string, View>>;
  viewSource: ViewSource | null;
  prices: Partial<Record<string, PriceQuote>>;
  /**
   * Prices loan health is measured with: the Stackday price feeds Morpho values collateral with on
   * Base Sepolia. Research prices never measure a loan, so a loan with no feed price is shown as not
   * measured instead of being measured at a market price the lending market does not use.
   */
  loanPrices: Partial<Record<string, PriceQuote>>;
};

/** A holding that could not be valued because no price was available. */
export type UnpricedHolding = { assetId: string; name: string; amount: number; why: string };

/** One holding's facts plus its name and whether research covers it. */
export type HoldingRow = HoldingFacts & {
  name: string;
  coveredByResearch: boolean;
  /** Plain line for holdings research does not cover. */
  coverageNote?: string;
};

/**
 * `PortfolioAnalysis` plus the holdings that had no price, the per-holding names and coverage, and
 * where the general views came from. Structurally a `PortfolioAnalysis`.
 */
export type PortfolioAnalysisResult = Omit<PortfolioAnalysis, "holdings"> & {
  holdings: HoldingRow[];
  unpriced: UnpricedHolding[];
  viewSource: ViewSource | null;
  kind: "live" | "sample";
};

export const NOT_COVERED = "not covered by research";
/** Limit use assumed for the borrowing note of a holding without a loan (spec section 3.8 example). */
export const DEFAULT_LIMIT_USE = 0.5;
/** A broad index fund counts as this many equal positions when measuring diversification. */
export const BROAD_FUND_POSITIONS = 10;
/** Effective number of positions that counts as fully diversified (score 1). */
export const DIVERSIFIED_POSITIONS = 10;
/** A single asset at or above this share gets a plain concentration fact. */
export const LARGE_SHARE = 0.4;
/** Stackday stocks that are members of the S&P 500, so the S&P 500 fund (mSPX) already holds them. */
export const SPX_MEMBERS = ["mAAPL", "mNVDA", "mMSFT", "mAMZN", "mGOOGL", "mMETA", "mTSLA", "mAMD"];
const BROAD_FUNDS = new Set(["mSPX"]);

const CLASS_LABEL: Record<AssetClass, string> = { stock: "Stocks", fund: "Funds", commodity: "Commodities", crypto: "Crypto" };

const EPS = 1e-9;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const usd = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Priced = {
  holding: Holding;
  asset: CatalogAsset;
  covered: boolean;
  valueUsd: number;
  share: number;
  factIds: string[];
  /** Collateral value at the lending market's own price (`loanPrices`), null when there is none. */
  loanValueUsd: number | null;
  /** Facts the loan health lines cite: amount, loan and the lending market's price. */
  loanFactIds: string[];
};

/** Units of one holding that are locked as loan collateral (see `Holding.collateralAmount`). */
function collateralOf(h: Holding): number {
  if (h.collateralAmount !== undefined && Number.isFinite(h.collateralAmount)) return Math.max(0, Math.min(h.collateralAmount, h.amount));
  // A vault reading without the split (older client) or a manual entry with a loan: the whole amount.
  return h.origin === "vault" || (h.loanUsd ?? 0) > 0 ? h.amount : 0;
}

/**
 * Holdings of the same asset added together (amounts and cost), in order of first appearance.
 * Loans are not simply added: a loan read from the vault is the real on-chain debt, so a loan typed
 * by hand for the same asset is taken to be the same loan and ignored (it would count it twice).
 * Collateral follows the loan it backs: the vault's locked units when the vault has a loan,
 * otherwise the units of hand-typed entries that carry a loan.
 */
export function mergeHoldings(holdings: Holding[]): Holding[] {
  type Acc = { h: Holding; vaultLoan?: number; manualLoan?: number; vaultCollateral: number; manualCollateral: number };
  const map = new Map<string, Acc>();
  for (const h of holdings) {
    let acc = map.get(h.assetId);
    if (!acc) {
      acc = { h: { assetId: h.assetId, amount: 0, origin: h.origin }, vaultCollateral: 0, manualCollateral: 0 };
      map.set(h.assetId, acc);
    }
    acc.h.amount += h.amount;
    if (acc.h.origin !== h.origin) acc.h.origin = "vault";
    if (h.costUsd !== undefined) acc.h.costUsd = (acc.h.costUsd ?? 0) + h.costUsd;
    if (h.origin === "vault") {
      if (h.loanUsd !== undefined) acc.vaultLoan = (acc.vaultLoan ?? 0) + h.loanUsd;
      acc.vaultCollateral += collateralOf(h);
    } else {
      if (h.loanUsd !== undefined) acc.manualLoan = (acc.manualLoan ?? 0) + h.loanUsd;
      if ((h.loanUsd ?? 0) > 0) acc.manualCollateral += collateralOf(h);
    }
  }
  return [...map.values()]
    .map(({ h, vaultLoan, manualLoan, vaultCollateral, manualCollateral }) => {
      const useVault = vaultLoan !== undefined && vaultLoan > 0;
      const loanUsd = useVault ? vaultLoan : (manualLoan ?? vaultLoan);
      const out: Holding = { ...h };
      if (loanUsd !== undefined) out.loanUsd = loanUsd;
      out.collateralAmount = useVault ? vaultCollateral : manualLoan !== undefined && manualLoan > 0 ? manualCollateral : vaultCollateral;
      return out;
    })
    .filter((h) => h.amount > 0);
}

function slices(rows: Priced[], keyOf: (p: Priced) => string, labelOf: (key: string) => string, total: number): AllocationSlice[] {
  const sums = new Map<string, number>();
  for (const p of rows) sums.set(keyOf(p), (sums.get(keyOf(p)) ?? 0) + p.valueUsd);
  return [...sums.entries()]
    .map(([key, valueUsd]) => ({ key, label: labelOf(key), valueUsd, share: total > 0 ? valueUsd / total : 0 }))
    .sort((a, b) => b.valueUsd - a.valueUsd || a.key.localeCompare(b.key));
}

/**
 * 0 to 1 from the effective number of positions (1 / sum of squared shares). A broad index fund
 * counts as `BROAD_FUND_POSITIONS` equal positions because it already spreads across hundreds of
 * companies. All in one stock gives 0; `DIVERSIFIED_POSITIONS` or more effective positions give 1.
 */
export function diversificationScore(shares: { assetId: string; share: number }[]): number {
  let hhi = 0;
  for (const { assetId, share } of shares) {
    if (share <= 0) continue;
    if (BROAD_FUNDS.has(assetId)) hhi += BROAD_FUND_POSITIONS * (share / BROAD_FUND_POSITIONS) ** 2;
    else hhi += share ** 2;
  }
  if (hhi <= EPS) return 0;
  return round2(clamp01((1 / hhi - 1) / (DIVERSIFIED_POSITIONS - 1)));
}

/** Loan as a share of its limit: loan / (collateral value x LLTV). Null when it cannot be measured. */
export function limitUseOf(loanUsd: number, valueUsd: number, lltv: number): number | null {
  if (!(loanUsd > 0)) return null;
  if (!(valueUsd > 0) || !(lltv > 0)) return null;
  return loanUsd / (valueUsd * lltv);
}

export function analyzePortfolio(input: PortfolioInput, ctx: PortfolioContext): PortfolioAnalysisResult {
  const { asOf } = ctx;
  const facts: Fact[] = [];
  const factIds = new Set<string>();
  const addFact = (f: Fact) => {
    if (!factIds.has(f.id)) {
      factIds.add(f.id);
      facts.push(f);
    }
    return f.id;
  };

  // 1. Value each holding from the prices passed in.
  const unpriced: UnpricedHolding[] = [];
  const pricedRaw: Omit<Priced, "share">[] = [];
  const unpricedLoans: { name: string; loanUsd: number; factId: string }[] = [];
  for (const holding of mergeHoldings(input.holdings)) {
    const asset = ctx.catalog.get(holding.assetId);
    if (!asset) {
      unpriced.push({ assetId: holding.assetId, name: holding.assetId, amount: holding.amount, why: "Not a Stackday asset, so it is not valued." });
      continue;
    }
    const covered = coveredByResearch(asset.assetId);
    const amountFactId = addFact({
      id: `${asset.assetId}:amount`,
      kind: "fundamental",
      label: `${asset.name} units held`,
      value: holding.amount,
      unit: asset.assetId,
      source: { name: holding.origin === "vault" ? "Your Stackday vault on Base Sepolia" : "Typed in by you" },
      asOf,
    });
    const collateral = collateralOf(holding);
    const collateralFactId =
      holding.loanUsd && holding.loanUsd > 0 && collateral !== holding.amount
        ? addFact({
            id: `${asset.assetId}:collateral`,
            kind: "fundamental",
            label: `${asset.name} units locked as loan collateral`,
            value: collateral,
            unit: asset.assetId,
            source: { name: holding.origin === "vault" ? "Your Stackday vault on Base Sepolia" : "Typed in by you" },
            asOf,
          })
        : null;
    const loanFactId =
      holding.loanUsd && holding.loanUsd > 0
        ? addFact({
            id: `${asset.assetId}:loan`,
            kind: "fundamental",
            label: `Loan against ${asset.name}`,
            value: holding.loanUsd,
            unit: "USD",
            source: { name: holding.origin === "vault" ? "Your Stackday vault on Base Sepolia" : "Typed in by you" },
            asOf,
          })
        : null;
    const quote = ctx.prices[asset.assetId];
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
      unpriced.push({ assetId: asset.assetId, name: asset.name, amount: holding.amount, why: "No price was available for it, so it is not valued." });
      if (loanFactId) unpricedLoans.push({ name: asset.name, loanUsd: holding.loanUsd!, factId: loanFactId });
      continue;
    }
    const priceFactId = addFact({
      id: `${asset.assetId}:price`,
      kind: "price",
      label: `${asset.name} price`,
      value: quote.price,
      unit: "USD",
      source: quote.source,
      asOf: quote.asOf,
    });
    const ids = [amountFactId, priceFactId];
    if (loanFactId) ids.push(loanFactId);
    // Loan health uses the lending market's price only (the feed Morpho reads), never a research price.
    const loanQuote = ctx.loanPrices[asset.assetId];
    const hasLoanQuote = !!loanQuote && Number.isFinite(loanQuote.price) && loanQuote.price > 0;
    const loanPriceFactId =
      hasLoanQuote && loanFactId
        ? loanQuote === quote
          ? priceFactId
          : addFact({
              id: `${asset.assetId}:loan-price`,
              kind: "price",
              label: `${asset.name} price the lending market uses`,
              value: loanQuote.price,
              unit: "USD",
              source: loanQuote.source,
              asOf: loanQuote.asOf,
            })
        : null;
    pricedRaw.push({
      holding,
      asset,
      covered,
      valueUsd: holding.amount * quote.price,
      factIds: ids,
      // Only locked collateral counts for the loan, as on the lending market (never idle tokens).
      loanValueUsd: hasLoanQuote ? collateral * loanQuote.price : null,
      loanFactIds: [collateralFactId ?? amountFactId, ...(loanFactId ? [loanFactId] : []), ...(loanPriceFactId ? [loanPriceFactId] : [])],
    });
  }

  const totalUsd = pricedRaw.reduce((s, p) => s + p.valueUsd, 0);
  const priced: Priced[] = pricedRaw
    .map((p) => ({ ...p, share: totalUsd > 0 ? p.valueUsd / totalUsd : 0 }))
    .sort((a, b) => b.valueUsd - a.valueUsd || a.asset.assetId.localeCompare(b.asset.assetId));
  const cite = (rows: Priced[]) => rows.flatMap((p) => p.factIds);
  const byId = new Map(priced.map((p) => [p.asset.assetId, p]));

  // 2. Allocation. Holdings research does not cover are labelled so.
  const byAsset = slices(
    priced,
    (p) => p.asset.assetId,
    (k) => {
      const p = byId.get(k)!;
      return p.covered ? p.asset.name : `${p.asset.name} (${NOT_COVERED})`;
    },
    totalUsd,
  );
  const byClass = slices(priced, (p) => p.asset.assetClass, (k) => CLASS_LABEL[k as AssetClass] ?? k, totalUsd);
  const diversification = diversificationScore(priced.map((p) => ({ assetId: p.asset.assetId, share: p.share })));

  // 3. Concentration facts. Stated plainly, with no advice attached.
  const concentration: Reasoned[] = [];
  for (const p of priced) {
    if (priced.length > 0 && p.share >= LARGE_SHARE - EPS && !BROAD_FUNDS.has(p.asset.assetId)) {
      concentration.push({ text: `${p.asset.name} is ${pct(p.share)} of the valued holdings.`, factIds: cite(priced) });
    }
  }
  for (const c of byClass) {
    if (byClass.length > 1 && c.share >= 0.5 - EPS) {
      const members = priced.filter((p) => p.asset.assetClass === c.key);
      concentration.push({ text: `${c.label} make up ${pct(c.share)} of the valued holdings (${members.map((p) => p.asset.name).join(", ")}).`, factIds: cite(priced) });
    }
  }
  if (priced.length === 1) {
    concentration.push({ text: `All valued holdings are in one asset, ${priced[0].asset.name}.`, factIds: cite(priced) });
  }

  // 4. Overlap facts: a fund that already holds stocks also held directly, and Strategy with Bitcoin.
  const overlaps: Reasoned[] = [];
  const spx = byId.get("mSPX");
  if (spx) {
    const direct = SPX_MEMBERS.map((id) => byId.get(id)).filter((p): p is Priced => Boolean(p));
    if (direct.length) {
      const directShare = direct.reduce((s, p) => s + p.share, 0);
      overlaps.push({
        text: `The S&P 500 fund (${pct(spx.share)} of the valued holdings) already holds ${direct.map((p) => p.asset.name).join(", ")}, which ${direct.length === 1 ? "is" : "are"} also held directly (${pct(directShare)}). Exposure to ${direct.length === 1 ? "this company" : "these companies"} is higher than the direct holdings show.`,
        factIds: cite([spx, ...direct]),
      });
    }
  }
  const mstr = byId.get("mMSTR");
  const btc = byId.get("mcbBTC");
  if (mstr && btc) {
    overlaps.push({
      text: `Strategy (${pct(mstr.share)}) holds a large amount of bitcoin and tends to move with it, so together with Bitcoin (${pct(btc.share)}) about ${pct(mstr.share + btc.share)} of the valued holdings depends on the bitcoin price.`,
      factIds: cite([mstr, btc]),
    });
  }

  // 5. Per holding: facts, general view (covered only), loan limit use, borrowing note (covered only).
  const holdings: HoldingRow[] = priced.map((p) => {
    const loan = p.holding.loanUsd ?? 0;
    const limitUse = p.loanValueUsd === null ? null : limitUseOf(loan, p.loanValueUsd, p.asset.lltv);
    const row: HoldingRow = {
      assetId: p.asset.assetId,
      name: p.asset.name,
      valueUsd: p.valueUsd,
      share: p.share,
      coveredByResearch: p.covered,
      generalView: p.covered ? (ctx.views[p.asset.assetId] ?? null) : null,
      borrowing: p.covered && p.asset.lltv > 0 ? borrowNote(p.asset.assetId, p.asset.name, p.asset.lltv, limitUse ?? DEFAULT_LIMIT_USE) : null,
    };
    if (limitUse !== null) row.limitUse = limitUse;
    if (!p.covered) row.coverageNote = `${p.asset.name} is ${NOT_COVERED}: research covers six borrowable assets, so there is no general view or borrowing note for it.`;
    return row;
  });

  // 6. Loan health.
  const loanFacts: Reasoned[] = [];
  let worstLimitUse: number | null = null;
  for (const p of priced) {
    const loan = p.holding.loanUsd ?? 0;
    if (!(loan > 0)) continue;
    if (!(p.asset.lltv > 0)) {
      loanFacts.push({ text: `A loan of ${usd(loan)} is entered against ${p.asset.name}, which has no lending market, so its limit cannot be measured.`, factIds: p.loanFactIds });
      continue;
    }
    const use = p.loanValueUsd === null ? null : limitUseOf(loan, p.loanValueUsd, p.asset.lltv);
    if (use === null) {
      loanFacts.push({
        text: `A loan of ${usd(loan)} is entered against ${p.asset.name}, but the lending market's price for it could not be read, so the loan's limit use is not measured.`,
        factIds: p.loanFactIds,
      });
      continue;
    }
    worstLimitUse = worstLimitUse === null ? use : Math.max(worstLimitUse, use);
    const collateralUsd = p.loanValueUsd!;
    const limitUsd = collateralUsd * p.asset.lltv;
    loanFacts.push({
      text:
        `The loan of ${usd(loan)} against ${p.asset.name} is ${pct(use)} of its limit (${usd(limitUsd)}, which is ${pct(p.asset.lltv)} of ${usd(collateralUsd)} at the lending market's price).` +
        (use >= 1 ? " At or above the limit, the loan can be liquidated." : ` It reaches the limit after a ${pct(Math.max(0, 1 - use))} fall in ${p.asset.name}.`),
      factIds: p.loanFactIds,
    });
  }
  for (const u of unpricedLoans) {
    loanFacts.push({ text: `A loan of ${usd(u.loanUsd)} is entered against ${u.name}, but it had no price, so the loan's limit use cannot be measured.`, factIds: [u.factId] });
  }
  const totalLoanUsd = mergeHoldings(input.holdings).reduce((s, h) => s + (h.loanUsd && h.loanUsd > 0 ? h.loanUsd : 0), 0);
  if (totalLoanUsd > 0) {
    loanFacts.push({
      text: "Stackday's optional emergency rule sends the whole next SIP share to collateral when a loan gets close to the limit. Repay is always manual.",
      factIds: facts.filter((f) => f.id.endsWith(":loan")).map((f) => f.id),
    });
  }

  return {
    asOf,
    kind: ctx.kind,
    totalUsd,
    byAsset,
    byClass,
    diversification,
    concentration,
    overlaps,
    holdings,
    loans: { totalLoanUsd, worstLimitUse, facts: loanFacts },
    facts,
    unpriced,
    viewSource: ctx.viewSource,
  };
}
