import { test } from "node:test";
import assert from "node:assert/strict";
import { EDITOR_SCHEMA } from "./prompts.ts";
import { Ctx } from "./parse.ts";
import { editorJson, parseDraft } from "./review.ts";
import type { Fact } from "../types.ts";

const fact: Fact = { id: "px.1d.last", kind: "price", label: "Close", value: 100, unit: "USD", source: { name: "test" }, asOf: "2026-11-20T21:00:00Z" };
const r = (text: string) => ({ text, factIds: ["px.1d.last"] });
const sc = (p: number) => ({ text: "A scenario.", factIds: ["px.1d.last"], probability: p, levels: [], trigger: "A close above the range." });
const draft = (chart: unknown) =>
  JSON.stringify({ recap: [r("Price closed near 100.")], chart, market: [], news: [], scenarios: { bull: sc(30), base: sc(50), bear: sc(20) }, view: { view: "hold", conviction: "low", reasons: [r("The range held.")] } });

test("the editor schema's chart is one flat list, so the grammar stays small enough to compile", () => {
  const chart = (EDITOR_SCHEMA as unknown as { properties: { chart: { type: string; items: { properties: Record<string, unknown> } } } }).properties.chart;
  assert.equal(chart.type, "array", "an object of per-timeframe lists was rejected by the API as too large (2026-11-25)");
  assert.deepEqual(Object.keys(chart.items.properties).sort(), ["factIds", "interval", "text"]);
});

test("a flat chart list is grouped back by timeframe, and a bad timeframe is refused", () => {
  const p = parseDraft(draft([{ interval: "1w", ...r("Weekly trend is flat.") }, { interval: "1d", ...r("Daily range.") }, { interval: "1d", ...r("Volatility is low.") }]), new Ctx([fact]), []);
  assert.deepEqual(p.draft.chart["1d"]!.map((x) => x.text), ["Daily range.", "Volatility is low."]);
  assert.deepEqual(p.draft.chart["1w"]!.map((x) => x.text), ["Weekly trend is flat."]);
  assert.deepEqual(p.draft.chart["1mo"], []);
  assert.throws(() => parseDraft(draft([{ interval: "4h", ...r("Nope.") }]), new Ctx([fact]), []));
});

test("review and revise see the draft in the editor's own flat shape", () => {
  const p = parseDraft(draft([{ interval: "1d", ...r("Daily range.") }]), new Ctx([fact]), []);
  const j = JSON.parse(editorJson(p.draft));
  assert.ok(Array.isArray(j.chart));
  assert.deepEqual(j.chart[0], { interval: "1d", text: "Daily range.", factIds: ["px.1d.last"] });
});
