import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase service role config.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });

    const supabaseUser = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
    if (authErr || !authData.user) return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });

    const actorId = authData.user.id;
    const service = getServiceClient();

    // Verify caller is an admin
    const { data: adminRow } = await service.from("admins").select("user_id").eq("user_id", actorId).maybeSingle();
    if (!adminRow) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });

    const body = (await req.json().catch(() => null)) as {
      userId?: string;
      photoType?: string;
      message?: string;
    } | null;

    const userId = body?.userId?.trim();
    const photoType = body?.photoType?.trim() || "photo";
    const message = body?.message?.trim();

    if (!userId || !message) {
      return NextResponse.json({ ok: false, error: "userId and message are required." }, { status: 400 });
    }

    const title = photoType === "cover" ? "Cover photo needs updating" : "Profile photo needs updating";

    const { error: insertErr } = await service.from("notifications").insert({
      user_id: userId,
      actor_id: actorId,
      kind: "admin_photo_review",
      title,
      body: message,
      link_url: "/photo-guide",
      metadata: { photo_type: photoType, sent_by_admin: actorId },
    });

    if (insertErr) return NextResponse.json({ ok: false, error: insertErr.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}
