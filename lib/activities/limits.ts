import { activityTypeLabel, normalizeActivityType } from "@/lib/activities/types";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

export const ACTIVITY_PAIR_MONTHLY_LIMIT = 2;

type ActivityLimitCheckResult =
  | { ok: true }
  | { ok: false; error: string };

type ServiceClient = ReturnType<typeof getSupabaseServiceClient>;

function monthStartIso(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

function isCountedStatus(value: unknown) {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  return status === "accepted" || status === "active" || status === "completed";
}

function activityMonthAnchor(row: { accepted_at?: unknown; created_at?: unknown }) {
  if (typeof row.accepted_at === "string" && row.accepted_at.trim()) return row.accepted_at;
  if (typeof row.created_at === "string" && row.created_at.trim()) return row.created_at;
  return "";
}

export async function validatePairActivityMonthlyLimit(params: {
  serviceClient: ServiceClient;
  requesterUserId: string;
  recipientUserId: string;
  activityType: string;
}): Promise<ActivityLimitCheckResult> {
  const monthStart = monthStartIso();
  const pairFilter = `and(requester_id.eq.${params.requesterUserId},recipient_id.eq.${params.recipientUserId}),and(requester_id.eq.${params.recipientUserId},recipient_id.eq.${params.requesterUserId})`;

  const res = await params.serviceClient
    .from("activities" as never)
    .select("id,activity_type,status,accepted_at,created_at")
    .or(pairFilter)
    .in("status", ["accepted", "active", "completed"] as never);

  if (res.error) {
    throw new Error(res.error.message ?? "Failed to validate activity limits.");
  }

  const rows = ((res.data ?? []) as Array<Record<string, unknown>>).filter((row) => {
    if (!isCountedStatus(row.status)) return false;
    const anchor = activityMonthAnchor(row);
    return Boolean(anchor && anchor >= monthStart);
  });

  const normalizedType = normalizeActivityType(params.activityType);
  const monthlyTypes = new Set(
    rows
      .map((row) => (typeof row.activity_type === "string" ? normalizeActivityType(row.activity_type) : ""))
      .filter(Boolean)
  );

  if (monthlyTypes.has(normalizedType)) {
    return {
      ok: false,
      error: `You already have a ${activityTypeLabel(normalizedType)} activity with this member this month.`,
    };
  }

  if (monthlyTypes.size >= ACTIVITY_PAIR_MONTHLY_LIMIT) {
    return {
      ok: false,
      error: `No more than ${ACTIVITY_PAIR_MONTHLY_LIMIT} activities per month with the same member are allowed.`,
    };
  }

  return { ok: true };
}
