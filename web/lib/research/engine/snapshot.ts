import sample from "../sample-snapshot.json" with { type: "json" };
import type { ResearchSnapshot } from "../types.ts";
import { trackRecord, type TrackRecord } from "./history.ts";
import type { ResearchStore } from "./store.ts";
import { isSnapshot } from "./validate.ts";

/**
 * What the public routes serve. The latest live snapshot when there is one, otherwise the
 * hand-written sample (kind "sample", which the UI labels "Sample data"). Any database problem
 * falls back to the sample too, so the research pages keep working with no keys set.
 */

export function sampleSnapshot(): ResearchSnapshot {
  const s = sample as unknown;
  if (!isSnapshot(s) || s.kind !== "sample") throw new Error("sample-snapshot.json is invalid");
  return s;
}

export async function publicSnapshot(store: ResearchStore | null): Promise<ResearchSnapshot> {
  if (store) {
    try {
      const live = await store.latestSnapshot();
      if (live && live.notes.length > 0) return live;
    } catch {
      // fall through to the sample
    }
  }
  return sampleSnapshot();
}

export type AssetHistory = {
  kind: "live" | "sample";
  assetId: string;
  notes: {
    date: string;
    status: string;
    action: string;
    confidence: string;
    summary: string;
    levels: ResearchSnapshot["notes"][number]["levels"];
    model: ResearchSnapshot["notes"][number]["model"];
  }[];
  track: TrackRecord;
};

export const HISTORY_LIMIT = 120;

export async function assetHistory(store: ResearchStore | null, assetId: string): Promise<AssetHistory> {
  let kind: AssetHistory["kind"] = "sample";
  let notes = sampleSnapshot().notes.filter((n) => n.assetId === assetId);
  if (store) {
    try {
      const live = await store.history(assetId, HISTORY_LIMIT);
      if (live.length > 0) {
        notes = live;
        kind = "live";
      }
    } catch {
      // keep the sample
    }
  }
  return {
    kind,
    assetId,
    notes: notes.map((n) => ({ date: n.date, status: n.status, action: n.action, confidence: n.confidence, summary: n.summary, levels: n.levels, model: n.model })),
    track: trackRecord(assetId, kind === "live" ? notes : []),
  };
}
