import type { NextConfig } from "next";

const SUPABASE_HOST = "qmntpjlxfvyhktbveojo.supabase.co";
const isProd = process.env.NODE_ENV === "production";

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' js.stripe.com;
  style-src 'self' 'unsafe-inline' fonts.googleapis.com;
  font-src 'self' fonts.gstatic.com data:;
  img-src 'self' data: blob: https://${SUPABASE_HOST} https://i.pravatar.cc https://images.unsplash.com https://lh3.googleusercontent.com;
  connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST} https://api.mapbox.com https://events.mapbox.com https://api.stripe.com;
  frame-src 'self' js.stripe.com hooks.stripe.com;
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  ${isProd ? "upgrade-insecure-requests;" : ""}
`.replace(/\s{2,}/g, " ").trim();

const securityHeaders = [
  { key: "Content-Security-Policy", value: ContentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
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
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
