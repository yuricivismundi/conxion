import { NextResponse } from "next/server";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    await sendAppEmailBestEffort({
      kind: "welcome_member",
      recipientUserId: authData.user.id,
      idempotencySeed: authData.user.created_at ?? new Date().toISOString().slice(0, 10),
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to send welcome email." },
      { status: 500 }
    );
  }
}
