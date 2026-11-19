import { handleCreateReport, handleListReports } from "@/lib/research/reports/handlers";
import { readJson, requestDeps, respond } from "@/lib/research/reports/deps";

/**
 * Research reports (docs/research/PLAN.md). Origin check and rate limiting run in proxy.ts for
 * every /api request.
 * POST: build a report for the signed-in wallet (access gate first), save it when the account
 * database is connected, and return it. GET: the signed-in wallet's own past reports.
 */
export async function POST(request: Request) {
  return respond(await handleCreateReport(requestDeps(request), await readJson(request)));
}

export async function GET(request: Request) {
  return respond(await handleListReports(requestDeps(request)));
}
