import { NextResponse } from "next/server";
import { buildRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(req: Request) {
  try {
    const limit = consumeRateLimit({
      key: buildRateLimitKey(req, "auth:check-email"),
      limit: 10,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Please try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": String(limit.retryAfterSec),
          },
        }
      );
    }

    const payload = (await req.json().catch(() => ({}))) as { email?: unknown };
    const email = normalizeEmail(payload.email);

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "Please provide a valid email." }, { status: 400 });
    }

    // Security: never disclose account existence from this endpoint.
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not verify email right now." }, { status: 500 });
  }
}
