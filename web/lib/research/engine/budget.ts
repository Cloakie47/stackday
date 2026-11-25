import { DEFAULT_CALL_TIMEOUT_MS, worstCaseCost, type ModelFn, type ModelRequest, type ModelResult } from "./model.ts";

/**
 * Spend and time guard for one run. Before each model call the worst case cost of that call is
 * reserved; if the run would pass its cap it throws `CostAbort`, the run stops and writes nothing.
 * The cap is the smaller of the per-run cap and what is left of the per-day cap (today's spend is
 * the sum of today's research_runs costs, read before the run starts).
 *
 * Every reservation is written to the run's row (`record`) BEFORE the call is made, so a run that is
 * killed mid-call (for example by the Vercel time limit) still counts its worst case in the day's
 * spend. If that write fails, the call is not made.
 *
 * The run also has a time limit: a call gets at most the time left (minus a margin), and no call
 * starts with less than `MIN_CALL_MS` left; that step fails instead of overrunning the route.
 */

export class CostAbort extends Error {}

export type CallLog = {
  step: string;
  model: string;
  costUsd: number;
  input: number;
  output: number;
  cacheRead: number;
  stopReason?: string | null;
  /** Raw model output, kept with the run for reproducibility. */
  text?: string;
  skipped?: string;
  /** Why the call failed: HTTP status, error type and a short message (never a key or header). */
  error?: string;
};

/** A short, safe description of a failed model call, for the run row, the logs and the problems list. */
export function describeError(e: unknown): string {
  const o = (typeof e === "object" && e !== null ? e : {}) as { status?: unknown; name?: unknown; message?: unknown; error?: { error?: { type?: unknown } } };
  const status = typeof o.status === "number" ? String(o.status) : "";
  const type = typeof o.error?.error?.type === "string" ? o.error.error.type : typeof o.name === "string" ? o.name : "";
  const msg = (typeof o.message === "string" ? o.message : String(e)).replace(/sk-ant-[\w-]+/g, "[key]").replace(/\s+/g, " ").slice(0, 200);
  return [status, type, msg].filter(Boolean).join(" ");
}

/**
 * True when the API refused the request before running the model (a 4xx other than 408 timeout,
 * or a connection that never got through), so nothing was billed. Timeouts and 5xx keep the
 * worst-case figure, because the model may have run.
 */
export function notBilled(e: unknown): boolean {
  const o = (typeof e === "object" && e !== null ? e : {}) as { status?: unknown; name?: unknown };
  if (typeof o.status === "number") return o.status >= 400 && o.status < 500 && o.status !== 408;
  return o.name === "APIConnectionError";
}

/** The distinct errors of a run's failed calls, for the problems list (at most `max`). */
export function callErrors(calls: CallLog[], max = 3): string[] {
  const seen = new Map<string, string[]>();
  for (const c of calls) if (c.error) seen.set(c.error, [...(seen.get(c.error) ?? []), c.step]);
  return [...seen.entries()].slice(0, max).map(([err, steps]) => `model call failed (${steps.length}x, ${steps.slice(0, 3).join(", ")}): ${err}`);
}

/** No model call starts with less time than this left in the run. */
export const MIN_CALL_MS = 20_000;
/** Time kept free at the end of a run for the final checks and writes. */
export const END_MARGIN_MS = 10_000;

export function costBudget(opts: {
  maxRunUsd: number;
  maxDayUsd: number;
  spentTodayUsd: number;
  /** Label of the run cap in the abort message, for example "weekly cap $4 (spent this week $1.20)". */
  runCapLabel?: string;
  /** Writes the run's spend so far (settled plus reserved). Awaited before every call. */
  record?: (usd: number) => Promise<void>;
  /** Writes the raw outputs so far after every call (best effort), so a killed run keeps them. */
  recordOutputs?: (calls: CallLog[]) => Promise<void>;
  /** Time limit of the whole run in ms, counted from when the budget is made. */
  timeLimitMs?: number;
  clock?: () => number;
}) {
  const dayLeft = opts.maxDayUsd - opts.spentTodayUsd;
  const cap = Math.min(opts.maxRunUsd, dayLeft);
  const which = dayLeft < opts.maxRunUsd ? `day cap $${opts.maxDayUsd} (spent today $${opts.spentTodayUsd.toFixed(2)})` : (opts.runCapLabel ?? `run cap $${opts.maxRunUsd}`);
  const clock = opts.clock ?? Date.now;
  const deadline = opts.timeLimitMs === undefined ? null : clock() + opts.timeLimitMs;
  let spent = 0;
  let reserved = 0;
  const calls: CallLog[] = [];
  let inFlight = 0;
  let idleWaiters: (() => void)[] = [];
  let outChain: Promise<void> = Promise.resolve();
  // Writes run one after another, each with the value at the time it runs, so the row never goes
  // back to an older, lower figure.
  let chain: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    if (!opts.record) return Promise.resolve();
    const record = opts.record;
    const next = chain.then(() => record(spent + reserved));
    chain = next.catch(() => {});
    return next;
  };
  const budget = {
    cap,
    calls,
    get spent() {
      return spent;
    },
    /** Milliseconds a call may still take, or null when the run has no time limit. */
    timeLeft(): number | null {
      return deadline === null ? null : deadline - END_MARGIN_MS - clock();
    },
    /** What may still be reserved: the cap minus settled and reserved spend. */
    headroom(): number {
      return cap - spent - reserved;
    },
    /**
     * Throws CostAbort, before any call, when a group of calls that run together (for example the
     * four analysts) would not fit in what is left, so no part of the group is paid for nothing.
     */
    ensure(worst: number, what: string) {
      if (!(cap > 0) || spent + reserved + worst > cap)
        throw new CostAbort(`cost guard: ${what} needs up to $${worst.toFixed(2)} and the ${which} leaves $${Math.max(0, cap - spent - reserved).toFixed(2)}`);
    },
    reserve(worst: number) {
      if (!(cap > 0) || spent + reserved + worst > cap) throw new CostAbort(`cost guard: the run would pass the ${which}`);
      reserved += worst;
    },
    /** Reserves and records the reservation before the call. */
    async hold(worst: number) {
      budget.reserve(worst);
      try {
        await persist();
      } catch {
        reserved -= worst;
        throw new CostAbort("cost guard: the run's spend could not be recorded, so no model call was made");
      }
    },
    settle(worst: number, actual: number) {
      reserved -= worst;
      spent += actual;
    },
    begin() {
      inFlight++;
    },
    end() {
      inFlight--;
      if (inFlight === 0) {
        const w = idleWaiters;
        idleWaiters = [];
        w.forEach((f) => f());
      }
    },
    /** Resolves when no call is in flight, so a run never finishes while it is still paying for one. */
    idle(): Promise<void> {
      return inFlight === 0 ? Promise.resolve() : new Promise((r) => idleWaiters.push(r));
    },
    /** Writes the outputs so far (best effort, one write after another so the row never goes back). */
    logOutputs(): Promise<void> {
      if (!opts.recordOutputs) return Promise.resolve();
      const record = opts.recordOutputs;
      const snapshot = calls.slice();
      outChain = outChain.then(() => record(snapshot)).catch(() => {});
      return outChain;
    },
    /** Waits for pending output writes (before the run writes its final outputs). */
    drain(): Promise<void> {
      return outChain;
    },
    /** Records the settled spend (best effort: finishing the run writes the final figure). */
    async flush() {
      await persist().catch(() => {});
    },
  };
  return budget;
}
export type Budget = ReturnType<typeof costBudget>;

/**
 * Calls the model through the budget. A model or network error, or too little time left, comes
 * back as null (the step failed); a cost abort is rethrown so the whole run stops.
 */
export async function guardedCall(model: ModelFn, req: ModelRequest, budget: Budget): Promise<ModelResult | null> {
  const left = budget.timeLeft();
  if (left !== null && left < MIN_CALL_MS) {
    budget.calls.push({ step: req.step, model: req.model, costUsd: 0, input: 0, output: 0, cacheRead: 0, skipped: "not enough time left in the run" });
    return null;
  }
  const timed: ModelRequest = { ...req, timeoutMs: Math.min(req.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, left ?? Infinity) };
  const worst = worstCaseCost(timed);
  await budget.hold(worst);
  budget.begin();
  let actual = worst;
  try {
    const res = await model(timed);
    actual = Number.isFinite(res.costUsd) ? res.costUsd : worst;
    budget.calls.push({ step: req.step, model: req.model, costUsd: actual, input: res.usage.input, output: res.usage.output, cacheRead: res.usage.cacheRead, stopReason: res.stopReason, text: res.raw ?? res.text });
    return res;
  } catch (e) {
    if (e instanceof CostAbort) throw e;
    const error = describeError(e);
    if (notBilled(e)) actual = 0;
    console.error(`research model call failed: ${req.step} (${req.model}): ${error}`);
    budget.calls.push({ step: req.step, model: req.model, costUsd: actual, input: 0, output: 0, cacheRead: 0, stopReason: "error", error });
    return null;
  } finally {
    budget.settle(worst, actual);
    void budget.logOutputs();
    await budget.flush();
    budget.end();
  }
}

/**
 * Like Promise.all, but waits for every promise to settle before rethrowing the first error, so a
 * cost abort in one call of a parallel group never leaves the others running unaccounted.
 */
export async function settleAll<T>(ps: Promise<T>[]): Promise<T[]> {
  const res = await Promise.allSettled(ps);
  const bad = res.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (bad) throw bad.reason;
  return res.map((r) => (r as PromiseFulfilledResult<T>).value);
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
