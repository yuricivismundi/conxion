import { NextResponse } from "next/server";
import { sendAdminThreadNotice } from "@/lib/admin/communication";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type EventModerateAction = "approve_cover" | "reject_cover" | "hide" | "unhide" | "cancel" | "publish";

function isEventModerateAction(value: unknown): value is EventModerateAction {
  return (
    value === "approve_cover" ||
    value === "reject_cover" ||
    value === "hide" ||
    value === "unhide" ||
    value === "cancel" ||
    value === "publish"
  );
}

function mapModerateEventErrorStatus(message: string) {
  if (message.includes("not_authenticated")) return 401;
  if (message.includes("not_authorized")) return 403;
  if (message.includes("event_not_found")) return 404;
  if (message.includes("invalid_action") || message.includes("event_cover_missing")) return 409;
  return 400;
}

function buildEventNotice(params: {
  action: EventModerateAction;
  eventTitle: string;
  note: string;
  hiddenReason: string;
}) {
  const title = params.eventTitle || "your event";
  const noteSuffix = params.note ? `\n\nAdmin note: ${params.note}` : "";

  if (params.action === "approve_cover") {
    return {
      notificationTitle: "Event cover approved",
      notificationBody: `Admin approved the cover image for "${title}".`,
      message: `Your event cover for "${title}" was approved by admin.${noteSuffix}`,
    };
  }

  if (params.action === "reject_cover") {
    return {
      notificationTitle: "Event cover rejected",
      notificationBody: `Admin rejected the cover image for "${title}". A new cover is required.`,
      message: `Your event cover for "${title}" was rejected by admin.${noteSuffix}\n\nPlease upload a new cover image that meets our guidelines. Until a new cover is approved, your event will remain as an incomplete draft and will not be listed publicly.`,
    };
  }

  if (params.action === "hide") {
    const reasonLine = params.hiddenReason ? `\n\nHide reason: ${params.hiddenReason}` : "";
    return {
      notificationTitle: "Event hidden by admin",
      notificationBody: `Admin removed "${title}" from discover.`,
      message: `Your event "${title}" was hidden by admin and is no longer visible in discover.${reasonLine}${noteSuffix}`,
    };
  }

  if (params.action === "unhide") {
    return {
      notificationTitle: "Event restored",
      notificationBody: `Admin restored "${title}" to discover.`,
      message: `Your event "${title}" was restored by admin and is visible again.${noteSuffix}`,
    };
  }

  if (params.action === "publish") {
    return {
      notificationTitle: "Event published by admin",
      notificationBody: `Admin published "${title}" again.`,
      message: `Your event "${title}" was published again by admin.${noteSuffix}`,
    };
  }

  return {
    notificationTitle: "Event cancelled by admin",
    notificationBody: `Admin cancelled "${title}".`,
    message: `Your event "${title}" was cancelled by admin.${noteSuffix}`,
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const eventId = typeof body?.eventId === "string" ? body.eventId : "";
    const action = body?.action;
    const note = typeof body?.note === "string" ? body.note : null;
    const hiddenReason = typeof body?.hiddenReason === "string" ? body.hiddenReason : null;

    if (!eventId || !isEventModerateAction(action)) {
      return NextResponse.json({ ok: false, error: "eventId and valid action are required." }, { status: 400 });
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

    const { data, error } = await supabase.rpc("moderate_event", {
      p_event_id: eventId,
      p_action: action,
      p_note: note,
      p_hidden_reason: hiddenReason,
    });
    if (error) {
      const message = error.message ?? "Failed to moderate event.";
      return NextResponse.json({ ok: false, error: message }, { status: mapModerateEventErrorStatus(message) });
    }

    const service = getSupabaseServiceClient();
    const eventRes = await service
      .from("events")
      .select("id,title,host_user_id,cover_url")
      .eq("id", eventId)
      .maybeSingle();
    if (eventRes.error) {
      return NextResponse.json({ ok: false, error: eventRes.error.message }, { status: 400 });
    }

    const eventRow = (eventRes.data ?? null) as { id?: string; title?: string | null; host_user_id?: string | null; cover_url?: string | null } | null;

    // When a cover is rejected: clear it from the event and revert to draft
    if (action === "reject_cover" && eventRow?.id) {
      const coverUrl = eventRow.cover_url ?? null;

      // Delete cover file from storage by extracting the path from the URL
      if (coverUrl) {
        const match = coverUrl.match(/\/storage\/v1\/object\/public\/avatars\/(.+?)(\?.*)?$/);
        if (match?.[1]) {
          await service.storage.from("avatars").remove([decodeURIComponent(match[1])]).catch(() => null);
        }
      }

      // Clear cover_url and move event back to draft
      const serviceAny = service as unknown as {
        from: (table: string) => {
          update: (values: Record<string, unknown>) => {
            eq: (col: string, val: string) => Promise<{ error: { message?: string } | null }>;
          };
        };
      };
      await serviceAny.from("events").update({ cover_url: null, status: "draft" }).eq("id", eventId);
    }

    let threadToken: string | null = null;
    let notificationWarning: string | null = null;

    if (eventRow?.host_user_id) {
      const noticeContent = buildEventNotice({
        action,
        eventTitle: eventRow.title ?? "your event",
        note: note?.trim() ?? "",
        hiddenReason: hiddenReason?.trim() ?? "",
      });
      try {
        const notice = await sendAdminThreadNotice({
          serviceClient: service,
          actorId: authData.user.id,
          recipientUserId: eventRow.host_user_id,
          title: noticeContent.notificationTitle,
          message: noticeContent.message,
          notificationBody: noticeContent.notificationBody,
          metadata: {
            source: "event_moderation",
            event_id: eventId,
            moderation_action: action,
          },
        });
        threadToken = notice.threadToken;
        notificationWarning = notice.notificationError;
      } catch (noticeError: unknown) {
        notificationWarning = noticeError instanceof Error ? noticeError.message : "Could not deliver the host update.";
      }
    }

    return NextResponse.json({
      ok: true,
      moderation_log_id: data ?? null,
      threadToken,
      notificationWarning,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
