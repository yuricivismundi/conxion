import { sendAppEmail } from "@/lib/email/app-events";
import type { AppEmailKind } from "@/lib/email/types";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

export type LifecycleEmailKind =
  | "sync_upcoming"
  | "event_starting_soon"
  | "travel_plan_upcoming"
  | "inbox_digest";

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
  sync_upcoming: DispatchStats;
  event_starting_soon: DispatchStats;
  travel_plan_upcoming: DispatchStats;
  inbox_digest: DispatchStats;
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

    await recordEmailResult(stats, "sync_upcoming", () =>
      sendAppEmail({
        kind: "sync_upcoming",
        recipientUserId: requesterId,
        actorUserId: recipientId,
        connectionId,
        syncId,
        idempotencySeed: seed,
      })
    );

    await recordEmailResult(stats, "sync_upcoming", () =>
      sendAppEmail({
        kind: "sync_upcoming",
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

async function dispatchUpcomingTravel(options: { userId?: string | null; todayDate: string; cutoffDate: string }) {
  const stats = createStats();
  const service = getSupabaseServiceClient();

  let tripsQuery = service
    .from("trips")
    .select("id,user_id,start_date,status")
    .gte("start_date", options.todayDate)
    .lte("start_date", options.cutoffDate)
    .limit(500);
  if (options.userId) {
    tripsQuery = tripsQuery.eq("user_id", options.userId);
  }

  const tripsRes = await tripsQuery;
  if (tripsRes.error) throw new Error(tripsRes.error.message);

  const trips = (tripsRes.data ?? []) as Array<Record<string, unknown>>;
  const tripIds = trips
    .filter((row) => {
      const status = typeof row.status === "string" ? row.status.toLowerCase() : "active";
      return !["cancelled", "archived", "ended"].includes(status);
    })
    .map((row) => ({
      tripId: typeof row.id === "string" ? row.id : "",
      ownerId: typeof row.user_id === "string" ? row.user_id : "",
      startDate: typeof row.start_date === "string" ? row.start_date : "",
    }))
    .filter((row) => row.tripId && row.ownerId && row.startDate);

  for (const trip of tripIds) {
    await recordEmailResult(stats, "travel_plan_upcoming", () =>
      sendAppEmail({
        kind: "travel_plan_upcoming",
        recipientUserId: trip.ownerId,
        tripId: trip.tripId,
        idempotencySeed: trip.startDate,
      })
    );
  }

  if (tripIds.length > 0) {
    const acceptedTripRes = await service
      .from("trip_requests")
      .select("id,trip_id,requester_id,status")
      .in("trip_id", tripIds.map((row) => row.tripId))
      .eq("status", "accepted")
      .limit(2000);
    if (acceptedTripRes.error) throw new Error(acceptedTripRes.error.message);

    const tripById = new Map(tripIds.map((row) => [row.tripId, row]));
    for (const row of (acceptedTripRes.data ?? []) as Array<Record<string, unknown>>) {
      const tripId = typeof row.trip_id === "string" ? row.trip_id : "";
      const requesterId = typeof row.requester_id === "string" ? row.requester_id : "";
      if (!tripId || !requesterId) continue;
      const trip = tripById.get(tripId);
      if (!trip) continue;

      await recordEmailResult(stats, "travel_plan_upcoming", () =>
        sendAppEmail({
          kind: "travel_plan_upcoming",
          recipientUserId: requesterId,
          actorUserId: trip.ownerId,
          tripId,
          idempotencySeed: trip.startDate,
        })
      );
    }
  }

  let hostingQuery = service
    .from("hosting_requests")
    .select("id,sender_user_id,recipient_user_id,request_type,trip_id,arrival_date,status")
    .eq("status", "accepted")
    .gte("arrival_date", options.todayDate)
    .lte("arrival_date", options.cutoffDate)
    .limit(1000);
  if (options.userId) {
    hostingQuery = hostingQuery.or(`sender_user_id.eq.${options.userId},recipient_user_id.eq.${options.userId}`);
  }

  const hostingRes = await hostingQuery;
  if (hostingRes.error) throw new Error(hostingRes.error.message);

  for (const row of (hostingRes.data ?? []) as Array<Record<string, unknown>>) {
    const hostingRequestId = typeof row.id === "string" ? row.id : "";
    const senderId = typeof row.sender_user_id === "string" ? row.sender_user_id : "";
    const recipientId = typeof row.recipient_user_id === "string" ? row.recipient_user_id : "";
    const tripId = typeof row.trip_id === "string" ? row.trip_id : null;
    const requestType = typeof row.request_type === "string" ? row.request_type : null;
    const arrivalDate = typeof row.arrival_date === "string" ? row.arrival_date : "";
    if (!hostingRequestId || !senderId || !recipientId || !arrivalDate) continue;

    await recordEmailResult(stats, "travel_plan_upcoming", () =>
      sendAppEmail({
        kind: "travel_plan_upcoming",
        recipientUserId: senderId,
        actorUserId: recipientId,
        hostingRequestId,
        tripId,
        requestType,
        idempotencySeed: arrivalDate,
      })
    );

    await recordEmailResult(stats, "travel_plan_upcoming", () =>
      sendAppEmail({
        kind: "travel_plan_upcoming",
        recipientUserId: recipientId,
        actorUserId: senderId,
        hostingRequestId,
        tripId,
        requestType,
        idempotencySeed: arrivalDate,
      })
    );
  }

  return stats;
}

async function dispatchInboxDigests(options: { userId?: string | null; dateSeed: string }) {
  const stats = createStats();
  const service = getSupabaseServiceClient();

  let participantsFull = service
    .from("thread_participants")
    .select("user_id,thread_id,last_read_at,archived_at")
    .limit(5000);
  if (options.userId) {
    participantsFull = participantsFull.eq("user_id", options.userId);
  }

  let participantsRes = await participantsFull;
  if (participantsRes.error) {
    const lower = participantsRes.error.message.toLowerCase();
    const missingArchived = lower.includes("archived_at") && (lower.includes("column") || lower.includes("schema cache"));
    if (!missingArchived) {
      throw new Error(participantsRes.error.message);
    }

    let fallback = service.from("thread_participants").select("user_id,thread_id,last_read_at").limit(5000);
    if (options.userId) {
      fallback = fallback.eq("user_id", options.userId);
    }
    participantsRes = await fallback;
    if (participantsRes.error) throw new Error(participantsRes.error.message);
  }

  const participants = (participantsRes.data ?? []) as Array<Record<string, unknown>>;
  const activeParticipants = participants.filter((row) => {
    const threadId = typeof row.thread_id === "string" ? row.thread_id : "";
    const archivedAt = typeof row.archived_at === "string" ? row.archived_at : "";
    return threadId && !archivedAt;
  });

  const threadIds = Array.from(new Set(activeParticipants.map((row) => (typeof row.thread_id === "string" ? row.thread_id : "")).filter(Boolean)));
  if (threadIds.length === 0) return stats;

  const threadsRes = await service
    .from("threads")
    .select("id,last_message_at")
    .in("id", threadIds)
    .limit(Math.max(threadIds.length, 1));
  if (threadsRes.error) throw new Error(threadsRes.error.message);

  const threadMap = new Map(
    ((threadsRes.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      typeof row.id === "string" ? row.id : "",
      typeof row.last_message_at === "string" ? row.last_message_at : "",
    ])
  );

  const unreadByUser = new Map<string, number>();
  for (const row of activeParticipants) {
    const userId = typeof row.user_id === "string" ? row.user_id : "";
    const threadId = typeof row.thread_id === "string" ? row.thread_id : "";
    if (!userId || !threadId) continue;

    const lastMessageAt = toMillis(threadMap.get(threadId));
    const lastReadAt = toMillis(typeof row.last_read_at === "string" ? row.last_read_at : "");
    if (!lastMessageAt || lastMessageAt <= lastReadAt) continue;

    unreadByUser.set(userId, (unreadByUser.get(userId) ?? 0) + 1);
  }

  for (const [userId, unreadCount] of unreadByUser.entries()) {
    if (unreadCount <= 0) continue;
    await recordEmailResult(stats, "inbox_digest", () =>
      sendAppEmail({
        kind: "inbox_digest",
        recipientUserId: userId,
        unreadCount,
        idempotencySeed: options.dateSeed,
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
  const syncCutoffIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const todayDate = nowIso.slice(0, 10);
  const travelCutoffDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const daySeed = todayDate;
  const selected = new Set<LifecycleEmailKind>(
    options.kinds?.length
      ? options.kinds
      : ["sync_upcoming", "event_starting_soon", "travel_plan_upcoming"]
  );

  const result: DispatchLifecycleEmailsResult = {
    ok: true,
    sync_upcoming: createStats(),
    event_starting_soon: createStats(),
    travel_plan_upcoming: createStats(),
    inbox_digest: createStats(),
  };

  if (selected.has("sync_upcoming")) {
    result.sync_upcoming = await dispatchUpcomingSyncs({ userId: options.userId, nowIso, cutoffIso: syncCutoffIso });
  }
  if (selected.has("event_starting_soon")) {
    result.event_starting_soon = await dispatchUpcomingEvents({ userId: options.userId, nowIso, cutoffIso: syncCutoffIso });
  }
  if (selected.has("travel_plan_upcoming")) {
    result.travel_plan_upcoming = await dispatchUpcomingTravel({ userId: options.userId, todayDate, cutoffDate: travelCutoffDate });
  }
  if (selected.has("inbox_digest")) {
    result.inbox_digest = await dispatchInboxDigests({ userId: options.userId, dateSeed: daySeed });
  }

  return result;
}
