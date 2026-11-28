import { createHash } from "node:crypto";
import { sanitizeText } from "../../themes/mood.ts";
import type { AssetResearchInput, CalendarEvent, Certainty, ChartInterval, ChartRead, Fact, FactKind } from "../types.ts";
import { CERTAINTIES, CHART_INTERVALS, isDisplayable, lowerCertainty, newsCertainty } from "../types.ts";

/**
 * Facts as the model sees them. Facts are made by code (web/lib/research/data) with a source and a
 * time; this module only cleans them, screens untrusted text and writes them out as lines.
 *
 * News and filing text is untrusted: it is cleaned (sanitizeText), cut short, screened for obvious
 * injection phrases (`looksLikeInjection`) and sent inside a marked <untrusted_news> block that the
 * instructions tell the model to treat as data only. Screened items are never sent and never citable.
 */

export const FACT_LIMITS = { label: 160, quote: 300, sentPerCall: 80 } as const;

const INJECTION = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions|rules|prompts?)/i,
  /disregard (all |any |the )?(previous|prior|above|earlier)/i,
  /\b(system|developer) (prompt|message|instructions?)\b/i,
  /\byou are (now )?(an?|the) (ai|assistant|model|language model)\b/i,
  /\b(as an ai|chatgpt|claude|llm)\b/i,
  // Tag-like text in any spacing or case (</untrusted_news >, < /UNTRUSTED_NEWS>, <system foo>), and
  // any mention of our block names at all.
  /<\s*\/?\s*(untrusted[\s_-]*\w*|system|assistant|user|human|instructions?)\b[^<>]*>/i,
  /\buntrusted[\s_-]*(news|notes)\b/i,
  /\b(respond|reply|answer|output) (only )?(with|in) (json|the following)\b/i,
  /\b(set|change) (the )?(view|action|rating|recommendation|conviction|probability) to\b/i,
];

/** Cheap code-side screen run before the model sees anything. */
export function looksLikeInjection(text: string): boolean {
  return INJECTION.some((re) => re.test(text));
}

export const isUntrusted = (f: Fact) => f.kind === "news" || f.kind === "filing";
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

/**
 * The facts the model may cite: valid ids, unique, cleaned text, untrusted items that look like an
 * injection removed. Returns the kept facts plus the ids that were screened out. Facts whose source
 * terms do not allow showing them (`display: false` on the fact or its source) are dropped here, so
 * they never reach a model or anything built from model answers.
 */
export function prepareFacts(facts: Fact[]): { facts: Fact[]; screened: string[]; restricted: string[] } {
  const seen = new Set<string>();
  const kept: Fact[] = [];
  const screened: string[] = [];
  const restricted: string[] = [];
  for (const f of facts) {
    if (!f || typeof f.id !== "string" || !ID_RE.test(f.id) || seen.has(f.id)) continue;
    if (!isDisplayable(f)) {
      restricted.push(f.id);
      continue;
    }
    if (!f.source || typeof f.source.name !== "string" || !Number.isFinite(Date.parse(f.asOf))) continue;
    seen.add(f.id);
    const label = sanitizeText(String(f.label ?? ""), FACT_LIMITS.label);
    const quote = f.quote === undefined ? undefined : sanitizeText(f.quote, FACT_LIMITS.quote);
    const value = typeof f.value === "number" ? f.value : sanitizeText(String(f.value ?? ""), FACT_LIMITS.label);
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    if (isUntrusted(f) && looksLikeInjection(`${label} ${value} ${quote ?? ""}`)) {
      screened.push(f.id);
      continue;
    }
    const certainty = codeCertainty(f, label);
    kept.push({ ...f, label, value, ...(quote === undefined ? {} : { quote }), ...(certainty ? { certainty } : {}) });
  }
  return { facts: kept, screened, restricted };
}

/**
 * The catalyst label of a fact, set in code (backstop for facts the data layer did not label):
 * filings and calendar facts are confirmed (SEC EDGAR, official calendars and published schedules);
 * news keeps its label, or gets one from its source tag and wording (`newsCertainty`, never
 * "confirmed" without an official or press-release tag). Other kinds have no label.
 */
export function codeCertainty(f: Fact, label = f.label): Certainty | undefined {
  if (f.certainty && (CERTAINTIES as readonly string[]).includes(f.certainty)) return f.certainty;
  if (f.kind === "filing" || f.kind === "calendar") return "confirmed";
  if (f.kind === "news") return newsCertainty(f.tags, label);
  return undefined;
}

/**
 * Applies the news analyst's label proposals: a proposal only counts when it LOWERS the label
 * (confirmed > reported > speculation). An upgrade, a repeat of the current label, an unknown fact
 * id, a fact without a label or a value outside the list is ignored. Returns the new facts and what
 * changed or was ignored, for the review notes.
 */
export function applyCertaintyProposals(facts: Fact[], proposals: { factId: string; certainty: string }[]): { facts: Fact[]; lowered: string[]; ignored: string[] } {
  const want = new Map<string, Certainty>();
  const ignored: string[] = [];
  const byId = new Map(facts.map((f) => [f.id, f]));
  for (const p of proposals) {
    const f = byId.get(p.factId);
    if (!f || !f.certainty || !(CERTAINTIES as readonly string[]).includes(p.certainty)) {
      ignored.push(`${p.factId}: not a labelled fact or not a known label`);
      continue;
    }
    const current = want.get(f.id) ?? f.certainty;
    const next = lowerCertainty(current, p.certainty as Certainty);
    if (next === current) ignored.push(`${f.id}: ${p.certainty} is not lower than ${current}`);
    else want.set(f.id, next);
  }
  const lowered: string[] = [];
  const out = facts.map((f) => {
    const next = want.get(f.id);
    if (!next || !f.certainty) return f;
    lowered.push(`${f.id} ${f.certainty} to ${next}`);
    return { ...f, certainty: next };
  });
  return { facts: out, lowered, ignored };
}

/**
 * "Already priced in?" check for the risk reviewer, computed in code, never by the model: how far
 * the price moved over the last PRICED_IN.bars daily bars, measured in daily ATR14 (from the
 * existing `changePct.bar5`, `last` and `atr14` readings). It FIRES when the move is
 * PRICED_IN.atrMultiple ATR or more either way. Why 3: measured on the recorded Coinbase daily
 * candles in data/fixtures/run.json (BTC and ETH since late 2021, PAXG), the median 5-bar move is
 * about 0.8 ATR and the 90th percentile about 2.4 ATR; 3 ATR or more happens on about 4 to 6
 * percent of days, so it marks a large move only. When it fires, a view reason must say how
 * much of the move may already be in the price and cite this fact (codeIssues in review.ts).
 */
export const PRICED_IN = { bars: 5, atrMultiple: 3, factId: "ind.1d.move5atr" } as const;

export type PricedIn = { fact: Fact; moveAtr: number; fired: boolean };

const round1 = (x: number) => Math.round(x * 10) / 10;
const fmtNum = (x: number) => String(Math.abs(x) >= 1000 ? Math.round(x) : Math.round(x * 100) / 100);

/** The priced-in reading for one input, or null when the 5-bar change, the close or the ATR is missing. */
export function pricedInCheck(input: AssetResearchInput): PricedIn | null {
  const d = input.indicators?.["1d"];
  const ch = d?.changePct?.bar5;
  const last = d?.last;
  const atr = d?.atr14;
  const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  if (!ok(ch) || !ok(last) || !ok(atr) || last <= 0 || atr <= 0 || ch <= -1) return null;
  const move = last - last / (1 + ch);
  const moveAtr = round1(move / atr);
  const series = input.series?.["1d"];
  const px = (input.facts ?? []).find((f) => f.id === "px.1d.last" || f.id === "px.last");
  const asOf = series?.bars?.at(-1)?.t ?? px?.asOf ?? series?.fetchedAt;
  if (!asOf || !Number.isFinite(Date.parse(asOf))) return null;
  const fired = Math.abs(moveAtr) >= PRICED_IN.atrMultiple;
  const dir = move >= 0 ? "up" : "down";
  const fact: Fact = {
    id: PRICED_IN.factId,
    kind: "indicator",
    label: `Move over the last ${PRICED_IN.bars} daily bars in ATR14 units: ${dir} ${fmtNum(Math.abs(move))} USD against a daily ATR14 of ${fmtNum(atr)} (code; priced-in check fires at ${PRICED_IN.atrMultiple} ATR or more)`,
    value: moveAtr,
    unit: "ATR",
    source: series?.source ?? px?.source ?? { name: "Stackday code, from the daily price readings" },
    asOf,
    ...(series?.source?.display === false ? { display: false } : {}),
  };
  return { fact, moveAtr, fired };
}

/** The line the editor, the reviewer and the revision see about the priced-in check. */
export function pricedInLine(p: PricedIn | null): string {
  const head = "PRICED-IN CHECK (computed in code):";
  if (!p) return `${head} no reading (no ${PRICED_IN.bars}-bar change or ATR).`;
  const dir = p.moveAtr >= 0 ? "up" : "down";
  if (!p.fired) return `${head} not fired. The price moved ${dir} ${Math.abs(p.moveAtr)} ATR over the last ${PRICED_IN.bars} daily bars [${p.fact.id}], under the ${PRICED_IN.atrMultiple} ATR threshold.`;
  return `${head} FIRED. The price already moved ${dir} ${Math.abs(p.moveAtr)} ATR over the last ${PRICED_IN.bars} daily bars [${p.fact.id}], at or above the ${PRICED_IN.atrMultiple} ATR threshold. At least one view reason must say how much of this move may already be in the price, and cite [${p.fact.id}].`;
}

/** Facts that may be shown (published reports and public API answers). */
export const displayableFacts = (facts: Fact[] | undefined): Fact[] => (facts ?? []).filter((f) => f && isDisplayable(f));

/**
 * The part of a gathered input that may reach a model and the published report. A price series
 * whose source has `display: false` takes with it everything built from it: its indicators, the
 * chart read of that interval (levels and patterns), and the facts built from them. Restricted facts
 * are removed too. The original input is still logged with the run (internal only).
 */
export function displayableInput(input: AssetResearchInput): { input: AssetResearchInput; withheld: string[] } {
  const withheld: string[] = [];
  const series: AssetResearchInput["series"] = {};
  const indicators: AssetResearchInput["indicators"] = {};
  const chart: AssetResearchInput["chart"] = {};
  for (const [k, s] of Object.entries(input.series ?? {}) as [keyof AssetResearchInput["series"], NonNullable<AssetResearchInput["series"]["1d"]>][]) {
    if (s && s.source?.display === false) withheld.push(`${k} series`);
    else series[k] = s;
  }
  const restrictedInterval = (k: string) => input.series?.[k as keyof AssetResearchInput["series"]]?.source?.display === false;
  for (const [k, v] of Object.entries(input.indicators ?? {}) as [keyof AssetResearchInput["indicators"], NonNullable<AssetResearchInput["indicators"]["1d"]>][]) if (!restrictedInterval(k)) indicators[k] = v;
  for (const i of CHART_INTERVALS) {
    const c = input.chart?.[i];
    if (!c) continue;
    if (restrictedInterval(i)) withheld.push(`${i} chart read`);
    else chart[i] = c;
  }
  const facts = (input.facts ?? []).filter((f) => {
    if (isDisplayable(f)) return true;
    withheld.push(`fact ${f.id}`);
    return false;
  });
  const calendar = (input.calendar ?? []).filter((e) => e.source?.display !== false);
  return { input: { ...input, series, indicators, chart, facts, calendar }, withheld };
}

/** Calendar events as facts, so they can be cited (macro analyst, week ahead). */
export function calendarFacts(events: CalendarEvent[]): Fact[] {
  return events.map((e) => ({
    id: e.id,
    kind: "calendar" as const,
    label: `${e.name} on ${e.date}${e.timeUtc ? ` at ${e.timeUtc} UTC` : ""}`,
    value: e.kind,
    source: e.source,
    asOf: `${e.date}T00:00:00Z`,
    // Events come from official calendars or a published schedule only (CalendarEvent).
    certainty: e.certainty ?? ("confirmed" as const),
  }));
}

/** Code-made price facts every note needs for scoring, added only when the data layer did not send them. */
export function ensurePriceFacts(input: AssetResearchInput): Fact[] {
  const facts = [...(input.facts ?? [])];
  const daily = input.indicators?.["1d"];
  const series = input.series?.["1d"];
  const lastBar = series?.bars?.at(-1);
  const asOf = lastBar?.t ?? series?.fetchedAt;
  if (!daily || !series || !asOf) return facts;
  const has = (id: string) => facts.some((f) => f.id === id);
  // Built from the series, so they inherit its display flag.
  const display = series.source?.display === false ? { display: false } : {};
  if (!has("px.1d.last") && Number.isFinite(daily.last) && daily.last > 0)
    facts.push({ id: "px.1d.last", kind: "price", label: "Last daily close", value: daily.last, unit: "USD", source: series.source, asOf, ...display });
  if (!has("ind.1d.atr14") && typeof daily.atr14 === "number" && Number.isFinite(daily.atr14) && daily.atr14 > 0)
    facts.push({ id: "ind.1d.atr14", kind: "indicator", label: "Average true range, 14 daily bars", value: daily.atr14, unit: "USD", source: series.source, asOf, ...display });
  return facts;
}

/** Oldest last daily close a note may rest on: a long weekend for stocks, two days for crypto. */
export const MAX_PRICE_AGE_DAYS = { stock: 5, crypto: 2 } as const;

/**
 * Why there is no usable price for a note, or null when there is one: no "px.1d.last" fact (for
 * example the price feed was down, or the series is not for display), or one older than
 * MAX_PRICE_AGE_DAYS before the run date. A note must not rest on news alone.
 */
export function priceProblem(facts: Fact[], date: string, crypto: boolean): string | null {
  const px = facts.find((f) => f.id === "px.1d.last" && typeof f.value === "number" && f.value > 0);
  if (!px) return "no price could be read";
  const ageDays = (Date.parse(`${date}T00:00:00Z`) - Date.parse(px.asOf.slice(0, 10) + "T00:00:00Z")) / 86_400_000;
  const max = crypto ? MAX_PRICE_AGE_DAYS.crypto : MAX_PRICE_AGE_DAYS.stock;
  return Number.isFinite(ageDays) && ageDays > max ? `the last price is from ${px.asOf.slice(0, 10)}, too old for ${date}` : null;
}

/** Fact kinds each analyst may see (founder spec section 4.2). */
export const ANALYST_KINDS: Record<"technical" | "macro" | "news" | "fundamentals", FactKind[]> = {
  technical: ["price", "indicator", "pattern"],
  macro: ["macro", "calendar"],
  news: ["news", "filing"],
  fundamentals: ["fundamental", "flow", "filing"],
};

/** News tags that count as geopolitics for the macro and geopolitics analyst. */
export const GEOPOLITICS_TAGS = ["geopolitics", "tariffs", "trade", "export-controls", "sanctions", "conflict", "elections", "regulation"];

export function factsFor(role: keyof typeof ANALYST_KINDS, facts: Fact[]): Fact[] {
  const kinds = ANALYST_KINDS[role];
  return facts.filter(
    (f) => kinds.includes(f.kind) || (role === "macro" && f.kind === "news" && (f.tags ?? []).some((t) => GEOPOLITICS_TAGS.includes(t))),
  );
}

export const factLine = (f: Fact) => {
  const unit = f.unit ? ` ${sanitizeText(f.unit, 16)}` : "";
  const quote = f.quote ? ` | quote: "${f.quote}"` : "";
  const tags = f.tags?.length ? ` | tags: ${f.tags.map((t) => sanitizeText(t, 24)).join(",")}` : "";
  const certainty = f.certainty && (CERTAINTIES as readonly string[]).includes(f.certainty) ? ` | certainty: ${f.certainty}` : "";
  return `[${f.id}] ${f.kind} | ${f.label}: ${f.value}${unit} | source: ${sanitizeText(f.source?.name ?? "unknown", 80)} | as of ${f.asOf}${certainty}${tags}${quote}`;
};

/** Trusted facts first, then untrusted text inside the marked block. Newest untrusted first when cut. */
export function factBlock(facts: Fact[], limit: number = FACT_LIMITS.sentPerCall): string {
  const trusted = facts.filter((f) => !isUntrusted(f));
  const untrusted = facts.filter(isUntrusted).sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf));
  const sent = [...trusted, ...untrusted].slice(0, limit);
  const t = sent.filter((f) => !isUntrusted(f)).map(factLine);
  const u = sent.filter(isUntrusted).map(factLine);
  return ["FACTS:", ...(t.length ? t : ["(none)"]), "", "<untrusted_news>", ...(u.length ? u : ["(none)"]), "</untrusted_news>"].join("\n");
}

/**
 * Text written by earlier model steps after they read the news (analyst notes, the debate, the
 * draft, reviewer notes, our own earlier notes). It may carry an injection forward, so later steps
 * get it inside a marked <untrusted_notes> block, never as trusted instructions. Each item already
 * passed `Ctx.text` (which drops injection-like text); any tag-like text left is removed here too.
 */
export function untrustedNotes(text: string): string {
  const clean = text.replace(/<\s*\/?\s*untrusted[\s_-]*\w*[^<>]*>/gi, "");
  return ["<untrusted_notes>", clean.trim() || "(none)", "</untrusted_notes>"].join("\n");
}

/** Facts actually sent by `factBlock` with the same limit (only these may be cited). */
export function sentFacts(facts: Fact[], limit: number = FACT_LIMITS.sentPerCall): Fact[] {
  const trusted = facts.filter((f) => !isUntrusted(f));
  const untrusted = facts.filter(isUntrusted).sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf));
  return [...trusted, ...untrusted].slice(0, limit);
}

const fmtLevel = (x: number) => String(Math.round(x * 100) / 100);

/** The code chart read written out as lines. The model may describe it, never change it. */
export function chartBlock(chart: Partial<Record<ChartInterval, ChartRead>>): string {
  const lines = ["CHART READ (computed in code):"];
  for (const i of CHART_INTERVALS) {
    const c = chart[i];
    if (!c) {
      lines.push(`${i}: no reading`);
      continue;
    }
    const pos = c.positionInRange === null ? "unknown" : `${Math.round(c.positionInRange * 100)}% of the way from support to resistance`;
    lines.push(
      `${i}: trend ${c.trend}; support ${c.support.map(fmtLevel).join(", ") || "none"}; resistance ${c.resistance.map(fmtLevel).join(", ") || "none"}; position ${pos}; volatility ${c.volatility.regime}; facts ${c.factIds.join(", ") || "none"}`,
    );
    for (const p of c.patterns) lines.push(`  pattern [${p.id}] ${p.kind}, ${p.direction}, confidence ${p.confidence}, invalidation ${fmtLevel(p.invalidation)}, as of ${p.asOf}: ${sanitizeText(p.detail, 160)}`);
  }
  return lines.join("\n");
}

/** Every price level the code chart read contains (allowed in model text and as scenario levels). */
export function chartLevels(chart: Partial<Record<ChartInterval, ChartRead>>): number[] {
  const out: number[] = [];
  for (const c of Object.values(chart)) {
    if (!c) continue;
    out.push(...c.support, ...c.resistance, ...c.patterns.map((p) => p.invalidation));
    if (c.positionInRange !== null) out.push(Math.round(c.positionInRange * 100));
  }
  return out.filter((x) => Number.isFinite(x) && x > 0);
}

/** Pattern ids from the chart read are citable facts too. */
export function patternFacts(chart: Partial<Record<ChartInterval, ChartRead>>, existing: Fact[], series: AssetResearchInput["series"] = {}): Fact[] {
  const have = new Set(existing.map((f) => f.id));
  const out: Fact[] = [];
  for (const c of Object.values(chart)) {
    for (const p of c?.patterns ?? []) {
      if (have.has(p.id)) continue;
      have.add(p.id);
      // Built from that interval's price series, so it inherits the series' display flag.
      const display = series?.[p.interval]?.source?.display === false ? { display: false } : {};
      out.push({ id: p.id, kind: "pattern", label: `${p.kind} on ${p.interval} bars (${p.direction}, ${p.confidence} confidence)`, value: p.detail, source: { name: "Stackday pattern detection (code)", ...display }, asOf: p.asOf, ...display });
    }
  }
  return out;
}

const canonical = (x: unknown): unknown =>
  Array.isArray(x) ? x.map(canonical) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : x;

/** Short sha256 of the inputs, logged with the run so a report can be reproduced. */
export function hashInputs(inputs: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(inputs))).digest("hex").slice(0, 32);
}

export function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}
