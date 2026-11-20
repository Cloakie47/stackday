import { VIEW_LABEL, VIEWS, type Fact, type IsoDate, type MarketOverview, type Reasoned, type ResearchNote } from "../types.ts";
import { universeAsset } from "../universe.ts";

/**
 * The daily market overview, built in code from the finished notes (no extra model call): a count
 * of views and the notes whose view changed today. Fact ids are prefixed with the asset id
 * ("mNVDA:px.1d.last") so they stay unique across notes.
 */

const MAX_DEVELOPMENTS = 6;

export function buildMarketOverview(date: IsoDate, notes: ResearchNote[]): MarketOverview {
  const fresh = notes.filter((n) => n.status === "ok");
  const carried = notes.filter((n) => n.status === "carried").length;
  const missing = notes.filter((n) => n.status === "no-reading").length;
  const counts = VIEWS.map((v) => `${fresh.filter((n) => n.view === v).length} ${VIEW_LABEL[v]}`).join(", ");

  const parts = [
    `Views across ${fresh.length} fresh notes: ${counts}.`,
    carried ? `${carried} carried forward because their market was closed.` : "",
    missing ? `${missing} with no reading today.` : "",
    "General research only, not advice.",
  ];

  const facts: Fact[] = [];
  const developments: Reasoned[] = [];
  const changed = fresh.filter((n) => n.previousView && n.previousView !== n.view);
  for (const n of changed.slice(0, MAX_DEVELOPMENTS)) {
    const reason = n.reasons[0];
    if (!reason) continue;
    const ids = reason.factIds.map((id) => `${n.assetId}:${id}`);
    for (const f of n.facts) if (reason.factIds.includes(f.id)) facts.push({ ...f, id: `${n.assetId}:${f.id}` });
    const name = universeAsset(n.assetId)?.name ?? n.assetId;
    developments.push({ text: `${name}: view changed from ${VIEW_LABEL[n.previousView!]} to ${VIEW_LABEL[n.view]}. ${reason.text}`, factIds: ids });
  }

  return { date, summary: parts.filter(Boolean).join(" "), developments, facts };
}
