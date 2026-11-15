/**
 * Origin check for requests that change data (fix 5 in docs/SECURITY-CHECKLIST.md).
 * No framework code in here, so it is unit tested (origin-check.test.ts). proxy.ts calls it
 * for every /api request.
 *
 * Browsers send an Origin header with every cross-site POST, PUT, PATCH and DELETE. If it names
 * another site, the request came from that site's page (for example a page trying to change a
 * signed-in visitor's team list), so it is refused. The sign-in cookie is already SameSite=Lax,
 * which blocks most of this; this is the second lock.
 *
 * Requests without an Origin header are allowed: browsers always send one on these methods, so a
 * missing header means a non-browser client (our test scripts, curl), which cannot use a
 * visitor's cookie anyway.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function originAllowed(p: { method: string; origin: string | null; host: string }): boolean {
  if (SAFE_METHODS.has(p.method.toUpperCase())) return true;
  if (!p.origin) return true;
  if (p.origin === "null") return false; // sandboxed frames and some redirects
  try {
    return new URL(p.origin).host.toLowerCase() === p.host.toLowerCase();
  } catch {
    return false;
  }
}
