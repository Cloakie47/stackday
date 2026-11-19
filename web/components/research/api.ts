/**
 * Browser-side calls to the Research API routes (built on other gg/research-* branches).
 * Each call accepts the bare object or a wrapper key ({ snapshot }, { notes }, ...). When a route
 * answers 404 (not built or not merged yet) the call falls back to the labelled sample fixtures and
 * says so with `from: "sample"`, so the page can show it. Any other failure is reported as an error,
 * never silently replaced.
 */
import type {
  Entitlement,
  Plan,
  PortfolioAnalysis,
  PortfolioInput,
  Report,
  ReportPeriod,
  ReportScope,
  ResearchNote,
  ResearchSnapshot,
} from "@/lib/research/types";
import { RESEARCH_DISCLAIMER } from "@/lib/research/types";
import { SAMPLE_SNAPSHOT, sampleHistory } from "./fixtures/sample-snapshot";
import { SAMPLE_ACCESS, SAMPLE_SCHEDULES } from "./fixtures/sample-other";

export type Loaded<T> = { data: T; from: "api" | "sample" };

export type PlanOffer = {
  plan: Plan;
  label: string;
  /** Test USDC price, 0 for free, null while the founder has not set it. */
  priceUsdc: number | null;
  period?: string;
  features: string[];
};

export type AccessInfo = {
  paywallEnabled: boolean;
  plans: PlanOffer[];
  entitlement?: Entitlement | null;
  /** Address that receives test USDC, when payments are on. */
  payTo?: string;
  /** True only for the local fixture. */
  sample?: boolean;
};

export type ScheduleRow = { scope: ReportScope; period: Exclude<ReportPeriod, "on-demand">; enabled: boolean };

export type Refusal = "sign-in" | "payment-required" | "premium-required" | "rate-limited";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public reason?: Refusal,
  ) {
    super(message);
  }
}

class NotBuilt extends Error {}

function unwrap<T>(body: unknown, key: string): T {
  if (body && typeof body === "object" && key in body) return (body as Record<string, unknown>)[key] as T;
  return body as T;
}

async function call(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (res.status === 404) throw new NotBuilt(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; reason?: Refusal };
    throw new ApiError(b.error ?? `The research service answered ${res.status}.`, res.status, b.reason);
  }
  return body;
}

async function withSample<T>(run: () => Promise<T>, sample: () => T): Promise<Loaded<T>> {
  try {
    return { data: await run(), from: "api" };
  } catch (e) {
    if (e instanceof NotBuilt) return { data: sample(), from: "sample" };
    throw e;
  }
}

export const getSnapshot = () =>
  withSample(
    async () => unwrap<ResearchSnapshot>(await call("/api/research/snapshot"), "snapshot"),
    () => SAMPLE_SNAPSHOT,
  );

export const getHistory = (assetId: string) =>
  withSample(
    async () => unwrap<ResearchNote[]>(await call(`/api/research/history?asset=${encodeURIComponent(assetId)}`), "notes") ?? [],
    () => sampleHistory(assetId),
  );

export const analysePortfolio = (input: PortfolioInput, fallback: () => PortfolioAnalysis) =>
  withSample(
    async () => unwrap<PortfolioAnalysis>(await call("/api/research/portfolio", { method: "POST", body: JSON.stringify(input) }), "analysis"),
    fallback,
  );

export const listReports = (owner?: string) =>
  withSample(
    async () => unwrap<Report[]>(await call(`/api/research/report${owner ? `?owner=${owner.toLowerCase()}` : ""}`), "reports") ?? [],
    () => [] as Report[],
  );

export type ReportRequestBody = { scope: ReportScope; period: ReportPeriod; assetId?: string; portfolio?: PortfolioInput };

export const buildReport = (req: ReportRequestBody, fallback: () => Report) =>
  withSample(async () => unwrap<Report>(await call("/api/research/report", { method: "POST", body: JSON.stringify(req) }), "report"), fallback);

export const getSchedules = () =>
  withSample(
    async () => unwrap<ScheduleRow[]>(await call("/api/research/schedules"), "schedules") ?? [],
    () => SAMPLE_SCHEDULES,
  );

export const saveSchedule = (row: ScheduleRow) =>
  withSample(
    async () => {
      await call("/api/research/schedules", { method: "POST", body: JSON.stringify(row) });
      return row;
    },
    () => row,
  );

export const getAccess = () =>
  withSample(
    async () => unwrap<AccessInfo>(await call("/api/research/access"), "access"),
    () => SAMPLE_ACCESS,
  );

/** A report built in the browser from a snapshot, only when the report route is not built yet. */
export function sampleReport(snapshot: ResearchSnapshot, req: ReportRequestBody, owner: string | null, portfolio?: PortfolioAnalysis): Report {
  const notes =
    req.scope === "market"
      ? []
      : req.scope === "asset"
        ? snapshot.notes.filter((n) => n.assetId === req.assetId)
        : req.scope === "portfolio" && portfolio
          ? snapshot.notes.filter((n) => portfolio.holdings.some((h) => h.assetId === n.assetId))
          : snapshot.notes;
  return {
    id: `local-${Date.now().toString(36)}`,
    scope: req.scope,
    period: req.period,
    owner,
    createdAt: new Date().toISOString(),
    snapshotDate: snapshot.date,
    premium: false,
    market: req.scope === "asset" ? undefined : snapshot.market,
    notes,
    changes: notes
      .filter((n) => n.previousAction && n.previousAction !== n.action)
      .map((n) => ({ text: `${n.assetId}: suggestion changed from ${n.previousAction} to ${n.action}.`, factIds: [] })),
    portfolio: req.scope === "portfolio" || req.scope === "full" ? portfolio : undefined,
    disclaimer: RESEARCH_DISCLAIMER,
  };
}
