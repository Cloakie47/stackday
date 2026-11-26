import type { NextConfig } from "next";
import { DEFAULT_RPC_URL, securityHeaders } from "./lib/security-headers.ts";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Security headers on every page and API route (see lib/security-headers.ts).
  async headers() {
    const headers = securityHeaders({
      isDev: process.env.NODE_ENV === "development",
      rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || DEFAULT_RPC_URL,
    });
    return [{ source: "/:path*", headers }];
  },
  // Addresses from the first version of the site keep working.
  async redirects() {
    return [
      { source: "/employee", destination: "/pay", permanent: false },
      // The full guide is a static site in public/guide (built by docs-site/build.mjs).
      { source: "/guide", destination: "/guide/index.html", permanent: false },
    ];
  },
};

export default nextConfig;
