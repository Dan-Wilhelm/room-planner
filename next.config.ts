import type { NextConfig } from "next";

// Cache Components stays off: all user data lives in the browser (IndexedDB),
// the server only runs AI/API routes, so there is nothing to cache server-side.
const nextConfig: NextConfig = {
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
