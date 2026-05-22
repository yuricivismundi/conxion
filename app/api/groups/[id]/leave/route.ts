import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { validateCsrfOrigin, csrfError } from "@/lib/security/csrf";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!validateCsrfOrigin(req)) return csrfError();
  try {
    const { id: groupId } = await context.params;
    if (!groupId) return NextResponse.json({ ok: false, error: "Missing group id." }, { status: 400 });

    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });

    const userClient = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !authData.user) return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    const userId = authData.user.id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = getSupabaseServiceClient() as any;

    const groupRes = await service.from("groups").select("id,host_user_id").eq("id", groupId).maybeSingle();
    if (groupRes.error || !groupRes.data?.id) {
      return NextResponse.json({ ok: false, error: "Group not found." }, { status: 404 });
    }
    if ((groupRes.data as { host_user_id: string }).host_user_id === userId) {
      return NextResponse.json({ ok: false, error: "The host cannot leave their own group." }, { status: 403 });
    }

    await service.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);

    // Archive thread participation
    const threadRes = await service
      .from("threads")
      .select("id")
      .eq("group_id", groupId)
      .eq("thread_type", "group")
      .maybeSingle();
    const threadId = (threadRes.data as { id?: string } | null)?.id ?? null;
    if (threadId) {
      await service
        .from("thread_participants")
        .update({ archived_at: new Date().toISOString() } as never)
        .eq("thread_id", threadId)
        .eq("user_id", userId);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Server error." }, { status: 500 });
  }
}
