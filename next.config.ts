import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Supabase public storage
      {
        protocol: "https",
        hostname: "qmntpjlxfvyhktbveojo.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },

      // Seed/default avatars
      {
        protocol: "https",
        hostname: "i.pravatar.cc",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;