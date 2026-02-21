import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type RespondAction = "accept" | "decline";

function isRespondAction(value: unknown): value is RespondAction {
  return value === "accept" || value === "decline";
}

function mapRespondErrorStatus(message: string) {
  if (message.includes("not_authenticated")) return 401;
  if (message.includes("not_authorized")) return 403;
  if (message.includes("event_not_found") || message.includes("request_not_found")) return 404;
  if (message.includes("request_not_pending") || message.includes("invalid_action")) return 409;
  return 400;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await context.params;
    if (!eventId) {
      return NextResponse.json({ ok: false, error: "Missing event id." }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const action = body?.action;
    const requestId = typeof body?.requestId === "string" ? body.requestId : "";
    const requesterId = typeof body?.requesterId === "string" ? body.requesterId : "";

    if (!isRespondAction(action)) {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }

    if (!requestId && !requesterId) {
      return NextResponse.json(
        { ok: false, error: "requestId or requesterId is required." },
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

    if (requestId) {
      const { data, error } = await supabase.rpc("respond_event_request", {
        p_request_id: requestId,
        p_action: action,
      });
      if (error) {
        const message = error.message ?? "Failed to process request.";
        return NextResponse.json({ ok: false, error: message }, { status: mapRespondErrorStatus(message) });
      }
      return NextResponse.json({ ok: true, event_id: data ?? eventId });
    }

    const { data, error } = await supabase.rpc("respond_event_request_by_id", {
      p_event_id: eventId,
      p_requester_id: requesterId,
      p_action: action,
    });

    if (error) {
      const message = error.message ?? "Failed to process request.";
      return NextResponse.json({ ok: false, error: message }, { status: mapRespondErrorStatus(message) });
    }

    return NextResponse.json({ ok: true, event_id: data ?? eventId });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
