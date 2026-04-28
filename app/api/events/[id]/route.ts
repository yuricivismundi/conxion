import { NextResponse } from "next/server";
import { normalizeEventAccessType, normalizeEventChatMode } from "@/lib/events/access";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type EventLinkInput = {
  label?: unknown;
  url?: unknown;
  type?: unknown;
};

const MIN_TITLE_LENGTH = 8;
const MAX_TITLE_LENGTH = 120;
const MIN_DESCRIPTION_LENGTH = 24;
const MAX_DESCRIPTION_LENGTH = 4000;

function privateGroupWindow() {
  const starts = new Date();
  const ends = new Date(starts);
  ends.setFullYear(ends.getFullYear() + 10);
  return { startsAt: starts.toISOString(), endsAt: ends.toISOString() };
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

function sanitizeStyles(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 12);
}

function normalizeCoverUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function mapUpdateErrorStatus(message: string) {
  if (message.includes("not_authenticated")) return 401;
  if (message.includes("not_authorized")) return 403;
  if (message.includes("event_not_found")) return 404;
  if (message.includes("edit_rate_limit_daily")) return 429;
  if (message.includes("active_event_limit_reached")) return 409;
  if (
    message.includes("title_required") ||
    message.includes("title_too_short") ||
    message.includes("title_too_long") ||
    message.includes("description_too_short") ||
    message.includes("description_too_long") ||
    message.includes("invalid_event_window") ||
    message.includes("invalid_visibility") ||
    message.includes("invalid_event_access_type") ||
    message.includes("invalid_chat_mode") ||
    message.includes("invalid_status") ||
    message.includes("invalid_capacity") ||
    message.includes("invalid_cover_url") ||
    message.includes("invalid_cover_format") ||
    message.includes("too_many_styles")
  ) {
    return 400;
  }
  if (
    message.includes("private_group_monthly_limit_reached") ||
    message.includes("private_group_member_limit_reached")
  ) {
    return 409;
  }
  return 500;
}

function formatUpdateErrorMessage(message: string) {
  if (message.includes("invalid_cover_format")) {
    return "Cover image could not be used. Upload a JPG, PNG, or WEBP and we will crop it into a wide event banner.";
  }
  return message;
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await context.params;
    if (!eventId) return NextResponse.json({ ok: false, error: "Missing event id." }, { status: 400 });

    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });

    const client = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await client.auth.getUser();
    if (authErr || !authData.user) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });

    const { data: event, error: fetchErr } = await client
      .from("events")
      .select("id, host_user_id, status")
      .eq("id", eventId)
      .maybeSingle();

    if (fetchErr || !event) return NextResponse.json({ ok: false, error: "Event not found." }, { status: 404 });
    if (event.host_user_id !== authData.user.id) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });

    const { error: delErr } = await client.from("events").delete().eq("id", eventId);
    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
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
    const eventAccessType = normalizeEventAccessType(
      typeof body?.eventAccessType === "string" ? body.eventAccessType : null,
      typeof body?.visibility === "string" ? body.visibility : null
    );
    const isPrivateGroup = eventAccessType === "private_group";
    const chatMode = normalizeEventChatMode(typeof body?.chatMode === "string" ? body.chatMode : null, eventAccessType);
    const city = typeof body?.city === "string" ? body.city.trim() : null;
    const country = typeof body?.country === "string" ? body.country.trim() : null;
    const venueName = typeof body?.venueName === "string" ? body.venueName : null;
    const venueAddress = typeof body?.venueAddress === "string" ? body.venueAddress : null;
    const groupWindow = isPrivateGroup ? privateGroupWindow() : null;
    const startsAt = groupWindow?.startsAt ?? (typeof body?.startsAt === "string" ? body.startsAt : null);
    const endsAt = groupWindow?.endsAt ?? (typeof body?.endsAt === "string" ? body.endsAt : null);
    const capacity = typeof body?.capacity === "number" && Number.isFinite(body.capacity) ? body.capacity : null;
    const coverUrl = normalizeCoverUrl(body?.coverUrl);
    const status = typeof body?.status === "string" ? body.status : null;
    const settings = (body?.settings && typeof body.settings === "object" && !Array.isArray(body.settings))
      ? body.settings as Record<string, unknown>
      : {};
    const isDraft = status === "draft";
    const trimmedDescription = typeof description === "string" ? description.trim() : "";
    const links = sanitizeLinks(body?.links);
    const styles = sanitizeStyles(body?.styles);
    const showGuestList = typeof settings.showGuestList === "boolean" ? settings.showGuestList : null;
    const guestsCanInvite = typeof settings.guestsCanInvite === "boolean" ? settings.guestsCanInvite : null;
    const approveMessages = typeof settings.approveMessages === "boolean" ? settings.approveMessages : null;

    if (!title) {
      return NextResponse.json({ ok: false, error: "title_required" }, { status: 400 });
    }
    if (title.length < MIN_TITLE_LENGTH) {
      return NextResponse.json({ ok: false, error: `title_too_short: minimum ${MIN_TITLE_LENGTH} characters.` }, { status: 400 });
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return NextResponse.json({ ok: false, error: `title_too_long: maximum ${MAX_TITLE_LENGTH} characters.` }, { status: 400 });
    }
    if (!isPrivateGroup && (!city || !country || !startsAt || !endsAt)) {
      return NextResponse.json(
        { ok: false, error: "title, city, country, startsAt, and endsAt are required." },
        { status: 400 }
      );
    }
    if (!isPrivateGroup && !isDraft && !venueName?.trim()) {
      return NextResponse.json({ ok: false, error: "venue_required" }, { status: 400 });
    }
    if (!isDraft && !trimmedDescription) {
      return NextResponse.json({ ok: false, error: "description_required" }, { status: 400 });
    }
    if (!isPrivateGroup && !isDraft && trimmedDescription.length < MIN_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        { ok: false, error: `description_too_short: minimum ${MIN_DESCRIPTION_LENGTH} characters.` },
        { status: 400 }
      );
    }
    if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        { ok: false, error: `description_too_long: maximum ${MAX_DESCRIPTION_LENGTH} characters.` },
        { status: 400 }
      );
    }
    if (status && !["draft", "published", "cancelled"].includes(status)) {
      return NextResponse.json({ ok: false, error: "invalid_status" }, { status: 400 });
    }
    if (!isPrivateGroup && startsAt && endsAt && endsAt <= startsAt) {
      return NextResponse.json({ ok: false, error: "invalid_event_window" }, { status: 400 });
    }
    if (capacity !== null && (capacity < 1 || capacity > 2000)) {
      return NextResponse.json({ ok: false, error: "invalid_capacity" }, { status: 400 });
    }
    if (coverUrl && !/\/storage\/v1\/(object\/public|render\/image\/public)\/avatars\//i.test(coverUrl)) {
      return NextResponse.json({ ok: false, error: "invalid_cover_url" }, { status: 400 });
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = getSupabaseServiceClient() as any;
    const currentRes = await service
      .from("events")
      .select("id,host_user_id,cover_url,cover_status,cover_reviewed_by,cover_reviewed_at,cover_review_note,show_guest_list,guests_can_invite,approve_messages")
      .eq("id", eventId)
      .maybeSingle();
    if (currentRes.error) {
      return NextResponse.json({ ok: false, error: currentRes.error.message }, { status: 500 });
    }

    const currentEvent = (currentRes.data ?? null) as {
      id?: string;
      host_user_id?: string | null;
      cover_url?: string | null;
      cover_status?: string | null;
      cover_reviewed_by?: string | null;
      cover_reviewed_at?: string | null;
      cover_review_note?: string | null;
      show_guest_list?: boolean | null;
      guests_can_invite?: boolean | null;
      approve_messages?: boolean | null;
    } | null;

    if (!currentEvent?.id) {
      return NextResponse.json({ ok: false, error: "event_not_found" }, { status: 404 });
    }
    if (currentEvent.host_user_id !== authData.user.id) {
      return NextResponse.json({ ok: false, error: "not_authorized" }, { status: 403 });
    }

    const nextCoverUrl = coverUrl;
    const currentCoverUrl = typeof currentEvent.cover_url === "string" && currentEvent.cover_url.trim()
      ? currentEvent.cover_url
      : null;
    const coverChanged = nextCoverUrl !== currentCoverUrl;
    const nextChatMode = eventAccessType === "private_group" ? chatMode : chatMode === "discussion" ? "discussion" : "broadcast";
    const updatePayload = {
      title,
      description: trimmedDescription || null,
      event_type: typeof eventType === "string" && eventType.trim() ? eventType.trim() : "Social",
      styles,
      visibility: eventAccessType === "private_group" ? "private" : "public",
      event_access_type: eventAccessType,
      chat_mode: nextChatMode,
      max_members: eventAccessType === "private_group" ? 25 : null,
      city: city?.trim() ?? "",
      country: country?.trim() ?? "",
      venue_name: typeof venueName === "string" && venueName.trim() ? venueName.trim() : null,
      venue_address: typeof venueAddress === "string" && venueAddress.trim() ? venueAddress.trim() : null,
      starts_at: startsAt,
      ends_at: endsAt,
      capacity: eventAccessType === "private_group" ? null : capacity,
      cover_url: nextCoverUrl,
      cover_status: nextCoverUrl === null ? "approved" : coverChanged ? "pending" : currentEvent.cover_status ?? "pending",
      cover_reviewed_by: coverChanged ? null : currentEvent.cover_reviewed_by ?? null,
      cover_reviewed_at: coverChanged ? null : currentEvent.cover_reviewed_at ?? null,
      cover_review_note: coverChanged ? null : currentEvent.cover_review_note ?? null,
      links,
      status: status ?? "published",
      show_guest_list: showGuestList ?? currentEvent.show_guest_list ?? true,
      guests_can_invite: guestsCanInvite ?? currentEvent.guests_can_invite ?? false,
      approve_messages: nextChatMode === "discussion" ? (approveMessages ?? currentEvent.approve_messages ?? false) : false,
      updated_at: new Date().toISOString(),
    };

    const updateRes = await service.from("events").update(updatePayload).eq("id", eventId);
    if (updateRes.error) {
      const message = updateRes.error.message ?? "Failed to update event.";
      return NextResponse.json({ ok: false, error: formatUpdateErrorMessage(message) }, { status: mapUpdateErrorStatus(message) });
    }

    try {
      await service.from("event_edit_logs").insert({ event_id: eventId, editor_id: authData.user.id });
    } catch {
      // Best effort only.
    }

    try {
      await service.rpc("cx_ensure_event_thread", {
        p_event_id: eventId,
        p_actor: authData.user.id,
        p_requester: null,
      });
    } catch {
      // Best effort only.
    }

    return NextResponse.json({ ok: true, event_id: eventId });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
