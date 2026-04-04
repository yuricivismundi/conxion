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
};

function pairOrClause(leftField: string, rightField: string, leftUserId: string, rightUserId: string) {
  return `and(${leftField}.eq.${leftUserId},${rightField}.eq.${rightUserId}),and(${leftField}.eq.${rightUserId},${rightField}.eq.${leftUserId})`;
}

function createConflict(kind: PendingPairRequestKind, label: string, requestId?: string | null): PendingPairRequestConflict {
  return {
    kind,
    label,
    requestId: requestId ?? null,
    message: `There is already a pending ${label} with this member. Open Requests in Messages to continue.`,
  };
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
    .or(pairOrClause("requester_id", "target_id", actorUserId, otherUserId))
    .limit(1)
    .maybeSingle();

  if (pendingRes.error) throw pendingRes.error;
  const row = (pendingRes.data ?? null) as { id?: string | null } | null;
  if (!row?.id) return null;
  return createConflict("connection", "connection request", row.id);
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
    .or(pairOrClause("sender_user_id", "recipient_user_id", actorUserId, otherUserId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingRes.error) throw pendingRes.error;
  const row = (pendingRes.data ?? null) as { id?: string | null; request_type?: string | null } | null;
  if (!row?.id) return null;
  const label = row.request_type === "offer_to_host" ? "host offer" : "hosting request";
  return createConflict("hosting_request", label, row.id);
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
    .or(pairOrClause("requester_id", "recipient_id", actorUserId, otherUserId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingRes.error) throw pendingRes.error;
  const row = (pendingRes.data ?? null) as { id?: string | null } | null;
  if (!row?.id) return null;
  return createConflict("service_inquiry", "teaching inquiry", row.id);
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
    .or(pairOrClause("requester_id", "recipient_id", actorUserId, otherUserId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingRes.error) throw pendingRes.error;
  const row = (pendingRes.data ?? null) as { id?: string | null; activity_type?: string | null } | null;
  if (!row?.id) return null;
  const activityLabel = row.activity_type ? `${activityTypeLabel(row.activity_type)} activity request` : "activity request";
  return createConflict("activity", activityLabel.toLowerCase(), row.id);
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
  return createConflict("trip_request", "trip request", match.id);
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
