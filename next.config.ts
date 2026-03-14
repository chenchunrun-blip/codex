import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: "standalone",

  // Enable strict mode for better development experience
  reactStrictMode: true,

  // Experimental features
  experimental: {
    // Enable server actions
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },

  // Image optimization - restrict to known domains
  images: {
    remotePatterns: [
      // GitHub avatars
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      // Google user content
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      // Cloudflare CDN
      {
        protocol: "https",
        hostname: "*.cloudfront.net",
      },
      // Gravatar
      {
        protocol: "https",
        hostname: "*.gravatar.com",
      },
      // Liveblocks
      {
        protocol: "https",
        hostname: "*.liveblocks.io",
      },
    ],
  },
};

export default nextConfig;
