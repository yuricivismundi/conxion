import { activityTypeLabel } from "@/lib/activities/types";
import type { SupabaseServiceClient } from "@/lib/supabase/service-role";

export type PendingPairRequestKind =
  | "connection"
  | "trip_request"
  | "hosting_request"
  | "service_inquiry"
  | "activity";

export type PendingPairRequestConflict = {
  kind: PendingPairRequestKind;
  label: string;
  message: string;
  requestId: string | null;
  threadToken: string | null;
};

const PENDING_REQUEST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function pendingCutoffIso() {
  return new Date(Date.now() - PENDING_REQUEST_WINDOW_MS).toISOString();
}

function pairOrClause(leftField: string, rightField: string, leftUserId: string, rightUserId: string) {
  return `and(${leftField}.eq.${leftUserId},${rightField}.eq.${rightUserId}),and(${leftField}.eq.${rightUserId},${rightField}.eq.${leftUserId})`;
}

function createConflict(kind: PendingPairRequestKind, label: string, requestId?: string | null, threadToken?: string | null): PendingPairRequestConflict {
  return {
    kind,
    label,
    requestId: requestId ?? null,
    threadToken: threadToken ?? null,
    message: `There is already a pending ${label} with this member.`,
  };
}

async function getLivePendingThreadContext(
  serviceClient: SupabaseServiceClient,
  sourceTable: string,
  sourceId: string | null | undefined
): Promise<{ threadId: string; threadToken: string } | null> {
  const resolvedSourceId = sourceId?.trim();
  if (!resolvedSourceId) return null;

  const contextRes = await serviceClient
    .from("thread_contexts")
    .select("thread_id,status_tag,created_at")
    .eq("source_table", sourceTable)
    .eq("source_id", resolvedSourceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (contextRes.error) throw contextRes.error;
  const row = (contextRes.data ?? null) as { thread_id?: string | null; status_tag?: string | null; created_at?: string | null } | null;
  if (!row?.thread_id) return null;

  const statusTag = (row.status_tag ?? "").trim().toLowerCase();
  if (statusTag !== "pending" && statusTag !== "inquiry_followup_pending") return null;

  const createdAt = row.created_at ? Date.parse(row.created_at) : NaN;
  if (Number.isFinite(createdAt) && createdAt < Date.now() - PENDING_REQUEST_WINDOW_MS) return null;

  const threadId = row.thread_id.trim();

  // Resolve thread type to build the correct navigation token
  const threadRes = await serviceClient
    .from("threads")
    .select("thread_type,connection_id")
    .eq("id", threadId)
    .maybeSingle();

  if (threadRes.error || !threadRes.data) return { threadId, threadToken: `direct:${threadId}` };
  const t = threadRes.data as { thread_type?: string | null; connection_id?: string | null };
  const token =
    t.thread_type === "connection" && t.connection_id
      ? `conn:${t.connection_id}`
      : `direct:${threadId}`;

  return { threadId, threadToken: token };
}

async function hasLivePendingThreadContext(
  serviceClient: SupabaseServiceClient,
  sourceTable: string,
  sourceId: string | null | undefined
) {
  return (await getLivePendingThreadContext(serviceClient, sourceTable, sourceId)) !== null;
}

async function findPendingConnectionConflict(
  serviceClient: SupabaseServiceClient,
  actorUserId: string,
  otherUserId: string
) {
  const pendingRes = await serviceClient
    .from("connections")
    .select("id")
    .eq("status", "pending")
    .gte("created_at", pendingCutoffIso())
    .or(pairOrClause("requester_id", "target_id", actorUserId, otherUserId))
    .limit(1)
    .maybeSingle();

  if (pendingRes.error) throw pendingRes.error;
  const row = (pendingRes.data ?? null) as { id?: string | null } | null;
  if (!row?.id) return null;
  const threadCtx = await getLivePendingThreadContext(serviceClient, "connections", row.id);
  if (!threadCtx) return null;
  return createConflict("connection", "connection request", row.id, threadCtx.threadToken);
}

async function findPendingHostingConflict(
  serviceClient: SupabaseServiceClient,
  actorUserId: string,
  otherUserId: string
) {
  const pendingRes = await serviceClient
    .from("hosting_requests")
    .select("id,request_type")
    .eq("status", "pending")
    .gte("created_at", pendingCutoffIso())
    .or(pairOrClause("sender_user_id", "recipient_user_id", actorUserId, otherUserId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingRes.error) throw pendingRes.error;
  const row = (pendingRes.data ?? null) as { id?: string | null; request_type?: string | null } | null;
  if (!row?.id) return null;
  const threadCtx = await getLivePendingThreadContext(serviceClient, "hosting_requests", row.id);
  if (!threadCtx) return null;
  const label = row.request_type === "offer_to_host" ? "host offer" : "hosting request";
  return createConflict("hosting_request", label, row.id, threadCtx.threadToken);
}

async function findPendingServiceInquiryConflict(
  serviceClient: SupabaseServiceClient,
  actorUserId: string,
  otherUserId: string
) {
  const pendingRes = await serviceClient
    .from("service_inquiries")
    .select("id")
    .eq("status", "pending")
    .gte("created_at", pendingCutoffIso())
    .or(pairOrClause("requester_id", "recipient_id", actorUserId, otherUserId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingRes.error) throw pendingRes.error;
  const row = (pendingRes.data ?? null) as { id?: string | null } | null;
  if (!row?.id) return null;
  const threadCtx = await getLivePendingThreadContext(serviceClient, "service_inquiries", row.id);
  if (!threadCtx) return null;
  return createConflict("service_inquiry", "teaching inquiry", row.id, threadCtx.threadToken);
}

async function findPendingActivityConflict(
  serviceClient: SupabaseServiceClient,
  actorUserId: string,
  otherUserId: string
) {
  const pendingRes = await serviceClient
    .from("activities")
    .select("id,activity_type")
    .eq("status", "pending")
    .gte("created_at", pendingCutoffIso())
    .or(pairOrClause("requester_id", "recipient_id", actorUserId, otherUserId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingRes.error) throw pendingRes.error;
  const row = (pendingRes.data ?? null) as { id?: string | null; activity_type?: string | null } | null;
  if (!row?.id) return null;
  const threadCtx = await getLivePendingThreadContext(serviceClient, "activities", row.id);
  if (!threadCtx) return null;

  // Always prefer the most recent accepted connection thread so the user lands
  // on the canonical thread (not a stale direct or older connection thread).
  let resolvedToken = threadCtx.threadToken;
  const connRes = await serviceClient
    .from("connections")
    .select("id")
    .eq("status", "accepted")
    .or(pairOrClause("requester_id", "target_id", actorUserId, otherUserId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!connRes.error && connRes.data) {
    resolvedToken = `conn:${(connRes.data as { id: string }).id}`;
  }

  const activityLabel = row.activity_type ? `${activityTypeLabel(row.activity_type)} activity request` : "activity request";
  return createConflict("activity", activityLabel.toLowerCase(), row.id, resolvedToken);
}

async function findPendingTripRequestConflictForDirection(
  serviceClient: SupabaseServiceClient,
  requesterId: string,
  ownerUserId: string
) {
  if (!requesterId || !ownerUserId || requesterId === ownerUserId) return null;

  const pendingRes = await serviceClient
    .from("trip_requests")
    .select("id,trip_id")
    .eq("requester_id", requesterId)
    .eq("status", "pending")
    .gte("created_at", pendingCutoffIso())
    .order("created_at", { ascending: false })
    .limit(200);

  if (pendingRes.error) throw pendingRes.error;

  const pendingRows = ((pendingRes.data ?? []) as Array<{ id?: string | null; trip_id?: string | null }>).filter(
    (row) => typeof row.trip_id === "string" && row.trip_id
  );

  if (pendingRows.length === 0) return null;

  const tripIds = Array.from(new Set(pendingRows.map((row) => row.trip_id as string)));
  const ownedTripsRes = await serviceClient.from("trips").select("id").eq("user_id", ownerUserId).in("id", tripIds);

  if (ownedTripsRes.error) throw ownedTripsRes.error;

  const ownedTripIds = new Set(
    ((ownedTripsRes.data ?? []) as Array<{ id?: string | null }>)
      .map((row) => (typeof row.id === "string" ? row.id : ""))
      .filter(Boolean)
  );

  if (ownedTripIds.size === 0) return null;

  const match = pendingRows.find((row) => typeof row.trip_id === "string" && ownedTripIds.has(row.trip_id));
  if (!match?.id) return null;
  const threadCtx = await getLivePendingThreadContext(serviceClient, "trip_requests", match.id);
  if (!threadCtx) return null;
  return createConflict("trip_request", "trip request", match.id, threadCtx.threadToken);
}

export async function findPendingPairRequestConflict(
  serviceClient: SupabaseServiceClient,
  params: {
    actorUserId: string;
    otherUserId: string;
  }
) {
  const { actorUserId, otherUserId } = params;
  if (!actorUserId || !otherUserId || actorUserId === otherUserId) return null;

  const [connectionConflict, hostingConflict, outgoingTripConflict, incomingTripConflict, serviceInquiryConflict, activityConflict] =
    await Promise.all([
      findPendingConnectionConflict(serviceClient, actorUserId, otherUserId),
      findPendingHostingConflict(serviceClient, actorUserId, otherUserId),
      findPendingTripRequestConflictForDirection(serviceClient, actorUserId, otherUserId),
      findPendingTripRequestConflictForDirection(serviceClient, otherUserId, actorUserId),
      findPendingServiceInquiryConflict(serviceClient, actorUserId, otherUserId),
      findPendingActivityConflict(serviceClient, actorUserId, otherUserId),
    ]);

  return connectionConflict ?? hostingConflict ?? outgoingTripConflict ?? incomingTripConflict ?? serviceInquiryConflict ?? activityConflict ?? null;
}
