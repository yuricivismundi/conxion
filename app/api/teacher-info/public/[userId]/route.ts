import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { hasTeacherBadgeRole } from "@/lib/teacher-info/roles";
import { fetchTeacherInfoProfile } from "@/lib/teacher-info/read-model";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ userId: string }>;
};

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { userId } = await params;
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    if (!normalizedUserId) {
      return NextResponse.json({ ok: false, error: "User id is required." }, { status: 400 });
    }

    const serviceClient = getSupabaseServiceClient();
    const profileRes = await serviceClient
      .from("profiles" as never)
      .select("user_id,roles")
      .eq("user_id", normalizedUserId)
      .maybeSingle();

    if (profileRes.error) throw profileRes.error;
    if (!profileRes.data) {
      return NextResponse.json({ ok: false, error: "Profile not found." }, { status: 404 });
    }

    const roles = Array.isArray((profileRes.data as { roles?: unknown }).roles)
      ? ((profileRes.data as { roles?: unknown }).roles as unknown[]).filter((item): item is string => typeof item === "string")
      : [];
    if (!hasTeacherBadgeRole(roles)) {
      return NextResponse.json({ ok: true, enabled: false });
    }

    const teacherProfile = await fetchTeacherInfoProfile(serviceClient, normalizedUserId);
    return NextResponse.json({
      ok: true,
      enabled: teacherProfile ? teacherProfile.isEnabled : true,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not load teacher inquiry availability." },
      { status: 500 }
    );
  }
}
