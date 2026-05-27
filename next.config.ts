import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // Clerk JS/UI bundles via unpkg CDN (clerk.orthogonaloa.com DNS not yet provisioned)
        source: "/__clerk/npm/:path*",
        destination: "https://unpkg.com/:path*",
      },
      {
        // Clerk auth API calls
        source: "/__clerk/:path*",
        destination: "https://clerk.orthogonaloa.com/:path*",
      },
    ];
  },
};

export default nextConfig;
