import type { AccessCheck, PortfolioInput, Report, ReportPeriod, ReportScope } from "../types.ts";
import type { ReportRequest } from "../access/gate.ts";
import { buildReport, ReportInputError } from "./build.ts";
import { parseReportRequest, parseSchedules, type Schedule } from "./request.ts";
import type { SnapshotLoader } from "./snapshot-loader.ts";
import { analyzePortfolio } from "../portfolio/analyze.ts";
import { mergeInputs, parsePortfolioInput } from "../portfolio/validate.ts";
import { summarizePortfolio } from "./build.ts";

/**
 * Framework-free request handlers behind the report, portfolio and schedule routes. Everything
 * with a side effect (session, database, access gate, clock, snapshot) is passed in, so the
 * handlers are unit tested and the routes stay a few lines each.
 */

export type Result = { status: number; body: unknown };

/** The database side. `null` store means the account database is not connected. */
export interface ResearchStore {
  saveReport(report: Report & { owner: string }): Promise<void>;
  listReports(wallet: string, limit: number): Promise<Report[]>;
  /** Most recent report of this wallet with the same period and scope, or null. */
  previousReport(wallet: string, period: ReportPeriod, scope: ReportScope): Promise<Report | null>;
  loadPortfolio(wallet: string): Promise<PortfolioInput | null>;
  savePortfolio(wallet: string, input: PortfolioInput): Promise<void>;
  listSchedules(wallet: string): Promise<Schedule[]>;
  saveSchedules(wallet: string, schedules: Schedule[]): Promise<void>;
}

export type Deps = {
  wallet: string | null;
  store: ResearchStore | null;
  loadSnapshot: SnapshotLoader;
  checkAccess: (req: ReportRequest) => Promise<AccessCheck>;
  consumeCredit: (wallet: string) => Promise<void>;
  now: () => Date;
  newId: () => string;
  onError?: (where: string, e: unknown) => void;
};

const STATUS_FOR: Record<Extract<AccessCheck, { allowed: false }>["reason"], number> = {
  "sign-in": 401,
  "payment-required": 402,
  "premium-required": 402,
  "rate-limited": 429,
};
const REFUSAL_TEXT: Record<Extract<AccessCheck, { allowed: false }>["reason"], string> = {
  "sign-in": "Sign in with your wallet first.",
  "payment-required": "This report needs a plan or a report credit.",
  "premium-required": "Premium depth needs a premium plan.",
  "rate-limited": "Too many reports for now. Try again later.",
};

const bad = (error: string): Result => ({ status: 400, body: { error } });
const noSnapshot: Result = { status: 503, body: { error: "Today's research is not available yet. Try again later." } };
const notConnected: Result = { status: 503, body: { configured: false, error: "The account database is not connected yet." } };
const needSignIn: Result = { status: 401, body: { reason: "sign-in", error: REFUSAL_TEXT["sign-in"] } };

export const REPORT_LIST_LIMIT = 30;

/** POST /api/research/report */
export async function handleCreateReport(deps: Deps, rawBody: unknown): Promise<Result> {
  const parsed = parseReportRequest(rawBody);
  if (!parsed.ok) return bad(parsed.error);
  const req = parsed.value;

  // The access gate runs before anything is built.
  const access = await deps.checkAccess({ wallet: deps.wallet, scope: req.scope, premium: req.premium });
  if (!access.allowed) return { status: STATUS_FOR[access.reason], body: { reason: access.reason, error: REFUSAL_TEXT[access.reason] } };

  const snapshot = await deps.loadSnapshot();
  if (!snapshot) return noSnapshot;

  const personal = req.scope === "portfolio" || req.scope === "full";
  let portfolio: PortfolioInput | undefined;
  let previous: Report | null = null;
  if (deps.store && deps.wallet) {
    try {
      if (personal) {
        const saved = await deps.store.loadPortfolio(deps.wallet);
        portfolio = req.portfolio ? mergeInputs(saved, req.portfolio) : (saved ?? undefined);
      }
      previous = await deps.store.previousReport(deps.wallet, req.period, req.scope);
    } catch (e) {
      deps.onError?.("report: load", e);
      return { status: 500, body: { error: "Could not load your saved portfolio." } };
    }
  }
  if (personal && !portfolio) portfolio = req.portfolio;
  if (personal && !portfolio) return bad("Add your holdings, horizon and risk answers first.");

  let report: Report;
  try {
    report = buildReport({
      id: deps.newId(),
      createdAt: deps.now().toISOString(),
      scope: req.scope,
      period: req.period,
      owner: deps.wallet,
      premium: req.premium,
      snapshot,
      assetId: req.assetId,
      portfolio,
      previous,
    });
  } catch (e) {
    if (e instanceof ReportInputError) return bad(e.message);
    throw e;
  }

  // Without the database (or without sign-in, for public scopes) the report is returned unsaved.
  let saved = false;
  if (deps.store && deps.wallet) {
    try {
      await deps.store.saveReport({ ...report, owner: deps.wallet });
      saved = true;
    } catch (e) {
      deps.onError?.("report: save", e);
      return { status: 500, body: { error: "The report was built but could not be saved. Try again." } };
    }
  }
  // Credits are used only for reports that were really delivered and saved.
  if (access.consumesCredit && deps.wallet && saved) {
    try {
      await deps.consumeCredit(deps.wallet);
    } catch (e) {
      deps.onError?.("report: credit", e);
    }
  }
  return { status: 200, body: { report, saved } };
}

/** GET /api/research/report: the signed-in wallet's own past reports, newest first. */
export async function handleListReports(deps: Deps): Promise<Result> {
  if (!deps.store) return { status: 200, body: { configured: false, reports: [] } };
  if (!deps.wallet) return needSignIn;
  try {
    return { status: 200, body: { configured: true, reports: await deps.store.listReports(deps.wallet, REPORT_LIST_LIMIT) } };
  } catch (e) {
    deps.onError?.("report: list", e);
    return { status: 500, body: { error: "Could not load your reports." } };
  }
}

/** GET /api/research/portfolio: saved manual holdings, horizon and risk. */
export async function handleGetPortfolio(deps: Deps): Promise<Result> {
  if (!deps.store) return { status: 200, body: { configured: false, input: null } };
  if (!deps.wallet) return needSignIn;
  try {
    return { status: 200, body: { configured: true, input: await deps.store.loadPortfolio(deps.wallet) } };
  } catch (e) {
    deps.onError?.("portfolio: get", e);
    return { status: 500, body: { error: "Could not load your portfolio." } };
  }
}

/** PUT /api/research/portfolio: save manual holdings, horizon and risk (vault rows are refused). */
export async function handleSavePortfolio(deps: Deps, rawBody: unknown): Promise<Result> {
  if (!deps.store) return notConnected;
  if (!deps.wallet) return needSignIn;
  const p = parsePortfolioInput(rawBody, { allowVault: false });
  if (!p.ok) return bad(p.error);
  try {
    await deps.store.savePortfolio(deps.wallet, p.value);
  } catch (e) {
    deps.onError?.("portfolio: save", e);
    return { status: 500, body: { error: "Could not save your portfolio." } };
  }
  return { status: 200, body: { input: p.value } };
}

/**
 * POST /api/research/portfolio: a quick summary-depth analysis of the holdings sent, saved
 * nowhere. The full per-holding detail comes with a premium portfolio report.
 */
export async function handlePreviewPortfolio(deps: Deps, rawBody: unknown): Promise<Result> {
  const p = parsePortfolioInput(rawBody, { allowVault: true });
  if (!p.ok) return bad(p.error);
  const snapshot = await deps.loadSnapshot();
  if (!snapshot) return noSnapshot;
  const analysis = analyzePortfolio(p.value, snapshot);
  return { status: 200, body: { analysis: summarizePortfolio(analysis), snapshotDate: snapshot.date, snapshotKind: snapshot.kind } };
}

/** GET /api/research/schedules */
export async function handleListSchedules(deps: Deps): Promise<Result> {
  if (!deps.store) return { status: 200, body: { configured: false, schedules: [] } };
  if (!deps.wallet) return needSignIn;
  try {
    return { status: 200, body: { configured: true, schedules: await deps.store.listSchedules(deps.wallet) } };
  } catch (e) {
    deps.onError?.("schedules: list", e);
    return { status: 500, body: { error: "Could not load your schedules." } };
  }
}

/** PUT or POST /api/research/schedules: add, change or switch off schedules. Returns the full list. */
export async function handleSaveSchedules(deps: Deps, rawBody: unknown): Promise<Result> {
  if (!deps.store) return notConnected;
  if (!deps.wallet) return needSignIn;
  const s = parseSchedules(rawBody);
  if (!s.ok) return bad(s.error);
  try {
    await deps.store.saveSchedules(deps.wallet, s.value);
    return { status: 200, body: { schedules: await deps.store.listSchedules(deps.wallet) } };
  } catch (e) {
    deps.onError?.("schedules: save", e);
    return { status: 500, body: { error: "Could not save your schedules." } };
  }
}
