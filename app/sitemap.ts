import type { MetadataRoute } from "next";
import { getAllBlogPosts, getBlogPostUrl } from "@/content/blog/posts";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { readPublicAppUrl } from "@/lib/public-app-url";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const appUrl = readPublicAppUrl();
  const staticRoutes = [
    "",
    "/about",
    "/pricing",
    "/careers",
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

  let eventEntries: MetadataRoute.Sitemap = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = getSupabaseServiceClient() as any;
    const { data } = await service
      .from("events")
      .select("id,updated_at")
      .eq("status", "published")
      .eq("visibility", "public")
      .order("starts_at", { ascending: false })
      .limit(500);
    if (Array.isArray(data)) {
      eventEntries = (data as Array<{ id: string; updated_at: string | null }>).map((row) => ({
        url: `${appUrl}/events/${row.id}`,
        changeFrequency: "weekly" as const,
        priority: 0.8,
        lastModified: row.updated_at ? new Date(row.updated_at) : new Date(),
      }));
    }
  } catch {
    // Best effort — sitemap still works without dynamic entries
  }

  let profileEntries: MetadataRoute.Sitemap = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = getSupabaseServiceClient() as any;
    const { data } = await service
      .from("profiles")
      .select("user_id,updated_at")
      .not("display_name", "is", null)
      .order("updated_at", { ascending: false })
      .limit(2000);
    if (Array.isArray(data)) {
      profileEntries = (data as Array<{ user_id: string; updated_at: string | null }>).map((row) => ({
        url: `${appUrl}/profile/${row.user_id}`,
        changeFrequency: "weekly" as const,
        priority: 0.6,
        lastModified: row.updated_at ? new Date(row.updated_at) : new Date(),
      }));
    }
  } catch {
    // Best effort
  }

  return [...staticEntries, ...blogEntries, ...eventEntries, ...profileEntries];
}
