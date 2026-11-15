import type { NextConfig } from "next";

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
  // Addresses from the first version of the site keep working.
  async redirects() {
    return [{ source: "/employee", destination: "/pay", permanent: false }];
  },
};

export default nextConfig;
