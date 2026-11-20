import { test } from "node:test";
import assert from "node:assert/strict";
import { isDue, runDueSchedules, type DueCandidate, type ScheduleRunStore } from "./scheduled.ts";
import type { ResearchStore } from "./handlers.ts";
import { staticSnapshotLoader } from "./snapshot-loader.ts";
import { makeSnapshot } from "../portfolio/fixtures.ts";
import type { AccessCheck, PortfolioInput, Report } from "../types.ts";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const LIVE = { ...makeSnapshot([{ assetId: "mSPX", price: 50, action: "buy" }]), kind: "live" as const, date: "2026-11-20" };
const PORTFOLIO: PortfolioInput = { holdings: [{ assetId: "mSPX", amount: 4, origin: "manual" }], horizon: "medium", risk: "medium" };

test("isDue: daily, weekly, monthly", () => {
  assert.equal(isDue("daily", null, "2026-11-20"), true);
  assert.equal(isDue("daily", "2026-11-20", "2026-11-20"), false);
  assert.equal(isDue("daily", "2026-11-19", "2026-11-20"), true);
  assert.equal(isDue("weekly", "2026-11-14", "2026-11-20"), false);
  assert.equal(isDue("weekly", "2026-11-13", "2026-11-20"), true);
  assert.equal(isDue("monthly", "2026-11-01", "2026-11-30"), false);
  assert.equal(isDue("monthly", "2026-10-31", "2026-11-01"), true);
  assert.equal(isDue("monthly", "2026-12-01", "2026-11-20"), false, "never due for a date before the last run");
});

function store(candidates: DueCandidate[], portfolios: Record<string, PortfolioInput> = {}) {
  const reports: (Report & { owner: string })[] = [];
  const marks: string[] = [];
  const s: ResearchStore & ScheduleRunStore = {
    async saveReport(r) { reports.push(r); },
    async listReports() { return []; },
    async previousReport() { return null; },
    async loadPortfolio(w) { return portfolios[w] ?? null; },
    async savePortfolio() {},
    async listSchedules() { return []; },
    async saveSchedules() {},
    async listEnabledSchedules(limit) { return candidates.slice(0, limit); },
    async markScheduleRun(w, scope, period, date) { marks.push(`${w}:${scope}:${period}:${date}`); },
  };
  return { s, reports, marks };
}

const baseDeps = (over: Partial<Parameters<typeof runDueSchedules>[0]> = {}) => {
  let n = 0;
  return {
    store: null,
    loadSnapshot: staticSnapshotLoader(LIVE),
    checkAccess: async (): Promise<AccessCheck> => ({ allowed: true, consumesCredit: false }),
    consumeCredit: async () => {},
    now: () => new Date("2026-11-20T23:00:00Z"),
    newId: () => `id-${++n}`,
    ...over,
  };
};

test("builds due reports, skips ones already run, marks what it handled", async () => {
  const { s, reports, marks } = store(
    [
      { wallet: A, scope: "market", period: "daily", lastRun: "2026-11-19" },
      { wallet: A, scope: "portfolio", period: "weekly", lastRun: null },
      { wallet: B, scope: "market", period: "weekly", lastRun: "2026-11-18" },
    ],
    { [A]: PORTFOLIO },
  );
  const r = await runDueSchedules(baseDeps({ store: s }));
  assert.equal(r.status, "ok");
  assert.equal(r.due, 2);
  assert.equal(r.built, 2);
  assert.deepEqual(reports.map((x) => `${x.owner}:${x.scope}:${x.period}`).sort(), [`${A}:market:daily`, `${A}:portfolio:weekly`]);
  assert.ok(reports.every((x) => x.snapshotDate === "2026-11-20"));
  assert.equal(marks.length, 2);
});

test("refused reports are marked (retried next period), not built; no holdings is a refusal too", async () => {
  const { s, reports, marks } = store([
    { wallet: A, scope: "full", period: "daily", lastRun: null },
    { wallet: B, scope: "portfolio", period: "daily", lastRun: null },
  ]);
  const r = await runDueSchedules(
    baseDeps({ store: s, checkAccess: async (req) => (req.wallet === A ? { allowed: false, reason: "payment-required" } : { allowed: true, consumesCredit: false }) }),
  );
  assert.equal(r.built, 0);
  assert.equal(reports.length, 0);
  assert.equal(r.skipped["payment-required"], 1);
  assert.equal(r.skipped["status-400"], 1);
  assert.equal(marks.length, 2);
});

test("credits are used once per delivered scheduled report", async () => {
  const used: string[] = [];
  const { s } = store([{ wallet: A, scope: "portfolio", period: "daily", lastRun: null }], { [A]: PORTFOLIO });
  await runDueSchedules(baseDeps({ store: s, checkAccess: async () => ({ allowed: true, consumesCredit: true }), consumeCredit: async (w) => void used.push(w) }));
  assert.deepEqual(used, [A]);
});

test("sample data or no database never produces scheduled reports", async () => {
  const { s, reports } = store([{ wallet: A, scope: "market", period: "daily", lastRun: null }]);
  const sample = await runDueSchedules(baseDeps({ store: s, loadSnapshot: staticSnapshotLoader({ ...LIVE, kind: "sample" }) }));
  assert.equal(sample.status, "no-live-research");
  assert.equal(reports.length, 0);
  assert.equal((await runDueSchedules(baseDeps())).status, "no-database");
});

test("a database failure while saving is not marked, so the next call retries it", async () => {
  const { s, marks } = store([{ wallet: A, scope: "market", period: "daily", lastRun: null }]);
  s.saveReport = async () => { throw new Error("db down"); };
  const r = await runDueSchedules(baseDeps({ store: s }));
  assert.equal(r.skipped.error, 1);
  assert.equal(marks.length, 0);
});

test("respects the per-run limit", async () => {
  const many: DueCandidate[] = Array.from({ length: 5 }, (_, i) => ({ wallet: `0x${String(i).repeat(40)}`, scope: "market", period: "daily", lastRun: null }));
  const { s, reports } = store(many);
  const r = await runDueSchedules(baseDeps({ store: s }), 3);
  assert.equal(r.due, 3);
  assert.equal(reports.length, 3);
});
