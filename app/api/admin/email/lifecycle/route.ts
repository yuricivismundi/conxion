import { NextResponse } from "next/server";
import { dispatchLifecycleEmails, type LifecycleEmailKind } from "@/lib/email/lifecycle";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type DispatchBody = {
  kinds?: unknown;
  userId?: unknown;
};

const ALLOWED_KINDS: LifecycleEmailKind[] = [
  "sync_upcoming",
  "event_starting_soon",
  "travel_plan_upcoming",
  "inbox_digest",
];

function isLocalDev() {
  return process.env.NODE_ENV !== "production";
}

async function requireAdmin(req: Request) {
  if (isLocalDev()) {
    return { ok: true as const };
  }

  const token = getBearerToken(req);
  if (!token) {
    return { ok: false as const, status: 401, error: "Missing auth token." };
  }

  const supabaseUser = getSupabaseUserClient(token);
  const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
  if (authErr || !authData.user) {
    return { ok: false as const, status: 401, error: "Invalid auth token." };
  }

  const adminCheck = await supabaseUser.from("admins").select("user_id").eq("user_id", authData.user.id).maybeSingle();
  if (adminCheck.error || !adminCheck.data) {
    return { ok: false as const, status: 403, error: "Admin access required." };
  }

  return { ok: true as const };
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
    }

    const body = (await req.json().catch(() => null)) as DispatchBody | null;
    const userId = typeof body?.userId === "string" && body.userId.trim() ? body.userId.trim() : null;
    const kinds = Array.isArray(body?.kinds)
      ? body.kinds.filter((kind): kind is LifecycleEmailKind => typeof kind === "string" && ALLOWED_KINDS.includes(kind as LifecycleEmailKind))
      : undefined;

    const result = await dispatchLifecycleEmails({
      userId,
      kinds: kinds?.length ? kinds : undefined,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to dispatch lifecycle emails." },
      { status: 500 }
    );
  }
}
