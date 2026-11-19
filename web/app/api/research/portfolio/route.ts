import { handleGetPortfolio, handlePreviewPortfolio, handleSavePortfolio } from "@/lib/research/reports/handlers";
import { readJson, requestDeps, respond } from "@/lib/research/reports/deps";

/**
 * Research portfolio. GET: saved manual holdings, horizon and risk. PUT: save them (signed in;
 * vault holdings are never stored, they are read from the chain each time). POST: a summary-depth
 * analysis of the holdings sent, saved nowhere.
 */
export async function GET(request: Request) {
  return respond(await handleGetPortfolio(requestDeps(request)));
}

export async function PUT(request: Request) {
  return respond(await handleSavePortfolio(requestDeps(request), await readJson(request)));
}

export async function POST(request: Request) {
  return respond(await handlePreviewPortfolio(requestDeps(request), await readJson(request)));
}
