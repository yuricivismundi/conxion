import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client (service role preferred; anon fallback)
function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!service && !anon) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(url, service ?? anon!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const requesterId = body?.requesterId as string | undefined;
    const targetId = body?.targetId as string | undefined;
    const payload = (body?.payload ?? {}) as any;

    if (!requesterId || !targetId) {
      return NextResponse.json({ ok: false, error: "Missing requesterId or targetId" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();

    const row = {
      requester_id: requesterId,
      target_id: targetId,
      status: "pending",

      // metadata (must exist as columns; if not, you'll see a clear DB error)
      connect_context: payload.connect_context ?? null,
      connect_reason: payload.connect_reason ?? null,
      connect_reason_role: payload.connect_reason_role ?? null,
      connect_note: payload.connect_note ?? null,
      trip_id: payload.trip_id ?? null,
    };

    const { error } = await supabase.from("connections").insert(row);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}