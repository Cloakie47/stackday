import { ACTIONS, TIMEFRAMES, type ResearchNote, type ResearchSnapshot } from "../types.ts";
import { universeAsset } from "../universe.ts";
import { LIMITS } from "./prompt.ts";

/**
 * Shape checks for finished notes and snapshots: the whole-run check before anything is written,
 * the check on rows read back from the database, and the test on the sample file.
 * Returns a list of problems in plain words (empty means valid).
 */

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isTime = (x: unknown) => typeof x === "string" && Number.isFinite(Date.parse(x));
const CONF = ["low", "medium", "high"];
const STANCE = ["positive", "neutral", "negative", "no-view"];

function reasonedProblems(x: unknown, where: string, ids: Set<string>, needIds: boolean): string[] {
  if (!isObject(x) || typeof x.text !== "string" || !Array.isArray(x.factIds)) return [`${where}: not a reasoned item`];
  const out: string[] = [];
  if (!x.text.trim()) out.push(`${where}: empty text`);
  if (needIds && x.factIds.length === 0) out.push(`${where}: cites no fact`);
  for (const id of x.factIds) if (typeof id !== "string" || !ids.has(id)) out.push(`${where}: cites unknown fact ${String(id)}`);
  return out;
}

export function noteProblems(n: unknown): string[] {
  if (!isObject(n)) return ["note is not an object"];
  const id = typeof n.assetId === "string" ? n.assetId : "?";
  const p = (s: string) => `${id}: ${s}`;
  const out: string[] = [];
  const asset = universeAsset(id);
  if (!asset) out.push(p("unknown asset"));
  if (typeof n.date !== "string" || !DATE.test(n.date)) out.push(p("bad date"));
  if (!isTime(n.generatedAt) || !isTime(n.dataAsOf)) out.push(p("bad time"));
  if (!["ok", "no-reading", "carried"].includes(n.status as string)) out.push(p("bad status"));
  if (typeof n.summary !== "string" || n.summary.length > LIMITS.summary) out.push(p("summary missing or over 420 characters"));
  if (!(ACTIONS as readonly string[]).includes(n.action as string)) out.push(p("bad action"));
  if (!CONF.includes(n.confidence as string)) out.push(p("bad confidence"));
  if (!Array.isArray(n.facts)) return [...out, p("facts missing")];
  const ids = new Set<string>();
  for (const f of n.facts) {
    if (!isObject(f) || typeof f.id !== "string" || typeof f.label !== "string" || !isObject(f.source) || !isTime(f.asOf)) out.push(p("bad fact"));
    else if (ids.has(f.id)) out.push(p(`duplicate fact ${f.id}`));
    else ids.add(f.id);
  }
  const ok = n.status === "ok";
  for (const key of ["reasons", "opportunities", "risks"] as const) {
    const list = n[key];
    if (!Array.isArray(list)) out.push(p(`${key} missing`));
    else list.forEach((r, i) => out.push(...reasonedProblems(r, p(`${key}[${i}]`), ids, true)));
  }
  if (ok && Array.isArray(n.reasons) && n.reasons.length === 0) out.push(p("ok note without reasons"));
  if (!isObject(n.scenarios)) out.push(p("scenarios missing"));
  else
    for (const k of ["bull", "base", "bear"]) {
      const s = n.scenarios[k];
      out.push(...reasonedProblems(s, p(`scenario ${k}`), ids, false));
      if (isObject(s) && !CONF.includes(s.likelihood as string)) out.push(p(`scenario ${k}: bad likelihood`));
    }
  if (!isObject(n.outlook)) out.push(p("outlook missing"));
  else
    for (const t of TIMEFRAMES) {
      const o = n.outlook[t];
      out.push(...reasonedProblems(o, p(`outlook ${t}`), ids, false));
      if (isObject(o) && !STANCE.includes(o.stance as string)) out.push(p(`outlook ${t}: bad stance`));
    }
  if (n.levels !== null) {
    const l = n.levels;
    if (!isObject(l) || ![l.entry, l.target, l.stop].every((x) => typeof x === "number" && Number.isFinite(x) && x > 0) || typeof l.basis !== "string")
      out.push(p("bad levels"));
    else if (!((l.stop as number) < (l.entry as number) && (l.entry as number) < (l.target as number))) out.push(p("levels out of order"));
    if (asset && (!asset.publicPrice || asset.risk === "cash-like")) out.push(p("levels shown for an asset that must not have them"));
  }
  if (!isObject(n.model) || typeof n.model.triage !== "string") out.push(p("model missing"));
  return out;
}

export function snapshotProblems(s: unknown): string[] {
  if (!isObject(s)) return ["snapshot is not an object"];
  const out: string[] = [];
  if (s.kind !== "live" && s.kind !== "sample") out.push("bad kind");
  if (typeof s.date !== "string" || !DATE.test(s.date)) out.push("bad date");
  if (!isTime(s.generatedAt)) out.push("bad generatedAt");
  if (typeof s.runId !== "string" || !s.runId) out.push("bad runId");
  if (!isObject(s.market) || typeof s.market.summary !== "string" || !Array.isArray(s.market.developments) || !Array.isArray(s.market.facts))
    out.push("bad market overview");
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

export function isSnapshot(s: unknown): s is ResearchSnapshot {
  return snapshotProblems(s).length === 0;
}

export function isNote(n: unknown): n is ResearchNote {
  return noteProblems(n).length === 0;
}
