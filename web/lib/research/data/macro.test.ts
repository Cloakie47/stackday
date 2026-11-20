import { test } from "node:test";
import assert from "node:assert/strict";
import { FRED_SERIES, derivedFacts, fetchMacro, fredApiUrl, fredCsvUrl, parseFredApi, parseFredCsv, seriesFacts, type Observation } from "./macro.ts";
import { redactUrl, type DataDeps } from "./deps.ts";

const def = (id: string) => FRED_SERIES.find((s) => s.id === id)!;
const daily = (vals: number[], start = Date.UTC(2026, 9, 1)): Observation[] => vals.map((value, i) => ({ date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), value }));

test("FRED CSV and API parsing skip missing values", () => {
  assert.deepEqual(parseFredCsv("observation_date,DGS10\n2026-11-17,4.10\n2026-11-18,.\n2026-11-19,4.12\n"), [
    { date: "2026-11-17", value: 4.1 },
    { date: "2026-11-19", value: 4.12 },
  ]);
  assert.throws(() => parseFredCsv("<html>"), /header/);
  assert.deepEqual(parseFredApi({ observations: [{ date: "2026-11-19", value: "4.12" }, { date: "2026-11-18", value: "." }] }), [{ date: "2026-11-19", value: 4.12 }]);
  // The key never reaches a log line or a fixture key.
  assert.ok(!redactUrl(fredApiUrl("DGS10", "2026-01-01", "SECRET")).includes("SECRET"));
  assert.equal(fredCsvUrl("DGS10", "2025-09-25"), "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=2025-09-25");
});

test("daily series: level plus changes over 5 and 20 observations in basis points, percent or points", () => {
  const vals = Array.from({ length: 25 }, (_, i) => 4 + i * 0.01); // 4.00 .. 4.24
  const f = new Map(seriesFacts(def("DGS10"), daily(vals)).map((x) => [x.id, x]));
  assert.equal(f.get("macro.dgs10")!.value, 4.24);
  assert.equal(f.get("macro.dgs10.chg5")!.value, 5);
  assert.equal(f.get("macro.dgs10.chg5")!.unit, "bp");
  assert.equal(f.get("macro.dgs10.chg20")!.value, 20);
  assert.equal(f.get("macro.dgs10")!.source.url, "https://fred.stlouisfed.org/series/DGS10");
  const usd = new Map(seriesFacts(def("DTWEXBGS"), daily([...Array(20).fill(100), 101, 102, 103, 104, 110])).map((x) => [x.id, x]));
  assert.equal(usd.get("macro.dtwexbgs.chg5")!.value, 10);
  assert.equal(usd.get("macro.dtwexbgs.chg5")!.unit, "%");
  const vix = new Map(seriesFacts(def("VIXCLS"), daily([15, 16, 17, 18, 19, 21])).map((x) => [x.id, x]));
  assert.equal(vix.get("macro.vixcls.chg5")!.value, 6);
  assert.equal(vix.get("macro.vixcls.chg5")!.unit, "points");
  assert.ok(!vix.has("macro.vixcls.chg20"));
});

test("monthly series: CPI year over year, payroll change, unemployment level", () => {
  const months = (vals: number[]) => vals.map((value, i) => ({ date: `${2025 + Math.floor((i + 9) / 12)}-${String(((i + 9) % 12) + 1).padStart(2, "0")}-01`, value }));
  const cpi = seriesFacts(def("CPIAUCSL"), months(Array.from({ length: 14 }, (_, i) => 300 + i)));
  // 2025-10 = 300 ... 2026-10 = 312 and 2026-11 = 313: 12 months to November 2026 is 313 / 301.
  assert.equal(cpi[0].id, "macro.cpiaucsl.yoy");
  assert.equal(cpi[0].value, Math.round((313 / 301 - 1) * 10000) / 100);
  assert.match(cpi[0].label, /12 months to November 2026/);
  const pay = seriesFacts(def("PAYEMS"), months([159000, 159120]));
  assert.equal(pay[0].id, "macro.payems.chg");
  assert.equal(pay[0].value, 120);
  assert.equal(seriesFacts(def("UNRATE"), months([4.3]))[0].value, 4.3);
  assert.deepEqual(seriesFacts(def("CPIAUCSL"), months([300])), []);
});

test("derived facts: 2s10s curve, Fed target range, S&P 500 trend", () => {
  const spx = daily(Array.from({ length: 220 }, (_, i) => 5000 + i * 5));
  const f = new Map(
    derivedFacts({
      DGS2: [{ date: "2026-11-19", value: 3.6 }],
      DGS10: [{ date: "2026-11-19", value: 4.12 }],
      DFEDTARL: [{ date: "2026-11-19", value: 3.5 }],
      DFEDTARU: [{ date: "2026-11-19", value: 3.75 }],
      SP500: spx,
    }).map((x) => [x.id, x]),
  );
  assert.equal(f.get("macro.curve2s10s")!.value, 52);
  assert.equal(f.get("macro.fedTarget")!.value, "3.50 to 3.75");
  assert.equal(f.get("macro.sp500.trend")!.value, "above its 50-day and 200-day averages");
});

test("fetchMacro: failures, stale series and future observations become no-reading lines", async () => {
  const csv = (rows: string[]) => `observation_date,X\n${rows.join("\n")}\n`;
  const deps: DataDeps = {
    fetch: async (url) => {
      if (url.includes("id=DGS10")) return { ok: true, status: 200, text: async () => csv(["2026-11-18,4.10", "2026-11-19,4.12", "2026-11-20,9.99"]) };
      if (url.includes("id=DGS2")) return { ok: true, status: 200, text: async () => csv(["2026-10-01,3.50"]) };
      return { ok: false, status: 500, text: async () => "" };
    },
    env: {},
    now: () => new Date("2026-11-19T22:00:00Z"),
    sleep: async () => {},
  };
  const r = await fetchMacro("2026-11-19", deps);
  const f = new Map(r.facts.map((x) => [x.id, x]));
  assert.equal(f.get("macro.dgs10")!.value, 4.12, "the 2026-11-20 observation is after the run date");
  assert.ok(!f.has("macro.dgs2"));
  assert.ok(r.problems.some((p) => /DGS2: newest observation 2026-10-01 is stale/.test(p)));
  assert.ok(r.problems.some((p) => /VIXCLS failed, no reading/.test(p)));
  // With a key, a failing API falls back to the CSV.
  const keyed = await fetchMacro("2026-11-19", { ...deps, env: { FRED_API_KEY: "k" } });
  assert.ok(keyed.facts.some((x) => x.id === "macro.dgs10"));
});
