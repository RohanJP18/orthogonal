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
        // Clerk auth API calls → actual Clerk backend (DNS CNAME target)
        source: "/__clerk/:path*",
        destination: "https://frontend-api.clerk.services/:path*",
      },
    ];
  },
};

export default nextConfig;
