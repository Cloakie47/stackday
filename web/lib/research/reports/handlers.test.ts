import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleCreateReport,
  handleGetPortfolio,
  handleListReports,
  handleListSchedules,
  handlePreviewPortfolio,
  handleSavePortfolio,
  handleSaveSchedules,
  type Deps,
  type ResearchStore,
} from "./handlers.ts";
import { staticSnapshotLoader, asSnapshot, fetchSnapshotLoader } from "./snapshot-loader.ts";
import { parseReportRequest, parseSchedules } from "./request.ts";
import { makeSnapshot } from "../portfolio/fixtures.ts";
import type { AccessCheck, PortfolioInput, Report } from "../types.ts";
import type { Schedule } from "./request.ts";

const WALLET = "0x1111111111111111111111111111111111111111";
const SNAP = makeSnapshot([
  { assetId: "mAAPL", price: 100, action: "hold" },
  { assetId: "mSPX", price: 50, action: "buy" },
]);
const PORTFOLIO: PortfolioInput = { holdings: [{ assetId: "mSPX", amount: 4, origin: "manual" }], horizon: "medium", risk: "medium" };

function memoryStore() {
  const reports: (Report & { owner: string })[] = [];
  const portfolios = new Map<string, PortfolioInput>();
  const schedules = new Map<string, Schedule>();
  const store: ResearchStore = {
    async saveReport(r) {
      reports.push(r);
    },
    async listReports(w, limit) {
      return reports.filter((r) => r.owner === w).reverse().slice(0, limit);
    },
    async previousReport(w, period, scope) {
      return [...reports].reverse().find((r) => r.owner === w && r.period === period && r.scope === scope) ?? null;
    },
    async loadPortfolio(w) {
      return portfolios.get(w) ?? null;
    },
    async savePortfolio(w, i) {
      portfolios.set(w, i);
    },
    async listSchedules() {
      return [...schedules.values()];
    },
    async saveSchedules(_w, list) {
      for (const s of list) schedules.set(`${s.scope}:${s.period}`, s);
    },
  };
  return { store, reports, portfolios };
}

function deps(over: Partial<Deps> = {}): Deps & { credits: string[]; gateCalls: number } {
  let n = 0;
  const d = {
    credits: [] as string[],
    gateCalls: 0,
    wallet: WALLET,
    store: null,
    loadSnapshot: staticSnapshotLoader(SNAP),
    checkAccess: async (): Promise<AccessCheck> => {
      d.gateCalls++;
      return { allowed: true, consumesCredit: false };
    },
    consumeCredit: async (w: string) => {
      d.credits.push(w);
    },
    now: () => new Date("2026-11-19T22:00:00Z"),
    newId: () => `id-${++n}`,
    ...over,
  };
  return d;
}

test("POST report works without the database: built, returned, not saved", async () => {
  const r = await handleCreateReport(deps(), { scope: "market", period: "daily" });
  assert.equal(r.status, 200);
  const body = r.body as { report: Report; saved: boolean };
  assert.equal(body.saved, false);
  assert.equal(body.report.scope, "market");
  assert.equal(body.report.owner, WALLET);
  assert.equal(body.report.id, "id-1");
});

test("POST report runs the access gate first and returns its refusal with a reason", async () => {
  let loaded = false;
  const d = deps({
    checkAccess: async () => ({ allowed: false, reason: "payment-required" }),
    loadSnapshot: async () => {
      loaded = true;
      return SNAP;
    },
  });
  const r = await handleCreateReport(d, { scope: "market", period: "weekly", premium: true });
  assert.equal(r.status, 402);
  assert.deepEqual((r.body as { reason: string }).reason, "payment-required");
  assert.equal(loaded, false, "nothing is built before access is granted");

  const signIn = await handleCreateReport(deps({ wallet: null, checkAccess: async () => ({ allowed: false, reason: "sign-in" }) }), { scope: "portfolio" });
  assert.equal(signIn.status, 401);
});

test("POST report refuses bad input before the gate", async () => {
  const d = deps();
  for (const body of [undefined, null, [], { scope: "everything" }, { scope: "asset" }, { scope: "market", assetId: "mAAPL" }, { scope: "market", extra: 1 }, { scope: "market", premium: "yes" }]) {
    const r = await handleCreateReport(d, body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(d.gateCalls, 0);
});

test("POST report with the database saves, merges saved holdings, compares with the previous report and uses a credit", async () => {
  const { store, reports, portfolios } = memoryStore();
  portfolios.set(WALLET, PORTFOLIO);
  const d = deps({ store, checkAccess: async () => ({ allowed: true, consumesCredit: true }) });
  const body = { scope: "portfolio", period: "weekly", portfolio: { holdings: [{ assetId: "mAAPL", amount: 1, origin: "vault" }], horizon: "long", risk: "high" } };
  const first = await handleCreateReport(d, body);
  assert.equal(first.status, 200);
  const r1 = (first.body as { report: Report; saved: boolean }).report;
  assert.equal((first.body as { saved: boolean }).saved, true);
  assert.equal(r1.portfolio?.totalUsd, 300, "vault mAAPL (100) plus saved mSPX (200)");
  assert.equal(reports.length, 1);
  assert.deepEqual(d.credits, [WALLET]);
  assert.match(r1.changes.at(-1)!.text, /first weekly report/);

  const second = await handleCreateReport(d, body);
  const r2 = (second.body as { report: Report }).report;
  assert.ok(r2.changes.some((c) => /same day/.test(c.text)), "compared with the first weekly portfolio report");
});

test("a personal report with no holdings anywhere asks for them", async () => {
  const r = await handleCreateReport(deps({ store: memoryStore().store }), { scope: "portfolio" });
  assert.equal(r.status, 400);
  assert.match((r.body as { error: string }).error, /holdings/);
});

test("no snapshot means a 503, and no credit is used", async () => {
  const d = deps({ loadSnapshot: staticSnapshotLoader(null), checkAccess: async () => ({ allowed: true, consumesCredit: true }) });
  const r = await handleCreateReport(d, { scope: "market" });
  assert.equal(r.status, 503);
  assert.deepEqual(d.credits, []);
});

test("a failed save returns 500 and uses no credit", async () => {
  const { store } = memoryStore();
  store.saveReport = async () => {
    throw new Error("db down");
  };
  const errors: string[] = [];
  const d = deps({ store, checkAccess: async () => ({ allowed: true, consumesCredit: true }), onError: (w) => errors.push(w) });
  const r = await handleCreateReport(d, { scope: "market" });
  assert.equal(r.status, 500);
  assert.deepEqual(d.credits, []);
  assert.deepEqual(errors, ["report: save"]);
});

test("GET reports: own reports only, needs sign-in when the database is connected", async () => {
  assert.deepEqual((await handleListReports(deps())).body, { configured: false, reports: [] });
  const { store } = memoryStore();
  assert.equal((await handleListReports(deps({ store, wallet: null }))).status, 401);
  await handleCreateReport(deps({ store }), { scope: "market" });
  await handleCreateReport(deps({ store, wallet: "0x2222222222222222222222222222222222222222" }), { scope: "market" });
  const mine = (await handleListReports(deps({ store }))).body as { reports: Report[] };
  assert.equal(mine.reports.length, 1);
  assert.equal(mine.reports[0].owner, WALLET);
});

test("portfolio: save only manual holdings, read them back, refuse bad input", async () => {
  const { store } = memoryStore();
  assert.equal((await handleSavePortfolio(deps(), PORTFOLIO)).status, 503);
  assert.equal((await handleSavePortfolio(deps({ store, wallet: null }), PORTFOLIO)).status, 401);
  const vault = { ...PORTFOLIO, holdings: [{ assetId: "mSPX", amount: 1, origin: "vault" }] };
  assert.equal((await handleSavePortfolio(deps({ store }), vault)).status, 400);
  assert.equal((await handleSavePortfolio(deps({ store }), { ...PORTFOLIO, horizon: "forever" })).status, 400);
  assert.equal((await handleSavePortfolio(deps({ store }), PORTFOLIO)).status, 200);
  assert.deepEqual((await handleGetPortfolio(deps({ store }))).body, { configured: true, input: PORTFOLIO });
  assert.deepEqual((await handleGetPortfolio(deps())).body, { configured: false, input: null });
});

test("portfolio preview: summary depth, no sign-in needed, nothing saved", async () => {
  const r = await handlePreviewPortfolio(deps({ wallet: null }), PORTFOLIO);
  assert.equal(r.status, 200);
  const body = r.body as { analysis: { totalUsd: number; holdings: unknown[] }; snapshotKind: string };
  assert.equal(body.analysis.totalUsd, 200);
  assert.deepEqual(body.analysis.holdings, []);
  assert.equal(body.snapshotKind, "sample");
  assert.equal((await handlePreviewPortfolio(deps(), { holdings: "all" })).status, 400);
});

test("schedules: validated, saved as upserts, and listed", async () => {
  const { store } = memoryStore();
  assert.deepEqual((await handleListSchedules(deps())).body, { configured: false, schedules: [] });
  assert.equal((await handleSaveSchedules(deps(), { scope: "market", period: "daily" })).status, 503);
  assert.equal((await handleSaveSchedules(deps({ store }), { scope: "asset", period: "daily" })).status, 400);
  assert.equal((await handleSaveSchedules(deps({ store }), { scope: "market", period: "on-demand" })).status, 400);
  const ok = await handleSaveSchedules(deps({ store }), { scope: "market", period: "daily" });
  assert.deepEqual(ok.body, { schedules: [{ scope: "market", period: "daily", enabled: true }] });
  await handleSaveSchedules(deps({ store }), [{ scope: "market", period: "daily", enabled: false }, { scope: "full", period: "weekly" }]);
  const list = (await handleListSchedules(deps({ store }))).body as { schedules: Schedule[] };
  assert.equal(list.schedules.length, 2);
  assert.equal(list.schedules.find((s) => s.period === "daily")?.enabled, false);
});

test("request parsing: defaults and limits", () => {
  const r = parseReportRequest({ scope: "market" });
  assert.deepEqual(r, { ok: true, value: { scope: "market", period: "on-demand", premium: false } });
  assert.equal(parseReportRequest({ scope: "market", portfolio: {} }).ok, false, "portfolio only for personal scopes");
  assert.equal(parseSchedules([]).ok, false);
  assert.equal(parseSchedules([{ scope: "market", period: "daily" }, { scope: "market", period: "daily" }]).ok, false);
  assert.equal(parseSchedules({ schedules: [{ scope: "full", period: "monthly" }] }).ok, true);
});

test("snapshot loader: accepts a bare snapshot or { snapshot }, refuses anything else", async () => {
  assert.equal(asSnapshot(SNAP)?.runId, SNAP.runId);
  assert.equal(asSnapshot({ snapshot: SNAP })?.runId, SNAP.runId);
  assert.equal(asSnapshot({ ...SNAP, kind: "made-up" }), null);
  assert.equal(asSnapshot({ ...SNAP, notes: [{ assetId: "mAAPL" }] }), null);
  assert.equal(asSnapshot("nope"), null);

  const calls: string[] = [];
  const fake = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ snapshot: SNAP }), { status: 200 });
  }) as unknown as typeof fetch;
  const loaded = await fetchSnapshotLoader("https://example.test/api/research/report?x=1", fake)();
  assert.equal(loaded?.date, SNAP.date);
  assert.deepEqual(calls, ["https://example.test/api/research/snapshot"]);

  const missing = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
  assert.equal(await fetchSnapshotLoader("https://example.test/", missing)(), null);
  const broken = (async () => {
    throw new Error("network");
  }) as unknown as typeof fetch;
  assert.equal(await fetchSnapshotLoader("https://example.test/", broken)(), null);
});
