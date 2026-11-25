import { test } from "node:test";
import assert from "node:assert/strict";
import { FRED_SERIES, NEVER, derivedFacts, fetchMacro, fredApiUrl, fredCsvUrl, h10Release, h15Release, isFedHoliday, parseFredApi, parseFredCsv, releasedBy, releasedFrom, restrictFacts, seriesFacts, type Observation } from "./macro.ts";
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
      if (url.includes("id=DGS10")) return { ok: true, status: 200, text: async () => csv(["2026-11-18,4.10", "2026-11-19,4.12", "2026-11-20,9.99", "2026-11-21,9.99"]) };
      if (url.includes("id=DGS2")) return { ok: true, status: 200, text: async () => csv(["2026-10-01,3.50"]) };
      return { ok: false, status: 500, text: async () => "" };
    },
    env: {},
    now: () => new Date("2026-11-20T22:00:00Z"),
    sleep: async () => {},
  };
  const r = await fetchMacro("2026-11-20", deps);
  const f = new Map(r.facts.map((x) => [x.id, x]));
  // 2026-11-21 is after the run date; H.15 posts 2026-11-19 on 2026-11-20 at 4:15 p.m., after the 12:00 UTC run.
  assert.equal(f.get("macro.dgs10")!.value, 4.1, "H.15 rates are used the day after their release");
  assert.ok(!f.has("macro.dgs2"));
  assert.ok(r.problems.some((p) => /DGS2: newest observation 2026-10-01 is stale/.test(p)));
  assert.ok(r.problems.some((p) => /VIXCLS failed, no reading/.test(p)));
  // With a key, a failing API falls back to the CSV.
  const keyed = await fetchMacro("2026-11-20", { ...deps, env: { FRED_API_KEY: "k" } });
  assert.ok(keyed.facts.some((x) => x.id === "macro.dgs10"));
});

test("release lag: October CPI is not visible on October 20, and a release day does not see its own release", () => {
  const cpi = def("CPIAUCSL");
  const obs = ["2026-08-01", "2026-09-01", "2026-10-01"].map((date, i) => ({ date, value: 320 + i }));
  // September 2026 CPI: BLS release 2026-10-14, used from 2026-10-15. October CPI: release 2026-11-10, used from 2026-11-11.
  assert.deepEqual(releasedBy(cpi, obs, "2026-10-20").map((o) => o.date), ["2026-08-01", "2026-09-01"]);
  assert.deepEqual(releasedBy(cpi, obs, "2026-10-14").map((o) => o.date), ["2026-08-01"]);
  assert.deepEqual(releasedBy(cpi, obs, "2026-10-15").map((o) => o.date), ["2026-08-01", "2026-09-01"]);
  assert.equal(releasedFrom(cpi, "2026-10-01"), "2026-11-11");
  assert.deepEqual(releasedBy(cpi, obs, "2026-11-10").map((o) => o.date), ["2026-08-01", "2026-09-01"]);
  assert.deepEqual(releasedBy(cpi, obs, "2026-11-11").map((o) => o.date), ["2026-08-01", "2026-09-01", "2026-10-01"]);
  // Payrolls and unemployment: the jobs report date when checked in (October 2026 on 2026-11-06), else the 11th.
  assert.equal(releasedFrom(def("PAYEMS"), "2026-10-01"), "2026-11-07");
  assert.equal(releasedFrom(def("UNRATE"), "2027-09-01"), "2027-10-09"); // second Friday, October 8, 2027
  assert.equal(releasedFrom(def("CPILFESL"), "2028-01-01"), "2028-02-16");
  // Daily closes (VIX, S&P 500, target range): the day after.
  assert.equal(releasedFrom(def("VIXCLS"), "2026-11-20"), "2026-11-21");
});

test("release lag in the 2025 shutdown: delayed and cancelled BLS releases are never seen early", () => {
  // September 2025 jobs report came out on 2025-11-20 (scheduled 2025-10-03), not in October.
  assert.equal(releasedFrom(def("PAYEMS"), "2025-09-01"), "2025-11-21");
  assert.equal(releasedFrom(def("UNRATE"), "2025-09-01"), "2025-11-21");
  // October 2025 payrolls were published with November's on 2025-12-16.
  assert.equal(releasedFrom(def("PAYEMS"), "2025-10-01"), "2025-12-17");
  assert.equal(releasedFrom(def("PAYEMS"), "2025-11-01"), "2025-12-17");
  // September 2025 CPI on 2025-10-24; October 2025 CPI was never published; November 2025 on 2025-12-18.
  assert.equal(releasedFrom(def("CPIAUCSL"), "2025-09-01"), "2025-10-25");
  assert.equal(releasedFrom(def("CPIAUCSL"), "2025-10-01"), NEVER);
  assert.equal(releasedFrom(def("CPILFESL"), "2025-11-01"), "2025-12-19");
  // January 2026: CPI moved to 2026-02-13 and jobs to 2026-02-11 by the early 2026 lapse.
  assert.equal(releasedFrom(def("CPIAUCSL"), "2026-01-01"), "2026-02-14");
  assert.equal(releasedFrom(def("PAYEMS"), "2026-01-01"), "2026-02-12");
  const jobs = def("PAYEMS");
  const obs = ["2025-08-01", "2025-09-01", "2025-10-01", "2025-11-01"].map((date, i) => ({ date, value: 159_000 + i }));
  assert.deepEqual(releasedBy(jobs, obs, "2025-11-17").map((o) => o.date), ["2025-08-01"]);
  assert.deepEqual(releasedBy(jobs, obs, "2025-11-24").map((o) => o.date), ["2025-08-01", "2025-09-01"]);
  assert.deepEqual(releasedBy(jobs, obs, "2025-12-22").map((o) => o.date), ["2025-08-01", "2025-09-01", "2025-10-01", "2025-11-01"]);
});

test("H.15 and H.10 publish in the afternoon: their same-day values are not visible to a 12:00 UTC run", () => {
  // H.15: day D is posted on the next Federal Reserve business day at 4:15 p.m.
  assert.equal(h15Release("2026-11-19"), "2026-11-20"); // Thursday's rates on Friday
  assert.equal(h15Release("2026-11-20"), "2026-11-23"); // Friday's rates on Monday afternoon
  assert.equal(releasedFrom(def("DGS10"), "2026-11-20"), "2026-11-24");
  assert.equal(releasedFrom(def("DGS10"), "2026-11-19"), "2026-11-21");
  const ylds = ["2026-11-18", "2026-11-19", "2026-11-20"].map((date, i) => ({ date, value: 4 + i / 100 }));
  assert.deepEqual(releasedBy(def("DGS2"), ylds, "2026-11-23").map((o) => o.date), ["2026-11-18", "2026-11-19"], "Monday run sees Thursday, not Friday");
  // Federal Reserve holidays push the release: Veterans Day (Wednesday 2026-11-11) and Thanksgiving.
  assert.equal(isFedHoliday("2026-11-11"), true);
  assert.equal(isFedHoliday("2026-11-26"), true);
  assert.equal(isFedHoliday("2027-07-05"), true, "July 4, 2027 is a Sunday, observed Monday");
  assert.equal(isFedHoliday("2027-12-24"), true, "Christmas 2027 is a Saturday: the Board is closed on Friday");
  assert.equal(isFedHoliday("2026-07-03"), true, "July 4, 2026 is a Saturday: the Board is closed on Friday July 3");
  assert.equal(isFedHoliday("2027-12-31"), true, "New Year's Day 2028 is a Saturday");
  assert.equal(isFedHoliday("2026-11-27"), false, "the day after Thanksgiving is a business day");
  assert.equal(h15Release("2026-07-02"), "2026-07-06", "Thursday July 2 is published on Monday July 6");
  assert.equal(h15Release("2026-11-10"), "2026-11-12");
  assert.equal(h15Release("2026-11-25"), "2026-11-27");
  // H.10: weekly on Monday afternoon for the week before; Tuesday after a Monday holiday.
  assert.equal(h10Release("2026-11-16"), "2026-11-23");
  assert.equal(h10Release("2026-11-20"), "2026-11-23");
  assert.equal(releasedFrom(def("DTWEXBGS"), "2026-11-20"), "2026-11-24");
  assert.equal(h10Release("2026-10-09"), "2026-10-13", "Columbus Day Monday 2026-10-12");
  const usd = ["2026-11-12", "2026-11-13", "2026-11-16", "2026-11-20"].map((date) => ({ date, value: 120 }));
  assert.deepEqual(releasedBy(def("DTWEXBGS"), usd, "2026-11-23").map((o) => o.date), ["2026-11-12", "2026-11-13"], "Monday run sees the week before last only");
});

test("fetchMacro: October CPI dated 2026-10-01 is not used in an October 20 run (backfill)", async () => {
  const months = ["2025-08-01", "2025-09-01", "2025-10-01", "2026-08-01", "2026-09-01", "2026-10-01"];
  const deps: DataDeps = {
    fetch: async (url) => (url.includes("id=CPIAUCSL") ? { ok: true, status: 200, text: async () => `observation_date,CPIAUCSL\n${months.map((d, i) => `${d},${300 + i}`).join("\n")}\n` } : { ok: false, status: 500, text: async () => "" }),
    env: {},
    now: () => new Date("2026-11-22T12:00:00Z"),
    sleep: async () => {},
  };
  const r = await fetchMacro("2026-10-20", deps);
  const yoy = r.facts.find((x) => x.id === "macro.cpiaucsl.yoy")!;
  assert.match(yoy.label, /12 months to September 2026/);
  assert.equal(yoy.value, Math.round((304 / 301 - 1) * 10000) / 100);
  assert.ok(r.problems.some((p) => /backfill for 2026-10-20 uses today's revised values/.test(p)));
});

test("backfill with a key asks ALFRED for the vintage as of the run date; a live run does not", async () => {
  const u = new URL(fredApiUrl("CPIAUCSL", "2024-01-01", "k", "2026-10-20"));
  assert.equal(u.searchParams.get("realtime_start"), "2026-10-20");
  assert.equal(u.searchParams.get("realtime_end"), "2026-10-20");
  assert.equal(new URL(fredApiUrl("CPIAUCSL", "2024-01-01", "k")).searchParams.get("realtime_start"), null);
  const seen: string[] = [];
  const deps: DataDeps = {
    fetch: async (url) => {
      seen.push(url);
      return { ok: false, status: 500, text: async () => "" };
    },
    env: { FRED_API_KEY: "k" },
    now: () => new Date("2026-11-22T12:00:00Z"),
    sleep: async () => {},
  };
  const back = await fetchMacro("2026-10-20", deps);
  assert.ok(seen.filter((x) => x.includes("api.stlouisfed.org")).every((x) => x.includes("realtime_start=2026-10-20")));
  assert.ok(!back.problems.some((p) => /backfill for .* uses today's revised values/.test(p)));
  seen.length = 0;
  await fetchMacro("2026-11-22", deps);
  assert.ok(seen.filter((x) => x.includes("api.stlouisfed.org")).every((x) => !x.includes("realtime_start")));
});

test("S&P 500 and VIX facts are display false unless RESEARCH_SHOW_SP_VIX is set", () => {
  const spx = daily(Array.from({ length: 220 }, (_, i) => 5000 + i * 5));
  const facts = [...seriesFacts(def("VIXCLS"), daily(Array.from({ length: 25 }, (_, i) => 15 + i * 0.1))), ...seriesFacts(def("SP500"), spx), ...derivedFacts({ SP500: spx }), ...seriesFacts(def("DGS10"), daily([4, 4.1]))];
  const off = new Map(restrictFacts(facts, {}).map((x) => [x.id, x]));
  for (const id of ["macro.vixcls", "macro.vixcls.chg5", "macro.vixcls.chg20", "macro.sp500.chg5", "macro.sp500.chg20", "macro.sp500.trend"]) assert.equal(off.get(id)!.display, false, id);
  assert.equal(off.get("macro.dgs10")!.display, undefined);
  assert.equal(off.get("macro.vixcls")!.source.display, false, "the source is marked too");
  for (const v of ["1", "true"]) for (const x of restrictFacts(facts, { RESEARCH_SHOW_SP_VIX: v })) assert.equal(x.display, undefined, x.id);
});

test("a failed ALFRED call that falls back to the CSV says it used revised values", async () => {
  const csv = `observation_date,DGS10\n${Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")},${4 + i / 100}`).join("\n")}\n`;
  const deps: DataDeps = {
    fetch: async (url) => (url.includes("api.stlouisfed.org") ? { ok: false, status: 500, text: async () => "" } : url.includes("id=DGS10") ? { ok: true, status: 200, text: async () => csv } : { ok: false, status: 500, text: async () => "" }),
    env: { FRED_API_KEY: "k" },
    now: () => new Date("2026-11-22T12:00:00Z"),
    sleep: async () => {},
  };
  const r = await fetchMacro("2026-10-28", deps);
  assert.ok(r.facts.some((x) => x.id === "macro.dgs10"), "the CSV value is still used");
  assert.ok(r.problems.some((p) => /FRED DGS10: ALFRED vintage for 2026-10-28 failed \(HTTP 500 .*\), used today's revised values from the public CSV/.test(p)), r.problems.join(" | "));
  for (const p of r.problems) assert.ok(!p.includes("api_key=k"), "no key in problems");
  // A live run that falls back is not a vintage problem.
  const live = await fetchMacro("2026-11-22", deps);
  assert.ok(!live.problems.some((p) => /ALFRED vintage/.test(p)));
});
