import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseServiceClient } from "@/lib/supabase/service-role";
import { fetchVisibleConnections } from "@/lib/connections/read-model";

export type LinkedMemberOption = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  city: string;
  country: string;
};

type RpcInvoker = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
    options?: { head?: boolean; get?: boolean; count?: "exact" | "planned" | "estimated" }
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isAcceptedStatus(value: unknown) {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  return status === "accepted" || status === "active" || status === "completed";
}

export async function fetchLinkedConnectionOptions(
  client: SupabaseClient,
  userId: string,
  excludedUserIds: string[] = []
): Promise<LinkedMemberOption[]> {
  const excluded = new Set(excludedUserIds.filter(Boolean));
  const visible = await fetchVisibleConnections(client, userId);
  const acceptedIds = Array.from(
    new Set(
      visible
        .filter((row) => row.is_accepted_visible && !row.is_blocked)
        .map((row) => row.other_user_id)
        .filter((id) => id && !excluded.has(id))
    )
  );
  if (acceptedIds.length === 0) return [];

  const { data, error } = await client
    .from("profiles")
    .select("user_id,display_name,avatar_url,city,country")
    .in("user_id", acceptedIds);
  if (error) throw error;

  const byId = new Map(
    ((data ?? []) as Array<Record<string, unknown>>).map((row) => [
      asString(row.user_id),
      {
        userId: asString(row.user_id),
        displayName: asString(row.display_name) || "Connection",
        avatarUrl: asString(row.avatar_url) || null,
        city: asString(row.city),
        country: asString(row.country),
      },
    ])
  );

  return acceptedIds
    .map((id) => byId.get(id) ?? { userId: id, displayName: "Connection", avatarUrl: null, city: "", country: "" })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function resolveLinkedMember(params: {
  serviceClient: SupabaseServiceClient;
  actorUserId: string;
  recipientUserId: string;
  linkedMemberUserId: string | null;
}) {
  const linkedMemberUserId = params.linkedMemberUserId?.trim() ?? "";
  if (!linkedMemberUserId) return null;
  if (linkedMemberUserId === params.actorUserId) {
    throw new Error("You cannot add yourself as the linked connection member.");
  }
  if (linkedMemberUserId === params.recipientUserId) {
    throw new Error("The linked connection member cannot be the request recipient.");
  }

  const connectionRes = await params.serviceClient
    .from("connections")
    .select("status,blocked_by")
    .or(
      `and(requester_id.eq.${params.actorUserId},target_id.eq.${linkedMemberUserId}),and(requester_id.eq.${linkedMemberUserId},target_id.eq.${params.actorUserId})`
    )
    .limit(2);
  if (connectionRes.error) throw connectionRes.error;

  const hasAcceptedConnection = ((connectionRes.data ?? []) as Array<{ status?: string | null; blocked_by?: string | null }>).some(
    (row) => isAcceptedStatus(row.status) && !row.blocked_by
  );
  if (!hasAcceptedConnection) {
    throw new Error("The linked connection member must already be an accepted connection.");
  }

  const profileRes = await params.serviceClient
    .from("profiles")
    .select("user_id,display_name,avatar_url,city,country")
    .eq("user_id", linkedMemberUserId)
    .maybeSingle();
  if (profileRes.error) throw profileRes.error;

  const row = (profileRes.data ?? null) as Record<string, unknown> | null;
  return {
    userId: linkedMemberUserId,
    displayName: asString(row?.display_name) || "Connection",
    avatarUrl: asString(row?.avatar_url) || null,
    city: asString(row?.city),
    country: asString(row?.country),
  } satisfies LinkedMemberOption;
}

export function buildLinkedMemberMetadata(linkedMember: LinkedMemberOption | null) {
  if (!linkedMember) return {};
  return {
    linked_member_user_id: linkedMember.userId,
    linked_member_name: linkedMember.displayName,
    linked_member_avatar_url: linkedMember.avatarUrl,
    linked_member_city: linkedMember.city || null,
    linked_member_country: linkedMember.country || null,
  };
}

export async function ensureLinkedMemberPairThread(params: {
  serviceClient: SupabaseServiceClient;
  actorUserId: string;
  linkedMember: LinkedMemberOption | null;
  recipientUserId: string;
}) {
  if (!params.linkedMember) return null;

  const rpc = await (params.serviceClient as unknown as RpcInvoker).rpc("cx_ensure_pair_thread", {
    p_user_a: params.linkedMember.userId,
    p_user_b: params.recipientUserId,
    p_actor: params.actorUserId,
  });
  if (rpc.error) throw rpc.error;

  const threadId = asString(rpc.data).trim();
  if (!threadId) throw new Error("Could not create linked member thread.");

  return threadId;
}

export async function mergeLinkedMemberContextMetadata(params: {
  serviceClient: SupabaseServiceClient;
  sourceTable: string;
  sourceId: string;
  linkedMember: LinkedMemberOption | null;
}) {
  if (!params.linkedMember || !params.sourceId) return;

  const contextRes = await params.serviceClient
    .from("thread_contexts" as never)
    .select("id,metadata")
    .eq("source_table", params.sourceTable)
    .eq("source_id", params.sourceId)
    .maybeSingle();
  if (contextRes.error) throw contextRes.error;

  const contextRow = (contextRes.data ?? null) as { id?: string | null; metadata?: Record<string, unknown> | null } | null;
  const contextId = asString(contextRow?.id).trim();
  if (!contextId) return;

  const nextMetadata = {
    ...((contextRow?.metadata ?? {}) as Record<string, unknown>),
    ...buildLinkedMemberMetadata(params.linkedMember),
  };

  const updateRes = await params.serviceClient
    .from("thread_contexts" as never)
    .update({
      metadata: nextMetadata,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", contextId);
  if (updateRes.error) throw updateRes.error;
}
