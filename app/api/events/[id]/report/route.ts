import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

function mapReportErrorStatus(message: string) {
  if (message.includes("not_authenticated")) return 401;
  if (message.includes("event_not_found")) return 404;
  if (message.includes("cannot_report_own_event")) return 409;
  if (message.includes("report_reason_required")) return 400;
  if (message.includes("ux_event_reports_open_unique") || message.includes("duplicate key")) return 409;
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
    const reason = typeof body?.reason === "string" ? body.reason : "";
    const note = typeof body?.note === "string" ? body.note : null;

    if (!reason.trim()) {
      return NextResponse.json({ ok: false, error: "Reason is required." }, { status: 400 });
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

    const { data, error } = await supabase.rpc("create_event_report", {
      p_event_id: eventId,
      p_reason: reason.trim(),
      p_note: note,
    });

    if (error) {
      const message = error.message ?? "Failed to report event.";
      return NextResponse.json({ ok: false, error: message }, { status: mapReportErrorStatus(message) });
    }

    return NextResponse.json({ ok: true, report_id: data ?? null });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
