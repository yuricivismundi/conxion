import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

export async function GET(req: Request, context: { params: Promise<{ connectionId: string }> }) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });

    const { connectionId } = await context.params;
    if (!connectionId) return NextResponse.json({ ok: false, error: "Missing connectionId." }, { status: 400 });

    const supabaseUser = getSupabaseUserClient(token);
    const service = getSupabaseServiceClient();

    // Auth + connection verify in parallel
    const [authRes, connRes] = await Promise.all([
      supabaseUser.auth.getUser(token),
      service
        .from("connections")
        .select("id,requester_id,target_id")
        .eq("id", connectionId)
        .maybeSingle(),
    ]);

    if (authRes.error || !authRes.data.user) return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    const userId = authRes.data.user.id;

    const conn = connRes.data as { id: string; requester_id: string; target_id: string } | null;
    // Verify caller is part of this connection
    if (!conn || (conn.requester_id !== userId && conn.target_id !== userId)) {
      return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }

    const otherUserId = conn.requester_id === userId ? conn.target_id : conn.requester_id;
    const userLow = userId < otherUserId ? userId : otherUserId;
    const userHigh = userId < otherUserId ? otherUserId : userId;

    // Find all threads + messages + contexts in one parallel batch
    const [connThreadsRes, directThreadsRes, myPartRes, otherPartRes, legacyMsgsRes, contextsRes] = await Promise.all([
      service.from("threads").select("id").eq("connection_id", connectionId),
      service.from("threads").select("id").eq("thread_type", "direct")
        .eq("direct_user_low", userLow).eq("direct_user_high", userHigh),
      service.from("thread_participants").select("thread_id").eq("user_id", userId),
      service.from("thread_participants").select("thread_id").eq("user_id", otherUserId),
      service.from("messages")
        .select("id,connection_id,sender_id,body,created_at")
        .eq("connection_id", connectionId)
        .order("created_at", { ascending: true })
        .limit(500),
      service.from("thread_contexts")
        .select("id,thread_id,source_table,source_id,context_tag,status_tag,title,city,start_date,end_date,requester_id,recipient_id,metadata,created_at,updated_at")
        .or(`and(requester_id.eq.${userId},recipient_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},recipient_id.eq.${userId})`)
        .order("updated_at", { ascending: false })
        .limit(80),
    ]);

    const allThreadIds = new Set<string>();
    for (const r of (connThreadsRes.data ?? []) as Array<{ id: string }>) allThreadIds.add(r.id);
    for (const r of (directThreadsRes.data ?? []) as Array<{ id: string }>) allThreadIds.add(r.id);
    const myIds = new Set((myPartRes.data ?? []).map((r: Record<string, unknown>) => r.thread_id as string));
    for (const r of (otherPartRes.data ?? []) as Array<{ thread_id: string }>) {
      if (myIds.has(r.thread_id)) allThreadIds.add(r.thread_id);
    }

    const threadIdArr = Array.from(allThreadIds);
    const threadMsgsRes = threadIdArr.length > 0
      ? await service.from("thread_messages")
          .select("id,thread_id,sender_id,body,message_type,context_tag,status_tag,metadata,created_at")
          .in("thread_id", threadIdArr)
          .order("created_at", { ascending: true })
          .limit(500)
      : { data: [], error: null };

    type LegacyMsg = { id: string; sender_id: string; body: string; created_at: string };
    const normalizedLegacy = ((legacyMsgsRes.data ?? []) as LegacyMsg[]).map((m) => ({
      id: m.id,
      thread_id: null,
      sender_id: m.sender_id,
      body: m.body,
      message_type: "text",
      context_tag: "regular_chat",
      status_tag: "active",
      metadata: {},
      created_at: m.created_at,
    }));

    const byId = new Map<string, Record<string, unknown>>();
    for (const m of [...((threadMsgsRes.data ?? []) as Record<string, unknown>[]), ...normalizedLegacy]) {
      byId.set(m.id as string, m);
    }
    const messages = Array.from(byId.values()).sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at))
    );

    const primaryThreadId = (connThreadsRes.data as Array<{ id: string }> | null)?.[0]?.id ?? null;
    const contexts = contextsRes.data ?? [];

    return NextResponse.json({ ok: true, messages, threadId: primaryThreadId, contexts });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load messages." },
      { status: 500 }
    );
  }
}
