import type {
  AllocationSlice,
  AssetClass,
  Fact,
  Holding,
  HoldingVerdict,
  PortfolioAnalysis,
  PortfolioInput,
  Reasoned,
  ResearchNote,
  ResearchSnapshot,
  RiskTolerance,
  Timeframe,
} from "../types.ts";
import { universeAsset, type RiskBucket, type UniverseAsset } from "../universe.ts";
import { allocateToGaps, assetOf, CAPS, RISK_LEVELS, THEMES, type GapEntry, type RiskLevel } from "../../themes/index.ts";

/**
 * Portfolio analysis for the Research engine (docs/research/PLAN.md, "Portfolio report").
 * Pure TypeScript: no network, no clock, no model. Same input and snapshot, same output.
 *
 * Honesty rules applied here:
 * - Prices come only from the snapshot's `px.last` facts. A holding without one is listed in
 *   `unpriced` and left out of every share, never valued with a guessed price.
 * - Every sentence cites the facts it rests on. Those facts are copied into `facts` with ids
 *   prefixed by the asset ("mAAPL:px.last"), so ids stay unique across holdings.
 * - Themes caps (web/lib/themes/policy.ts) are targets for new buys. Nothing here ever suggests
 *   selling: over a cap means "skip new buys", and rebalance ideas only redirect new money.
 */

/** A holding that could not be valued because the snapshot has no price for it today. */
export type UnpricedHolding = { assetId: string; name: string; amount: number; why: string };

/**
 * `PortfolioAnalysis` plus the holdings that had no price. Structurally a `PortfolioAnalysis`,
 * so it can be stored and shown anywhere one is expected.
 */
export type PortfolioAnalysisResult = PortfolioAnalysis & { unpriced: UnpricedHolding[] };

/** A broad index fund counts as this many equal positions when measuring diversification. */
export const BROAD_FUND_POSITIONS = 10;
/** Effective number of positions that counts as fully diversified (score 1). */
export const DIVERSIFIED_POSITIONS = 10;
/** Most of the portfolio in speculative assets that still fits each risk answer. */
export const SPECULATIVE_LIMIT: Record<RiskTolerance, number> = { low: 0.1, medium: 0.3, high: 0.5 };
/** Loan to value at which the loan part of the health score reaches 0. */
export const LOAN_ZERO_AT = 0.6;
/** Loan to value above which a loan flag is raised. */
export const LOAN_FLAG_AT = 0.4;
/** Any one asset other than a broad or cash-like fund above this share is flagged. */
export const SINGLE_ASSET_LIMIT = CAPS.singleTheme;

/** The person's risk answer mapped onto the Themes risk levels (for the crypto cap). */
export const RISK_LEVEL_FOR: Record<RiskTolerance, RiskLevel> = { low: "steady", medium: "balanced", high: "bold" };

/** Which outlook in the daily note matches the person's horizon. */
export const OUTLOOK_FOR: Record<PortfolioInput["horizon"], Timeframe> = { short: "1m", medium: "1y", long: "5y" };

/** Stocks the S&P 500 fund (mSPX) already holds, per its universe note. */
export const SPX_TOP_HOLDINGS = ["mAAPL", "mNVDA", "mMSFT", "mAMZN", "mGOOGL", "mMETA", "mTSLA"];
const BROAD_FUNDS = new Set(["mSPX"]);

const HEALTH_WEIGHTS = { diversification: 0.3, caps: 0.25, research: 0.2, risk: 0.15, loan: 0.1 } as const;

const CLASS_LABEL: Record<AssetClass, string> = { stock: "Stocks", fund: "Funds", commodity: "Commodities", crypto: "Crypto" };
const RISK_LABEL: Record<RiskBucket, string> = { "cash-like": "Cash-like", core: "Core", growth: "Growth", speculative: "Speculative" };
const ACTION_LABEL = { buy: "Buy", hold: "Hold", sell: "Sell", watch: "Watch" } as const;

const EPS = 1e-9;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const usd = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Priced = {
  holding: Holding;
  asset: UniverseAsset;
  note: ResearchNote | undefined;
  price: number;
  valueUsd: number;
  share: number;
  priceFactId: string;
  amountFactId: string;
};

/** The note for an asset in the snapshot, if any. */
export function noteFor(snapshot: ResearchSnapshot, assetId: string): ResearchNote | undefined {
  return snapshot.notes.find((n) => n.assetId === assetId);
}

/** The last price from a note's `px.last` fact, or null if it is missing or not a positive number. */
export function lastPrice(note: ResearchNote | undefined): { price: number; fact: Fact } | null {
  const fact = note?.facts.find((f) => f.id === "px.last");
  if (!fact) return null;
  const price = typeof fact.value === "number" ? fact.value : Number.NaN;
  if (!Number.isFinite(price) || price <= 0) return null;
  return { price, fact };
}

/** Holdings of the same asset added together, in input order of first appearance. */
function mergeHoldings(holdings: Holding[]): Holding[] {
  const map = new Map<string, Holding>();
  for (const h of holdings) {
    const prev = map.get(h.assetId);
    if (!prev) map.set(h.assetId, { ...h });
    else {
      prev.amount += h.amount;
      if (prev.origin !== h.origin) prev.origin = "vault";
      if (h.costUsd !== undefined) prev.costUsd = (prev.costUsd ?? 0) + h.costUsd;
    }
  }
  return [...map.values()].filter((h) => h.amount > 0);
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

/** The Themes target cap that applies to new buys of one asset, with its plain-language name. */
export function capFor(asset: UniverseAsset, risk: RiskTolerance): { cap: number; label: string } | null {
  const cat = assetOf(asset.realToken);
  if (cat?.riskOnly) return { cap: CAPS.riskAsset, label: `the ${pct(CAPS.riskAsset)} cap for a single risk-bucket name` };
  if (asset.assetClass === "stock") return { cap: CAPS.singleStock, label: `the ${pct(CAPS.singleStock)} single-stock cap` };
  if (asset.assetClass === "crypto") {
    const cap = RISK_LEVELS[RISK_LEVEL_FOR[risk]].cryptoCap;
    return { cap, label: `the ${pct(cap)} crypto cap for your risk answer` };
  }
  if (asset.assetClass === "commodity") return { cap: SINGLE_ASSET_LIMIT, label: `the ${pct(SINGLE_ASSET_LIMIT)} single-asset limit` };
  return null; // funds: a broad or cash-like fund is diversified by itself
}

function isCryptoGroup(asset: UniverseAsset) {
  return asset.assetClass === "crypto" || Boolean(assetOf(asset.realToken)?.cryptoLike);
}

function isAiChips(asset: UniverseAsset) {
  return Boolean(assetOf(asset.realToken)?.aiChips) || asset.sector === "Semiconductors";
}

type Flag = { reason: Reasoned; assetIds: string[] };

export function analyzePortfolio(input: PortfolioInput, snapshot: ResearchSnapshot): PortfolioAnalysisResult {
  const asOf = snapshot.generatedAt;
  const facts: Fact[] = [];
  const factIds = new Set<string>();
  const addFact = (f: Fact) => {
    if (!factIds.has(f.id)) {
      factIds.add(f.id);
      facts.push(f);
    }
    return f.id;
  };
  /** Copies a note's fact into the analysis with an asset prefix and returns the new id. */
  const citeNoteFact = (note: ResearchNote, id: string): string | null => {
    const f = note.facts.find((x) => x.id === id);
    if (!f) return null;
    return addFact({ ...f, id: `${note.assetId}:${f.id}` });
  };

  // 1. Value each holding from the snapshot's own price facts.
  const unpriced: UnpricedHolding[] = [];
  const pricedRaw: Omit<Priced, "share">[] = [];
  for (const holding of mergeHoldings(input.holdings)) {
    const asset = universeAsset(holding.assetId);
    if (!asset) {
      unpriced.push({ assetId: holding.assetId, name: holding.assetId, amount: holding.amount, why: "Not a Stackday asset, so there is no research for it." });
      continue;
    }
    const note = noteFor(snapshot, holding.assetId);
    const px = lastPrice(note);
    if (!note || !px) {
      unpriced.push({
        assetId: asset.assetId,
        name: asset.name,
        amount: holding.amount,
        why: note ? "Today's research has no price for it, so it is not valued." : "Not in today's research snapshot, so it is not valued.",
      });
      continue;
    }
    const priceFactId = citeNoteFact(note, px.fact.id)!;
    const amountFactId = addFact({
      id: `${asset.assetId}:amount`,
      kind: "fundamental",
      label: `${asset.name} units you hold`,
      value: holding.amount,
      unit: asset.assetId,
      source: { name: holding.origin === "vault" ? "Your Stackday vault on Base Sepolia" : "Typed in by you" },
      asOf,
    });
    pricedRaw.push({ holding, asset, note, price: px.price, valueUsd: holding.amount * px.price, priceFactId, amountFactId });
  }

  const totalUsd = pricedRaw.reduce((s, p) => s + p.valueUsd, 0);
  const priced: Priced[] = pricedRaw.map((p) => ({ ...p, share: totalUsd > 0 ? p.valueUsd / totalUsd : 0 }));
  const cite = (rows: Priced[]) => rows.flatMap((p) => [p.priceFactId, p.amountFactId]);
  const byId = new Map(priced.map((p) => [p.asset.assetId, p]));

  // 2. Allocation.
  const byAsset = slices(priced, (p) => p.asset.assetId, (k) => universeAsset(k)?.name ?? k, totalUsd);
  const byClass = slices(priced, (p) => p.asset.assetClass, (k) => CLASS_LABEL[k as AssetClass] ?? k, totalUsd);
  const bySector = slices(priced, (p) => p.asset.sector, (k) => k, totalUsd);
  const byRisk = slices(priced, (p) => p.asset.risk, (k) => RISK_LABEL[k as RiskBucket] ?? k, totalUsd);
  const diversification = diversificationScore(priced.map((p) => ({ assetId: p.asset.assetId, share: p.share })));

  // 3. Concentration against the Themes caps (targets for new buys).
  const flags: Flag[] = [];
  const NOTHING_SOLD = "Caps are targets for new buys, so nothing is sold.";
  for (const p of priced) {
    const c = capFor(p.asset, input.risk);
    if (c && p.asset.assetClass !== "crypto" && p.share > c.cap + EPS) {
      flags.push({
        assetIds: [p.asset.assetId],
        reason: { text: `${p.asset.name} is ${pct(p.share)} of your portfolio, above ${c.label}. ${NOTHING_SOLD}`, factIds: cite([p]) },
      });
    }
  }
  const groups: { name: string; cap: number; capLabel: string; members: Priced[] }[] = [];
  const cryptoCap = RISK_LEVELS[RISK_LEVEL_FOR[input.risk]].cryptoCap;
  groups.push({ name: "Bitcoin, Ether and crypto-like stocks", cap: cryptoCap, capLabel: `the ${pct(cryptoCap)} crypto cap for your risk answer`, members: priced.filter((p) => isCryptoGroup(p.asset)) });
  groups.push({ name: "AI and chip stocks", cap: CAPS.aiChips, capLabel: `the ${pct(CAPS.aiChips)} AI and chips cap`, members: priced.filter((p) => isAiChips(p.asset)) });
  for (const t of THEMES) {
    if (t.id === "crypto-native") continue; // covered by the crypto group above
    const members = priced.filter((p) => t.tickers.includes(p.asset.realToken));
    groups.push({ name: `The ${t.name} theme`, cap: CAPS.singleTheme, capLabel: `the ${pct(CAPS.singleTheme)} single-theme cap`, members });
  }
  for (const g of groups) {
    const share = g.members.reduce((s, p) => s + p.share, 0);
    if (g.members.length && share > g.cap + EPS) {
      const names = g.members.map((p) => p.asset.name).join(", ");
      flags.push({
        assetIds: g.members.map((p) => p.asset.assetId),
        reason: { text: `${g.name} (${names}) make up ${pct(share)} of your portfolio, above ${g.capLabel}. ${NOTHING_SOLD}`, factIds: cite(g.members) },
      });
    }
  }
  const loanUsd = input.loanUsd && input.loanUsd > 0 ? input.loanUsd : 0;
  let ltv = 0;
  let loanFactId: string | null = null;
  if (loanUsd > 0) {
    loanFactId = addFact({ id: "input.loan", kind: "fundamental", label: "Open loan against your vault", value: loanUsd, unit: "USD", source: { name: "Your Stackday vault on Base Sepolia" }, asOf });
    ltv = totalUsd > 0 ? loanUsd / totalUsd : Number.POSITIVE_INFINITY;
    const text =
      totalUsd > 0
        ? `Your loan of ${usd(loanUsd)} is ${pct(ltv)} of the value of your priced holdings. ${ltv > LOAN_FLAG_AT ? "That is high: a fall in prices could bring the loan close to liquidation. Repaying, or locking more collateral, lowers the risk." : "That leaves room before liquidation, but a sharp fall in prices still raises the risk."}`
        : `You have a loan of ${usd(loanUsd)} but none of your holdings could be priced today, so the loan's safety cannot be measured.`;
    if (ltv > LOAN_FLAG_AT || totalUsd <= 0) flags.push({ assetIds: [], reason: { text, factIds: [loanFactId, ...cite(priced)] } });
  }
  const flagged = new Set(flags.flatMap((f) => f.assetIds));
  const concentration = flags.map((f) => f.reason);

  // 4. Overlap: a fund that already holds what you also own directly, and MSTR with bitcoin.
  const overlaps: Reasoned[] = [];
  const spx = byId.get("mSPX");
  if (spx) {
    const direct = SPX_TOP_HOLDINGS.map((id) => byId.get(id)).filter((p): p is Priced => Boolean(p));
    if (direct.length) {
      const directShare = direct.reduce((s, p) => s + p.share, 0);
      overlaps.push({
        text: `The S&P 500 fund (${pct(spx.share)} of your portfolio) already holds ${direct.map((p) => p.asset.name).join(", ")}, which you also own directly (${pct(directShare)}). Your real exposure to these companies is higher than your direct holdings show.`,
        factIds: cite([spx, ...direct]),
      });
    }
  }
  const mstr = byId.get("mMSTR");
  const btc = byId.get("mcbBTC");
  if (mstr && btc) {
    overlaps.push({
      text: `Strategy (${pct(mstr.share)}) moves mostly with bitcoin because its main asset is a large bitcoin holding, so together with your Bitcoin (${pct(btc.share)}) about ${pct(mstr.share + btc.share)} of your portfolio rides on the bitcoin price.`,
      factIds: cite([mstr, btc]),
    });
  }

  // 5. Per-holding verdict from today's note, the person's horizon and risk answer, and the caps.
  const timeframe = OUTLOOK_FOR[input.horizon];
  const verdicts: HoldingVerdict[] = priced
    .slice()
    .sort((a, b) => b.valueUsd - a.valueUsd || a.asset.assetId.localeCompare(b.asset.assetId))
    .map((p) => holdingVerdict(p, input, timeframe, flagged.has(p.asset.assetId), citeNoteFact));

  // 6. New-money-only rebalance ideas.
  const rebalanceIdeas = rebalance(priced, verdicts, input, totalUsd, flagged, cite);

  // 7. Health score.
  const health = healthScore({ priced, verdicts, flags: flags.filter((f) => f.assetIds.length > 0).length, diversification, input, totalUsd, loanUsd, ltv, unpriced });

  return {
    asOf,
    totalUsd,
    byAsset,
    byClass,
    bySector,
    byRisk,
    diversification,
    concentration,
    overlaps,
    holdings: verdicts,
    rebalanceIdeas,
    health,
    facts,
    unpriced,
  };
}

function holdingVerdict(
  p: Priced,
  input: PortfolioInput,
  timeframe: Timeframe,
  overCap: boolean,
  citeNoteFact: (note: ResearchNote, id: string) => string | null,
): HoldingVerdict {
  const base = { assetId: p.asset.assetId, valueUsd: p.valueUsd, share: p.share };
  const ids = [p.priceFactId, p.amountFactId];
  const note = p.note!;
  if (note.status === "no-reading") {
    return {
      ...base,
      action: "watch",
      verdict: "review",
      why: { text: `There is no research reading for ${p.asset.name} today, so there is no suggestion to lean on. Check it again tomorrow before adding to it.`, factIds: ids },
    };
  }
  const outlook = note.outlook?.[timeframe];
  const outlookIds = (outlook?.factIds ?? []).map((id) => citeNoteFact(note, id)).filter((x): x is string => Boolean(x));
  const why = (text: string) => ({ text, factIds: [...ids, ...outlookIds] });
  const carried = note.status === "carried" ? " (carried from the last trading day)" : "";
  const said = `Today's research note${carried} suggests ${ACTION_LABEL[note.action]} with ${note.confidence} confidence`;
  const stance = outlook?.stance ?? "no-view";
  const horizonText = stance === "no-view" ? "and has no view for your horizon" : `and its outlook for your horizon is ${stance}`;
  const speculativeForLow = p.asset.risk === "speculative" && input.risk === "low";

  if (overCap) {
    return { ...base, action: note.action, verdict: "trim-new-buys", why: why(`${said} ${horizonText}. It is already above its cap, so new money is better pointed elsewhere for now. Nothing is sold.`) };
  }
  if (note.action === "sell") {
    return { ...base, action: note.action, verdict: "review", why: why(`${said} ${horizonText}. Worth reviewing whether it still fits your plan. Stackday never sells for you; any change is your decision.`) };
  }
  if (note.action === "buy") {
    if (stance === "negative") {
      return { ...base, action: note.action, verdict: "keep", why: why(`${said}, but its outlook for your horizon is negative, so the signals are mixed. Keeping it without adding is the cautious reading.`) };
    }
    if (speculativeForLow) {
      return { ...base, action: note.action, verdict: "keep", why: why(`${said} ${horizonText}, but it is a speculative asset and you chose low risk, so adding more does not fit your answer.`) };
    }
    return { ...base, action: note.action, verdict: "add-with-new-money", why: why(`${said} ${horizonText}, and it is within its cap, so it is a candidate for new money.`) };
  }
  if (stance === "negative") {
    return { ...base, action: note.action, verdict: "review", why: why(`${said}, but its outlook for your horizon is negative. Worth a look before adding more.`) };
  }
  return { ...base, action: note.action, verdict: "keep", why: why(`${said} ${horizonText}. No change needed.`) };
}

function rebalance(
  priced: Priced[],
  verdicts: HoldingVerdict[],
  input: PortfolioInput,
  totalUsd: number,
  flagged: Set<string>,
  cite: (rows: Priced[]) => string[],
): Reasoned[] {
  if (!priced.length) return [];
  const byId = new Map(priced.map((p) => [p.asset.assetId, p]));
  const ideas: Reasoned[] = [{ text: "New money only: these ideas point your next buys, nothing is sold, and nothing moves until you sign.", factIds: cite(priced) }];

  for (const v of verdicts) {
    const p = byId.get(v.assetId)!;
    if (v.verdict === "trim-new-buys") ideas.push({ text: `Skip new buys of ${p.asset.name} until new money brings it back under its cap.`, factIds: cite([p]) });
    if (v.verdict === "review") ideas.push({ text: `Pause new buys of ${p.asset.name} while you review it.`, factIds: v.why.factIds });
  }

  const eligible = verdicts.filter((v) => (v.verdict === "add-with-new-money" || v.verdict === "keep") && !flagged.has(v.assetId)).map((v) => byId.get(v.assetId)!);
  const adders = eligible.filter((p) => verdicts.find((v) => v.assetId === p.asset.assetId)!.verdict === "add-with-new-money");
  const receivers = adders.length ? adders : eligible;
  const newMoney = input.monthlyNewMoneyUsd && input.monthlyNewMoneyUsd > 0 ? input.monthlyNewMoneyUsd : 0;

  if (receivers.length && newMoney > 0) {
    // Each receiver aims for an equal part of the portfolio after the new money, never above its cap.
    const after = totalUsd + newMoney;
    const equal = 1 / receivers.length;
    const entries: GapEntry[] = receivers.map((p) => {
      const cap = capFor(p.asset, input.risk)?.cap ?? 1;
      const target = Math.min(cap, equal) * after;
      return { key: p.asset.assetId, gap: Math.max(0, target - p.valueUsd), weight: Math.min(cap, equal), overweight: p.valueUsd > target + EPS };
    });
    const { amounts, unplaced } = allocateToGaps(entries, newMoney);
    const buys = receivers
      .map((p) => ({ p, usd: Math.floor((amounts[p.asset.assetId] ?? 0) * 100) / 100 }))
      .filter((b) => b.usd >= 1)
      .sort((a, b) => b.usd - a.usd || a.p.asset.assetId.localeCompare(b.p.asset.assetId));
    for (const b of buys) {
      ideas.push({ text: `Of your ${usd(newMoney)} a month, about ${usd(b.usd)} could go to ${b.p.asset.name}, which is below an even share of the holdings research still supports.`, factIds: cite([b.p]) });
    }
    const left = newMoney - buys.reduce((s, b) => s + b.usd, 0);
    if (unplaced > 0.005 || left >= 1) {
      ideas.push({ text: `About ${usd(left)} a month has no holding below its target, so it could stay as USDC or go to a holding you choose.`, factIds: cite(receivers) });
    }
  } else if (receivers.length) {
    const under = receivers.slice().sort((a, b) => a.share - b.share).slice(0, 3);
    ideas.push({ text: `When you next add money, favour ${under.map((p) => p.asset.name).join(", ")}: research still supports them and they are your smallest positions.`, factIds: cite(under) });
  }

  const cashLike = priced.some((p) => p.asset.risk === "cash-like");
  if (input.risk === "low" && !cashLike) {
    ideas.push({ text: "You chose low risk and hold nothing cash-like. Pointing some new money at the US Treasuries 0-3M fund would steady the mix.", factIds: cite(priced) });
  }
  return ideas;
}

function healthScore(p: {
  priced: Priced[];
  verdicts: HoldingVerdict[];
  flags: number;
  diversification: number;
  input: PortfolioInput;
  totalUsd: number;
  loanUsd: number;
  ltv: number;
  unpriced: UnpricedHolding[];
}): PortfolioAnalysis["health"] {
  if (!p.priced.length || p.totalUsd <= 0) {
    const why = p.unpriced.length ? "None of your holdings could be priced today, so the portfolio cannot be scored." : "There are no holdings to score yet.";
    return { score: 0, parts: [{ label: "No priced holdings", score: 0, why }] };
  }
  const w = (x: number) => `${Math.round(x * 100)}% of the score`;
  const parts: { label: string; score: number; why: string; weight: number }[] = [];

  const divScore = Math.round(p.diversification * 100);
  parts.push({
    label: "Diversification",
    score: divScore,
    weight: HEALTH_WEIGHTS.diversification,
    why: `Spread across ${p.priced.length} priced holding${p.priced.length === 1 ? "" : "s"} (a broad index fund counts as ${BROAD_FUND_POSITIONS}). ${w(HEALTH_WEIGHTS.diversification)}.`,
  });

  const capScore = Math.max(0, 100 - 25 * p.flags);
  parts.push({
    label: "Caps",
    score: capScore,
    weight: HEALTH_WEIGHTS.caps,
    why: `${p.flags === 0 ? "Nothing is above a Themes cap" : `${p.flags} cap${p.flags === 1 ? " is" : "s are"} exceeded, 25 points off each`}. ${w(HEALTH_WEIGHTS.caps)}.`,
  });

  const verdictPoints = { keep: 100, "add-with-new-money": 100, "trim-new-buys": 60, review: 30 } as const;
  const research = Math.round(p.verdicts.reduce((s, v) => s + v.share * verdictPoints[v.verdict], 0));
  const reviews = p.verdicts.filter((v) => v.verdict === "review").length;
  parts.push({
    label: "Research fit",
    score: research,
    weight: HEALTH_WEIGHTS.research,
    why: `Weighted by value: holdings research still supports count fully, over-cap ones 60, ones to review 30${reviews ? ` (${reviews} to review)` : ""}. ${w(HEALTH_WEIGHTS.research)}.`,
  });

  const speculative = p.priced.filter((x) => x.asset.risk === "speculative").reduce((s, x) => s + x.share, 0);
  const limit = SPECULATIVE_LIMIT[p.input.risk];
  const riskScore = Math.round(100 * clamp01(speculative <= limit ? 1 : 1 - (speculative - limit) / limit));
  parts.push({
    label: "Risk fit",
    score: riskScore,
    weight: HEALTH_WEIGHTS.risk,
    why: `${pct(speculative)} is in speculative assets against about ${pct(limit)} for your ${p.input.risk} risk answer. ${w(HEALTH_WEIGHTS.risk)}.`,
  });

  const loanScore = p.loanUsd > 0 ? Math.round(100 * clamp01(1 - p.ltv / LOAN_ZERO_AT)) : 100;
  parts.push({
    label: "Loan",
    score: loanScore,
    weight: HEALTH_WEIGHTS.loan,
    why: `${p.loanUsd > 0 ? `Loan is ${pct(p.ltv)} of priced holdings; the score reaches 0 at ${pct(LOAN_ZERO_AT)}` : "No open loan"}. ${w(HEALTH_WEIGHTS.loan)}.`,
  });

  const score = Math.round(parts.reduce((s, x) => s + x.score * x.weight, 0));
  const out = parts.map(({ label, score: s, why }) => ({ label, score: s, why }));
  if (p.unpriced.length) {
    out.push({ label: "Not scored", score: 0, why: `${p.unpriced.map((u) => u.name).join(", ")} had no price today and ${p.unpriced.length === 1 ? "is" : "are"} left out of the score.` });
  }
  return { score, parts: out };
}
