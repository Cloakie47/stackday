/**
 * HTTP security headers for every page and API route, used by next.config.ts.
 * Kept in its own file with no imports so it can be unit tested (security-headers.test.ts).
 *
 * The Content-Security-Policy follows the Next.js "without nonces" pattern: pages stay static
 * (nonces would force every page to render on each request), so inline scripts are allowed,
 * but scripts, frames, objects and form posts from any other site are not.
 */

export type Header = { key: string; value: string };

export type HeaderOptions = {
  /** true when running `next dev` (hot reload needs eval and a websocket). */
  isDev: boolean;
  /** The RPC address the browser reads the chain from (NEXT_PUBLIC_RPC_URL or the public default). */
  rpcUrl: string;
};

export const DEFAULT_RPC_URL = "https://sepolia.base.org";

/** TradingView's free chart widgets (web components). Only these hosts, nothing wider. */
export const TRADINGVIEW_SCRIPTS = ["https://widgets.tradingview-widget.com", "https://www.tradingview-widget.com"];
export const TRADINGVIEW_FRAMES = ["https://widgets.tradingview-widget.com", "https://www.tradingview-widget.com", "https://s.tradingview.com", "https://www.tradingview.com"];
export const TRADINGVIEW_CONNECT = [
  "https://widgets.tradingview-widget.com",
  "https://www.tradingview-widget.com",
  "https://*.tradingview.com",
  "wss://*.tradingview.com",
  "wss://*.tradingview-widget.com",
];
export const TRADINGVIEW_IMAGES = ["https://*.tradingview.com", "https://*.tradingview-widget.com"];

/** Origin (scheme, host, port) of a URL, or null if it is not a valid http(s) or ws(s) URL. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return ["http:", "https:", "ws:", "wss:"].includes(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy({ isDev, rpcUrl }: HeaderOptions): string {
  // TradingView price charts (real market prices): widget code, its frames, data and logos.
  const connect = new Set(["'self'", DEFAULT_RPC_URL, ...TRADINGVIEW_CONNECT]);
  const rpc = originOf(rpcUrl);
  if (rpc) connect.add(rpc);
  if (isDev) connect.add("ws://localhost:*").add("ws://127.0.0.1:*");

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${TRADINGVIEW_SCRIPTS.join(" ")}${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${TRADINGVIEW_IMAGES.join(" ")}`,
    "font-src 'self'",
    `frame-src ${TRADINGVIEW_FRAMES.join(" ")}`,
    `connect-src ${[...connect].join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // No other site may show Stackday inside a frame (stops clickjacking a wallet prompt).
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

export function securityHeaders(options: HeaderOptions): Header[] {
  const headers: Header[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    // Older browsers that ignore frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
    // Keeps popups that wallets open working, but cuts the link to windows opened by other sites.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ];
  if (!options.isDev) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  }
  return headers;
}
