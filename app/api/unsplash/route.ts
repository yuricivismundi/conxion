import { NextResponse } from "next/server";
import { buildRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limit = consumeRateLimit({
    key: buildRateLimitKey(request, "api:unsplash"),
    limit: 40,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many image requests. Please retry shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(limit.retryAfterSec),
        },
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("query") ?? "").trim();

  if (!query || query.length < 2 || query.length > 80) {
    return NextResponse.json({ error: "Invalid query." }, { status: 400 });
  }
  if (!/^[\p{L}\p{N}\s,.'-]+$/u.test(query)) {
    return NextResponse.json({ error: "Query contains unsupported characters." }, { status: 400 });
  }

  const upstream = `https://source.unsplash.com/featured/1600x900?${encodeURIComponent(query)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    const response = await fetch(upstream, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });
    clearTimeout(timeout);

    if (response.ok && response.body) {
      const contentType = response.headers.get("content-type") ?? "image/jpeg";
      if (!contentType.toLowerCase().startsWith("image/")) {
        return NextResponse.json({ error: "Unexpected upstream response." }, { status: 502 });
      }
      return new NextResponse(response.body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
  } catch {
    // fall through
  }

  return NextResponse.json({ error: "Image provider unavailable." }, { status: 502 });
}
