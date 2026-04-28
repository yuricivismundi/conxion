import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type EventMessageAction = "approve";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const { id: eventId, messageId } = await context.params;
    if (!eventId || !messageId) {
      return NextResponse.json({ ok: false, error: "Missing event or message id." }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
    const action = body?.action;
    if (action !== "approve") {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const userClient = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = getSupabaseServiceClient() as any;
    const eventRes = await service
      .from("events")
      .select("id,host_user_id")
      .eq("id", eventId)
      .maybeSingle();
    if (eventRes.error) {
      return NextResponse.json({ ok: false, error: eventRes.error.message }, { status: 500 });
    }

    const eventRow = (eventRes.data ?? null) as { id?: string; host_user_id?: string } | null;
    if (!eventRow?.id) {
      return NextResponse.json({ ok: false, error: "Event not found." }, { status: 404 });
    }
    if (eventRow.host_user_id !== authData.user.id) {
      return NextResponse.json({ ok: false, error: "Only the organiser can approve messages." }, { status: 403 });
    }

    const threadRes = await service
      .from("threads")
      .select("id,thread_type")
      .eq("event_id", eventId)
      .eq("thread_type", "event")
      .maybeSingle();
    if (threadRes.error) {
      return NextResponse.json({ ok: false, error: threadRes.error.message }, { status: 500 });
    }

    const threadRow = (threadRes.data ?? null) as { id?: string; thread_type?: string } | null;
    if (!threadRow?.id || threadRow.thread_type !== "event") {
      return NextResponse.json({ ok: false, error: "Event thread not found." }, { status: 404 });
    }

    const messageRes = await service
      .from("thread_messages")
      .select("id,thread_id,message_type,context_tag,status_tag")
      .eq("id", messageId)
      .eq("thread_id", threadRow.id)
      .maybeSingle();
    if (messageRes.error) {
      return NextResponse.json({ ok: false, error: messageRes.error.message }, { status: 500 });
    }

    const messageRow = (messageRes.data ?? null) as {
      id?: string;
      thread_id?: string;
      message_type?: string | null;
      context_tag?: string | null;
      status_tag?: string | null;
    } | null;
    if (!messageRow?.id) {
      return NextResponse.json({ ok: false, error: "Message not found." }, { status: 404 });
    }
    if ((messageRow.message_type ?? "text") !== "text" || (messageRow.context_tag ?? "event_chat") !== "event_chat") {
      return NextResponse.json({ ok: false, error: "Only attendee chat messages can be approved here." }, { status: 409 });
    }

    if ((messageRow.status_tag ?? "active") !== "pending") {
      return NextResponse.json({ ok: true, status_tag: messageRow.status_tag ?? "active" });
    }

    const updateRes = await service
      .from("thread_messages")
      .update({ status_tag: "active" })
      .eq("id", messageId)
      .eq("thread_id", threadRow.id);
    if (updateRes.error) {
      return NextResponse.json({ ok: false, error: updateRes.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status_tag: "active" });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
