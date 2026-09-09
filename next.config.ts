import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16.3 + Vercel adapter skips next-server.js.nft.json when standalone is on
  // (vercel/next.js#96646). Keep standalone for non-Vercel/Docker builds only.
  output: process.env.VERCEL ? undefined : "standalone",
  reactStrictMode: true,
  typedRoutes: true,
};

export default nextConfig;
