import { handleGetPortfolio, handleSavePortfolio } from "@/lib/research/portfolio/handlers";
import { readJson, requestDeps, respond } from "@/lib/research/portfolio/deps";

/**
 * Saved manual holdings for the portfolio check (signed in). GET returns them, PUT saves them.
 * Vault holdings are never stored: they are read from the chain each time. Origin check and rate
 * limiting run in proxy.ts for every /api request.
 */
export async function GET(request: Request) {
  return respond(await handleGetPortfolio(requestDeps(request)));
}

export async function PUT(request: Request) {
  return respond(await handleSavePortfolio(requestDeps(request), await readJson(request)));
}
