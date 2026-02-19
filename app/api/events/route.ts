import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type EventLinkInput = {
  label?: unknown;
  url?: unknown;
  type?: unknown;
};

function sanitizeStyles(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 12);
}

function sanitizeLinks(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ label: string; url: string; type: string }>;

  return value
    .map((raw) => {
      const row = (raw ?? {}) as EventLinkInput;
      const url = typeof row.url === "string" ? row.url.trim() : "";
      if (!url) return null;
      return {
        label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : "Link",
        url,
        type: typeof row.type === "string" && row.type.trim() ? row.type.trim() : "link",
      };
    })
    .filter((item): item is { label: string; url: string; type: string } => Boolean(item));
}

function mapCreateErrorStatus(message: string) {
  if (message.includes("not_authenticated")) return 401;
  if (message.includes("not_authorized")) return 403;
  if (
    message.includes("title_required") ||
    message.includes("location_required") ||
    message.includes("invalid_event_window") ||
    message.includes("invalid_visibility") ||
    message.includes("invalid_status") ||
    message.includes("invalid_capacity") ||
    message.includes("invalid_cover_url") ||
    message.includes("invalid_cover_format") ||
    message.includes("too_many_styles")
  ) {
    return 400;
  }
  if (message.includes("active_event_limit_reached")) return 409;
  return 500;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const description = typeof body?.description === "string" ? body.description : "";
    const eventType = typeof body?.eventType === "string" ? body.eventType : "Social";
    const visibility = typeof body?.visibility === "string" ? body.visibility : "public";
    const city = typeof body?.city === "string" ? body.city.trim() : "";
    const country = typeof body?.country === "string" ? body.country.trim() : "";
    const venueName = typeof body?.venueName === "string" ? body.venueName : "";
    const venueAddress = typeof body?.venueAddress === "string" ? body.venueAddress : "";
    const startsAt = typeof body?.startsAt === "string" ? body.startsAt : "";
    const endsAt = typeof body?.endsAt === "string" ? body.endsAt : "";
    const capacity = typeof body?.capacity === "number" && Number.isFinite(body.capacity) ? body.capacity : null;
    const coverUrl = typeof body?.coverUrl === "string" ? body.coverUrl : "";
    const status = typeof body?.status === "string" ? body.status : "published";
    const links = sanitizeLinks(body?.links);
    const styles = sanitizeStyles(body?.styles);

    if (!title || !city || !country || !startsAt || !endsAt) {
      return NextResponse.json(
        { ok: false, error: "title, city, country, startsAt, and endsAt are required." },
        { status: 400 }
      );
    }

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const { data, error } = await supabase.rpc("create_event", {
      p_title: title,
      p_description: description || null,
      p_event_type: eventType,
      p_visibility: visibility,
      p_city: city,
      p_country: country,
      p_venue_name: venueName || null,
      p_venue_address: venueAddress || null,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_capacity: capacity,
      p_cover_url: coverUrl || null,
      p_links: links,
      p_status: status,
      p_styles: styles,
    });

    if (error) {
      const message = error.message ?? "Failed to create event.";
      return NextResponse.json({ ok: false, error: message }, { status: mapCreateErrorStatus(message) });
    }

    return NextResponse.json({ ok: true, event_id: data ?? null });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
