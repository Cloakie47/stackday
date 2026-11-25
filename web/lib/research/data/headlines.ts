import type { Fact, IsoDate } from "../types.ts";
import type { UniverseAsset } from "../universe.ts";
import { LIMITS, safeUrl, sanitizeText } from "../../themes/mood.ts";
import { GENERIC_USER_AGENT, RateLimiter, getJson, getText, type DataDeps } from "./deps.ts";
import { NEWS_WINDOW_DAYS, feedText, parseFeed, quoteWords, selectNews, type FeedItem } from "./news.ts";

/**
 * Headlines for the research run (spec section 3.4), from three kinds of source, each tagged so
 * the engine can weigh them:
 *
 * - "reputable-outlet": Reuters, AP, Bloomberg, FT, WSJ, CNBC, BBC and a few others, found through
 *   the free GDELT DOC 2.0 API. Headline and link only: we never fetch the article.
 * - "official": Federal Reserve, SEC and Treasury OFAC press feeds.
 * - "press-release": the company's own newsroom. One side of a story, never the only source.
 *
 * Every headline is untrusted text: sanitized with the Themes guard, screened for instructions to
 * an AI (dropped and logged), cut to a quote of at most 25 words, and tagged with topics by the
 * regular expressions in `TOPICS`. Server-only.
 */

const DAY = 86_400_000;
const feedLimiter = new RateLimiter(500);

/** A headline ready to become a fact: source set by code, quote at most 25 words, topic tags. */
export type NewsItem = { title: string; url: string; publishedAt: string; quote: string; sourceName: string; tags: string[] };

// ---------------------------------------------------------------------------------------------
// Topic tags (code, not model)
// ---------------------------------------------------------------------------------------------

/** Topic tags set by code from the headline and summary. Order is stable. */
export const TOPICS: [string, RegExp][] = [
  ["geopolitics", /\b(war|wars|conflict|military|invasion|invade|missiles?|ceasefire|troops|geopolitic\w*|elections?|coup|nato|middle east|ukrain\w*|russia\w*|taiwan\w*|iran\w*|israel\w*)\b/i],
  ["tariffs", /\b(tariffs?|trade war|trade deal|trade talks|duties|import tax(es)?)\b/i],
  ["export-controls", /\b(export controls?|export restrictions?|export curbs?|export ban|entity list|chip curbs?|export licen[cs]es?)\b/i],
  ["sanctions", /\b(sanction\w*|ofac|blacklist\w*)\b/i],
  ["fed", /\b(federal reserve|the fed|fed's|fomc|powell|rate cuts?|rate hikes?|interest rates?|monetary policy)\b/i],
  ["regulation", /\b(regulat\w*|sec|lawsuits?|antitrust|probe|investigation|fines?|fined|court|ruling|enforcement|legislation)\b/i],
  ["earnings", /\b(earnings|quarterly results|revenue|guidance|profits?|forecasts?)\b/i],
  ["etf", /\betfs?\b/i],
  ["china", /\b(china|chinese|beijing)\b/i],
  ["inflation", /\b(inflation|cpi|pce|consumer prices)\b/i],
  ["jobs", /\b(jobs report|payrolls?|unemployment|labor market)\b/i],
  ["crypto", /\b(crypto\w*|bitcoin|ether|ethereum|stablecoins?|digital assets?)\b/i],
  ["gold", /\b(gold|bullion)\b/i],
];

export function tagTopics(text: string): string[] {
  return TOPICS.filter(([, re]) => re.test(text)).map(([t]) => t);
}

// ---------------------------------------------------------------------------------------------
// Company newsroom feeds
// ---------------------------------------------------------------------------------------------

export type PressFeed = { name: string; url: string };

/**
 * Official company newsroom feeds for the stocks in the research universe, checked 2026-11-19
 * (HTTP 200 with RSS or Atom).
 */
export const PRESS_FEEDS: Record<string, PressFeed> = {
  mAAPL: { name: "Apple Newsroom", url: "https://www.apple.com/newsroom/rss-feed.rss" },
  mNVDA: { name: "NVIDIA Newsroom", url: "https://nvidianews.nvidia.com/releases.xml" },
};

/** Company press releases: at most this many per asset, so they never dominate the news. */
export const MAX_PRESS = 3;

const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml";

export async function fetchPressNews(asset: UniverseAsset, date: IsoDate, deps: DataDeps): Promise<{ items: NewsItem[]; problems: string[] }> {
  const feed = PRESS_FEEDS[asset.assetId];
  if (!feed) return { items: [], problems: [] };
  const problems: string[] = [];
  try {
    await feedLimiter.wait(deps);
    const xml = await getText(deps, feed.url, { "User-Agent": GENERIC_USER_AGENT, Accept: FEED_ACCEPT });
    const items = selectNews(parseFeed(xml), date, deps.now(), problems, `${asset.assetId} ${feed.name}`, NEWS_WINDOW_DAYS, MAX_PRESS);
    return {
      items: items.map((it) => ({ title: it.title, url: it.url, publishedAt: it.publishedAt, quote: quoteWords(it.summary || it.title), sourceName: feed.name, tags: ["press-release", ...tagTopics(`${it.title} ${it.summary}`)] })),
      problems,
    };
  } catch (e) {
    return { items: [], problems: [`${asset.assetId}: ${feed.name} feed failed, no reading (${e instanceof Error ? e.message : "unknown error"})`] };
  }
}

// ---------------------------------------------------------------------------------------------
// Reputable outlets through GDELT
// ---------------------------------------------------------------------------------------------

/**
 * Outlets we accept, checked again in code against the host name of each article's link (never
 * GDELT's own `domain` field). Paywalled sites are fine because we keep only the headline and the
 * link GDELT already indexed.
 */
export const REPUTABLE_DOMAINS = ["reuters.com", "apnews.com", "bloomberg.com", "ft.com", "wsj.com", "cnbc.com", "bbc.co.uk", "bbc.com", "nytimes.com", "economist.com", "theguardian.com", "npr.org"];

/** Crypto trade press, only for the crypto assets. */
export const CRYPTO_DOMAINS = ["coindesk.com"];
const CRYPTO_KEYS = new Set(["mcbBTC", "mWETH"]);

export const GDELT_DOCS = "https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/";
/** GDELT asks for at most one request every 5 seconds. */
export const gdeltLimiter = new RateLimiter(5_500);
export const WIRE_WINDOW_DAYS = 7;
export const MAX_WIRE = 8;

/**
 * Topic queries per asset, plus "market" for the market-wide input, in GDELT query syntax. GDELT
 * refuses long queries ("Your query was too short or too long", seen 2026-11-20 with all twelve
 * domains in the query), so each query names only the main outlets (`QUERY_DOMAINS`) and stays
 * under `MAX_GDELT_QUERY` characters; the full whitelist is still enforced in code.
 */
export const GDELT_TOPICS: Record<string, string> = {
  mNVDA: 'nvidia (tariffs OR "export controls" OR china OR sanctions)',
  mAAPL: "(apple OR iphone) (tariffs OR china OR antitrust OR lawsuit)",
  mSPX: '("wall street" OR "s&p 500") (tariffs OR fed OR recession OR war)',
  mcbBTC: "bitcoin (regulation OR sec OR etf OR fed OR ban)",
  mWETH: "(ethereum OR ether) (regulation OR sec OR etf)",
  mPAXG: '(gold OR bullion) ("central bank" OR sanctions OR war OR fed)',
  market: '(tariffs OR sanctions OR "federal reserve" OR ceasefire OR invasion)',
};

/** Outlets named inside the GDELT query itself. */
export const QUERY_DOMAINS = ["reuters.com", "apnews.com", "bloomberg.com", "cnbc.com", "ft.com"];
export const MAX_GDELT_QUERY = 200;

const compact = (d: string) => d.replace(/-/g, "");

export function gdeltQuery(key: string): string {
  const domains = [...QUERY_DOMAINS, ...(CRYPTO_KEYS.has(key) ? CRYPTO_DOMAINS : ["wsj.com"])];
  return `${GDELT_TOPICS[key]} (${domains.map((d) => `domainis:${d}`).join(" OR ")})`;
}

export function gdeltUrl(key: string, date: IsoDate): string {
  const start = new Date(Date.parse(`${date}T00:00:00Z`) - WIRE_WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const p = new URLSearchParams({ query: gdeltQuery(key), mode: "artlist", format: "json", maxrecords: "75", sort: "datedesc", startdatetime: `${compact(start)}000000`, enddatetime: `${compact(date)}235959` });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${p}`;
}

/**
 * True when a host name is a whitelisted domain or a subdomain of one: "www.reuters.com" and
 * "uk.reuters.com" pass, "notreuters.com" and "reuters.com.evil.io" do not. A trailing dot is
 * ignored.
 */
export function isReputable(host: string, extra: string[] = []): boolean {
  const d = host.toLowerCase().replace(/\.$/, "");
  return [...REPUTABLE_DOMAINS, ...extra].some((x) => d === x || d.endsWith(`.${x}`));
}

/** Host name of an http(s) link, lowercased, or null when the link does not parse. */
export function linkHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.hostname.toLowerCase().replace(/\.$/, "") : null;
  } catch {
    return null;
  }
}

/** `domain` is the host name of `url` (set by our code, not copied from GDELT). */
export type GdeltArticle = { title: string; url: string; publishedAt: string; domain: string };

/** GDELT artlist JSON: { articles: [{ url, title, seendate: "20261119T143000Z", domain }] }; {} when nothing matches. */
export function parseGdelt(raw: unknown): GdeltArticle[] {
  if (!raw || typeof raw !== "object") throw new Error("GDELT: unexpected shape");
  const arts = (raw as { articles?: unknown }).articles;
  if (arts === undefined) return [];
  if (!Array.isArray(arts)) throw new Error("GDELT: unexpected shape");
  const out: GdeltArticle[] = [];
  for (const a of arts as Record<string, unknown>[]) {
    const m = String(a.seendate ?? "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    const url = safeUrl(a.url);
    const title = feedText(String(a.title ?? ""), LIMITS.title);
    const host = url ? linkHost(url) : null;
    if (!m || !url || !title || !host) continue;
    out.push({ title, url, publishedAt: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`, domain: host });
  }
  return out;
}

/** Lowercased headline without punctuation, to drop the same story syndicated twice. */
const titleKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").slice(0, 70);

/**
 * Headlines from reputable outlets for one asset (or "market") over the last 7 days. GDELT
 * answers HTTP 429 when called too fast; we wait and retry once.
 */
export async function fetchWireNews(key: string, date: IsoDate, deps: DataDeps): Promise<{ items: NewsItem[]; problems: string[] }> {
  if (!GDELT_TOPICS[key]) return { items: [], problems: [] };
  const url = gdeltUrl(key, date);
  const headers = { "User-Agent": GENERIC_USER_AGENT, Accept: "application/json" };
  // The long query URL is left out of the run log.
  const fail = (msg: string) => ({ items: [], problems: [`${key}: news from reputable outlets (GDELT) failed, no reading (${msg.replace(/ (from|for) https?:\/\/\S+/, "")})`] });
  let raw: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      await gdeltLimiter.wait(deps);
      raw = await getJson(deps, url, headers);
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      if (attempt === 0 && /HTTP 429/.test(msg)) {
        await deps.sleep(6_000);
        continue;
      }
      return fail(msg);
    }
  }
  try {
    const extra = CRYPTO_KEYS.has(key) ? CRYPTO_DOMAINS : [];
    const problems: string[] = [];
    const seen = new Set<string>();
    const candidates: FeedItem[] = [];
    const domainOf = new Map<string, string>();
    for (const a of parseGdelt(raw)) {
      // The whitelist is checked on the link's own host name, so a wrong GDELT `domain` cannot let a site in.
      const host = linkHost(a.url);
      if (!host || !isReputable(host, extra)) continue;
      const k = titleKey(a.title);
      if (seen.has(k)) continue;
      seen.add(k);
      domainOf.set(a.url, sanitizeText(host.replace(/^www\./, ""), 60));
      candidates.push({ title: a.title, url: a.url, publishedAt: a.publishedAt, summary: "" });
    }
    const kept = selectNews(candidates, date, deps.now(), problems, `${key} GDELT`, WIRE_WINDOW_DAYS, MAX_WIRE);
    return {
      items: kept.map((it) => ({ title: it.title, url: it.url, publishedAt: it.publishedAt, quote: quoteWords(it.title), sourceName: `${domainOf.get(it.url)} (found through GDELT)`, tags: ["reputable-outlet", ...tagTopics(it.title)] })),
      problems,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "unknown error");
  }
}

// ---------------------------------------------------------------------------------------------
// Official sources
// ---------------------------------------------------------------------------------------------

export const OFFICIAL_FEEDS: PressFeed[] = [
  { name: "Federal Reserve press releases", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { name: "SEC press releases", url: "https://www.sec.gov/news/pressreleases.rss" },
  { name: "US Treasury OFAC recent actions", url: "https://ofac.treasury.gov/system/files/126/ofac.xml" },
];

export const MAX_OFFICIAL = 6;

/** Words that make an official release relevant to an asset. The market input takes them all. */
export const ASSET_KEYWORDS: Record<string, RegExp> = {
  mcbBTC: /\b(bitcoin|crypto\w*|digital assets?|stablecoins?)\b/i,
  mWETH: /\b(ether|ethereum|crypto\w*|digital assets?|stablecoins?)\b/i,
  mNVDA: /\b(nvidia|semiconductors?|chips?|export controls?)\b/i,
  mAAPL: /\b(apple)\b/i,
  mPAXG: /\b(gold|precious metals?)\b/i,
  mSPX: /\b(federal open market committee|fomc|monetary policy|equity markets?)\b/i,
};

/**
 * Official releases over the last 7 days, for one asset (filtered by its keywords) or for the
 * market (`key` "market": all of them). A failed feed is a problem line on the market input;
 * the asset input reuses the same responses through the run cache.
 */
export async function fetchOfficialNews(key: string, date: IsoDate, deps: DataDeps): Promise<{ items: NewsItem[]; problems: string[] }> {
  const problems: string[] = [];
  const kw = key === "market" ? null : ASSET_KEYWORDS[key];
  if (key !== "market" && !kw) return { items: [], problems };
  const all: NewsItem[] = [];
  for (const feed of OFFICIAL_FEEDS) {
    try {
      await feedLimiter.wait(deps);
      const xml = await getText(deps, feed.url, { "User-Agent": GENERIC_USER_AGENT, Accept: FEED_ACCEPT });
      const parsed = parseFeed(xml).filter((it) => !kw || kw.test(`${it.title} ${it.summary}`));
      for (const it of selectNews(parsed, date, deps.now(), problems, `${key} ${feed.name}`, WIRE_WINDOW_DAYS, MAX_OFFICIAL)) {
        all.push({ title: it.title, url: it.url, publishedAt: it.publishedAt, quote: quoteWords(it.summary || it.title), sourceName: feed.name, tags: ["official", ...tagTopics(`${it.title} ${it.summary}`)] });
      }
    } catch (e) {
      if (key === "market") problems.push(`${feed.name} feed failed, no reading (${e instanceof Error ? e.message : "unknown error"})`);
    }
  }
  all.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { items: all.slice(0, MAX_OFFICIAL), problems };
}

/** Turns headlines into facts "news.0", "news.1", ... newest first, dropping repeated links. */
export function newsFacts(items: NewsItem[]): Fact[] {
  const seen = new Set<string>();
  return [...items]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .filter((it) => (seen.has(it.url) ? false : (seen.add(it.url), true)))
    .map((it, i) => ({
      id: `news.${i}`,
      kind: "news" as const,
      label: it.title,
      value: it.title,
      source: { name: sanitizeText(it.sourceName, LIMITS.source), url: it.url },
      asOf: it.publishedAt,
      quote: it.quote,
      tags: [...new Set(it.tags)],
    }));
}
