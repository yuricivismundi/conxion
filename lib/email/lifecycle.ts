import { sendAppEmail } from "@/lib/email/app-events";
import type { AppEmailKind } from "@/lib/email/types";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

export type LifecycleEmailKind =
  | "activity_upcoming"
  | "event_starting_soon";

export type DispatchLifecycleEmailsOptions = {
  kinds?: LifecycleEmailKind[];
  userId?: string | null;
  now?: Date;
};

type DispatchStats = {
  inspected: number;
  sent: number;
  skipped: number;
  failed: number;
};

export type DispatchLifecycleEmailsResult = {
  ok: true;
  activity_upcoming: DispatchStats;
  event_starting_soon: DispatchStats;
};

function createStats(): DispatchStats {
  return { inspected: 0, sent: 0, skipped: 0, failed: 0 };
}

function toMillis(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

async function recordEmailResult(
  stats: DispatchStats,
  kind: AppEmailKind,
  run: () => ReturnType<typeof sendAppEmail>
) {
  stats.inspected += 1;
  try {
    const result = await run();
    if (result.ok) {
      stats.sent += 1;
      return;
    }
    if (result.skipped) {
      stats.skipped += 1;
      return;
    }
    stats.failed += 1;
    console.error("[email] lifecycle dispatch failed", kind, result.error);
  } catch (error) {
    stats.failed += 1;
    console.error("[email] lifecycle dispatch unexpected failure", kind, error);
  }
}

async function dispatchUpcomingSyncs(options: { userId?: string | null; nowIso: string; cutoffIso: string }) {
  const stats = createStats();
  const service = getSupabaseServiceClient();
  let query = service
    .from("connection_syncs")
    .select("id,connection_id,requester_id,recipient_id,scheduled_at,status")
    .eq("status", "accepted")
    .gte("scheduled_at", options.nowIso)
    .lte("scheduled_at", options.cutoffIso)
    .limit(500);

  if (options.userId) {
    query = query.or(`requester_id.eq.${options.userId},recipient_id.eq.${options.userId}`);
  }

  const res = await query;
  if (res.error) throw new Error(res.error.message);

  for (const row of (res.data ?? []) as Array<Record<string, unknown>>) {
    const syncId = typeof row.id === "string" ? row.id : "";
    const connectionId = typeof row.connection_id === "string" ? row.connection_id : null;
    const requesterId = typeof row.requester_id === "string" ? row.requester_id : "";
    const recipientId = typeof row.recipient_id === "string" ? row.recipient_id : "";
    const scheduledAt = typeof row.scheduled_at === "string" ? row.scheduled_at : "";
    if (!syncId || !requesterId || !recipientId || !scheduledAt) continue;

    const seed = scheduledAt.slice(0, 16);

    await recordEmailResult(stats, "activity_upcoming", () =>
      sendAppEmail({
        kind: "activity_upcoming",
        recipientUserId: requesterId,
        actorUserId: recipientId,
        connectionId,
        syncId,
        idempotencySeed: seed,
      })
    );

    await recordEmailResult(stats, "activity_upcoming", () =>
      sendAppEmail({
        kind: "activity_upcoming",
        recipientUserId: recipientId,
        actorUserId: requesterId,
        connectionId,
        syncId,
        idempotencySeed: seed,
      })
    );
  }

  return stats;
}

async function dispatchUpcomingEvents(options: { userId?: string | null; nowIso: string; cutoffIso: string }) {
  const stats = createStats();
  const service = getSupabaseServiceClient();

  const eventsRes = await service
    .from("events")
    .select("id,host_user_id,starts_at,status")
    .eq("status", "published")
    .gte("starts_at", options.nowIso)
    .lte("starts_at", options.cutoffIso)
    .limit(500);
  if (eventsRes.error) throw new Error(eventsRes.error.message);

  const events = (eventsRes.data ?? []) as Array<Record<string, unknown>>;
  const eventIds = events.map((row) => (typeof row.id === "string" ? row.id : "")).filter(Boolean);
  if (eventIds.length === 0) return stats;

  let membersQuery = service
    .from("event_members")
    .select("event_id,user_id,status")
    .in("event_id", eventIds)
    .in("status", ["host", "going"])
    .limit(5000);
  if (options.userId) {
    membersQuery = membersQuery.eq("user_id", options.userId);
  }

  const membersRes = await membersQuery;
  if (membersRes.error) throw new Error(membersRes.error.message);

  const eventById = new Map(events.map((row) => [String(row.id), row]));
  for (const member of (membersRes.data ?? []) as Array<Record<string, unknown>>) {
    const eventId = typeof member.event_id === "string" ? member.event_id : "";
    const userId = typeof member.user_id === "string" ? member.user_id : "";
    if (!eventId || !userId) continue;

    const event = eventById.get(eventId);
    const hostUserId = typeof event?.host_user_id === "string" ? event.host_user_id : null;
    const startsAt = typeof event?.starts_at === "string" ? event.starts_at : "";
    if (!startsAt) continue;

    await recordEmailResult(stats, "event_starting_soon", () =>
      sendAppEmail({
        kind: "event_starting_soon",
        recipientUserId: userId,
        actorUserId: hostUserId && hostUserId !== userId ? hostUserId : null,
        eventId,
        idempotencySeed: startsAt.slice(0, 16),
      })
    );
  }

  return stats;
}

export async function dispatchLifecycleEmails(
  options: DispatchLifecycleEmailsOptions = {}
): Promise<DispatchLifecycleEmailsResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const activityCutoffIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const selected = new Set<LifecycleEmailKind>(
    options.kinds?.length
      ? options.kinds
      : ["activity_upcoming", "event_starting_soon"]
  );

  const result: DispatchLifecycleEmailsResult = {
    ok: true,
    activity_upcoming: createStats(),
    event_starting_soon: createStats(),
  };

  if (selected.has("activity_upcoming")) {
    result.activity_upcoming = await dispatchUpcomingSyncs({ userId: options.userId, nowIso, cutoffIso: activityCutoffIso });
  }
  if (selected.has("event_starting_soon")) {
    result.event_starting_soon = await dispatchUpcomingEvents({ userId: options.userId, nowIso, cutoffIso: activityCutoffIso });
  }

  return result;
}
