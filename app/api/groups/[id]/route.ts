import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function getUserClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: groupId } = await params;
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });

    const userClient = getUserClient(token);
    const { data: authData, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !authData.user) return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    const userId = authData.user.id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = getSupabaseServiceClient() as any;

    const { data: groupData, error: groupErr } = await service.from("groups").select("host_user_id").eq("id", groupId).single();
    if (groupErr || !groupData) return NextResponse.json({ ok: false, error: "Group not found." }, { status: 404 });
    if ((groupData as { host_user_id: string }).host_user_id !== userId) {
      return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const updates: Record<string, unknown> = {};

    if (typeof body?.title === "string") {
      const title = body.title.trim();
      if (title.length < 8) return NextResponse.json({ ok: false, error: "Title must be at least 8 characters." }, { status: 400 });
      if (title.length > 50) return NextResponse.json({ ok: false, error: "Title must be no more than 50 characters." }, { status: 400 });
      updates.title = title;
    }
    if (body?.description === null) {
      updates.description = null;
    } else if (typeof body?.description === "string") {
      const description = body.description.trim();
      if (description.length < 24) return NextResponse.json({ ok: false, error: "Description must be at least 24 characters." }, { status: 400 });
      if (description.length > 4000) return NextResponse.json({ ok: false, error: "Description must be no more than 4000 characters." }, { status: 400 });
      updates.description = description;
    }
    if (typeof body?.chatMode === "string") {
      updates.chat_mode = body.chatMode === "broadcast" ? "broadcast" : "discussion";
    }
    if (body?.coverUrl !== undefined) {
      const coverUrl = typeof body.coverUrl === "string" ? body.coverUrl.trim() : null;
      if (coverUrl && !/\/storage\/v1\/(object\/public|render\/image\/public)\/avatars\//i.test(coverUrl)) {
        return NextResponse.json({ ok: false, error: "Invalid cover URL." }, { status: 400 });
      }
      updates.cover_url = coverUrl || null;
      if (coverUrl) updates.cover_status = "pending";
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateErr } = await service.from("groups").update(updates).eq("id", groupId);
      if (updateErr) {
        return NextResponse.json({ ok: false, error: (updateErr as { message?: string }).message ?? "Update failed." }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: groupId } = await params;
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });

    const userClient = getUserClient(token);
    const { data: authData, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !authData.user) return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    const userId = authData.user.id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = getSupabaseServiceClient() as any;

    const { data: groupData, error: groupErr } = await service.from("groups").select("host_user_id").eq("id", groupId).single();
    if (groupErr || !groupData) return NextResponse.json({ ok: false, error: "Group not found." }, { status: 404 });
    if ((groupData as { host_user_id: string }).host_user_id !== userId) {
      return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }

    const { data: threadData } = await service
      .from("threads")
      .select("id")
      .eq("group_id", groupId)
      .eq("thread_type", "group")
      .single();

    if (threadData) {
      const threadId = (threadData as { id: string }).id;
      await service
        .from("thread_participants")
        .update({ archived_at: new Date().toISOString() })
        .eq("thread_id", threadId);
    }

    const { error: deleteErr } = await service.from("groups").delete().eq("id", groupId).eq("host_user_id", userId);
    if (deleteErr) {
      return NextResponse.json({ ok: false, error: (deleteErr as { message?: string }).message ?? "Delete failed." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}
