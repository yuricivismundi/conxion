import { NextResponse } from "next/server";
import { findPendingPairRequestConflict } from "@/lib/requests/pending-pair-conflicts";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type PendingPairConflictPayload = {
  otherUserId?: string | null;
};

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as PendingPairConflictPayload | null;
    const otherUserId = body?.otherUserId?.trim() ?? "";
    if (!otherUserId) {
      return NextResponse.json({ ok: false, error: "otherUserId is required." }, { status: 400 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const conflict = await findPendingPairRequestConflict(getSupabaseServiceClient(), {
      actorUserId: authData.user.id,
      otherUserId,
    });

    return NextResponse.json({
      ok: true,
      conflict,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not check pending requests." },
      { status: 500 }
    );
  }
}
