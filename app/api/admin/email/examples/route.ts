import { NextResponse } from "next/server";
import { sendAppEmail } from "@/lib/email/app-events";
import type { AppEmailKind, AppEmailParams } from "@/lib/email/types";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type ExamplesBody = {
  toEmail?: unknown;
  recipientName?: unknown;
  kinds?: unknown;
};

type PreviewSeed = {
  recipientUserId: string;
  actorUserId: string;
  recipientEmailOverride: string | null;
  connectionId: string | null;
  tripId: string | null;
  eventId: string | null;
  syncId: string | null;
  hostingRequestId: string | null;
  referenceId: string | null;
  promptId: string | null;
};

const DEFAULT_KINDS: AppEmailKind[] = [
  "welcome_member",
  "inbox_digest",
  "connection_request_received",
  "connection_request_accepted",
  "connection_request_declined",
  "trip_request_received",
  "trip_request_accepted",
  "trip_request_declined",
  "travel_plan_upcoming",
  "hosting_request_received",
  "hosting_request_accepted",
  "hosting_request_declined",
  "sync_proposed",
  "sync_accepted",
  "sync_declined",
  "sync_upcoming",
  "sync_completed",
  "event_request_received",
  "event_request_accepted",
  "event_request_declined",
  "event_joined",
  "event_starting_soon",
  "reference_received",
  "reference_prompt_due",
  "reference_prompt_reminder",
];

function isLocalDev() {
  return process.env.NODE_ENV !== "production";
}

async function requireAdmin(req: Request) {
  if (isLocalDev()) return { ok: true as const };

  const token = getBearerToken(req);
  if (!token) return { ok: false as const, status: 401, error: "Missing auth token." };

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

function isDeliverableEmail(email: string | null | undefined) {
  return Boolean(email && !email.toLowerCase().endsWith("@local.test"));
}

async function loadPreviewSeed(): Promise<PreviewSeed | null> {
  const service = getSupabaseServiceClient();
  const listed = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listed.error) throw new Error(listed.error.message);

  const users = (listed.data.users ?? []).filter((user) => isDeliverableEmail(user.email));
  if (users.length < 2) return null;

  const [connectionsRes, tripsRes, eventsRes, syncsRes, hostingRes, referencesRes, promptsRes] = await Promise.all([
    service.from("connections").select("id").eq("status", "accepted").limit(1).maybeSingle(),
    service.from("trips").select("id").limit(1).maybeSingle(),
    service.from("events").select("id").limit(1).maybeSingle(),
    service.from("connection_syncs").select("id").limit(1).maybeSingle(),
    service.from("hosting_requests").select("id").limit(1).maybeSingle(),
    service.from("references").select("id").limit(1).maybeSingle(),
    service.from("reference_requests").select("id").limit(1).maybeSingle(),
  ]);

  const connectionRow = (connectionsRes.data ?? null) as { id?: string } | null;
  const tripRow = (tripsRes.data ?? null) as { id?: string } | null;
  const eventRow = (eventsRes.data ?? null) as { id?: string } | null;
  const syncRow = (syncsRes.data ?? null) as { id?: string } | null;
  const hostingRow = (hostingRes.data ?? null) as { id?: string } | null;
  const referenceRow = (referencesRes.data ?? null) as { id?: string } | null;
  const promptRow = (promptsRes.data ?? null) as { id?: string } | null;

  return {
    recipientUserId: users[0].id,
    actorUserId: users[1].id,
    recipientEmailOverride: null,
    connectionId: typeof connectionRow?.id === "string" ? connectionRow.id : null,
    tripId: typeof tripRow?.id === "string" ? tripRow.id : null,
    eventId: typeof eventRow?.id === "string" ? eventRow.id : null,
    syncId: typeof syncRow?.id === "string" ? syncRow.id : null,
    hostingRequestId: typeof hostingRow?.id === "string" ? hostingRow.id : null,
    referenceId: typeof referenceRow?.id === "string" ? referenceRow.id : null,
    promptId: typeof promptRow?.id === "string" ? promptRow.id : null,
  };
}

async function resolvePreviewSeedForEmail(toEmail: string): Promise<PreviewSeed | null> {
  const service = getSupabaseServiceClient();
  const listed = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listed.error) throw new Error(listed.error.message);

  const deliverableUsers = (listed.data.users ?? []).filter((user) => isDeliverableEmail(user.email));
  if (deliverableUsers.length < 2) return null;

  const matchedUser = deliverableUsers.find((user) => (user.email ?? "").trim().toLowerCase() === toEmail);
  const fallbackSeed = await loadPreviewSeed();
  if (!fallbackSeed) return null;

  if (!matchedUser) {
    return {
      ...fallbackSeed,
      recipientEmailOverride: toEmail,
    };
  }

  const actorFallback = deliverableUsers.find((user) => user.id !== matchedUser.id);
  return {
    ...fallbackSeed,
    recipientUserId: matchedUser.id,
    actorUserId: actorFallback?.id ?? fallbackSeed.actorUserId,
    recipientEmailOverride: null,
  };
}

function buildPreviewParams(kind: AppEmailKind, seed: PreviewSeed, recipientName: string, index: number): AppEmailParams {
  return {
    kind,
    recipientUserId: seed.recipientUserId,
    recipientEmailOverride: seed.recipientEmailOverride,
    recipientNameOverride: recipientName,
    actorUserId: seed.actorUserId,
    connectionId: seed.connectionId,
    tripId: seed.tripId,
    eventId: seed.eventId,
    syncId: seed.syncId,
    hostingRequestId: seed.hostingRequestId,
    referenceId: seed.referenceId,
    promptId: seed.promptId,
    contextTag: "travel",
    promptDueAt: new Date().toISOString(),
    unreadCount: 4,
    idempotencySeed: `preview-${new Date().toISOString()}-${index}`,
  };
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
    }

    const body = (await req.json().catch(() => null)) as ExamplesBody | null;
    const toEmail = typeof body?.toEmail === "string" ? body.toEmail.trim().toLowerCase() : "";
    const recipientName = typeof body?.recipientName === "string" && body.recipientName.trim() ? body.recipientName.trim() : "Josh";
    if (!toEmail) {
      return NextResponse.json({ ok: false, error: "toEmail is required." }, { status: 400 });
    }

    const kinds = Array.isArray(body?.kinds)
      ? body.kinds.filter((kind): kind is AppEmailKind => typeof kind === "string" && DEFAULT_KINDS.includes(kind as AppEmailKind))
      : DEFAULT_KINDS;

    const seed = await resolvePreviewSeedForEmail(toEmail);
    if (!seed) {
      return NextResponse.json({ ok: false, error: "Could not find enough sample users for email previews." }, { status: 400 });
    }

    const results: Array<{ kind: AppEmailKind; ok: boolean; id?: string | null; error?: string }> = [];
    for (const [index, kind] of kinds.entries()) {
      const result = await sendAppEmail(buildPreviewParams(kind, seed, recipientName, index));
      results.push(
        result.ok
          ? { kind, ok: true, id: result.id }
          : { kind, ok: false, error: result.error }
      );
    }

    return NextResponse.json({
      ok: true,
      toEmail,
      sent: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to send example emails." },
      { status: 500 }
    );
  }
}
