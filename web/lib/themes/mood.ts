import { CATALOG, themeOf } from "./catalog.ts";
import { VALUE_SCORE_LIMIT } from "./policy.ts";

/**
 * Market Mood: scores news per asset and rolls it up per theme. The mood score summarises recent
 * news; it does not predict prices (Mutual Interest docs/07, section 2.5).
 * Pure TypeScript, no network. Pipeline and guardrails: docs/themes/concept.md ("Mood score")
 * and docs/03-consumer-app-concept.md section 3.
 *
 * Every article is untrusted text. The model that classifies it returns only the strict
 * `NewsItem` shape below; anything else is dropped, and an article the model flags as a
 * possible prompt injection gets zero weight. Weights are computed here, in code, from
 * bounded numbers, so even a fooled model can only move mood inside [-1, 1]. Mood is shown to
 * people as context next to the split; it does not change amounts. (A Smart DCA pace driven by
 * mood was removed: it lost to plain weekly buying in 24 of 24 backtest windows, docs/07 4.4.)
 */

export const EVENT_TYPES = ["regulation", "earnings", "guidance", "product", "legal", "macro", "rumor", "other"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** One scored article for one ticker: the model's strict output plus where the article came from. */
export type NewsItem = {
  /** A catalog ticker, for example "NVDAc". */
  ticker: string;
  event_type: EventType;
  /** -1 (clearly bad for the asset) to +1 (clearly good). */
  direction: number;
  /** 0 (noise) to 1 (changes the business: guidance cut, fraud claim, CEO exit). Materiality, not tone. */
  materiality: number;
  /** 0 to 1: how sure the classifier is. */
  confidence: number;
  /** Opinion, column or commentary rather than reported fact. */
  is_opinion: boolean;
  /** At most 25 words copied from the article, shown on the "why" card. */
  evidence_quote: string;
  /** The model saw instructions inside the article. Such items never get here: parsing drops them. */
  injection_suspected?: boolean;
  title: string;
  /** Publisher name, set by our ingest (never by the model). Drives `sourceTrust`. */
  source: string;
  /** http(s) link to the article. */
  url: string;
  /** ISO 8601 date or date-time. */
  publishedAt: string;
};

export const LIMITS = {
  quoteWords: 25,
  quoteChars: 300,
  title: 200,
  source: 80,
  url: 500,
  label: 300,
  method: 4000,
} as const;

/** Opinion pieces (and social-only stories) never count as more than this materiality. */
export const OPINION_MATERIALITY_CAP = 0.2;
/** A negative item at or above this materiality is a candidate material event. */
export const MATERIAL_THRESHOLD = 0.7;
/** Mood half-life style decay: weight x e^(-age / tau), tau in days. */
export const DEFAULT_TAU_DAYS = 3;

const DAY_MS = 86_400_000;
const TICKERS = new Set(CATALOG.map((a) => a.ticker));

// ---------------------------------------------------------------------------------------------
// Sanitizing
// ---------------------------------------------------------------------------------------------

/** Zero-width, bidi-control, soft hyphen and other invisible format characters. Removed outright. */
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;
/** C0 and C1 control characters plus line and paragraph separators. Replaced by a space. */
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;

/**
 * Look-alike Cyrillic and Greek letters mapped to the Latin letter they imitate. NFKC already
 * folds full-width and mathematical letters (for example "\uFF2E\uFF36\uFF24\uFF21" to "NVDA");
 * this covers the common cross-script tricks NFKC leaves alone. The news pipeline is English-only,
 * so folding these is safe for us.
 */
const CONFUSABLES: Record<string, string> = {
  "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041A": "K", "\u041C": "M", "\u041D": "H", "\u041E": "O",
  "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0425": "X", "\u0430": "a", "\u0435": "e", "\u043E": "o",
  "\u0440": "p", "\u0441": "c", "\u0443": "y", "\u0445": "x", "\u0456": "i", "\u0458": "j", "\u0405": "S",
  "\u0455": "s", "\u0406": "I", "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H",
  "\u0399": "I", "\u039A": "K", "\u039C": "M", "\u039D": "N", "\u039F": "O", "\u03A1": "P", "\u03A4": "T",
  "\u03A5": "Y", "\u03A7": "X", "\u03BF": "o", "\u03B9": "i", "\u03BD": "v",
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");

/**
 * Cleans untrusted text: Unicode NFKC, look-alike letters folded to Latin, invisible characters
 * removed, control characters turned into spaces, whitespace collapsed, then cut to `max`
 * characters (by code point, so a surrogate pair is never split).
 */
export function sanitizeText(input: string, max: number): string {
  const s = input
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(CONFUSABLE_RE, (c) => CONFUSABLES[c] ?? c)
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() : s;
}

/** Only absolute http(s) URLs without embedded credentials. Returns the normalized URL or null. */
export function safeUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = sanitizeText(input, LIMITS.url + 1);
  if (s.length === 0 || s.length > LIMITS.url) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password || !u.hostname) return null;
  return u.toString();
}

export const wordCount = (s: string) => (s.trim() === "" ? 0 : s.trim().split(/\s+/).length);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const isIsoDate = (s: unknown): s is string => typeof s === "string" && ISO_DATE.test(s) && Number.isFinite(Date.parse(s));

// ---------------------------------------------------------------------------------------------
// Parsing the model output
// ---------------------------------------------------------------------------------------------

const ITEM_KEYS = new Set([
  "ticker", "event_type", "direction", "materiality", "confidence", "is_opinion", "evidence_quote",
  "injection_suspected", "title", "source", "url", "publishedAt",
]);

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const inRange = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;

/**
 * Strict schema check for one scored article. Returns a cleaned item, or null when anything is
 * off-schema (unknown key, wrong type, out-of-range number, unknown ticker, quote over 25 words,
 * non-http(s) URL, bad date) or when the model flagged a possible injection.
 */
export function parseNewsItem(raw: unknown): NewsItem | null {
  if (!isObject(raw)) return null;
  for (const k of Object.keys(raw)) if (!ITEM_KEYS.has(k)) return null;

  if (raw.injection_suspected !== undefined && typeof raw.injection_suspected !== "boolean") return null;
  if (raw.injection_suspected === true) return null;

  if (typeof raw.ticker !== "string") return null;
  const ticker = sanitizeText(raw.ticker, 16);
  if (!TICKERS.has(ticker)) return null;

  if (typeof raw.event_type !== "string" || !(EVENT_TYPES as readonly string[]).includes(raw.event_type)) return null;
  if (!inRange(raw.direction, -1, 1) || !inRange(raw.materiality, 0, 1) || !inRange(raw.confidence, 0, 1)) return null;
  if (typeof raw.is_opinion !== "boolean") return null;

  if (typeof raw.evidence_quote !== "string") return null;
  const quote = sanitizeText(raw.evidence_quote, LIMITS.quoteChars + 1);
  if (quote.length === 0 || quote.length > LIMITS.quoteChars || wordCount(quote) > LIMITS.quoteWords) return null;

  if (typeof raw.title !== "string" || typeof raw.source !== "string") return null;
  const title = sanitizeText(raw.title, LIMITS.title);
  const source = sanitizeText(raw.source, LIMITS.source);
  if (!title || !source) return null;

  const url = safeUrl(raw.url);
  if (!url) return null;
  if (!isIsoDate(raw.publishedAt)) return null;

  return {
    ticker,
    event_type: raw.event_type as EventType,
    direction: raw.direction,
    materiality: raw.materiality,
    confidence: raw.confidence,
    is_opinion: raw.is_opinion,
    evidence_quote: quote,
    title,
    source,
    url,
    publishedAt: raw.publishedAt,
  };
}

// ---------------------------------------------------------------------------------------------
// Source trust
// ---------------------------------------------------------------------------------------------

export const TRUST = { primary: 1, wire: 0.9, other: 0.6, social: 0.3 } as const;

const WIRES = [
  "reuters", "associated press", "ap news", "bloomberg", "dow jones", "wall street journal",
  "business wire", "pr newswire", "globenewswire", "globe newswire",
];
const SOCIAL = new Set([
  "x", "twitter", "reddit", "stocktwits", "telegram", "discord", "tiktok", "youtube", "facebook",
  "instagram", "threads", "farcaster", "bluesky",
]);

/**
 * How much a publisher's word counts, by name (lowercase match):
 * - 1.0 primary filings: "SEC EDGAR" (the company's own filing with the regulator)
 * - 0.9 major wires: Reuters, AP, Bloomberg, Dow Jones / WSJ, and the press-release wires
 *   (Business Wire, PR Newswire, GlobeNewswire), which carry the company's own release
 * - 0.3 social: X, Reddit, Stocktwits, Telegram and similar
 * - 0.6 everyone else (news sites, blogs, company newsrooms)
 * The name is set by our ingest from the feed, never by the model.
 */
export function sourceTrust(source: string): number {
  const s = sanitizeText(source, LIMITS.source).toLowerCase();
  if (/\bsec edgar\b/.test(s) || s === "sec" || s === "edgar") return TRUST.primary;
  if (WIRES.some((w) => s.includes(w))) return TRUST.wire;
  const words = s.split(/[^a-z0-9.]+/).filter(Boolean);
  if (words.some((w) => SOCIAL.has(w))) return TRUST.social;
  return TRUST.other;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** A primary filing only when the name says so AND the link really is on sec.gov. */
export const isPrimaryFiling = (item: NewsItem) => {
  const host = hostOf(item.url);
  return sourceTrust(item.source) === TRUST.primary && (host === "sec.gov" || host.endsWith(".sec.gov"));
};

/** Trust of one item: a claimed filing that is not on sec.gov is treated as an ordinary site. */
export function itemTrust(item: NewsItem): number {
  const t = sourceTrust(item.source);
  if (t === TRUST.primary && !isPrimaryFiling(item)) return TRUST.other;
  return t;
}

/** Materiality after the caps: opinion and social-only items never count above 0.2. */
export function effectiveMateriality(item: NewsItem): number {
  const capped = item.is_opinion || itemTrust(item) <= TRUST.social;
  return capped ? Math.min(item.materiality, OPINION_MATERIALITY_CAP) : item.materiality;
}

// ---------------------------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------------------------

const toMs = (t: Date | string | number) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));
const clamp = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : 0);

/**
 * mood = sum(direction x w) / sum(w), w = materiality x confidence x trust x e^(-age / tau),
 * clamped to [-1, 1]. Opinion pieces count with materiality at most 0.2. Items dated after `now`
 * are ignored. No items (or all weights zero) gives 0.
 */
export function aggregateMood(items: NewsItem[], now: Date | string | number, tauDays = DEFAULT_TAU_DAYS): number {
  if (!(tauDays > 0)) throw new Error("tauDays must be positive");
  const nowMs = toMs(now);
  if (!Number.isFinite(nowMs)) throw new Error("now must be a valid date");
  let num = 0;
  let den = 0;
  for (const item of items) {
    const ageDays = (nowMs - Date.parse(item.publishedAt)) / DAY_MS;
    if (!Number.isFinite(ageDays) || ageDays < 0) continue;
    const w = effectiveMateriality(item) * item.confidence * itemTrust(item) * Math.exp(-ageDays / tauDays);
    num += item.direction * w;
    den += w;
  }
  return den > 0 ? clamp(num / den, -1, 1) : 0;
}

/**
 * The corroboration rule: a negative item with materiality 0.7 or more only raises the flag when
 * it comes from a primary filing, or when at least 2 independent sources (different publisher and
 * different website, not social) report such an item. Pass `now` to only look at the last
 * `windowDays` days.
 */
export function materialRiskFlag(items: NewsItem[], now?: Date | string | number, windowDays = 14): boolean {
  const nowMs = now === undefined ? undefined : toMs(now);
  const candidates = items.filter((i) => {
    if (i.direction >= 0 || effectiveMateriality(i) < MATERIAL_THRESHOLD) return false;
    if (nowMs === undefined) return true;
    const age = (nowMs - Date.parse(i.publishedAt)) / DAY_MS;
    return age >= 0 && age <= windowDays;
  });
  if (candidates.some(isPrimaryFiling)) return true;
  const names = new Set<string>();
  const hosts = new Set<string>();
  let independent = 0;
  for (const i of candidates) {
    if (itemTrust(i) < TRUST.other) continue;
    const name = sanitizeText(i.source, LIMITS.source).toLowerCase().replace(/\s*\(.*\)\s*$/, "");
    const host = hostOf(i.url);
    if (names.has(name) || hosts.has(host)) continue;
    names.add(name);
    hosts.add(host);
    independent++;
  }
  return independent >= 2;
}

// ---------------------------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------------------------

export type AssetMood = {
  /** -2 (expensive) to +2 (cheap); 0 when not measured. Same scale as the basket value tilt. */
  valueScore: number;
  /** -1 (fearful) to +1 (euphoric). */
  mood: number;
  /** Mention spike or greed reading above 80: slows buying. */
  hype: boolean;
  /** A corroborated material negative event is open. */
  materialRisk: boolean;
  items: NewsItem[];
};

export type MoodSnapshot = {
  /** Always "snapshot": built by hand at one moment, not a live feed. */
  kind: "snapshot";
  /** ISO date or date-time the snapshot describes. */
  asOf: string;
  /** Plain-language label the UI must show next to any mood. */
  label: string;
  /** How it was built and scored. */
  method: string;
  assets: Record<string, AssetMood>;
};

/**
 * Checks a snapshot. Returns null when the frame is wrong (not kind "snapshot", bad date, empty
 * label or method). Inside, drops every asset that is not in the catalog or has an out-of-range
 * score, and every news item that fails `parseNewsItem` or names a different ticker. A material
 * risk the items corroborate is always kept on, whatever the file says.
 */
export function validateSnapshot(raw: unknown): MoodSnapshot | null {
  if (!isObject(raw) || raw.kind !== "snapshot") return null;
  if (!isIsoDate(raw.asOf)) return null;
  if (typeof raw.label !== "string" || typeof raw.method !== "string") return null;
  const label = sanitizeText(raw.label, LIMITS.label);
  const method = sanitizeText(raw.method, LIMITS.method);
  if (!label || !method) return null;

  const assets: Record<string, AssetMood> = {};
  if (isObject(raw.assets)) {
    for (const [key, a] of Object.entries(raw.assets)) {
      const ticker = sanitizeText(key, 16);
      if (!TICKERS.has(ticker) || ticker !== key || !isObject(a)) continue;
      if (!inRange(a.valueScore, -VALUE_SCORE_LIMIT, VALUE_SCORE_LIMIT) || !inRange(a.mood, -1, 1)) continue;
      if (typeof a.hype !== "boolean" || typeof a.materialRisk !== "boolean" || !Array.isArray(a.items)) continue;
      const items = a.items.map(parseNewsItem).filter((i): i is NewsItem => i !== null && i.ticker === ticker);
      assets[ticker] = {
        valueScore: a.valueScore,
        mood: a.mood,
        hype: a.hype,
        materialRisk: a.materialRisk || materialRiskFlag(items),
        items,
      };
    }
  }
  return { kind: "snapshot", asOf: raw.asOf, label, method, assets };
}

/** Theme mood: equal-weight mean over the theme's tickers. A ticker with no entry counts as 0. */
export function themeMood(snapshot: MoodSnapshot, themeId: string): number {
  const theme = themeOf(themeId);
  if (!theme) throw new Error(`unknown theme: ${themeId}`);
  if (theme.tickers.length === 0) return 0;
  const sum = theme.tickers.reduce((s, t) => s + (snapshot.assets[t]?.mood ?? 0), 0);
  return clamp(sum / theme.tickers.length, -1, 1);
}

/**
 * Open material events for the chosen themes: tickers (each once) whose corroborated material
 * negative event is still open in the snapshot. Shown as a flag; it never changes amounts.
 */
export function openEventsFor(snapshot: MoodSnapshot, themeIds: string[]): { tickers: string[]; riskTickers: string[] } {
  const tickers: string[] = [];
  for (const id of themeIds) {
    const theme = themeOf(id);
    if (!theme) throw new Error(`unknown theme: ${id}`);
    for (const t of theme.tickers) if (!tickers.includes(t)) tickers.push(t);
  }
  return { tickers, riskTickers: tickers.filter((t) => snapshot.assets[t]?.materialRisk === true) };
}
