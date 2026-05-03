import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

export async function DELETE(
  req: Request,
  context: { params: Promise<{ threadId: string; messageId: string }> }
) {
  try {
    const { threadId, messageId } = await context.params;
    if (!threadId || !messageId) {
      return NextResponse.json({ ok: false, error: "Missing thread or message id." }, { status: 400 });
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
    const userId = authData.user.id;

    const service = getSupabaseServiceClient();
    const [threadRes, messageRes] = await Promise.all([
      service
        .from("threads")
        .select("id,thread_type,event_id,group_id")
        .eq("id", threadId)
        .maybeSingle(),
      service
        .from("thread_messages")
        .select("id,thread_id,sender_id")
        .eq("id", messageId)
        .eq("thread_id", threadId)
        .maybeSingle(),
    ]);

    if (threadRes.error) {
      return NextResponse.json({ ok: false, error: threadRes.error.message }, { status: 500 });
    }
    if (messageRes.error) {
      return NextResponse.json({ ok: false, error: messageRes.error.message }, { status: 500 });
    }

    const threadRow = (threadRes.data ?? null) as {
      id?: string;
      thread_type?: string | null;
      event_id?: string | null;
      group_id?: string | null;
    } | null;
    const messageRow = (messageRes.data ?? null) as {
      id?: string;
      thread_id?: string;
      sender_id?: string | null;
    } | null;

    if (!threadRow?.id || !messageRow?.id) {
      return NextResponse.json({ ok: false, error: "Message not found." }, { status: 404 });
    }

    let canDelete = messageRow.sender_id === userId;

    if (!canDelete && threadRow.thread_type === "event" && threadRow.event_id) {
      const eventRes = await service
        .from("events")
        .select("host_user_id")
        .eq("id", threadRow.event_id)
        .maybeSingle();
      if (eventRes.error) {
        return NextResponse.json({ ok: false, error: eventRes.error.message }, { status: 500 });
      }
      const hostUserId = (eventRes.data as { host_user_id?: string } | null)?.host_user_id ?? null;
      canDelete = hostUserId === userId;
    }

    if (!canDelete && threadRow.thread_type === "group" && threadRow.group_id) {
      const groupRes = await service
        .from("groups")
        .select("host_user_id")
        .eq("id", threadRow.group_id)
        .maybeSingle();
      if (groupRes.error) {
        return NextResponse.json({ ok: false, error: groupRes.error.message }, { status: 500 });
      }
      const hostUserId = (groupRes.data as { host_user_id?: string } | null)?.host_user_id ?? null;
      canDelete = hostUserId === userId;
    }

    if (!canDelete) {
      return NextResponse.json({ ok: false, error: "Not authorized to delete this message." }, { status: 403 });
    }

    const deleteRes = await service
      .from("thread_messages")
      .delete()
      .eq("id", messageId)
      .eq("thread_id", threadId);
    if (deleteRes.error) {
      return NextResponse.json({ ok: false, error: deleteRes.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
