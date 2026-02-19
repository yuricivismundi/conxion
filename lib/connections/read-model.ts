import type { SupabaseClient } from "@supabase/supabase-js";

type ConnectionContext = "member" | "trip" | "traveller" | null;

export type VisibleConnectionRow = {
  id: string;
  requester_id: string;
  target_id: string;
  status: string;
  blocked_by: string | null;
  created_at: string | null;
  connect_context: ConnectionContext;
  connect_reason: string | null;
  connect_reason_role: string | null;
  connect_note: string | null;
  trip_id: string | null;
  trip_destination_city: string | null;
  trip_destination_country: string | null;
  trip_start_date: string | null;
  trip_end_date: string | null;
  trip_purpose: string | null;
  other_user_id: string;
  is_blocked: boolean;
  is_visible_in_messages: boolean;
  is_incoming_pending: boolean;
  is_outgoing_pending: boolean;
  is_accepted_visible: boolean;
};

function asString(v: unknown) {
  return typeof v === "string" ? v : "";
}

function asNullableString(v: unknown) {
  return typeof v === "string" ? v : null;
}

function asBool(v: unknown) {
  return v === true;
}

function normalizeRpcRow(raw: Record<string, unknown>): VisibleConnectionRow {
  return {
    id: asString(raw.id),
    requester_id: asString(raw.requester_id),
    target_id: asString(raw.target_id),
    status: asString(raw.status),
    blocked_by: asNullableString(raw.blocked_by),
    created_at: asNullableString(raw.created_at),
    connect_context: (raw.connect_context as ConnectionContext) ?? null,
    connect_reason: asNullableString(raw.connect_reason),
    connect_reason_role: asNullableString(raw.connect_reason_role),
    connect_note: asNullableString(raw.connect_note),
    trip_id: asNullableString(raw.trip_id),
    trip_destination_city: asNullableString(raw.trip_destination_city),
    trip_destination_country: asNullableString(raw.trip_destination_country),
    trip_start_date: asNullableString(raw.trip_start_date),
    trip_end_date: asNullableString(raw.trip_end_date),
    trip_purpose: asNullableString(raw.trip_purpose),
    other_user_id: asString(raw.other_user_id),
    is_blocked: asBool(raw.is_blocked),
    is_visible_in_messages: asBool(raw.is_visible_in_messages),
    is_incoming_pending: asBool(raw.is_incoming_pending),
    is_outgoing_pending: asBool(raw.is_outgoing_pending),
    is_accepted_visible: asBool(raw.is_accepted_visible),
  };
}

function normalizeFallbackRow(raw: Record<string, unknown>, userId: string): VisibleConnectionRow {
  const status = asString(raw.status);
  const requesterId = asString(raw.requester_id);
  const targetId = asString(raw.target_id);
  const blockedBy = asNullableString(raw.blocked_by);
  const isBlocked = status === "blocked" || Boolean(blockedBy);
  const otherUserId = requesterId === userId ? targetId : requesterId;

  return {
    id: asString(raw.id),
    requester_id: requesterId,
    target_id: targetId,
    status,
    blocked_by: blockedBy,
    created_at: asNullableString(raw.created_at),
    connect_context: (raw.connect_context as ConnectionContext) ?? null,
    connect_reason: asNullableString(raw.connect_reason),
    connect_reason_role: asNullableString(raw.connect_reason_role),
    connect_note: asNullableString(raw.connect_note),
    trip_id: asNullableString(raw.trip_id),
    trip_destination_city: asNullableString(raw.trip_destination_city),
    trip_destination_country: asNullableString(raw.trip_destination_country),
    trip_start_date: asNullableString(raw.trip_start_date),
    trip_end_date: asNullableString(raw.trip_end_date),
    trip_purpose: asNullableString(raw.trip_purpose),
    other_user_id: otherUserId,
    is_blocked: isBlocked,
    is_visible_in_messages: status === "accepted" && !isBlocked,
    is_incoming_pending: status === "pending" && targetId === userId,
    is_outgoing_pending: status === "pending" && requesterId === userId,
    is_accepted_visible: status === "accepted" && !isBlocked,
  };
}

export async function fetchVisibleConnections(client: SupabaseClient, userId: string): Promise<VisibleConnectionRow[]> {
  const { data: rpcRows, error: rpcErr } = await client.rpc("app_visible_connections", { p_user_id: userId });
  if (!rpcErr && Array.isArray(rpcRows)) {
    return rpcRows.map((row) => normalizeRpcRow(row as Record<string, unknown>));
  }

  const { data: fallbackRows, error: fallbackErr } = await client
    .from("connections")
    .select("*")
    .or(`requester_id.eq.${userId},target_id.eq.${userId}`)
    .limit(500);

  if (fallbackErr) {
    throw new Error(fallbackErr.message);
  }

  return (fallbackRows ?? []).map((row) => normalizeFallbackRow(row as Record<string, unknown>, userId));
}
