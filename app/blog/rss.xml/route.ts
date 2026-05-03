import { getAllBlogPosts, getBlogPostAbsoluteUrl, BLOG_DESCRIPTION } from "@/content/blog/posts";
import { absolutePublicAppUrl } from "@/lib/public-app-url";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function GET() {
  const posts = getAllBlogPosts();
  const blogUrl = absolutePublicAppUrl("/blog");

  const items = posts
    .map((post) => {
      const url = getBlogPostAbsoluteUrl(post.slug);
      return `
        <item>
          <title>${escapeXml(post.title)}</title>
          <link>${url}</link>
          <guid>${url}</guid>
          <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>
          <description>${escapeXml(post.excerpt)}</description>
          <category>${escapeXml(post.category)}</category>
        </item>
      `.trim();
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>ConXion Blog</title>
    <link>${blogUrl}</link>
    <description>${escapeXml(BLOG_DESCRIPTION)}</description>
    <language>en</language>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
