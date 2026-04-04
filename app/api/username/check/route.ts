import { NextResponse } from "next/server";
import { buildRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { normalizeUsername } from "@/lib/username/normalize";
import { checkUsernameAvailability, resolveAvailableUsernameSuggestion } from "@/lib/username/server";
import { validateUsernameFormat } from "@/lib/username/validate";

export const runtime = "nodejs";

type Payload = {
  username?: unknown;
  seed?: unknown;
  currentUserId?: unknown;
};

export async function POST(req: Request) {
  try {
    const payload = (await req.json().catch(() => ({}))) as Payload;
    const token = getBearerToken(req);
    let currentUserId = "";

    if (token) {
      const supabase = getSupabaseUserClient(token);
      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      if (!authError && authData.user?.id) {
        currentUserId = authData.user.id;
      }
    }

    const limit = consumeRateLimit({
      key: buildRateLimitKey(req, "username:check", currentUserId || null),
      limit: 20,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Please try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSec) },
        }
      );
    }

    const rawUsername = typeof payload.username === "string" ? payload.username : "";
    const seed = typeof payload.seed === "string" ? payload.seed : rawUsername;
    const normalizedUsername = normalizeUsername(rawUsername);
    const format = validateUsernameFormat(normalizedUsername);

    if (!format.valid) {
      const suggestion = seed
        ? await resolveAvailableUsernameSuggestion({ seed, currentUserId: currentUserId || null })
        : null;

      return NextResponse.json({
        ok: true,
        normalizedUsername: format.normalizedUsername,
        available: false,
        error: format.error ?? "Username must be between 3 and 20 characters.",
        suggestion,
      });
    }

    const result = await checkUsernameAvailability({
      username: format.normalizedUsername,
      currentUserId: currentUserId || null,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        normalizedUsername: "",
        available: false,
        error: "Could not check username right now.",
        suggestion: null,
      },
      { status: 500 }
    );
  }
}
