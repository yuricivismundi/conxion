import { NextResponse } from "next/server";
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

    return NextResponse.json({ ok: true, moderation_log_id: data ?? null });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
