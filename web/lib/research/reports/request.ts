import type { PortfolioInput, ReportPeriod, ReportScope } from "../types.ts";
import { universeAsset } from "../universe.ts";
import { parsePortfolioInput, type Parsed } from "../portfolio/validate.ts";

/**
 * Strict parsing for report and schedule requests. Pure, so it is unit tested. The routes refuse
 * anything that does not parse, with the plain message from here.
 */

export const SCOPES: ReportScope[] = ["market", "asset", "portfolio", "full"];
export const PERIODS: ReportPeriod[] = ["daily", "weekly", "monthly", "on-demand"];
/** Schedules exclude single-asset reports and on-demand (see research_schedules in supabase/schema.sql). */
export const SCHEDULE_SCOPES = ["market", "portfolio", "full"] as const;
export const SCHEDULE_PERIODS = ["daily", "weekly", "monthly"] as const;
export type ScheduleScope = (typeof SCHEDULE_SCOPES)[number];
export type SchedulePeriod = (typeof SCHEDULE_PERIODS)[number];
export type Schedule = { scope: ScheduleScope; period: SchedulePeriod; enabled: boolean };
export const MAX_SCHEDULES = SCHEDULE_SCOPES.length * SCHEDULE_PERIODS.length;

export type ReportRequestBody = {
  scope: ReportScope;
  period: ReportPeriod;
  premium: boolean;
  assetId?: string;
  /** Holdings read from the vault by the browser plus any changes; merged with the saved portfolio. */
  portfolio?: PortfolioInput;
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

export function parseReportRequest(x: unknown): Parsed<ReportRequestBody> {
  if (!isObj(x)) return { ok: false, error: "Send a report request object." };
  const extra = Object.keys(x).find((k) => !["scope", "period", "premium", "assetId", "portfolio"].includes(k));
  if (extra) return { ok: false, error: `Unknown field "${extra.slice(0, 40)}".` };
  if (typeof x.scope !== "string" || !SCOPES.includes(x.scope as ReportScope)) return { ok: false, error: "scope must be market, asset, portfolio or full." };
  const period = x.period ?? "on-demand";
  if (typeof period !== "string" || !PERIODS.includes(period as ReportPeriod)) return { ok: false, error: "period must be daily, weekly, monthly or on-demand." };
  if (x.premium !== undefined && typeof x.premium !== "boolean") return { ok: false, error: "premium must be true or false." };
  const out: ReportRequestBody = { scope: x.scope as ReportScope, period: period as ReportPeriod, premium: x.premium === true };
  if (out.scope === "asset") {
    if (typeof x.assetId !== "string" || !universeAsset(x.assetId)) return { ok: false, error: "Choose a Stackday asset for an asset report." };
    out.assetId = x.assetId;
  } else if (x.assetId !== undefined) {
    return { ok: false, error: "assetId is only used for asset reports." };
  }
  if (x.portfolio !== undefined) {
    if (out.scope !== "portfolio" && out.scope !== "full") return { ok: false, error: "portfolio is only used for portfolio and full reports." };
    const p = parsePortfolioInput(x.portfolio, { allowVault: true });
    if (!p.ok) return p;
    out.portfolio = p.value;
  }
  return { ok: true, value: out };
}

export function parseSchedule(x: unknown): Parsed<Schedule> {
  if (!isObj(x)) return { ok: false, error: "Each schedule must be an object." };
  const extra = Object.keys(x).find((k) => !["scope", "period", "enabled"].includes(k));
  if (extra) return { ok: false, error: `Unknown field "${extra.slice(0, 40)}".` };
  if (typeof x.scope !== "string" || !(SCHEDULE_SCOPES as readonly string[]).includes(x.scope)) return { ok: false, error: "Scheduled reports can be market, portfolio or full." };
  if (typeof x.period !== "string" || !(SCHEDULE_PERIODS as readonly string[]).includes(x.period)) return { ok: false, error: "Schedules run daily, weekly or monthly." };
  const enabled = x.enabled ?? true;
  if (typeof enabled !== "boolean") return { ok: false, error: "enabled must be true or false." };
  return { ok: true, value: { scope: x.scope as ScheduleScope, period: x.period as SchedulePeriod, enabled } };
}

/** One schedule, a list of them, or { schedules: [...] }. Duplicates of the same scope and period are refused. */
export function parseSchedules(x: unknown): Parsed<Schedule[]> {
  const list = Array.isArray(x) ? x : isObj(x) && Array.isArray(x.schedules) && Object.keys(x).length === 1 ? x.schedules : [x];
  if (list.length === 0) return { ok: false, error: "Send at least one schedule." };
  if (list.length > MAX_SCHEDULES) return { ok: false, error: `At most ${MAX_SCHEDULES} schedules.` };
  const out: Schedule[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const s = parseSchedule(raw);
    if (!s.ok) return s;
    const key = `${s.value.scope}:${s.value.period}`;
    if (seen.has(key)) return { ok: false, error: "The same scope and period appear twice." };
    seen.add(key);
    out.push(s.value);
  }
  return { ok: true, value: out };
}
