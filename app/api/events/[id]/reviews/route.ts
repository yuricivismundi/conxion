import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await context.params;
    if (!eventId) {
      return NextResponse.json({ ok: false, error: "Missing event id." }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = getSupabaseServiceClient() as any;

    const { data: feedbackRows, error } = await service
      .from("event_feedback")
      .select("id,quality,note,created_at,author_id")
      .eq("event_id", eventId)
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = (feedbackRows ?? []) as { id: string; quality: number; note: string | null; created_at: string; author_id: string }[];

    // Fetch profiles for all authors
    const authorIds = [...new Set(rows.map((r) => r.author_id))];
    let profilesMap: Record<string, { display_name: string; avatar_url: string | null; city: string | null; country: string | null }> = {};

    if (authorIds.length > 0) {
      const { data: profileRows } = await service
        .from("profiles")
        .select("user_id,display_name,avatar_url,city,country")
        .in("user_id", authorIds);

      for (const p of (profileRows ?? []) as { user_id: string; display_name: string; avatar_url: string | null; city: string | null; country: string | null }[]) {
        profilesMap[p.user_id] = { display_name: p.display_name, avatar_url: p.avatar_url, city: p.city, country: p.country };
      }
    }

    const reviews = rows.map((r) => ({
      id: r.id,
      quality: r.quality,
      note: r.note,
      created_at: r.created_at,
      author_id: r.author_id,
      profiles: profilesMap[r.author_id] ?? null,
    }));

    return NextResponse.json({ ok: true, reviews });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
