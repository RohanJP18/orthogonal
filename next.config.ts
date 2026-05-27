import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // Clerk JS + UI bundles live on npm.clerk.dev
        source: "/__clerk/npm/:path*",
        destination: "https://npm.clerk.dev/:path*",
      },
      {
        // Clerk API calls go to the Frontend API host
        source: "/__clerk/:path*",
        destination: "https://clerk.orthogonaloa.com/:path*",
      },
    ];
  },
};

export default nextConfig;
