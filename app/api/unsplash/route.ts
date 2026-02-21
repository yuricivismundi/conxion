import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("query") ?? "").trim();

  if (!query) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  const upstream = `https://source.unsplash.com/featured/1600x900?${encodeURIComponent(query)}`;

  try {
    const response = await fetch(upstream, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });

    if (response.ok && response.body) {
      const contentType = response.headers.get("content-type") ?? "image/jpeg";
      return new NextResponse(response.body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
  } catch {
    // Fall through to redirect.
  }

  // Fallback: let the browser request Unsplash directly.
  return NextResponse.redirect(upstream, { status: 302 });
}
