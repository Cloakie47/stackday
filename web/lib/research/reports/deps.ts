import { randomUUID } from "node:crypto";
import { sessionWallet } from "../../server/backend.ts";
import { checkReportAccess, consumeReportCredit } from "../access/gate.ts";
import type { Deps, Result } from "./handlers.ts";
import { fetchSnapshotLoader } from "./snapshot-loader.ts";
import { researchStore } from "./store.ts";

/** Real dependencies for one request: session cookie, Supabase (if connected), access gate, snapshot route. */
export function requestDeps(request: Request): Deps {
  return {
    wallet: sessionWallet(request),
    store: researchStore(),
    loadSnapshot: fetchSnapshotLoader(request.url),
    checkAccess: checkReportAccess,
    consumeCredit: consumeReportCredit,
    now: () => new Date(),
    newId: randomUUID,
    // Only the place and the message: never request bodies, wallets or keys.
    onError: (where, e) => console.error(`research ${where}:`, e instanceof Error ? e.message : "error"),
  };
}

/** Largest request body the research routes read, in bytes. */
export const MAX_BODY_BYTES = 32_000;

/** Reads a JSON body, refusing anything too large or not JSON. Returns undefined on failure. */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const respond = (r: Result) => Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
