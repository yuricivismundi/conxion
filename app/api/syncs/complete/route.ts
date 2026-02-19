import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseUserClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(url, anon, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const connectionId = typeof body?.connectionId === "string" ? body.connectionId : "";
    const syncId = typeof body?.syncId === "string" ? body.syncId : "";
    const note = typeof body?.note === "string" ? body.note : null;

    if (!connectionId && !syncId) {
      return NextResponse.json({ ok: false, error: "Missing syncId or connectionId." }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    let targetSyncId = syncId;

    if (!targetSyncId && connectionId) {
      const latestAccepted = await supabase
        .from("connection_syncs")
        .select("id")
        .eq("connection_id", connectionId)
        .eq("status", "accepted")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latestAccepted.error && latestAccepted.data?.id) {
        targetSyncId = latestAccepted.data.id;
      }
    }

    if (targetSyncId) {
      const completed = await supabase.rpc("complete_connection_sync", {
        p_sync_id: targetSyncId,
        p_note: note,
      });
      if (!completed.error) {
        return NextResponse.json({ ok: true, sync_id: completed.data ?? targetSyncId, mode: "connection_syncs" });
      }

      if (
        !completed.error.message.toLowerCase().includes("function") &&
        !completed.error.message.toLowerCase().includes("complete_connection_sync")
      ) {
        return NextResponse.json({ ok: false, error: completed.error.message }, { status: 400 });
      }
    }

    if (!connectionId) {
      return NextResponse.json({ ok: false, error: "Legacy completion requires connectionId." }, { status: 400 });
    }

    const legacy = await supabase.rpc("mark_sync_completed", {
      p_connection_id: connectionId,
      p_note: note,
    });
    if (legacy.error) {
      return NextResponse.json({ ok: false, error: legacy.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, sync_id: legacy.data ?? null, mode: "legacy" });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
