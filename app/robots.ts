import type { MetadataRoute } from "next";
import { absolutePublicAppUrl, readPublicAppUrl } from "@/lib/public-app-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/api/",
        "/auth/",
        "/me/",
        "/onboarding/",
        "/notifications",
        "/messages",
      ],
    },
    host: readPublicAppUrl(),
    sitemap: absolutePublicAppUrl("/sitemap.xml"),
  };
}
