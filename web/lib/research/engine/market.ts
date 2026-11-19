import type { Fact, IsoDate, MarketOverview, Reasoned, ResearchNote } from "../types.ts";
import { universeAsset } from "../universe.ts";

/**
 * The daily market overview, built in code from the finished notes (no extra model call): a count
 * of suggested actions and the notes whose suggestion changed today. Fact ids are prefixed with the
 * asset id ("mNVDA:px.last") so they stay unique across notes.
 */

const MAX_DEVELOPMENTS = 6;

export function buildMarketOverview(date: IsoDate, notes: ResearchNote[]): MarketOverview {
  const fresh = notes.filter((n) => n.status === "ok");
  const count = (a: string) => fresh.filter((n) => n.action === a).length;
  const carried = notes.filter((n) => n.status === "carried").length;
  const missing = notes.filter((n) => n.status === "no-reading").length;

  const parts = [
    `Suggested actions across ${fresh.length} fresh notes: ${count("buy")} Buy, ${count("hold")} Hold, ${count("sell")} Sell, ${count("watch")} Watch.`,
    carried ? `${carried} carried forward because their market was closed.` : "",
    missing ? `${missing} with no reading today.` : "",
    "Research only, not advice.",
  ];

  const facts: Fact[] = [];
  const developments: Reasoned[] = [];
  const changed = fresh.filter((n) => n.previousAction && n.previousAction !== n.action);
  for (const n of changed.slice(0, MAX_DEVELOPMENTS)) {
    const reason = n.reasons[0];
    if (!reason) continue;
    const ids = reason.factIds.map((id) => `${n.assetId}:${id}`);
    for (const f of n.facts) if (reason.factIds.includes(f.id)) facts.push({ ...f, id: `${n.assetId}:${f.id}` });
    const name = universeAsset(n.assetId)?.name ?? n.assetId;
    developments.push({ text: `${name}: suggestion changed from ${n.previousAction} to ${n.action}. ${reason.text}`, factIds: ids });
  }

  return { date, summary: parts.filter(Boolean).join(" "), developments, facts };
}
