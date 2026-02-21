import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type RequestAction = "accept" | "decline";

function isRequestAction(value: unknown): value is RequestAction {
  return value === "accept" || value === "decline";
}

function mapRequestErrorStatus(message: string) {
  if (message.includes("not_authenticated")) return 401;
  if (message.includes("not_authorized")) return 403;
  if (message.includes("request_not_found") || message.includes("event_not_found")) return 404;
  if (message.includes("request_not_pending") || message.includes("invalid_action") || message.includes("event_hidden")) return 409;
  return 400;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const requestId = typeof body?.requestId === "string" ? body.requestId : "";
    const action = body?.action;

    if (!requestId || !isRequestAction(action)) {
      return NextResponse.json({ ok: false, error: "requestId and valid action are required." }, { status: 400 });
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

    const { data, error } = await supabase.rpc("respond_event_request", {
      p_request_id: requestId,
      p_action: action,
    });
    if (error) {
      const message = error.message ?? "Failed to process request.";
      return NextResponse.json({ ok: false, error: message }, { status: mapRequestErrorStatus(message) });
    }

    return NextResponse.json({ ok: true, event_id: data ?? null });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
