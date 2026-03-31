import { NextResponse } from "next/server";
import { dispatchReferencePromptEmails } from "@/lib/email/reference-prompts";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

function isMissingSchemaError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("relation") ||
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("column") ||
    text.includes("function")
  );
}

function isRecoverableSyncError(message: string) {
  const text = message.toLowerCase();
  return text.includes("record \"r\" has no field");
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabaseUser = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const [activitySyncRes, syncRes] = await Promise.all([
      supabaseUser.rpc("cx_sync_activities"),
      supabaseUser.rpc("cx_sync_reference_requests"),
    ]);
    if (activitySyncRes.error && !isMissingSchemaError(activitySyncRes.error.message)) {
      return NextResponse.json({ ok: false, error: activitySyncRes.error.message }, { status: 400 });
    }
    if (
      syncRes.error &&
      !isMissingSchemaError(syncRes.error.message) &&
      !isRecoverableSyncError(syncRes.error.message)
    ) {
      return NextResponse.json({ ok: false, error: syncRes.error.message }, { status: 400 });
    }

    const email = await dispatchReferencePromptEmails({ userId: authData.user.id, limit: 100 });

    return NextResponse.json({
      ok: true,
      activitySync: activitySyncRes.error ? null : activitySyncRes.data ?? null,
      sync: syncRes.error ? null : syncRes.data ?? null,
      email,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to sync reference prompts." },
      { status: 500 }
    );
  }
}
