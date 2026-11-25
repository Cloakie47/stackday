import Anthropic from "@anthropic-ai/sdk";

/**
 * The one swappable server function that talks to a model. Everything else in the engine only sees
 * the `ModelFn` type, so a different provider or a test fake plugs in here and nowhere else.
 * Which model each step uses is chosen in one place: `RESEARCH_MODELS` in ../flags.ts.
 *
 * Server only: the SDK reads ANTHROPIC_API_KEY from the environment and it is never logged.
 * The SDK is pinned to an exact version in web/package.json.
 */

export type Effort = "low" | "medium" | "high";

export type ModelRequest = {
  /** Exact model id, for example "claude-haiku-5-5". */
  model: string;
  /** Short name of the step for logs and tests, for example "daily.triage" or "weekly.bull". */
  step: string;
  /** Frozen instructions, identical across calls of a run, sent with a cache breakpoint. */
  system: string;
  /**
   * Optional shared context (for example one asset's fact list) sent first in the user turn with a
   * second cache breakpoint, so several steps on the same asset read it from the cache.
   */
  context?: string;
  /** The step's own instructions and inputs. */
  user: string;
  /** JSON schema the answer must follow (structured outputs). The answer is still validated in code. */
  schema: Record<string, unknown>;
  maxTokens: number;
  effort: Effort;
  /**
   * Wall-clock limit for this call, in ms: one attempt may use all of it, and a retry after a
   * transient error only gets what is left. `guardedCall` caps it at the run's time left so a slow
   * model can never push a route past its Vercel limit.
   */
  timeoutMs?: number;
};

export type ModelUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ModelResult = {
  /** The model's text answer (expected to be JSON). Empty when it gave none or stopped early. */
  text: string;
  /** Everything the model wrote, even when it stopped early. Logged with the run for reproducibility. */
  raw?: string;
  model: string;
  stopReason: string | null;
  usage: ModelUsage;
  costUsd: number;
};

export type ModelFn = (req: ModelRequest) => Promise<ModelResult>;

/** USD per million tokens (Anthropic list prices). Cache writes cost 1.25 x input (5 minute cache). */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

export function costOf(model: string, u: ModelUsage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for model ${model}`);
  return (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1_000_000;
}

/**
 * Conservative token count of a prompt: 2 characters per token. English is usually 3.5 to 4, but
 * numbers, ids and JSON tokenize much worse, and the reservation must never undershoot.
 */
export const approxTokens = (s: string) => Math.ceil(s.length / 2);

/**
 * Highest possible cost of one call, reserved before the call: every input token billed as a cache
 * write (1.25 x input, because system and context carry cache breakpoints) and every output token
 * used (thinking counts as output).
 */
export function worstCaseCost(req: Pick<ModelRequest, "model" | "system" | "context" | "user" | "maxTokens">): number {
  const input = approxTokens(req.system) + approxTokens(req.context ?? "") + approxTokens(req.user) + 500;
  return costOf(req.model, { input: 0, output: req.maxTokens, cacheRead: 0, cacheWrite: input });
}

/** Default wall-clock limit of one call when the caller sets none. */
export const DEFAULT_CALL_TIMEOUT_MS = 120_000;

/**
 * Smallest max_tokens any step may use. Thinking is adaptive and always on for these models (effort
 * only sets how much), and thinking tokens count toward max_tokens. A step that runs out returns no
 * answer but is still billed, so every step leaves room for thinking plus its JSON answer.
 */
export const MIN_MAX_TOKENS = 8000;

/**
 * Limit for the long weekly steps (editor, revise, summary: 16k max tokens on the strongest model).
 * Always capped by the time left in the run (`guardedCall`), and no call starts with under
 * MIN_CALL_MS left.
 */
export const LONG_CALL_TIMEOUT_MS = 200_000;
/** A retry after a transient error starts only when at least this much of the call's limit is left. */
export const MIN_RETRY_MS = 20_000;

type CreateParams = Parameters<Anthropic["messages"]["create"]>[0];
/** The one API call, injectable so the timeout and retry rules are tested without the network. */
export type CreateFn = (params: CreateParams, opts: { timeout: number; maxRetries: number }) => Promise<Anthropic.Message>;

/**
 * Only errors where the request was surely not billed are retried: rate limits, overload and
 * server errors, and connection failures. Timeouts (client, 408, 504) are never retried: the model
 * may have run and billed, and a second attempt would pay twice.
 */
export function retryable(e: unknown): boolean {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return false;
  if (e instanceof Anthropic.APIConnectionError) return true;
  if (e instanceof Anthropic.APIError) {
    const s = e.status;
    return typeof s === "number" && (s === 429 || (s >= 500 && s !== 504));
  }
  return false;
}

/**
 * One attempt that may use the whole limit (`timeoutMs`), so a long answer is not cut at half
 * time and paid twice. The SDK's own retries are off (they also fire on timeouts); one manual retry
 * follows a `retryable` error when at least MIN_RETRY_MS of the limit is left, with what is left.
 */
/** Wait before the one retry: the API's `retry-after` (seconds) when given, else 1 s, never past `maxMs`. */
export function retryDelayMs(e: unknown, maxMs: number): number {
  const h = (e as { headers?: unknown } | null)?.headers as { get?: (k: string) => string | null } | Record<string, string> | undefined;
  const raw = h && typeof (h as { get?: unknown }).get === "function" ? (h as { get: (k: string) => string | null }).get("retry-after") : (h as Record<string, string> | undefined)?.["retry-after"];
  const secs = raw ? Number(raw) : NaN;
  const want = Number.isFinite(secs) && secs > 0 ? secs * 1000 : 1000;
  return Math.max(0, Math.min(want, maxMs));
}

export function modelCaller(create: CreateFn, clock: () => number = Date.now, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): ModelFn {
  return async (req) => {
    const limit = req.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    const deadline = clock() + limit;
    const content: Anthropic.TextBlockParam[] = [];
    if (req.context) content.push({ type: "text", text: req.context, cache_control: { type: "ephemeral" } });
    content.push({ type: "text", text: req.user });
    const params = {
      model: req.model,
      max_tokens: req.maxTokens,
      system: [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content }],
      output_config: { effort: req.effort, format: { type: "json_schema" as const, schema: req.schema } },
    } as CreateParams;
    let res: Anthropic.Message;
    try {
      res = await create(params, { timeout: limit, maxRetries: 0 });
    } catch (e) {
      if (!retryable(e) || deadline - clock() < MIN_RETRY_MS + 1000) throw e;
      // Honour the API's retry-after (rate limits), but leave MIN_RETRY_MS for the retry itself.
      await wait(retryDelayMs(e, deadline - clock() - MIN_RETRY_MS));
      res = await create(params, { timeout: Math.max(1, deadline - clock()), maxRetries: 0 });
    }
    return toResult(req, res);
  };
}

function toResult(req: ModelRequest, res: Anthropic.Message): ModelResult {
  const usage: ModelUsage = {
    input: res.usage.input_tokens,
    output: res.usage.output_tokens,
    cacheRead: res.usage.cache_read_input_tokens ?? 0,
    cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
  };
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text: res.stop_reason === "end_turn" ? text : "", raw: text, model: req.model, stopReason: res.stop_reason, usage, costUsd: costOf(req.model, usage) };
}

let client: Anthropic | undefined;

/** Real implementation on the Anthropic API. Never called by tests. */
export const callModel: ModelFn = (req) => {
  client ??= new Anthropic();
  const c = client;
  return modelCaller((params, opts) => c.messages.create(params, opts) as Promise<Anthropic.Message>)(req);
};
