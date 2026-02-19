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

    const requesterId = body?.requesterId as string | undefined;
    const targetId = body?.targetId as string | undefined;
    const payload =
      body && typeof body.payload === "object" && body.payload !== null
        ? (body.payload as {
            connect_context?: string | null;
            connect_reason?: string | null;
            connect_reason_role?: string | null;
            connect_note?: string | null;
            trip_id?: string | null;
          })
        : {};

    if (!requesterId || !targetId) {
      return NextResponse.json({ ok: false, error: "Missing requesterId or targetId" }, { status: 400 });
    }
    if (requesterId === targetId) {
      return NextResponse.json({ ok: false, error: "Cannot connect with yourself." }, { status: 400 });
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
    if (authData.user.id !== requesterId) {
      return NextResponse.json({ ok: false, error: "Requester does not match session user." }, { status: 403 });
    }

    const contextRaw = payload.connect_context ?? (payload.trip_id ? "traveller" : "member");
    const normalizedContext = contextRaw === "trip" ? "traveller" : contextRaw;
    if (normalizedContext !== "member" && normalizedContext !== "traveller") {
      return NextResponse.json({ ok: false, error: "Invalid connect_context." }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("create_connection_request", {
      p_target_id: targetId,
      p_context: normalizedContext,
      p_connect_reason: payload.connect_reason ?? "",
      p_connect_reason_role: payload.connect_reason_role ?? null,
      p_trip_id: payload.trip_id ?? null,
      p_note: payload.connect_note ?? null,
    });

    if (error) {
      const message = error.message ?? "Failed to create connection request.";
      const status =
        message.includes("already_pending_or_connected") ? 409 :
        message.includes("rate_limit") ? 429 :
        message.includes("blocked") ? 403 : 400;
      return NextResponse.json({ ok: false, error: message }, { status });
    }

    return NextResponse.json({ ok: true, id: data ?? null });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
