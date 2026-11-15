import { json } from "@/lib/server/backend";
import { validateSnapshot } from "@/lib/themes/mood";
import snapshot from "@/lib/themes/mood-snapshot.json";

/**
 * Public: the Market Mood snapshot for Themes. This is a hand-built, labelled snapshot (see its
 * `label` and `method` fields), not live data. It is checked against the strict schema on the
 * way out, so a bad edit to the file drops the bad entries instead of reaching the app.
 */
export function GET() {
  const valid = validateSnapshot(snapshot);
  if (!valid) return json({ error: "The mood snapshot is not valid." }, 500);
  return json(valid);
}
