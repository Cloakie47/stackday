import type { Fact, IsoDate } from "../types.ts";
import type { UniverseAsset } from "../universe.ts";
import { LIMITS, safeUrl, sanitizeText } from "../../themes/mood.ts";
import { GENERIC_USER_AGENT, RateLimiter, getJson, getText, type DataDeps } from "./deps.ts";

/**
 * Primary-source news for the research run, turned into `Fact`s. Server-only. No scraping:
 *
 * - SEC EDGAR submissions API (https://data.sec.gov/submissions/CIK##########.json) for the
 *   company's own filings. SEC asks automated clients to declare a User-Agent with a contact;
 *   we send SEC_USER_AGENT (set by the founder) and skip EDGAR when it is missing. Requests are
 *   spaced to stay under SEC's "max request rate: 10 requests/second".
 * - Company press-release RSS or Atom feeds that the company publishes for subscribers.
 *
 * Feed text is untrusted. It is sanitized with the Themes guard (`sanitizeText`, `safeUrl` from
 * lib/themes/mood.ts), cut to a quote of at most 25 words copied from the source, and an item that
 * looks like it carries instructions for an AI is dropped and reported in `problems`.
 */

export const SEC_USER_AGENT_ENV = "SEC_USER_AGENT";
export const EDGAR_SOURCE_NAME = "SEC EDGAR";
export const EDGAR_API_DOCS = "https://www.sec.gov/search-filings/edgar-application-programming-interfaces";
/** About 8 requests per second at most, under SEC's 10 per second. */
export const secLimiter = new RateLimiter(125);
const feedLimiter = new RateLimiter(500);

const DAY = 86_400_000;
export const NEWS_WINDOW_DAYS = 30;
export const FILING_WINDOW_DAYS = 120;
export const MAX_NEWS = 5;
export const MAX_FILINGS = 5;

export type PressFeed = { name: string; url: string };

/**
 * Official newsroom feeds, checked 2026-11-19 (HTTP 200 with RSS or Atom). Tesla, Strategy and
 * Alphabet investor relations have no working public feed, so they rely on EDGAR 8-K filings.
 */
export const PRESS_FEEDS: Record<string, PressFeed> = {
  mAAPL: { name: "Apple Newsroom", url: "https://www.apple.com/newsroom/rss-feed.rss" },
  mNVDA: { name: "NVIDIA Newsroom", url: "https://nvidianews.nvidia.com/releases.xml" },
  mMSFT: { name: "Microsoft News Center", url: "https://news.microsoft.com/feed/" },
  mMETA: { name: "Meta Newsroom", url: "https://about.fb.com/news/feed/" },
  mGOOGL: { name: "Google Blog (The Keyword)", url: "https://blog.google/rss/" },
  mAMZN: { name: "About Amazon", url: "https://www.aboutamazon.com/rss/feed.rss" },
  mAMD: { name: "AMD Investor Relations press releases", url: "https://ir.amd.com/news-events/press-releases/rss" },
};

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

/** Phrases that address an AI model rather than a reader. Such items get zero weight: dropped. */
const INJECTION = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts?)/i,
  /disregard (all |any )?(previous|prior|above)/i,
  /system prompt/i,
  /you are (an? )?(ai|language model|assistant|chatbot)/i,
  /\b(assistant|ai|model|llm)\s*[:,]\s*(please )?(say|output|rate|respond|reply|recommend)/i,
  /<\/?(system|assistant|user|instructions?)>/i,
  /\bjailbreak\b/i,
];

export const looksLikeInjection = (s: string) => INJECTION.some((re) => re.test(s));

/** The first `max` words of already-sanitized text: still a verbatim copy, only shortened. */
export function quoteWords(text: string, max: number = LIMITS.quoteWords): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const q = words.slice(0, max).join(" ");
  return Array.from(q).length > LIMITS.quoteChars ? Array.from(q).slice(0, LIMITS.quoteChars).join("").trimEnd() : q;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodes the XML/HTML entities that appear in feeds. Unknown named entities are left as is. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text content of feed markup: CDATA unwrapped, tags removed, entities decoded, then sanitized. */
export function feedText(raw: string | undefined, max: number): string {
  if (!raw) return "";
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Entity-encoded HTML inside RSS descriptions: decode once, then strip the tags it revealed.
  s = decodeEntities(s.replace(/<[^>]*>/g, " "));
  s = s.replace(/<[^>]*>/g, " ");
  return sanitizeText(s, max);
}

// ---------------------------------------------------------------------------------------------
// RSS and Atom
// ---------------------------------------------------------------------------------------------

export type FeedItem = { title: string; url: string; publishedAt: string; summary: string };

const tag = (block: string, name: string): string | undefined => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*?)?(?<!/)>([\\s\\S]*?)</${name}>`, "i"));
  return m?.[1];
};

function atomLink(block: string): string | undefined {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  for (const attrs of links) {
    const rel = attrs.match(/\brel\s*=\s*["']([^"']*)["']/i)?.[1];
    const href = attrs.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1];
    if (href && (!rel || rel === "alternate")) return decodeEntities(href);
  }
  return undefined;
}

/**
 * Parses RSS 2.0 `<item>` and Atom `<entry>` blocks with plain string matching (no XML library,
 * no entity expansion, no external fetches). Items without a safe http(s) link or a valid date
 * are skipped.
 */
export function parseFeed(xml: string): FeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const out: FeedItem[] = [];
  for (const b of blocks) {
    const title = feedText(tag(b, "title"), LIMITS.title);
    const rawLink = tag(b, "link");
    const link = rawLink && !/^\s*$/.test(rawLink) ? feedText(rawLink, LIMITS.url + 1) : atomLink(b);
    const url = safeUrl(link);
    const dateRaw = feedText(tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date"), 80);
    const ms = Date.parse(dateRaw);
    const summary = feedText(tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content"), 2000);
    if (!title || !url || !Number.isFinite(ms)) continue;
    out.push({ title, url, publishedAt: new Date(ms).toISOString(), summary });
  }
  return out;
}

/** Newest first, inside [date - window, now], with injection-looking items removed. */
export function selectNews(items: FeedItem[], date: IsoDate, now: Date, problems: string[], label: string): FeedItem[] {
  const end = Math.min(now.getTime(), Date.parse(`${date}T23:59:59Z`));
  const start = Date.parse(`${date}T00:00:00Z`) - NEWS_WINDOW_DAYS * DAY;
  const kept: FeedItem[] = [];
  for (const it of items) {
    const t = Date.parse(it.publishedAt);
    if (t < start || t > end) continue;
    if (looksLikeInjection(`${it.title} ${it.summary}`)) {
      problems.push(`${label}: dropped a feed item that looked like instructions to an AI (${it.url})`);
      continue;
    }
    kept.push(it);
  }
  return kept.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, MAX_NEWS);
}

export async function fetchPressNews(asset: UniverseAsset, date: IsoDate, deps: DataDeps): Promise<{ facts: Fact[]; problems: string[] }> {
  const feed = PRESS_FEEDS[asset.assetId];
  if (!feed) return { facts: [], problems: [] };
  const problems: string[] = [];
  try {
    await feedLimiter.wait(deps);
    const xml = await getText(deps, feed.url, { "User-Agent": GENERIC_USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" });
    const items = selectNews(parseFeed(xml), date, deps.now(), problems, `${asset.assetId} ${feed.name}`);
    const facts: Fact[] = items.map((it, i) => ({
      id: `news.${i}`,
      kind: "news",
      label: it.title,
      value: it.title,
      source: { name: feed.name, url: it.url },
      asOf: it.publishedAt,
      quote: quoteWords(it.summary || it.title),
    }));
    return { facts, problems };
  } catch (e) {
    return { facts: [], problems: [`${asset.assetId}: ${feed.name} feed failed (${e instanceof Error ? e.message : "unknown error"})`] };
  }
}

// ---------------------------------------------------------------------------------------------
// SEC EDGAR
// ---------------------------------------------------------------------------------------------

/** Filing types worth a research note. Insider forms (3, 4, 5) and routine exhibits are left out. */
export const FORM_LABEL: Record<string, string> = {
  "10-K": "Annual report (10-K)",
  "10-K/A": "Amended annual report (10-K/A)",
  "10-Q": "Quarterly report (10-Q)",
  "10-Q/A": "Amended quarterly report (10-Q/A)",
  "8-K": "Current report (8-K)",
  "8-K/A": "Amended current report (8-K/A)",
  "DEF 14A": "Proxy statement (DEF 14A)",
  "S-1": "Registration statement (S-1)",
  "S-3": "Registration statement (S-3)",
  "424B5": "Prospectus (424B5)",
  "SC 13D": "Ownership report (SC 13D)",
  "SC 13G": "Ownership report (SC 13G)",
};

/** Item titles exactly as Form 8-K names them, so the quote is the SEC's own wording. */
export const FORM_8K_ITEMS: Record<string, string> = {
  "1.01": "Entry into a Material Definitive Agreement",
  "1.02": "Termination of a Material Definitive Agreement",
  "1.03": "Bankruptcy or Receivership",
  "1.05": "Material Cybersecurity Incidents",
  "2.01": "Completion of Acquisition or Disposition of Assets",
  "2.02": "Results of Operations and Financial Condition",
  "2.03": "Creation of a Direct Financial Obligation or an Obligation under an Off-Balance Sheet Arrangement of a Registrant",
  "2.04": "Triggering Events That Accelerate or Increase a Direct Financial Obligation",
  "2.05": "Costs Associated with Exit or Disposal Activities",
  "2.06": "Material Impairments",
  "3.01": "Notice of Delisting or Failure to Satisfy a Continued Listing Rule or Standard; Transfer of Listing",
  "3.02": "Unregistered Sales of Equity Securities",
  "3.03": "Material Modification to Rights of Security Holders",
  "4.01": "Changes in Registrant's Certifying Accountant",
  "4.02": "Non-Reliance on Previously Issued Financial Statements",
  "5.01": "Changes in Control of Registrant",
  "5.02": "Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers; Compensatory Arrangements of Certain Officers",
  "5.03": "Amendments to Articles of Incorporation or Bylaws; Change in Fiscal Year",
  "5.07": "Submission of Matters to a Vote of Security Holders",
  "7.01": "Regulation FD Disclosure",
  "8.01": "Other Events",
  "9.01": "Financial Statements and Exhibits",
};

export type Filing = {
  form: string;
  filingDate: IsoDate;
  acceptedAt?: string;
  reportDate?: string;
  items: string[];
  url: string;
  description?: string;
};

export const edgarSubmissionsUrl = (cik: string) => `https://data.sec.gov/submissions/CIK${cik.replace(/\D/g, "").padStart(10, "0")}.json`;

/** Reads `filings.recent` from an EDGAR submissions response (column arrays, newest first). */
export function parseSubmissions(raw: unknown, cik: string): Filing[] {
  const recent = (raw as { filings?: { recent?: Record<string, unknown[]> } })?.filings?.recent;
  if (!recent || !Array.isArray(recent.accessionNumber) || !Array.isArray(recent.form)) throw new Error("EDGAR: unexpected submissions shape");
  const col = (k: string, i: number) => {
    const a = recent[k];
    return Array.isArray(a) && a[i] !== undefined && a[i] !== null ? String(a[i]) : "";
  };
  const cikNum = String(Number(cik.replace(/\D/g, "")));
  const out: Filing[] = [];
  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const form = col("form", i);
    if (!(form in FORM_LABEL)) continue;
    const acc = col("accessionNumber", i);
    const doc = col("primaryDocument", i);
    if (!/^\d{10}-\d{2}-\d{6}$/.test(acc)) continue;
    const folder = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc.replace(/-/g, "")}`;
    const url = safeUrl(doc && /^[\w.\-]+$/.test(doc) ? `${folder}/${doc}` : `${folder}/${acc}-index.htm`);
    const filingDate = col("filingDate", i);
    if (!url || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate)) continue;
    out.push({
      form,
      filingDate,
      acceptedAt: col("acceptanceDateTime", i) || undefined,
      reportDate: col("reportDate", i) || undefined,
      items: col("items", i).split(",").map((s) => s.trim()).filter(Boolean),
      url,
      description: col("primaryDocDescription", i) || undefined,
    });
  }
  return out;
}

export function filingFact(f: Filing, i: number): Fact {
  const itemTitles = f.items.map((it) => FORM_8K_ITEMS[it]).filter(Boolean);
  const label = `${FORM_LABEL[f.form] ?? f.form} filed ${f.filingDate}${f.items.length ? ` (items ${f.items.join(", ")})` : ""}`;
  const quoteSrc = itemTitles.length ? itemTitles.join("; ") : f.reportDate ? `${f.form} for the period ending ${f.reportDate}` : (f.description ?? f.form);
  const accepted = f.acceptedAt && Number.isFinite(Date.parse(f.acceptedAt)) ? new Date(f.acceptedAt).toISOString() : `${f.filingDate}T00:00:00.000Z`;
  return {
    id: `filing.${i}`,
    kind: "filing",
    label: sanitizeText(label, LIMITS.label),
    value: f.form,
    source: { name: EDGAR_SOURCE_NAME, url: f.url },
    asOf: accepted,
    quote: quoteWords(sanitizeText(quoteSrc, 2000)),
  };
}

export async function fetchFilings(asset: UniverseAsset, date: IsoDate, deps: DataDeps): Promise<{ facts: Fact[]; problems: string[] }> {
  if (!asset.cik) return { facts: [], problems: [] };
  const ua = deps.env[SEC_USER_AGENT_ENV]?.trim();
  if (!ua) return { facts: [], problems: [`${asset.assetId}: ${SEC_USER_AGENT_ENV} not set, SEC filings skipped`] };
  try {
    await secLimiter.wait(deps);
    const raw = await getJson(deps, edgarSubmissionsUrl(asset.cik), { "User-Agent": ua, Accept: "application/json" });
    const end = Date.parse(`${date}T23:59:59Z`);
    const start = end - FILING_WINDOW_DAYS * DAY;
    const filings = parseSubmissions(raw, asset.cik)
      .filter((f) => {
        const t = Date.parse(`${f.filingDate}T12:00:00Z`);
        return t >= start && t <= end;
      })
      .slice(0, MAX_FILINGS);
    return { facts: filings.map(filingFact), problems: [] };
  } catch (e) {
    return { facts: [], problems: [`${asset.assetId}: SEC EDGAR failed (${e instanceof Error ? e.message : "unknown error"})`] };
  }
}
