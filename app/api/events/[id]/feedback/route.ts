import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

function mapFeedbackErrorStatus(message: string) {
  if (message.includes("not_authenticated")) return 401;
  if (message.includes("event_not_found")) return 404;
  if (message.includes("event_feedback_not_allowed")) return 403;
  if (message.includes("invalid_quality") || message.includes("invalid_visibility") || message.includes("feedback_note_too_long")) {
    return 400;
  }
  if (message.includes("feedback_locked_after_15_days")) return 409;
  return 500;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await context.params;
    if (!eventId) {
      return NextResponse.json({ ok: false, error: "Missing event id." }, { status: 400 });
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

    const userId = authData.user.id;

    const [mineRes, canSubmitRes, summaryRes] = await Promise.all([
      supabase
        .from("event_feedback")
        .select("id,event_id,author_id,happened_as_described,quality,note,visibility,created_at,updated_at")
        .eq("event_id", eventId)
        .eq("author_id", userId)
        .maybeSingle(),
      supabase.rpc("can_submit_event_feedback", { p_event_id: eventId, p_user_id: userId }),
      supabase.rpc("get_event_feedback_summary", { p_event_id: eventId }),
    ]);

    return NextResponse.json({
      ok: true,
      mine: mineRes.data ?? null,
      can_submit: Boolean(canSubmitRes.data),
      summary: Array.isArray(summaryRes.data) ? summaryRes.data[0] ?? null : null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
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
    const happenedAsDescribed = body?.happenedAsDescribed === true;
    const quality = typeof body?.quality === "number" ? body.quality : Number(body?.quality ?? 0);
    const note = typeof body?.note === "string" ? body.note : null;
    const visibility = typeof body?.visibility === "string" ? body.visibility : "private";

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const { data, error } = await supabase.rpc("submit_event_feedback", {
      p_event_id: eventId,
      p_happened_as_described: happenedAsDescribed,
      p_quality: quality,
      p_note: note,
      p_visibility: visibility,
    });

    if (error) {
      const message = error.message ?? "Failed to submit feedback.";
      return NextResponse.json({ ok: false, error: message }, { status: mapFeedbackErrorStatus(message) });
    }

    return NextResponse.json({ ok: true, feedback_id: data ?? null });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
