import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

export async function GET(req: Request, context: { params: Promise<{ threadId: string }> }) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });

    const { threadId } = await context.params;
    if (!threadId) return NextResponse.json({ ok: false, error: "Missing threadId." }, { status: 400 });

    const url = new URL(req.url);
    const connectionId = url.searchParams.get("connectionId") ?? null;

    const supabaseUser = getSupabaseUserClient(token);
    const service = getSupabaseServiceClient();

    const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
    if (authErr || !authData.user) return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    const userId = authData.user.id;

    // Resolve thread metadata and verify access
    const [partRes, ctxRes, threadMeta] = await Promise.all([
      service.from("thread_participants").select("user_id").eq("thread_id", threadId).eq("user_id", userId).maybeSingle(),
      service.from("thread_contexts").select("requester_id,recipient_id").eq("thread_id", threadId).limit(5),
      service.from("threads").select("id,thread_type,connection_id,direct_user_low,direct_user_high").eq("id", threadId).maybeSingle(),
    ]);

    const thread = threadMeta.data as {
      id?: string; thread_type?: string; connection_id?: string | null;
      direct_user_low?: string | null; direct_user_high?: string | null;
    } | null;
    if (!thread?.id) return NextResponse.json({ ok: false, error: "Thread not found." }, { status: 404 });

    let canAccess = Boolean(partRes.data);
    let otherUserId: string | null = null;
    const resolvedConnectionId = connectionId ?? thread.connection_id ?? null;

    if (!canAccess) {
      const ctxRows = (ctxRes.data ?? []) as Array<{ requester_id?: string | null; recipient_id?: string | null }>;
      if (ctxRows.some((r) => r.requester_id === userId || r.recipient_id === userId)) {
        canAccess = true;
        const ctx = ctxRows.find((r) => r.requester_id === userId || r.recipient_id === userId);
        otherUserId = ctx?.requester_id === userId ? (ctx?.recipient_id ?? null) : (ctx?.requester_id ?? null);
      }
    }

    if (!canAccess && resolvedConnectionId) {
      const connRes = await service.from("connections").select("id,requester_id,target_id")
        .eq("id", resolvedConnectionId)
        .or(`requester_id.eq.${userId},target_id.eq.${userId}`)
        .maybeSingle();
      if (connRes.data) {
        canAccess = true;
        const c = connRes.data as { requester_id?: string; target_id?: string };
        otherUserId = c.requester_id === userId ? (c.target_id ?? null) : (c.requester_id ?? null);
      }
    }

    if (!canAccess && (thread.direct_user_low === userId || thread.direct_user_high === userId)) {
      canAccess = true;
      otherUserId = ((thread.direct_user_low === userId ? thread.direct_user_high : thread.direct_user_low) ?? null);
    }

    if (!canAccess) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });

    // Collect ALL thread IDs to search across
    const allThreadIds = new Set<string>([threadId]);

    if (otherUserId) {
      const userLow = userId < otherUserId ? userId : otherUserId;
      const userHigh = userId < otherUserId ? otherUserId : userId;

      const [directRes, myPartRes, otherPartRes] = await Promise.all([
        service.from("threads").select("id").eq("thread_type", "direct")
          .eq("direct_user_low", userLow).eq("direct_user_high", userHigh),
        service.from("thread_participants").select("thread_id").eq("user_id", userId),
        service.from("thread_participants").select("thread_id").eq("user_id", otherUserId),
      ]);

      for (const r of (directRes.data ?? []) as Array<{ id: string }>) allThreadIds.add(r.id);
      const myIds = new Set((myPartRes.data ?? []).map((r: Record<string, unknown>) => r.thread_id as string));
      for (const r of (otherPartRes.data ?? []) as Array<{ thread_id: string }>) {
        if (myIds.has(r.thread_id)) allThreadIds.add(r.thread_id);
      }
    }

    // Fetch from BOTH message tables in parallel
    const threadIdArr = Array.from(allThreadIds);
    const [threadMsgsRes, connMsgsRes] = await Promise.all([
      service.from("thread_messages")
        .select("id,thread_id,sender_id,body,message_type,context_tag,status_tag,metadata,created_at")
        .in("thread_id", threadIdArr)
        .order("created_at", { ascending: true })
        .limit(2000),
      resolvedConnectionId
        ? service.from("messages")
            .select("id,connection_id,sender_id,body,created_at")
            .eq("connection_id", resolvedConnectionId)
            .order("created_at", { ascending: true })
            .limit(2000)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (threadMsgsRes.error) return NextResponse.json({ ok: false, error: threadMsgsRes.error.message }, { status: 500 });

    // Normalise legacy messages table rows to match thread_messages shape
    type LegacyRow = { id: string; sender_id: string; body: string; created_at: string };
    const legacyRaw = ((connMsgsRes as { data: LegacyRow[] | null }).data ?? []);
    const legacyMsgs = legacyRaw.map((m) => ({
      id: m.id,
      thread_id: threadId,
      sender_id: m.sender_id,
      body: m.body,
      message_type: "text",
      context_tag: "regular_chat",
      status_tag: "active",
      metadata: {},
      created_at: m.created_at,
    }));

    // Merge, dedup by id, sort by created_at
    const byId = new Map<string, Record<string, unknown>>();
    for (const m of [...(threadMsgsRes.data ?? []), ...legacyMsgs]) {
      byId.set(m.id as string, m as Record<string, unknown>);
    }
    const messages = Array.from(byId.values()).sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at))
    );

    return NextResponse.json({ ok: true, messages });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load messages." },
      { status: 500 }
    );
  }
}
