import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

export async function POST(
  req: Request,
  context: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await context.params;
    if (!requestId) {
      return NextResponse.json({ ok: false, error: "Missing requestId." }, { status: 400 });
    }

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const { data, error } = await supabase.rpc("cancel_hosting_request", {
      p_request_id: requestId,
    });

    if (error) {
      const message = error.message ?? "Failed to cancel hosting request.";
      const status =
        message.includes("not_authenticated") ? 401 :
        message.includes("not_found") ? 404 :
        message.includes("not_pending") ? 409 : 400;
      return NextResponse.json({ ok: false, error: message }, { status });
    }

    return NextResponse.json({ ok: true, id: data ?? null });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}

