import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/__clerk/:path*",
        destination: "https://clerk.orthogonaloa.com/:path*",
      },
    ];
  },
};

export default nextConfig;
