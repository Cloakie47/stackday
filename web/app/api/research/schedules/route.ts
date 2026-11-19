import { handleListSchedules, handleSaveSchedules } from "@/lib/research/reports/handlers";
import { readJson, requestDeps, respond } from "@/lib/research/reports/deps";

/** Scheduled research reports for the signed-in wallet. PUT and POST both save (add, change or switch off). */
export async function GET(request: Request) {
  return respond(await handleListSchedules(requestDeps(request)));
}

export async function PUT(request: Request) {
  return respond(await handleSaveSchedules(requestDeps(request), await readJson(request)));
}

export const POST = PUT;
