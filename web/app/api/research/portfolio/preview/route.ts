import { handlePreviewPortfolio } from "@/lib/research/portfolio/handlers";
import { readJson, requestDeps, respond } from "@/lib/research/portfolio/deps";

/**
 * Portfolio check preview: facts about the holdings sent (allocation, overlap, loan health, a
 * borrowing note per holding) and a link to the general research view. No sign-in, nothing saved,
 * never a personal buy or sell order.
 */
export async function POST(request: Request) {
  return respond(await handlePreviewPortfolio(requestDeps(request), await readJson(request)));
}
