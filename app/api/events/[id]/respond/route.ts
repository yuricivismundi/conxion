import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

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
    const service = getSupabaseServiceClient();
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    if (requestId) {
      const requestRes = await service
        .from("event_requests")
        .select("id,event_id,requester_id")
        .eq("id", requestId)
        .maybeSingle();
      if (requestRes.error) {
        return NextResponse.json({ ok: false, error: requestRes.error.message }, { status: 500 });
      }
      const requestRow = (requestRes.data ?? null) as { requester_id?: string; event_id?: string | null } | null;
      if (typeof requestRow?.event_id === "string" && requestRow.event_id !== eventId) {
        return NextResponse.json({ ok: false, error: "Request does not belong to this event." }, { status: 404 });
      }
      const { data, error } = await supabase.rpc("respond_event_request", {
        p_request_id: requestId,
        p_action: action,
      });
      if (error) {
        const message = error.message ?? "Failed to process request.";
        return NextResponse.json({ ok: false, error: message }, { status: mapRespondErrorStatus(message) });
      }
      const requesterIdResolved = typeof requestRow?.requester_id === "string" ? requestRow.requester_id : "";
      const eventIdResolved = typeof requestRow?.event_id === "string" ? requestRow.event_id : eventId;
      if (requesterIdResolved) {
        await sendAppEmailBestEffort({
          kind: action === "accept" ? "event_request_accepted" : "event_request_declined",
          recipientUserId: requesterIdResolved,
          actorUserId: authData.user.id,
          eventId: eventIdResolved,
        });
      }
      return NextResponse.json({ ok: true, event_id: data ?? eventId });
    }

    const existingRequestRes = await service
      .from("event_requests")
      .select("id,event_id,requester_id")
      .eq("event_id", eventId)
      .eq("requester_id", requesterId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingRequestRes.error) {
      return NextResponse.json({ ok: false, error: existingRequestRes.error.message }, { status: 500 });
    }
    const existingRequestRow = (existingRequestRes.data ?? null) as { event_id?: string | null } | null;

    const { data, error } = await supabase.rpc("respond_event_request_by_id", {
      p_event_id: eventId,
      p_requester_id: requesterId,
      p_action: action,
    });

    if (error) {
      const message = error.message ?? "Failed to process request.";
      return NextResponse.json({ ok: false, error: message }, { status: mapRespondErrorStatus(message) });
    }

    if (requesterId) {
      await sendAppEmailBestEffort({
        kind: action === "accept" ? "event_request_accepted" : "event_request_declined",
        recipientUserId: requesterId,
        actorUserId: authData.user.id,
        eventId: typeof existingRequestRow?.event_id === "string" ? existingRequestRow.event_id : eventId,
      });
    }

    return NextResponse.json({ ok: true, event_id: data ?? eventId });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
