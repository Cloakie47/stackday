import type { QueryClient } from "@tanstack/react-query";

/** The longest a page waits for its data to refresh before it moves on. */
export const REFRESH_WAIT_MS = 4000;

/**
 * Refetches every query, waiting at most `ms`. One slow request (a busy RPC, or a wallet that never
 * answers a capabilities call) must never leave a button on "Saving..." for good: past the limit the
 * page moves on and the refetch finishes in the background. A failed refetch is not the action
 * failing, so it never throws.
 */
export async function refreshAll(client: Pick<QueryClient, "invalidateQueries">, ms = REFRESH_WAIT_MS): Promise<"done" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  const refresh = client.invalidateQueries().then(
    () => "done" as const,
    () => "done" as const,
  );
  try {
    return await Promise.race([refresh, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
