import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type EventLinkInput = {
  label?: unknown;
  url?: unknown;
  type?: unknown;
};

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

function sanitizeStyles(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 12);
}

function mapUpdateErrorStatus(message: string) {
  if (message.includes("not_authenticated")) return 401;
  if (message.includes("not_authorized")) return 403;
  if (message.includes("event_not_found")) return 404;
  if (message.includes("edit_rate_limit_daily")) return 429;
  if (
    message.includes("title_required") ||
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
  return 500;
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await context.params;
    if (!eventId) {
      return NextResponse.json({ ok: false, error: "Missing event id." }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const description = typeof body?.description === "string" ? body.description : null;
    const eventType = typeof body?.eventType === "string" ? body.eventType : null;
    const visibility = typeof body?.visibility === "string" ? body.visibility : null;
    const city = typeof body?.city === "string" ? body.city.trim() : null;
    const country = typeof body?.country === "string" ? body.country.trim() : null;
    const venueName = typeof body?.venueName === "string" ? body.venueName : null;
    const venueAddress = typeof body?.venueAddress === "string" ? body.venueAddress : null;
    const startsAt = typeof body?.startsAt === "string" ? body.startsAt : null;
    const endsAt = typeof body?.endsAt === "string" ? body.endsAt : null;
    const capacity = typeof body?.capacity === "number" && Number.isFinite(body.capacity) ? body.capacity : null;
    const coverUrl = typeof body?.coverUrl === "string" ? body.coverUrl : null;
    const status = typeof body?.status === "string" ? body.status : null;
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

    const { data, error } = await supabase.rpc("update_event", {
      p_event_id: eventId,
      p_title: title,
      p_description: description,
      p_event_type: eventType,
      p_styles: styles,
      p_visibility: visibility,
      p_city: city,
      p_country: country,
      p_venue_name: venueName,
      p_venue_address: venueAddress,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_capacity: capacity,
      p_cover_url: coverUrl,
      p_links: links,
      p_status: status,
    });

    if (error) {
      const message = error.message ?? "Failed to update event.";
      return NextResponse.json({ ok: false, error: message }, { status: mapUpdateErrorStatus(message) });
    }

    return NextResponse.json({ ok: true, event_id: data ?? eventId });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
