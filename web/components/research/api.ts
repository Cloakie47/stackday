/**
 * Browser-side calls to the Research API routes. Routes and shapes follow the API contract table
 * in docs/research/PLAN.md. When a route is missing (404), unreachable or fails on the server
 * (5xx), the call falls back to the labelled sample fixtures and says so with `from: "sample"`,
 * so the page can show it. Refusals (sign-in, payment, rate limit) are reported as errors, never
 * silently replaced.
 */
import type {
  AccessCheck,
  DailyScore,
  Entitlement,
  PortfolioAnalysis,
  PortfolioInput,
  ResearchSnapshot,
  Scorecard,
  WeeklyReport,
} from "@/lib/research/types";
import { SAMPLE_WEEKLY } from "./fixtures/sample-weekly";
import { SAMPLE_SNAPSHOT, sampleScores } from "./fixtures/sample-snapshot";
import { SAMPLE_ACCESS } from "./fixtures/sample-other";

export type Loaded<T> = { data: T; from: "api" | "sample"; why?: string };

export type Refusal = "sign-in" | "payment-required" | "rate-limited";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public reason?: Refusal,
  ) {
    super(message);
  }
}

/** The route is missing or broken, so a sample may stand in. */
class Unavailable extends Error {}

async function call(url: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  } catch {
    throw new Unavailable("The research service could not be reached.");
  }
  if (res.status === 404) throw new Unavailable("The research service is not live yet.");
  const body = await res.json().catch(() => null);
  if (res.status >= 500) throw new Unavailable(`The research service failed (${res.status}).`);
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
    if (e instanceof Unavailable) return { data: sample(), from: "sample", why: e.message };
    throw e;
  }
}

/* Weekly report --------------------------------------------------------------------------- */

export type WeeklyResult = { report: WeeklyReport; access: AccessCheck };

export const getWeekly = (weekOf?: string) =>
  withSample<WeeklyResult>(
    async () => {
      const b = (await call(`/api/research/weekly${weekOf ? `?weekOf=${encodeURIComponent(weekOf)}` : ""}`)) as Partial<WeeklyResult>;
      if (!b?.report) throw new Unavailable("The research service sent no report.");
      return { report: b.report, access: b.access ?? { allowed: true, consumesCredit: false } };
    },
    () => ({ report: SAMPLE_WEEKLY, access: { allowed: true, consumesCredit: false } }),
  );

export async function approveWeekly(weekOf: string) {
  await call("/api/research/weekly/approve", { method: "POST", body: JSON.stringify({ weekOf }) });
}

/* Daily notes (internal while testing) ------------------------------------------------------ */

export type SnapshotResult = { snapshot: ResearchSnapshot; internal: boolean };

export const getSnapshot = () =>
  withSample<SnapshotResult>(
    async () => {
      const b = (await call("/api/research/snapshot")) as Partial<SnapshotResult>;
      if (!b?.snapshot) throw new Unavailable("The research service sent no notes.");
      return { snapshot: b.snapshot, internal: Boolean(b.internal) };
    },
    () => ({ snapshot: SAMPLE_SNAPSHOT, internal: false }),
  );

/* Scores and track record ------------------------------------------------------------------ */

export type ScoresResult = { scores: DailyScore[]; calibration: Scorecard["calibration"] };

export const getScores = (assetId: string) =>
  withSample<ScoresResult>(
    async () => {
      const b = (await call(`/api/research/scores?asset=${encodeURIComponent(assetId)}`)) as Partial<ScoresResult>;
      return { scores: b?.scores ?? [], calibration: b?.calibration ?? [] };
    },
    () => sampleScores(assetId),
  );

export async function gradeNote(date: string, assetId: string, grade: number) {
  await call("/api/research/scores/grade", { method: "POST", body: JSON.stringify({ date, assetId, grade }) });
}

/* Portfolio check -------------------------------------------------------------------------- */

export const previewPortfolio = (input: PortfolioInput, fallback: () => PortfolioAnalysis) =>
  withSample<{ analysis: PortfolioAnalysis; reportKind: "live" | "sample" }>(
    async () => {
      const b = (await call("/api/research/portfolio/preview", { method: "POST", body: JSON.stringify(input) })) as {
        analysis?: PortfolioAnalysis;
        reportKind?: "live" | "sample";
      };
      if (!b?.analysis) throw new Unavailable("The portfolio service sent no analysis.");
      return { analysis: b.analysis, reportKind: b.reportKind ?? "sample" };
    },
    () => ({ analysis: fallback(), reportKind: "sample" }),
  );

/* Access and plans ------------------------------------------------------------------------- */

export type AccessInfo = {
  paywallEnabled: boolean;
  /** Proposed test USDC amounts, null while the founder has not set them. */
  prices: { "weekly-single": number | null; monthly: number | null };
  entitlement: Entitlement | null;
};

/** Reads a price whatever its exact shape: 2, "2", { usdc: "2" }, { priceUsdc: 2 } or { amount: 2 }. */
function priceOf(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["usdc", "priceUsdc", "amount", "price"]) {
      const v = priceOf(o[k]);
      if (v !== null) return v;
    }
  }
  return null;
}

function pricesOf(raw: unknown): AccessInfo["prices"] {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const items = (o.items && typeof o.items === "object" ? o.items : o) as Record<string, unknown>;
  if (Array.isArray(raw)) {
    const find = (p: string) => priceOf((raw as Record<string, unknown>[]).find((x) => x?.plan === p || x?.purpose === p));
    return { "weekly-single": find("weekly-single"), monthly: find("monthly") };
  }
  return { "weekly-single": priceOf(items["weekly-single"]), monthly: priceOf(items.monthly) };
}

export const getAccess = () =>
  withSample<AccessInfo>(
    async () => {
      const b = (await call("/api/research/access")) as { paywallEnabled?: boolean; prices?: unknown; entitlement?: Entitlement | null };
      return { paywallEnabled: Boolean(b?.paywallEnabled), prices: pricesOf(b?.prices), entitlement: b?.entitlement ?? null };
    },
    () => SAMPLE_ACCESS,
  );
