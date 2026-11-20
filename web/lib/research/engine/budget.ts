import { worstCaseCost, type ModelFn, type ModelRequest, type ModelResult } from "./model.ts";

/**
 * Spend guard for one run. Before each model call the worst case cost of that call is reserved;
 * if the run would pass its cap it throws `CostAbort`, the run stops and writes nothing.
 * The cap is the smaller of the per-run cap and what is left of the per-day cap (today's spend is
 * the sum of today's research_runs costs, read before the run starts).
 */

export class CostAbort extends Error {}

export type CallLog = { step: string; model: string; costUsd: number; input: number; output: number; cacheRead: number };

export function costBudget(opts: { maxRunUsd: number; maxDayUsd: number; spentTodayUsd: number }) {
  const dayLeft = opts.maxDayUsd - opts.spentTodayUsd;
  const cap = Math.min(opts.maxRunUsd, dayLeft);
  const which = dayLeft < opts.maxRunUsd ? `day cap $${opts.maxDayUsd} (spent today $${opts.spentTodayUsd.toFixed(2)})` : `run cap $${opts.maxRunUsd}`;
  let spent = 0;
  let reserved = 0;
  const calls: CallLog[] = [];
  return {
    cap,
    calls,
    get spent() {
      return spent;
    },
    reserve(worst: number) {
      if (!(cap > 0) || spent + reserved + worst > cap) throw new CostAbort(`cost guard: the run would pass the ${which}`);
      reserved += worst;
    },
    settle(worst: number, actual: number) {
      reserved -= worst;
      spent += actual;
    },
  };
}
export type Budget = ReturnType<typeof costBudget>;

/**
 * Calls the model through the budget. A model or network error comes back as null (the step
 * failed); a cost abort is rethrown so the whole run stops.
 */
export async function guardedCall(model: ModelFn, req: ModelRequest, budget: Budget): Promise<ModelResult | null> {
  const worst = worstCaseCost(req);
  budget.reserve(worst);
  let actual = worst;
  try {
    const res = await model(req);
    actual = Number.isFinite(res.costUsd) ? res.costUsd : worst;
    budget.calls.push({ step: req.step, model: req.model, costUsd: actual, input: res.usage.input, output: res.usage.output, cacheRead: res.usage.cacheRead });
    return res;
  } catch (e) {
    if (e instanceof CostAbort) throw e;
    budget.calls.push({ step: req.step, model: req.model, costUsd: actual, input: 0, output: 0, cacheRead: 0 });
    return null;
  } finally {
    budget.settle(worst, actual);
  }
}

/** Runs `fn` over items, `size` at a time. After the first error no new item starts; the error is rethrown. */
export async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let firstError: unknown;
  const worker = async () => {
    while (next < items.length && firstError === undefined) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (e) {
        firstError ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, size) }, worker));
  if (firstError !== undefined) throw firstError;
  return out;
}
