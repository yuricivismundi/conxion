import { NextResponse } from "next/server";
import { normalizeEventAccessType, normalizeEventChatMode } from "@/lib/events/access";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type EventLinkInput = {
  label?: unknown;
  url?: unknown;
  type?: unknown;
};

type EventOccurrenceInput = {
  startsAt?: unknown;
  endsAt?: unknown;
};

const MIN_DESCRIPTION_LENGTH = 32;
const MAX_DESCRIPTION_LENGTH = 1600;

function privateGroupWindow() {
  const starts = new Date();
  const ends = new Date(starts);
  ends.setFullYear(ends.getFullYear() + 10);
  return { startsAt: starts.toISOString(), endsAt: ends.toISOString() };
}

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

function sanitizeOccurrences(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ startsAt: string; endsAt: string }>;

  return value
    .map((raw) => {
      const row = (raw ?? {}) as EventOccurrenceInput;
      const startsAt = typeof row.startsAt === "string" ? row.startsAt.trim() : "";
      const endsAt = typeof row.endsAt === "string" ? row.endsAt.trim() : "";
      if (!startsAt || !endsAt) return null;
      return { startsAt, endsAt };
    })
    .filter((item): item is { startsAt: string; endsAt: string } => Boolean(item));
}

function normalizeCoverUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function mapCreateErrorStatus(message: string) {
  if (message.includes("not_authenticated")) return 401;
  if (message.includes("not_authorized")) return 403;
  if (
    message.includes("title_required") ||
    message.includes("location_required") ||
    message.includes("invalid_event_window") ||
    message.includes("invalid_visibility") ||
    message.includes("invalid_event_access_type") ||
    message.includes("invalid_chat_mode") ||
    message.includes("invalid_status") ||
    message.includes("invalid_capacity") ||
    message.includes("invalid_cover_url") ||
    message.includes("invalid_cover_format") ||
    message.includes("too_many_styles") ||
    message.includes("description_required") ||
    message.includes("description_too_short") ||
    message.includes("description_too_long") ||
    message.includes("venue_required") ||
    message.includes("invalid_occurrences") ||
    message.includes("series_occurrence_count_invalid") ||
    message.includes("invalid_recurrence_kind")
  ) {
    return 400;
  }
  if (message.includes("active_event_limit_reached")) return 409;
  if (
    message.includes("private_group_monthly_limit_reached") ||
    message.includes("private_group_member_limit_reached")
  ) {
    return 409;
  }
  return 500;
}

function formatCreateErrorMessage(message: string) {
  if (message.includes("invalid_cover_format")) {
    return "Cover image could not be used. Upload a JPG, PNG, or WEBP and we will crop it into a wide event banner.";
  }
  return message;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const description = typeof body?.description === "string" ? body.description : "";
    const eventType = typeof body?.eventType === "string" ? body.eventType : "Social";
    const eventAccessType = normalizeEventAccessType(
      typeof body?.eventAccessType === "string" ? body.eventAccessType : null,
      typeof body?.visibility === "string" ? body.visibility : null
    );
    const isPrivateGroup = eventAccessType === "private_group";
    const rawChatMode = typeof body?.chatMode === "string" ? body.chatMode : null;
    const chatMode = normalizeEventChatMode(rawChatMode, eventAccessType);
    const city = typeof body?.city === "string" ? body.city.trim() : "";
    const country = typeof body?.country === "string" ? body.country.trim() : "";
    const venueName = typeof body?.venueName === "string" ? body.venueName : "";
    const venueAddress = typeof body?.venueAddress === "string" ? body.venueAddress : "";
    const groupWindow = isPrivateGroup ? privateGroupWindow() : null;
    const startsAt = groupWindow?.startsAt ?? (typeof body?.startsAt === "string" ? body.startsAt : "");
    const endsAt = groupWindow?.endsAt ?? (typeof body?.endsAt === "string" ? body.endsAt : "");
    const capacity = typeof body?.capacity === "number" && Number.isFinite(body.capacity) ? body.capacity : null;
    const coverUrl = normalizeCoverUrl(body?.coverUrl);
    const status = typeof body?.status === "string" ? body.status : "published";
    const settings = (body?.settings && typeof body.settings === "object" && !Array.isArray(body.settings))
      ? body.settings as Record<string, unknown>
      : {};
    const recurrence = (body?.recurrence && typeof body.recurrence === "object" && !Array.isArray(body.recurrence))
      ? body.recurrence as Record<string, unknown>
      : null;
    const showGuestList = settings.showGuestList !== false;
    const guestsCanInvite = settings.guestsCanInvite === true;
    const approveMessages = settings.approveMessages === true;
    const isDraft = status === "draft";
    const links = sanitizeLinks(body?.links);
    const styles = sanitizeStyles(body?.styles);
    const occurrences = sanitizeOccurrences(recurrence?.occurrences);
    const recurrenceKind = typeof recurrence?.kind === "string" ? recurrence.kind.trim().toLowerCase() : "none";
    const recurrenceTimezone = typeof recurrence?.timezone === "string" ? recurrence.timezone.trim() : null;

    if (!title) {
      return NextResponse.json(
        { ok: false, error: "title is required." },
        { status: 400 }
      );
    }
    if (!isPrivateGroup && (!city || !country || !startsAt || !endsAt)) {
      return NextResponse.json(
        { ok: false, error: "city, country, startsAt, and endsAt are required for events." },
        { status: 400 }
      );
    }
    if (!isPrivateGroup && !isDraft && !venueName.trim()) {
      return NextResponse.json({ ok: false, error: "venue_required" }, { status: 400 });
    }
    if (!description.trim() && !isDraft) {
      return NextResponse.json({ ok: false, error: "description_required" }, { status: 400 });
    }
    if (!isPrivateGroup && !isDraft && description.trim().length < MIN_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        { ok: false, error: `description_too_short: minimum ${MIN_DESCRIPTION_LENGTH} characters.` },
        { status: 400 }
      );
    }
    if (description.trim().length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        { ok: false, error: `description_too_long: maximum ${MAX_DESCRIPTION_LENGTH} characters.` },
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

    if (!isPrivateGroup && occurrences.length > 1 && recurrenceKind !== "none") {
      const { data, error } = await supabase.rpc("create_event_series", {
        p_title: title,
        p_description: description || null,
        p_event_type: eventType,
        p_visibility: "public",
        p_event_access_type: eventAccessType,
        p_chat_mode: chatMode,
        p_city: city,
        p_country: country,
        p_venue_name: venueName || null,
        p_venue_address: venueAddress || null,
        p_occurrences: occurrences,
        p_capacity: capacity,
        p_cover_url: coverUrl || null,
        p_links: links,
        p_status: status,
        p_styles: styles,
        p_show_guest_list: showGuestList,
        p_guests_can_invite: guestsCanInvite,
        p_approve_messages: approveMessages,
        p_recurrence_kind: recurrenceKind,
        p_timezone: recurrenceTimezone,
      });

      if (error) {
        const message = error.message ?? "Failed to create event series.";
        return NextResponse.json({ ok: false, error: formatCreateErrorMessage(message) }, { status: mapCreateErrorStatus(message) });
      }

      const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
      const eventIds = Array.isArray(payload.event_ids)
        ? payload.event_ids.filter((item): item is string => typeof item === "string")
        : [];
      const primaryEventId =
        typeof payload.primary_event_id === "string"
          ? payload.primary_event_id
          : eventIds[0] ?? null;

      return NextResponse.json({
        ok: true,
        event_id: primaryEventId,
        event_ids: eventIds,
        series_id: typeof payload.series_id === "string" ? payload.series_id : null,
      });
    }

    const { data, error } = await supabase.rpc("create_event", {
      p_title: title,
      p_description: description || null,
      p_event_type: eventType,
      p_visibility: eventAccessType === "private_group" ? "private" : "public",
      p_event_access_type: eventAccessType,
      p_chat_mode: chatMode,
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
      p_show_guest_list: showGuestList,
      p_guests_can_invite: guestsCanInvite,
      p_approve_messages: approveMessages,
    });

    if (error) {
      const message = error.message ?? "Failed to create event.";
      return NextResponse.json({ ok: false, error: formatCreateErrorMessage(message) }, { status: mapCreateErrorStatus(message) });
    }

    return NextResponse.json({ ok: true, event_id: data ?? null });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
