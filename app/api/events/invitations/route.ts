import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = getSupabaseServiceClient() as any;

    const { data: invRows, error } = await service
      .from("event_invitations")
      .select("id,event_id,inviter_user_id,status,created_at")
      .eq("recipient_user_id", authData.user.id)
      .in("status", ["pending", null])
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const rows = (invRows ?? []) as {
      id: string;
      event_id: string;
      inviter_user_id: string;
      status: string | null;
      created_at: string;
    }[];

    if (rows.length === 0) return NextResponse.json({ ok: true, invitations: [] });

    const eventIds = [...new Set(rows.map((r) => r.event_id))];
    const inviterIds = [...new Set(rows.map((r) => r.inviter_user_id))];

    const [eventsRes, profilesRes] = await Promise.all([
      service
        .from("events")
        .select("id,title,starts_at,ends_at,cover_url,city,country,status")
        .in("id", eventIds),
      service
        .from("profiles")
        .select("user_id,display_name,avatar_url")
        .in("user_id", inviterIds),
    ]);

    const eventsById: Record<string, { title: string; starts_at: string | null; ends_at: string | null; cover_url: string | null; city: string | null; country: string | null; status: string }> = {};
    for (const e of (eventsRes.data ?? [])) eventsById[e.id] = e;

    const profilesById: Record<string, { display_name: string; avatar_url: string | null }> = {};
    for (const p of (profilesRes.data ?? [])) profilesById[p.user_id] = p;

    const invitations = rows
      .map((r) => {
        const event = eventsById[r.event_id];
        if (!event || event.status === "cancelled") return null;
        return {
          id: r.id,
          event_id: r.event_id,
          status: r.status,
          created_at: r.created_at,
          event: {
            title: event.title,
            starts_at: event.starts_at,
            ends_at: event.ends_at,
            cover_url: event.cover_url,
            city: event.city,
            country: event.country,
          },
          inviter: profilesById[r.inviter_user_id] ?? null,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ ok: true, invitations });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}
