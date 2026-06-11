import { NextResponse } from "next/server";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

// Names to skip (case-insensitive substring match)
const SKIP_DISPLAY_NAMES = ["loubna ait kaci"];

function isLocalDev() {
  return process.env.NODE_ENV !== "production";
}

async function requireAdmin(req: Request) {
  if (isLocalDev()) return { ok: true as const };
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, status: 401, error: "Missing auth token." };
  const supabaseUser = getSupabaseUserClient(token);
  const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
  if (authErr || !authData.user) return { ok: false as const, status: 401, error: "Invalid auth token." };
  const adminCheck = await supabaseUser
    .from("admins")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (adminCheck.error || !adminCheck.data) return { ok: false as const, status: 403, error: "Admin access required." };
  return { ok: true as const };
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dryRun") === "1";

    const service = getSupabaseServiceClient();

    // Anyone who has a profile row has completed onboarding and should have received the welcome email.
    const profilesRes = await service
      .from("profiles")
      .select("user_id,display_name,created_at")
      .limit(5000);

    if (profilesRes.error) {
      return NextResponse.json({ ok: false, error: profilesRes.error.message }, { status: 500 });
    }

    type ProfileRow = { user_id?: string | null; display_name?: string | null; created_at?: string | null };
    const profiles = (profilesRes.data ?? []) as ProfileRow[];

    let sent = 0;
    let skippedExcluded = 0;
    let skippedMissingId = 0;
    const skippedNames: string[] = [];
    const errors: Array<{ userId: string; reason: string }> = [];

    for (const row of profiles) {
      const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
      if (!userId) {
        skippedMissingId += 1;
        continue;
      }
      const displayName = typeof row.display_name === "string" ? row.display_name.trim() : "";
      const lower = displayName.toLowerCase();
      if (SKIP_DISPLAY_NAMES.some((skip) => lower.includes(skip))) {
        skippedExcluded += 1;
        skippedNames.push(displayName);
        continue;
      }
      if (dryRun) {
        sent += 1;
        continue;
      }
      try {
        // Same idempotency seed as the onboarding finalize route uses, so Resend
        // will silently drop the email for anyone who already received it.
        await sendAppEmailBestEffort({
          kind: "welcome_member",
          recipientUserId: userId,
          idempotencySeed: row.created_at ?? new Date().toISOString().slice(0, 10),
        });
        sent += 1;
      } catch (e: unknown) {
        errors.push({ userId, reason: e instanceof Error ? e.message : "Unknown error" });
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      totalProfiles: profiles.length,
      sent,
      skippedExcluded,
      skippedMissingId,
      skippedNames,
      errors: errors.slice(0, 50),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
