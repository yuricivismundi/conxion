import type { MetadataRoute } from "next";
import { getAllBlogPosts, getBlogPostUrl } from "@/content/blog/posts";
import { readPublicAppUrl } from "@/lib/public-app-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const appUrl = readPublicAppUrl();
  const staticRoutes = [
    "",
    "/about",
    "/blog",
    "/support",
    "/safety-center",
    "/privacy",
    "/terms",
  ];

  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((path) => ({
    url: `${appUrl}${path || "/"}`,
    changeFrequency: path === "/blog" ? "weekly" : "monthly",
    priority: path === "" ? 1 : path === "/blog" ? 0.8 : 0.6,
    lastModified: new Date(),
  }));

  const blogEntries: MetadataRoute.Sitemap = getAllBlogPosts().map((post) => ({
    url: `${appUrl}${getBlogPostUrl(post.slug)}`,
    changeFrequency: "monthly",
    priority: 0.7,
    lastModified: new Date(post.publishedAt),
  }));

  return [...staticEntries, ...blogEntries];
}
