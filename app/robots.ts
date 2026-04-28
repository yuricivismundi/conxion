import type { MetadataRoute } from "next";
import { absolutePublicAppUrl, readPublicAppUrl } from "@/lib/public-app-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    host: readPublicAppUrl(),
    sitemap: absolutePublicAppUrl("/sitemap.xml"),
  };
}
