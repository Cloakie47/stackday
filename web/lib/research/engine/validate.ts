import { CHART_INTERVALS, VIEWS, type ResearchNote, type ResearchSnapshot, type WeeklyReport } from "../types.ts";
import { universeAsset } from "../universe.ts";

/**
 * Shape checks for finished notes, snapshots and weekly reports: the whole-run check before
 * anything is written, the check on rows read back from the database, and the test on the sample
 * files. Each returns a list of problems in plain words (empty means valid).
 */

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (x: unknown) => typeof x === "string" && DATE.test(x);
const isTime = (x: unknown) => typeof x === "string" && Number.isFinite(Date.parse(x));
const CONF = ["low", "medium", "high"];
const pos = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x > 0;

function factIds(facts: unknown, p: (s: string) => string, out: string[]): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(facts)) {
    out.push(p("facts missing"));
    return ids;
  }
  for (const f of facts) {
    if (!isObject(f) || typeof f.id !== "string" || typeof f.label !== "string" || !isObject(f.source) || typeof f.source.name !== "string" || !isTime(f.asOf))
      out.push(p("bad fact"));
    else if (ids.has(f.id)) out.push(p(`duplicate fact ${f.id}`));
    else ids.add(f.id);
  }
  return ids;
}

function reasonedProblems(x: unknown, where: string, ids: Set<string>, needIds = true): string[] {
  if (!isObject(x) || typeof x.text !== "string" || !Array.isArray(x.factIds)) return [`${where}: not a reasoned item`];
  const out: string[] = [];
  if (!x.text.trim()) out.push(`${where}: empty text`);
  if (needIds && x.factIds.length === 0) out.push(`${where}: cites no fact`);
  for (const id of x.factIds) if (typeof id !== "string" || !ids.has(id)) out.push(`${where}: cites unknown fact ${String(id)}`);
  return out;
}

function listProblems(x: unknown, where: string, ids: Set<string>): string[] {
  if (!Array.isArray(x)) return [`${where} missing`];
  return x.flatMap((r, i) => reasonedProblems(r, `${where}[${i}]`, ids));
}

export function levelsProblems(l: unknown, where: string): string[] {
  if (l === null) return [];
  if (!isObject(l) || !pos(l.invalidation) || typeof l.basis !== "string" || !Array.isArray(l.support) || !Array.isArray(l.resistance))
    return [`${where}: bad levels`];
  if (![...l.support, ...l.resistance].every(pos)) return [`${where}: bad support or resistance`];
  if (l.buyZone !== null) {
    if (!isObject(l.buyZone) || !pos(l.buyZone.low) || !pos(l.buyZone.high)) return [`${where}: bad buy zone`];
    if ((l.buyZone.low as number) > (l.buyZone.high as number)) return [`${where}: buy zone out of order`];
    if ((l.invalidation as number) >= (l.buyZone.low as number)) return [`${where}: invalidation not below the buy zone`];
  }
  return [];
}

export function noteProblems(n: unknown): string[] {
  if (!isObject(n)) return ["note is not an object"];
  const id = typeof n.assetId === "string" ? n.assetId : "?";
  const p = (s: string) => `${id}: ${s}`;
  const out: string[] = [];
  if (!universeAsset(id)) out.push(p("not in the research universe"));
  if (!isDate(n.date)) out.push(p("bad date"));
  if (!isTime(n.generatedAt) || !isTime(n.dataAsOf)) out.push(p("bad time"));
  if (!["ok", "no-reading", "carried"].includes(n.status as string)) out.push(p("bad status"));
  if (typeof n.summary !== "string" || n.summary.length > 420) out.push(p("summary missing or over 420 characters"));
  if (!(VIEWS as readonly string[]).includes(n.view as string)) out.push(p("bad view"));
  if (n.previousView !== undefined && !(VIEWS as readonly string[]).includes(n.previousView as string)) out.push(p("bad previous view"));
  if (!CONF.includes(n.conviction as string)) out.push(p("bad conviction"));
  const ids = factIds(n.facts, p, out);
  out.push(...listProblems(n.reasons, p("reasons"), ids), ...listProblems(n.risks, p("risks"), ids));
  if (n.status === "ok" && Array.isArray(n.reasons) && n.reasons.length === 0) out.push(p("ok note without reasons"));
  out.push(...levelsProblems(n.levels, p("levels")));
  if (!isObject(n.chart)) out.push(p("chart missing"));
  if (!isObject(n.model) || typeof n.model.triage !== "string") out.push(p("model missing"));
  return out;
}

export function marketProblems(m: unknown, where = "market"): string[] {
  if (!isObject(m) || typeof m.summary !== "string" || !Array.isArray(m.developments)) return [`${where}: bad overview`];
  const out: string[] = [];
  const ids = factIds(m.facts, (s) => `${where}: ${s}`, out);
  out.push(...listProblems(m.developments, `${where} developments`, ids));
  return out;
}

export function snapshotProblems(s: unknown): string[] {
  if (!isObject(s)) return ["snapshot is not an object"];
  const out: string[] = [];
  if (s.kind !== "live" && s.kind !== "sample") out.push("bad kind");
  if (!isDate(s.date)) out.push("bad date");
  if (!isTime(s.generatedAt)) out.push("bad generatedAt");
  if (typeof s.runId !== "string" || !s.runId) out.push("bad runId");
  out.push(...marketProblems(s.market));
  if (!Array.isArray(s.notes)) return [...out, "notes missing"];
  const seen = new Set<string>();
  for (const n of s.notes) {
    out.push(...noteProblems(n));
    const id = isObject(n) ? String(n.assetId) : "?";
    if (seen.has(id)) out.push(`${id}: duplicate note`);
    seen.add(id);
  }
  return out;
}

function scenarioProblems(x: unknown, where: string, ids: Set<string>, ok: boolean): string[] {
  const out = reasonedProblems(x, where, ids, ok);
  if (!isObject(x)) return out;
  if (typeof x.probability !== "number" || x.probability < 0 || x.probability > 100) out.push(`${where}: bad probability`);
  if (!Array.isArray(x.levels) || !x.levels.every(pos)) out.push(`${where}: bad levels`);
  if (typeof x.trigger !== "string") out.push(`${where}: bad trigger`);
  return out;
}

export function sectionProblems(a: unknown): string[] {
  if (!isObject(a)) return ["section is not an object"];
  const id = typeof a.assetId === "string" ? a.assetId : "?";
  const p = (s: string) => `${id}: ${s}`;
  const out: string[] = [];
  if (!universeAsset(id)) out.push(p("not in the research universe"));
  if (a.status !== "ok" && a.status !== "no-reading") out.push(p("bad status"));
  const ok = a.status === "ok";
  const ids = factIds(a.facts, p, out);
  for (const k of ["recap", "market", "news"]) out.push(...listProblems(a[k], p(k), ids));
  if (!isObject(a.chart)) out.push(p("chart missing"));
  else
    for (const i of CHART_INTERVALS) {
      const c = a.chart[i];
      if (c === undefined) continue;
      if (!isObject(c) || !Array.isArray(c.support) || !Array.isArray(c.resistance) || !Array.isArray(c.patterns)) out.push(p(`chart ${i}: bad read`));
      else out.push(...listProblems(c.text, p(`chart ${i} text`), ids));
    }
  if (!Array.isArray(a.weekAhead)) out.push(p("weekAhead missing"));
  if (!isObject(a.scenarios)) out.push(p("scenarios missing"));
  else {
    let sum = 0;
    for (const k of ["bull", "base", "bear"]) {
      out.push(...scenarioProblems(a.scenarios[k], p(`scenario ${k}`), ids, ok));
      const s = a.scenarios[k];
      if (isObject(s) && typeof s.probability === "number") sum += s.probability;
    }
    if (ok && sum !== 100) out.push(p(`scenario probabilities add up to ${sum}, not 100`));
  }
  if (!isObject(a.view)) out.push(p("view missing"));
  else {
    const v = a.view;
    if (!(VIEWS as readonly string[]).includes(v.view as string)) out.push(p("bad view"));
    if (!CONF.includes(v.conviction as string)) out.push(p("bad conviction"));
    out.push(...levelsProblems(v.levels, p("view levels")), ...listProblems(v.reasons, p("view reasons"), ids));
    if (ok && Array.isArray(v.reasons) && v.reasons.length === 0) out.push(p("ok section without view reasons"));
  }
  if (!isObject(a.borrowing) || typeof a.borrowing.text !== "string" || !pos(a.borrowing.lltv)) out.push(p("bad borrowing note"));
  if (a.debate !== undefined) {
    if (!isObject(a.debate)) out.push(p("bad debate"));
    else out.push(...listProblems(a.debate.bull, p("debate bull"), ids), ...listProblems(a.debate.bear, p("debate bear"), ids));
  }
  return out;
}

export function weeklyProblems(r: unknown): string[] {
  if (!isObject(r)) return ["report is not an object"];
  const out: string[] = [];
  if (r.kind !== "live" && r.kind !== "sample") out.push("bad kind");
  if (!isDate(r.weekOf)) out.push("bad weekOf");
  else if (new Date(`${r.weekOf}T12:00:00Z`).getUTCDay() !== 1) out.push("weekOf is not a Monday");
  if (!isTime(r.generatedAt)) out.push("bad generatedAt");
  if (typeof r.runId !== "string" || !r.runId) out.push("bad runId");
  if (typeof r.beta !== "boolean") out.push("bad beta");
  if (typeof r.disclaimer !== "string" || !r.disclaimer) out.push("disclaimer missing");
  out.push(...marketProblems(r.market));
  if (!Array.isArray(r.assets)) return [...out, "assets missing"];
  const seen = new Set<string>();
  for (const a of r.assets) {
    out.push(...sectionProblems(a));
    const id = isObject(a) ? String(a.assetId) : "?";
    if (seen.has(id)) out.push(`${id}: duplicate section`);
    seen.add(id);
  }
  if (!isObject(r.ideas) || !Array.isArray(r.ideas.ranked) || !Array.isArray(r.ideas.exampleSplits)) out.push("bad ideas");
  else {
    for (const sp of r.ideas.exampleSplits) {
      if (!isObject(sp) || !Array.isArray(sp.slices)) {
        out.push("bad example split");
        continue;
      }
      const total = (sp.slices as { share: number }[]).reduce((s, x) => s + (x.share ?? 0), 0);
      if (sp.slices.length && Math.abs(total - 1) > 1e-6) out.push(`example split ${String(sp.profile)} adds up to ${total}, not 1`);
    }
  }
  if (r.scorecard !== null && (!isObject(r.scorecard) || !Array.isArray(r.scorecard.rows) || !Array.isArray(r.scorecard.calibration))) out.push("bad scorecard");
  if (!isObject(r.review) || typeof r.review.approved !== "boolean" || typeof r.review.sentBack !== "number" || typeof r.review.removedClaims !== "number")
    out.push("bad review");
  if (!isObject(r.model) || typeof r.model.analysts !== "string" || typeof r.model.editor !== "string") out.push("bad model");
  return out;
}

export const isSnapshot = (s: unknown): s is ResearchSnapshot => snapshotProblems(s).length === 0;
export const isNote = (n: unknown): n is ResearchNote => noteProblems(n).length === 0;
export const isWeeklyReport = (r: unknown): r is WeeklyReport => weeklyProblems(r).length === 0;
