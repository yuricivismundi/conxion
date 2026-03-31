import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type MaintenanceRequestBody = {
  seedIfEmpty?: unknown;
  archiveAfterDays?: unknown;
  deleteAfterDays?: unknown;
  keepArchiveDays?: unknown;
  batch?: unknown;
};

type EventsHealth = {
  upcoming_total: number;
  upcoming_public_visible: number;
  past_total: number;
  archived_total: number;
  generated_at: string;
};

type SupabaseServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceClient>>;

function getSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return null;
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

async function requireAdmin(req: Request) {
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

async function loadEventsHealth(service: SupabaseServiceClient): Promise<EventsHealth> {
  const generatedAt = new Date().toISOString();
  const nowIso = new Date().toISOString();

  const snapshot = await service.rpc("cx_events_health_snapshot");
  if (!snapshot.error && snapshot.data && typeof snapshot.data === "object") {
    const row = snapshot.data as Record<string, unknown>;
    return {
      upcoming_total: Number(row.upcoming_total ?? 0) || 0,
      upcoming_public_visible: Number(row.upcoming_public_visible ?? 0) || 0,
      past_total: Number(row.past_total ?? 0) || 0,
      archived_total: Number(row.archived_total ?? 0) || 0,
      generated_at: typeof row.generated_at === "string" && row.generated_at ? row.generated_at : generatedAt,
    };
  }

  const [upcomingRes, publicUpcomingRes, pastRes, archivedRes] = await Promise.all([
    service.from("events").select("id", { count: "exact", head: true }).eq("status", "published").gte("ends_at", nowIso),
    service
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .eq("visibility", "public")
      .eq("hidden_by_admin", false)
      .gte("ends_at", nowIso),
    service.from("events").select("id", { count: "exact", head: true }).eq("status", "published").lt("ends_at", nowIso),
    service.from("events_archive").select("event_id", { count: "exact", head: true }),
  ]);

  const fallbackError =
    upcomingRes.error ?? publicUpcomingRes.error ?? pastRes.error ?? archivedRes.error;
  if (fallbackError) {
    throw new Error(fallbackError.message ?? "Failed to load events maintenance health.");
  }

  return {
    upcoming_total: upcomingRes.count ?? 0,
    upcoming_public_visible: publicUpcomingRes.count ?? 0,
    past_total: pastRes.count ?? 0,
    archived_total: archivedRes.count ?? 0,
    generated_at: generatedAt,
  };
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
    }

    const service = getSupabaseServiceClient();
    if (!service) {
      return NextResponse.json({ ok: false, error: "Missing service role configuration." }, { status: 500 });
    }

    const health = await loadEventsHealth(service);
    return NextResponse.json({ ok: true, health });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load events maintenance health." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
    }

    const service = getSupabaseServiceClient();
    if (!service) {
      return NextResponse.json({ ok: false, error: "Missing service role configuration." }, { status: 500 });
    }

    const rawBody = (await req.json().catch(() => null)) as MaintenanceRequestBody | null;
    const seedIfEmpty = asBoolean(rawBody?.seedIfEmpty, false);
    const archiveAfterDays = asInt(rawBody?.archiveAfterDays, 0, 0, 365);
    const deleteAfterDays = asInt(rawBody?.deleteAfterDays, 30, 1, 3650);
    const keepArchiveDays = asInt(rawBody?.keepArchiveDays, 30, 1, 3650);
    const batch = asInt(rawBody?.batch, 1000, 1, 5000);

    const runRes = await service.rpc("cx_run_events_maintenance", {
      p_archive_after_days: archiveAfterDays,
      p_delete_after_days: deleteAfterDays,
      p_keep_archive_days: keepArchiveDays,
      p_batch: batch,
      p_seed_if_empty: seedIfEmpty,
    });

    if (runRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: runRes.error.message,
          hint: "Run scripts/sql/2026-03-13_events_maintenance_ops.sql then retry.",
        },
        { status: 500 }
      );
    }

    const summary = (runRes.data ?? null) as Record<string, unknown> | null;
    const health = await loadEventsHealth(service);

    return NextResponse.json({
      ok: true,
      run: {
        archivedCount: Number(summary?.archived_count ?? 0) || 0,
        deletedCount: Number(summary?.deleted_count ?? 0) || 0,
        prunedArchiveCount: Number(summary?.pruned_archive_count ?? 0) || 0,
        seededCount: Number(summary?.seeded_count ?? 0) || 0,
        ranAt: typeof summary?.ran_at === "string" && summary.ran_at ? summary.ran_at : new Date().toISOString(),
      },
      health,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to run events maintenance." },
      { status: 500 }
    );
  }
}
