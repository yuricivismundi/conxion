import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

export async function POST(
  req: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token: inviteToken } = await context.params;
    if (!inviteToken) {
      return NextResponse.json({ ok: false, error: "Missing invite token." }, { status: 400 });
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = getSupabaseServiceClient() as any;
    const groupRes = await service
      .from("groups")
      .select("id,title,status,max_members")
      .eq("invite_token", inviteToken)
      .maybeSingle();
    if (groupRes.error) {
      return NextResponse.json({ ok: false, error: groupRes.error.message }, { status: 500 });
    }

    const groupRow = (groupRes.data ?? null) as {
      id?: string;
      title?: string | null;
      status?: string | null;
      max_members?: number | null;
    } | null;
    if (!groupRow?.id) {
      return NextResponse.json({ ok: false, error: "Invite link not found." }, { status: 404 });
    }
    if ((groupRow.status ?? "active") !== "active") {
      return NextResponse.json({ ok: false, error: "This group is no longer accepting members." }, { status: 409 });
    }

    const [membershipRes, countRes] = await Promise.all([
      service
        .from("group_members")
        .select("id")
        .eq("group_id", groupRow.id)
        .eq("user_id", userId)
        .maybeSingle(),
      service
        .from("group_members")
        .select("id", { head: true, count: "exact" })
        .eq("group_id", groupRow.id),
    ]);

    if (membershipRes.error) {
      return NextResponse.json({ ok: false, error: membershipRes.error.message }, { status: 500 });
    }
    if (countRes.error) {
      return NextResponse.json({ ok: false, error: countRes.error.message }, { status: 500 });
    }

    const alreadyMember = Boolean((membershipRes.data as { id?: string } | null)?.id);
    const memberCount = countRes.count ?? 0;
    const maxMembers = typeof groupRow.max_members === "number" && Number.isFinite(groupRow.max_members)
      ? groupRow.max_members
      : 25;

    if (!alreadyMember && memberCount >= maxMembers) {
      return NextResponse.json({ ok: false, error: "This group is already full." }, { status: 409 });
    }

    if (!alreadyMember) {
      const insertRes = await service
        .from("group_members")
        .insert({ group_id: groupRow.id, user_id: userId, role: "member" });
      if (insertRes.error) {
        return NextResponse.json({ ok: false, error: insertRes.error.message }, { status: 500 });
      }
    }

    try {
      await service.rpc("cx_ensure_group_thread", {
        p_group_id: groupRow.id,
        p_actor: userId,
      });
    } catch {
      // Best effort only. Joining the group matters more than the chat thread.
    }

    const threadRes = await service
      .from("threads")
      .select("id")
      .eq("group_id", groupRow.id)
      .eq("thread_type", "group")
      .maybeSingle();
    if (!threadRes.error) {
      const threadId = (threadRes.data as { id?: string } | null)?.id ?? null;
      if (threadId) {
        await service.from("thread_participants").upsert(
          { thread_id: threadId, user_id: userId, role: "member", archived_at: null },
          { onConflict: "thread_id,user_id", ignoreDuplicates: false }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      group_id: groupRow.id,
      title: groupRow.title ?? "Group",
      already_member: alreadyMember,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
