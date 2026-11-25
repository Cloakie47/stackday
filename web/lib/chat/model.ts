import Anthropic from "@anthropic-ai/sdk";
import type { CreateFn } from "./agent.ts";

/**
 * Server only: the real model call for the chat assistant. The SDK reads ANTHROPIC_API_KEY from the
 * environment (already set for research); it is never logged or sent to the browser. Tests use a
 * fake CreateFn instead and never reach this file's client.
 */

let client: Anthropic | undefined;

/**
 * One chat step, limited to the time left in the turn (at most 45 s) and never retried by the SDK, so
 * a turn cannot outrun the route's 60 s function limit.
 */
export const createMessage: CreateFn = (params, opts) => {
  client ??= new Anthropic();
  return client.beta.messages.create(params, { timeout: Math.min(45_000, opts?.timeoutMs ?? 45_000), maxRetries: 0 });
};

/** Plain words for a failed model call, most specific first. Never includes the error body. */
export function chatError(e: unknown): { status: number; message: string } {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { status: 503, message: "The assistant is not available right now." };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, message: "The assistant is busy. Try again in a minute." };
  if (e instanceof Anthropic.BadRequestError) return { status: 502, message: "The assistant could not read that conversation. Clear the chat and try again." };
  if (e instanceof Anthropic.APIConnectionTimeoutError) return { status: 504, message: "The assistant took too long. Try again." };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, message: "Could not reach the assistant. Try again." };
  if (e instanceof Anthropic.APIError) return { status: 502, message: "The assistant had a problem. Try again." };
  return { status: 500, message: "Something went wrong. Try again." };
}
