import { createHash } from "node:crypto";
import { sanitizeText } from "../../themes/mood.ts";
import type { AssetResearchInput, CalendarEvent, ChartInterval, ChartRead, Fact, FactKind, MarketResearchInput } from "../types.ts";
import { CHART_INTERVALS } from "../types.ts";

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
  /<\/?(untrusted_news|system|assistant|user|instructions?)>/i,
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
 * injection removed. Returns the kept facts plus the ids that were screened out.
 */
export function prepareFacts(facts: Fact[]): { facts: Fact[]; screened: string[] } {
  const seen = new Set<string>();
  const kept: Fact[] = [];
  const screened: string[] = [];
  for (const f of facts) {
    if (!f || typeof f.id !== "string" || !ID_RE.test(f.id) || seen.has(f.id)) continue;
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
    kept.push({ ...f, label, value, ...(quote === undefined ? {} : { quote }) });
  }
  return { facts: kept, screened };
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
  if (!has("px.1d.last") && Number.isFinite(daily.last) && daily.last > 0)
    facts.push({ id: "px.1d.last", kind: "price", label: "Last daily close", value: daily.last, unit: "USD", source: series.source, asOf });
  if (!has("ind.1d.atr14") && typeof daily.atr14 === "number" && Number.isFinite(daily.atr14) && daily.atr14 > 0)
    facts.push({ id: "ind.1d.atr14", kind: "indicator", label: "Average true range, 14 daily bars", value: daily.atr14, unit: "USD", source: series.source, asOf });
  return facts;
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
  return `[${f.id}] ${f.kind} | ${f.label}: ${f.value}${unit} | source: ${sanitizeText(f.source?.name ?? "unknown", 80)} | as of ${f.asOf}${tags}${quote}`;
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
export function patternFacts(chart: Partial<Record<ChartInterval, ChartRead>>, existing: Fact[]): Fact[] {
  const have = new Set(existing.map((f) => f.id));
  const out: Fact[] = [];
  for (const c of Object.values(chart)) {
    for (const p of c?.patterns ?? []) {
      if (have.has(p.id)) continue;
      have.add(p.id);
      out.push({ id: p.id, kind: "pattern", label: `${p.kind} on ${p.interval} bars (${p.direction}, ${p.confidence} confidence)`, value: p.detail, source: { name: "Stackday pattern detection (code)" }, asOf: p.asOf });
    }
  }
  return out;
}

const canonical = (x: unknown): unknown =>
  Array.isArray(x) ? x.map(canonical) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : x;

/** Short sha256 of the inputs, logged with the run so a report can be reproduced. */
export function hashInputs(inputs: (AssetResearchInput | MarketResearchInput | null)[]): string {
  return createHash("sha256").update(JSON.stringify(canonical(inputs))).digest("hex").slice(0, 32);
}

export function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}
