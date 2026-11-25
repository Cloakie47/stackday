/**
 * Gift box mixes: the rules of src/GiftBox.sol written once in plain TypeScript, so the Gifts page
 * and the chat assistant build exactly what the contract accepts. Pure, no React and no network.
 * Unit tested in mix.test.ts.
 *
 * Contract rules mirrored here (GiftBox._checkMix and create):
 * - 1 to 6 assets, no asset twice, every weight above zero, weights add up to exactly 10_000 bps.
 * - At least 1 USDC (minGift). The site also caps a box at 500 test USDC.
 * - Expiry between 1 and 365 days; the site offers 7, 30 or 90.
 *
 * Every weight here is a whole percent (a multiple of 100 bps, at least 1%). A tiny share could buy
 * zero units of an asset, and then the contract refuses to open the box (BuyFailed).
 */

export type Hex = `0x${string}`;

/** One part of a mix, as GiftBox stores it. */
export type MixLeg = { token: Hex; weightBps: number };

export const MAX_LEGS = 6;
export const TOTAL_BPS = 10_000;
/** Smallest share of one part: 1%. */
export const MIN_LEG_BPS = 100;
/** 1 USDC (6 decimals), the contract's minGift. */
export const MIN_GIFT_USDC = 1_000_000n;
/** 500 test USDC, the site's cap. */
export const MAX_GIFT_USDC = 500_000_000n;
export const EXPIRY_DAYS = [7, 30, 90] as const;
export type ExpiryDays = (typeof EXPIRY_DAYS)[number];
export const MESSAGE_MAX = 140;
/** Slippage the app allows on each buy when opening (the contract caps it at 300). */
export const OPEN_SLIPPAGE_BPS = 100;

/** The contract's two kinds. Fixed covers one stock, my mix and surprise. */
export const KIND = { Fixed: 0, Research: 1 } as const;
export type BoxType = "one" | "mix" | "surprise" | "research";
export const BOX_LABEL: Record<BoxType, string> = {
  one: "One stock",
  mix: "My mix",
  surprise: "Surprise",
  research: "Research pick",
};

/** Box names a link may use: the form's own, and the chat assistant's (lib/chat/intent.ts). */
const LINK_BOX: Record<string, BoxType> = {
  one: "one",
  one_stock: "one",
  mix: "mix",
  my_mix: "mix",
  surprise: "surprise",
  research: "research",
  research_pick: "research",
};

/**
 * Reads the amount and box type a link to /gifts carries (the chat's gift card links to
 * /gifts?usdc=5&box=surprise). Anything unknown, malformed or outside 1 to 500 test USDC is dropped,
 * so the form keeps its own default. The recipient is never taken from the address bar.
 */
export function giftLinkPrefill(usdc: string | null | undefined, box: string | null | undefined): { usdc?: string; box?: BoxType } {
  const out: { usdc?: string; box?: BoxType } = {};
  const u = (usdc ?? "").trim();
  if (/^\d{1,3}(\.\d{1,6})?$/.test(u)) {
    const micro = BigInt(u.split(".")[0]) * 1_000_000n + BigInt((u.split(".")[1] ?? "").padEnd(6, "0"));
    if (micro >= MIN_GIFT_USDC && micro <= MAX_GIFT_USDC) out.usdc = u;
  }
  const b = LINK_BOX[(box ?? "").trim().toLowerCase()];
  if (b) out.box = b;
  return out;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

/** The same checks GiftBox._checkMix makes, plus the whole-percent rule. Null when the mix is fine. */
export function mixProblem(legs: MixLeg[]): string | null {
  if (legs.length === 0) return "Pick at least one asset.";
  if (legs.length > MAX_LEGS) return `A box holds at most ${MAX_LEGS} assets.`;
  const seen = new Set<string>();
  let sum = 0;
  for (const l of legs) {
    const key = l.token.toLowerCase();
    if (seen.has(key)) return "An asset is in the mix twice.";
    seen.add(key);
    if (!Number.isInteger(l.weightBps) || l.weightBps < MIN_LEG_BPS) return "Every part needs at least 1%.";
    if (l.weightBps % 100 !== 0) return "Use whole percents.";
    sum += l.weightBps;
  }
  if (sum !== TOTAL_BPS) return `The parts add up to ${sum / 100}%, not 100%.`;
  return null;
}

/**
 * Turns ratios typed by a person (any positive numbers, for example 20, 30, 50 or 1, 1, 2) into whole
 * percents that add up to exactly 100%: each gets its share rounded down, then the percents left
 * over go to the largest remainders (ties to the earlier part). Every part keeps at least 1%.
 */
export function ratiosToBps(parts: { token: Hex; ratio: number }[]): Result<MixLeg[]> {
  if (parts.length === 0) return fail("Pick at least one asset.");
  if (parts.length > MAX_LEGS) return fail(`A box holds at most ${MAX_LEGS} assets.`);
  if (parts.some((p) => !Number.isFinite(p.ratio) || p.ratio <= 0)) return fail("Every part needs a share above zero.");
  const total = parts.reduce((s, p) => s + p.ratio, 0);
  const exact = parts.map((p) => (p.ratio / total) * 100);
  const pct = exact.map((x) => Math.max(1, Math.floor(x)));
  let left = 100 - pct.reduce((s, x) => s + x, 0);
  // Hand out what is left by largest remainder; take back (from the biggest parts) if the 1% floor overshot.
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++) {
    pct[order[k % order.length][1]]++;
    left--;
  }
  while (left < 0) {
    const i = pct.indexOf(Math.max(...pct));
    if (pct[i] <= 1) return fail("Too many parts for whole percents.");
    pct[i]--;
    left++;
  }
  const legs = parts.map((p, i) => ({ token: p.token, weightBps: pct[i] * 100 }));
  const problem = mixProblem(legs);
  return problem ? fail(problem) : { ok: true, value: legs };
}

export const oneStockMix = (token: Hex): MixLeg[] => [{ token, weightBps: TOTAL_BPS }];

/**
 * A surprise mix: 2 to 4 different assets (fewer only if fewer exist) with random whole-percent
 * shares of at least 10% each, adding up to 100%. Picked in the browser when sending; `rand` is
 * injectable for tests and must return numbers in [0, 1).
 */
export function surpriseMix(tokens: Hex[], rand: () => number = Math.random): MixLeg[] {
  const pool = Array.from(new Map(tokens.map((t) => [t.toLowerCase(), t])).values());
  if (pool.length === 0) return [];
  if (pool.length === 1) return oneStockMix(pool[0]);
  const maxN = Math.min(4, pool.length);
  const n = 2 + Math.floor(rand() * (maxN - 1));
  // Fisher-Yates on a copy, then take the first n.
  const picked = [...pool];
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  const chosen = picked.slice(0, n);
  // Each part starts at 10%, the remaining percents go one 1% unit at a time to a random part.
  const MIN_PCT = 10;
  const pct = chosen.map(() => MIN_PCT);
  let left = 100 - MIN_PCT * n;
  // Spread in chunks so shares really differ, but always end on exactly 100.
  while (left > 0) {
    const chunk = Math.min(left, 1 + Math.floor(rand() * 15));
    pct[Math.floor(rand() * n)] += chunk;
    left -= chunk;
  }
  return chosen.map((token, i) => ({ token, weightBps: pct[i] * 100 }));
}

/** The minimal shape of a weekly report the research pick needs (WeeklyReport in lib/research/types.ts). */
export type ReportForMix = {
  kind: "live" | "sample";
  weekOf: string;
  ideas: {
    ranked: { rank: number; assetId: string; view: string }[];
    exampleSplits: { profile: string; slices: { assetId: string; share: number }[] }[];
  };
};

/** A research pick by asset id; the app maps ids to token addresses with its asset list. */
export type ResearchPick = { weekOf: string; source: "cautious-split" | "top-idea"; legs: { assetId: string; weightBps: number }[] };

/**
 * The research pick from an approved weekly report, only ever from the researched assets:
 * - the report's general "cautious" example split (computed in code from the views and risk), as
 *   whole percents adding up to 100%;
 * - if that is empty, the single top ranked idea whose view is accumulate or hold, at 100%.
 * Sample reports never count. Returns null when the report gives nothing usable.
 */
export function researchPick(report: ReportForMix | null | undefined, researched: string[]): ResearchPick | null {
  if (!report || report.kind !== "live") return null;
  const allowed = new Set(researched);
  const split = report.ideas.exampleSplits.find((s) => s.profile === "cautious");
  const slices = (split?.slices ?? []).filter((s) => allowed.has(s.assetId) && Number.isFinite(s.share) && s.share > 0);
  const merged = new Map<string, number>();
  for (const s of slices) merged.set(s.assetId, (merged.get(s.assetId) ?? 0) + s.share);
  const parts = [...merged.entries()].slice(0, MAX_LEGS);
  if (parts.length > 0) {
    // Reuse the ratio rounding with the asset id standing in for the token.
    const r = ratiosToBps(parts.map(([assetId, share]) => ({ token: assetId as Hex, ratio: share })));
    if (r.ok) return { weekOf: report.weekOf, source: "cautious-split", legs: r.value.map((l) => ({ assetId: l.token, weightBps: l.weightBps })) };
  }
  const top = [...report.ideas.ranked]
    .sort((a, b) => a.rank - b.rank)
    .find((i) => allowed.has(i.assetId) && (i.view === "accumulate" || i.view === "hold"));
  if (top) return { weekOf: report.weekOf, source: "top-idea", legs: [{ assetId: top.assetId, weightBps: TOTAL_BPS }] };
  return null;
}

/** Maps a research pick to token addresses. Null if any asset is unknown to this deployment. */
export function pickToLegs(pick: ResearchPick, tokenOf: (assetId: string) => Hex | undefined): MixLeg[] | null {
  const legs: MixLeg[] = [];
  for (const l of pick.legs) {
    const token = tokenOf(l.assetId);
    if (!token) return null;
    legs.push({ token, weightBps: l.weightBps });
  }
  return mixProblem(legs) ? null : legs;
}

/** USDC per part exactly as GiftBox._buyMix splits it: rounded down, the last part takes the rest. */
export function splitUsdc(total: bigint, legs: MixLeg[]): bigint[] {
  let spent = 0n;
  return legs.map((l, i) => {
    const part = i + 1 === legs.length ? total - spent : (total * BigInt(l.weightBps)) / BigInt(TOTAL_BPS);
    spent += part;
    return part;
  });
}

/** Problem with a gift amount (6-decimal USDC), or null. `walletUsdc` adds a balance check when known. */
export function amountProblem(amount: bigint, walletUsdc?: bigint): string | null {
  if (amount < MIN_GIFT_USDC) return "A gift is at least 1 USDC.";
  if (amount > MAX_GIFT_USDC) return "A gift is at most 500 test USDC.";
  if (walletUsdc !== undefined && amount > walletUsdc) return "Your wallet does not hold that much test USDC.";
  return null;
}

/** Expiry timestamp for a box sent now. */
export const expiryFrom = (nowSeconds: number, days: ExpiryDays): number => nowSeconds + days * 86_400;

/** A gift message: trimmed, at most 140 characters, no control characters. Null when invalid. */
export function cleanMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim();
  if (m.length > MESSAGE_MAX) return null;
  if (/[\u0000-\u001f\u007f]/.test(m)) return null;
  return m;
}

/** "SD-7K3F9Q2M" style Stackday ID, or a wallet address, typed by the sender. */
export function recipientQuery(raw: string): { kind: "id" | "wallet" | "name" | "none"; q: string } {
  const q = raw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) return { kind: "wallet", q: q.toLowerCase() };
  if (/^sd-?[0-9a-z]{2,8}$/i.test(q)) return { kind: "id", q: `SD-${q.toUpperCase().replace(/^SD-?/, "")}` };
  if (/^@?[a-z0-9_]{2,20}$/i.test(q)) return { kind: "name", q: q.replace(/^@/, "").toLowerCase() };
  return { kind: "none", q };
}
