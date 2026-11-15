import { assetOf, THEMES, themeOf, type CatalogAsset } from "./catalog.ts";
import { CAPS, CRYPTO_SPLIT, RISK_LEVELS, VALUE_SCORE_LIMIT, VALUE_TILT_PER_POINT, type RiskLevel } from "./policy.ts";

/**
 * Turns "the themes I care about + my risk level" into a capped plan. Deterministic: the same
 * input always gives the same plan, and no AI model is involved. Value scores (from the market
 * data snapshot) can tilt weights by at most 25 percent, and every cap is applied after that.
 * See docs/themes/policy.md.
 */

export type Sleeve = "stocks" | "crypto" | "risk";

export type PlanInput = {
  /** Theme ids from catalog.ts. */
  themes: string[];
  risk: RiskLevel;
  /** Real tickers that can actually be bought here (on testnet: the ones with a Stackday mock). */
  available: string[];
  /** Optional cheapness score per ticker, -2 (expensive) to +2 (cheap). */
  valueScores?: Record<string, number>;
};

export type Holding = {
  ticker: string;
  name: string;
  sleeve: Sleeve;
  /** Share of the plan in basis points (10000 = everything). */
  bps: number;
  /** Which of the picked themes it comes from. */
  themes: string[];
  /** Plain-language reasons: theme fit, tilt, caps hit. */
  why: string[];
};

export type Plan = {
  holdings: Holding[];
  /** USDC cushion in basis points: kept as cash, not bought. */
  usdcBps: number;
  /** Tickers in the picked themes that cannot be bought here (shown as a preview only). */
  previewOnly: string[];
  /** Plan-level notes, for example "only 2 stocks can be bought here". */
  notes: string[];
};

type Work = { a: CatalogAsset; sleeve: Sleeve; w: number; themes: string[]; why: string[] };

const EPS = 1e-9;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const isCryptoGroup = (a: CatalogAsset) => a.kind === "crypto" || !!a.cryptoLike;

export function buildPlan(input: PlanInput): Plan {
  const targets = RISK_LEVELS[input.risk];
  const picked = Array.from(new Set(input.themes)).filter((id) => themeOf(id));
  const available = new Set(input.available);
  const notes: string[] = [];
  const previewOnly = new Set<string>();
  const work = new Map<string, Work>();

  const add = (ticker: string, sleeve: Sleeve, w: number, theme: string | null, why: string) => {
    const a = assetOf(ticker);
    if (!a || w <= 0) return;
    const cur = work.get(ticker) ?? { a, sleeve, w: 0, themes: [], why: [] };
    cur.w += w;
    if (theme && !cur.themes.includes(theme)) cur.themes.push(theme);
    if (!cur.why.includes(why)) cur.why.push(why);
    work.set(ticker, cur);
  };

  if (picked.length === 0) {
    return { holdings: [], usdcBps: 10_000, previewOnly: [], notes: ["Pick at least one theme to see a plan."] };
  }

  // 1. Stock sleeve: equal share per picked theme, equal weight inside a theme, overlaps add up.
  const coreOf = (themeId: string) =>
    themeOf(themeId)!.tickers.filter((t) => {
      const a = assetOf(t)!;
      if (a.kind !== "stock" || a.riskOnly) return false;
      if (!available.has(t)) {
        previewOnly.add(t);
        return false;
      }
      return true;
    });
  const stockThemes = picked.map((id) => ({ id, core: coreOf(id) })).filter((x) => x.core.length > 0);
  if (stockThemes.length === 0) {
    notes.push("None of the stocks in these themes can be bought here yet, so the stock part stays as USDC.");
  }
  for (const { id, core } of stockThemes) {
    const share = targets.stocks / stockThemes.length;
    for (const t of core) add(t, "stocks", share / core.length, id, `In your ${themeOf(id)!.name} theme`);
  }

  // 2. Crypto sleeve: Bitcoin and Ether, 2 to 1, whatever themes were picked (the risk level sets the size).
  const crypto = Object.keys(CRYPTO_SPLIT).filter((t) => available.has(t));
  const cryptoTotal = crypto.reduce((s, t) => s + CRYPTO_SPLIT[t], 0);
  for (const t of crypto) {
    add(
      t,
      "crypto",
      (targets.crypto * CRYPTO_SPLIT[t]) / cryptoTotal,
      picked.includes("crypto-native") ? "crypto-native" : null,
      `Part of the ${pct(targets.crypto)} crypto slice for your risk level`,
    );
  }
  if (crypto.length === 0 && targets.crypto > 0) notes.push("Bitcoin and Ether cannot be bought here yet, so that part stays as USDC.");

  // 3. Risk bucket: volatile names from the picked themes, each at most 2.5 percent.
  if (targets.risk > 0) {
    const candidates = Array.from(new Set(picked.flatMap((id) => themeOf(id)!.tickers))).filter((t) => assetOf(t)!.riskOnly);
    const riskNames = candidates.filter((t) => available.has(t));
    for (const t of candidates) if (!available.has(t)) previewOnly.add(t);
    for (const t of riskNames) {
      const id = picked.find((p) => themeOf(p)!.tickers.includes(t)) ?? null;
      add(t, "risk", Math.min(CAPS.riskAsset, targets.risk / riskNames.length), id, "Small risk-bucket slice: volatile, kept tiny on purpose");
    }
    if (riskNames.length === 0) notes.push("No risk-bucket names can be bought here yet, so the risk slice stays as USDC.");
  }

  // 4. Value tilt, inside each sleeve (the sleeve keeps its size, weights move by at most 25 percent).
  if (input.valueScores) {
    for (const sleeve of ["stocks", "crypto", "risk"] as Sleeve[]) {
      const items = [...work.values()].filter((x) => x.sleeve === sleeve);
      const before = items.reduce((s, x) => s + x.w, 0);
      for (const x of items) {
        const raw = input.valueScores[x.a.ticker];
        if (raw === undefined || !Number.isFinite(raw)) continue;
        const score = Math.max(-VALUE_SCORE_LIMIT, Math.min(VALUE_SCORE_LIMIT, raw));
        if (score === 0) continue;
        x.w *= 1 + VALUE_TILT_PER_POINT * score;
        x.why.push(
          score > 0
            ? `Tilted up: cheaper than usual (value score ${score.toFixed(1)})`
            : `Tilted down: pricier than usual (value score ${score.toFixed(1)})`,
        );
      }
      const after = items.reduce((s, x) => s + x.w, 0);
      if (after > 0) for (const x of items) x.w *= before / after;
    }
  }

  // 5. Caps. Scale down whatever is over, pass the excess to holdings in the same sleeve that are
  // not capped, and put anything nobody can take into the USDC cushion.
  applyCaps(work, picked, targets.cryptoCap);

  // 6. Basis points. Rounding down can only lower a weight, so caps still hold. The rest is USDC.
  const holdings: Holding[] = [...work.values()]
    .map((x) => ({
      ticker: x.a.ticker,
      name: x.a.name,
      sleeve: x.sleeve,
      bps: Math.floor(x.w * 10_000 + EPS),
      themes: x.themes,
      why: x.why,
    }))
    .filter((h) => h.bps > 0)
    .sort((a, b) => b.bps - a.bps || a.ticker.localeCompare(b.ticker));
  const usdcBps = 10_000 - holdings.reduce((s, h) => s + h.bps, 0);

  const liveStocks = holdings.filter((h) => h.sleeve === "stocks").length;
  if (liveStocks > 0 && liveStocks < 5) {
    notes.push(
      `Only ${liveStocks} of the stocks in these themes can be bought here, and each is capped at ${pct(CAPS.singleStock)}, so more of the plan stays as USDC.`,
    );
  }
  const themeCapped = picked.filter((id) => holdings.some((h) => h.why.includes(`${themeOf(id)!.name} theme capped at ${pct(CAPS.singleTheme)}`)));
  if (themeCapped.length) {
    notes.push(
      `No single theme may go above ${pct(CAPS.singleTheme)} of the plan (${themeCapped.map((id) => themeOf(id)!.name).join(", ")} reached it). Pick more themes to invest more of each payday; the rest stays as USDC.`,
    );
  }
  if (usdcBps / 10_000 < targets.usdcFloor - EPS) throw new Error("USDC cushion below its floor");

  return { holdings, usdcBps, previewOnly: [...previewOnly].sort(), notes };
}

type Constraint = { label: string; cap: number; members: Work[] };

function applyCaps(work: Map<string, Work>, picked: string[], cryptoCap: number) {
  const all = [...work.values()];
  const constraints: Constraint[] = [];
  for (const x of all) {
    if (x.sleeve === "stocks") constraints.push({ label: `Capped at ${pct(CAPS.singleStock)} for a single stock`, cap: CAPS.singleStock, members: [x] });
    if (x.sleeve === "risk") constraints.push({ label: `Capped at ${pct(CAPS.riskAsset)} as a risk-bucket name`, cap: CAPS.riskAsset, members: [x] });
  }
  for (const id of picked) {
    const t = themeOf(id)!;
    const members = all.filter((x) => t.tickers.includes(x.a.ticker));
    if (members.length) constraints.push({ label: `${t.name} theme capped at ${pct(CAPS.singleTheme)}`, cap: CAPS.singleTheme, members });
  }
  const ai = all.filter((x) => x.a.aiChips);
  if (ai.length) constraints.push({ label: `AI and chips group capped at ${pct(CAPS.aiChips)}`, cap: CAPS.aiChips, members: ai });
  const cg = all.filter((x) => isCryptoGroup(x.a));
  if (cg.length) constraints.push({ label: `Crypto group capped at ${pct(cryptoCap)}`, cap: cryptoCap, members: cg });

  const totalOf = (c: Constraint) => c.members.reduce((s, x) => s + x.w, 0);
  const memberOf = new Map<Work, Constraint[]>(all.map((x) => [x, constraints.filter((c) => c.members.includes(x))]));
  /** How much more `x` can take before any cap it belongs to is reached. */
  const room = (x: Work) => Math.max(0, Math.min(Infinity, ...memberOf.get(x)!.map((c) => c.cap - totalOf(c))));

  // a. Scale every breach down to its cap. Scaling down never pushes another cap over.
  const excess: Record<Sleeve, number> = { stocks: 0, crypto: 0, risk: 0 };
  for (const c of constraints) {
    const total = totalOf(c);
    if (total <= c.cap + EPS) continue;
    const scale = c.cap / total;
    for (const x of c.members) {
      excess[x.sleeve] += x.w * (1 - scale);
      x.w *= scale;
      if (!x.why.includes(c.label)) x.why.push(c.label);
    }
  }

  // b. Hand the excess to other holdings in the same sleeve, in proportion to their weight, but
  // never more than the room left under every cap they belong to (checked live, one at a time).
  // Whatever nobody has room for stays as USDC.
  for (const sleeve of Object.keys(excess) as Sleeve[]) {
    let pool = excess[sleeve];
    for (let pass = 0; pass < 50 && pool > EPS; pass++) {
      const open = all.filter((x) => x.sleeve === sleeve && room(x) > EPS).sort((a, b) => b.w - a.w || a.a.ticker.localeCompare(b.a.ticker));
      const base = open.reduce((s, x) => s + x.w, 0);
      if (!open.length || base <= EPS) break;
      let given = 0;
      const start = pool;
      for (const x of open) {
        const g = Math.min((start * x.w) / base, room(x), pool);
        if (g <= 0) continue;
        x.w += g;
        pool -= g;
        given += g;
      }
      if (given <= EPS) break;
    }
  }
}

/** Every cap, checked on a finished plan. Returns the broken rules (empty when the plan is fine). */
export function checkPlan(plan: Plan, risk: RiskLevel, themes: string[]): string[] {
  const t = RISK_LEVELS[risk];
  const problems: string[] = [];
  const w = (h: Holding) => h.bps / 10_000;
  const total = plan.holdings.reduce((s, h) => s + h.bps, 0) + plan.usdcBps;
  if (total !== 10_000) problems.push(`weights add up to ${total} bps`);
  for (const h of plan.holdings) {
    if (h.bps < 0) problems.push(`${h.ticker} is negative`);
    if (h.sleeve === "stocks" && w(h) > CAPS.singleStock + EPS) problems.push(`${h.ticker} is over the single-stock cap`);
    if (h.sleeve === "risk" && w(h) > CAPS.riskAsset + EPS) problems.push(`${h.ticker} is over the risk-bucket cap`);
  }
  for (const id of themes) {
    const th = THEMES.find((x) => x.id === id);
    if (!th) continue;
    const sum = plan.holdings.filter((h) => th.tickers.includes(h.ticker)).reduce((s, h) => s + w(h), 0);
    if (sum > CAPS.singleTheme + EPS) problems.push(`${th.name} is over the theme cap`);
  }
  const ai = plan.holdings.filter((h) => assetOf(h.ticker)?.aiChips).reduce((s, h) => s + w(h), 0);
  if (ai > CAPS.aiChips + EPS) problems.push("AI and chips group is over its cap");
  const cg = plan.holdings.filter((h) => isCryptoGroup(assetOf(h.ticker)!)).reduce((s, h) => s + w(h), 0);
  if (cg > t.cryptoCap + EPS) problems.push("crypto group is over its cap");
  if (plan.usdcBps / 10_000 < t.usdcFloor - EPS) problems.push("USDC cushion is below its floor");
  return problems;
}
