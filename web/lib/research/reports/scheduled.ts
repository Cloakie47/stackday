import type { IsoDate, ResearchSnapshot } from "../types.ts";
import { handleCreateReport, type Deps, type ResearchStore } from "./handlers.ts";
import type { SchedulePeriod, ScheduleScope } from "./request.ts";

/**
 * Scheduled reports: once a day, after the research run, build every report a wallet asked for
 * that is due, and save it to that wallet's report list (the /research/reports page shows it).
 * Each report goes through the same access gate and builder as an on-demand report, so plans,
 * credits and the paywall switch apply the same way.
 *
 * Rules:
 * - Due is measured against the research snapshot's date, not the clock: no new research means no
 *   new report. Sample data never produces scheduled reports.
 * - daily: once per snapshot date. weekly: 7 or more days after the last one. monthly: once per
 *   calendar month.
 * - A schedule is marked as run even when the report was refused (no plan, no holdings saved), so
 *   a refused schedule is retried next period instead of every day.
 * - At most `maxPerRun` reports per call, oldest-waiting first, so one call stays short.
 */

export type DueCandidate = { wallet: string; scope: ScheduleScope; period: SchedulePeriod; lastRun: IsoDate | null };

export interface ScheduleRunStore {
  /** Enabled schedules, those never run or run longest ago first. */
  listEnabledSchedules(limit: number): Promise<DueCandidate[]>;
  /** Records that this schedule was handled for `date`. */
  markScheduleRun(wallet: string, scope: ScheduleScope, period: SchedulePeriod, date: IsoDate): Promise<void>;
}

const DAY = 86_400_000;
const days = (from: IsoDate, to: IsoDate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export function isDue(period: SchedulePeriod, lastRun: IsoDate | null, today: IsoDate): boolean {
  if (!lastRun) return true;
  if (lastRun >= today) return false;
  if (period === "daily") return true;
  if (period === "weekly") return days(lastRun, today) >= 7;
  return lastRun.slice(0, 7) !== today.slice(0, 7);
}

export type ScheduleRunSummary = {
  status: "ok" | "no-database" | "no-live-research";
  snapshotDate?: IsoDate;
  checked: number;
  due: number;
  built: number;
  /** Refusals and failures by reason, for the run log. Never wallets. */
  skipped: Record<string, number>;
};

export const MAX_SCHEDULED_PER_RUN = 200;

export async function runDueSchedules(
  deps: Omit<Deps, "wallet" | "store"> & { store: (ResearchStore & ScheduleRunStore) | null },
  maxPerRun = MAX_SCHEDULED_PER_RUN,
): Promise<ScheduleRunSummary> {
  const empty = { checked: 0, due: 0, built: 0, skipped: {} };
  if (!deps.store) return { status: "no-database", ...empty };

  // Load the snapshot once and hand the same one to every report.
  const snapshot: ResearchSnapshot | null = await deps.loadSnapshot();
  if (!snapshot || snapshot.kind !== "live") return { status: "no-live-research", ...empty };
  const today = snapshot.date;
  const loadSnapshot = async () => snapshot;

  const candidates = await deps.store.listEnabledSchedules(maxPerRun * 4);
  const due = candidates.filter((c) => isDue(c.period, c.lastRun, today)).slice(0, maxPerRun);
  const summary: ScheduleRunSummary = { status: "ok", snapshotDate: today, checked: candidates.length, due: due.length, built: 0, skipped: {} };
  const skip = (reason: string) => (summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1);

  for (const c of due) {
    let result;
    try {
      result = await handleCreateReport({ ...deps, wallet: c.wallet, store: deps.store, loadSnapshot }, { scope: c.scope, period: c.period });
    } catch (e) {
      deps.onError?.("schedules: build", e);
      skip("error");
      continue; // not marked: retried on the next call
    }
    if (result.status === 200 && (result.body as { saved?: boolean }).saved) summary.built++;
    else if (result.status >= 500) {
      skip("error");
      continue; // database trouble: retried on the next call
    } else skip((result.body as { reason?: string }).reason ?? `status-${result.status}`);
    try {
      await deps.store.markScheduleRun(c.wallet, c.scope, c.period, today);
    } catch (e) {
      deps.onError?.("schedules: mark", e);
    }
  }
  return summary;
}
