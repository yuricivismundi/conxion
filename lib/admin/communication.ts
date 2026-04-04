import type { SupabaseServiceClient } from "@/lib/supabase/service-role";

type NotificationInsertResult =
  | { ok: true; notificationId: string | null }
  | { ok: false; error: string };

type RpcInvoker = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
    options?: { head?: boolean; get?: boolean; count?: "exact" | "planned" | "estimated" }
  ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

function trimText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function isMissingSchemaError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("relation") ||
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("column")
  );
}

function extractMissingColumnFromError(message: string) {
  const couldNotFind = message.match(/could not find the '([^']+)' column/i);
  if (couldNotFind?.[1]) return couldNotFind[1];

  const missing = message.match(/column \"([^\"]+)\" does not exist/i);
  if (missing?.[1]) return missing[1];

  return "";
}

function isNullColumnConstraintError(message: string) {
  return /null value in column \"([^\"]+)\"/i.test(message);
}

function extractNullColumnFromError(message: string) {
  const matched = message.match(/null value in column \"([^\"]+)\"/i);
  return matched?.[1] ?? "";
}

function notificationFallbackValue(
  column: string,
  params: {
    userId: string;
    actorId: string;
    kind: string;
    title: string;
    body: string;
    linkUrl: string;
    metadata: Record<string, unknown>;
  }
) {
  const key = column.trim().toLowerCase();
  if (key === "user_id" || key === "recipient_id" || key === "to_user_id" || key === "target_id") return params.userId;
  if (key === "actor_id" || key === "sender_id" || key === "from_user_id" || key === "source_id") return params.actorId;
  if (key === "kind" || key === "type" || key === "event_type") return params.kind;
  if (key === "title" || key === "message") return params.title;
  if (key === "body" || key === "content" || key === "text") return params.body;
  if (key === "link_url" || key === "url") return params.linkUrl;
  if (key === "metadata" || key === "data" || key === "payload") return params.metadata;
  if (key === "is_read" || key === "read") return false;
  return undefined;
}

function applyNotificationMissingColumnCompatibilitySwap(
  payload: Record<string, unknown>,
  missingColumn: string,
  params: {
    userId: string;
    actorId: string;
    kind: string;
    title: string;
    body: string;
    linkUrl: string;
    metadata: Record<string, unknown>;
  }
) {
  const key = missingColumn.trim().toLowerCase();

  if (key === "actor_id" && "actor_id" in payload) {
    delete payload.actor_id;
    return true;
  }
  if (key === "link_url" && "link_url" in payload) {
    delete payload.link_url;
    return true;
  }
  if (key === "body" && "body" in payload) {
    delete payload.body;
    payload.message = params.body;
    return true;
  }
  if (key === "title" && "title" in payload) {
    delete payload.title;
    payload.message = params.title;
    return true;
  }
  if (key === "kind" && "kind" in payload) {
    delete payload.kind;
    payload.type = params.kind;
    return true;
  }
  if (key === "metadata" && "metadata" in payload) {
    delete payload.metadata;
    payload.data = params.metadata;
    return true;
  }
  if (key === "user_id" && "user_id" in payload) {
    delete payload.user_id;
    payload.recipient_id = params.userId;
    return true;
  }
  if (key === "recipient_id" && "recipient_id" in payload) {
    delete payload.recipient_id;
    payload.user_id = params.userId;
    return true;
  }

  return false;
}

export async function insertNotificationCompat(params: {
  serviceClient: SupabaseServiceClient;
  userId: string;
  actorId: string;
  kind: string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<NotificationInsertResult> {
  const body = trimText(params.body);
  const linkUrl = trimText(params.linkUrl);
  const metadata = params.metadata ?? {};

  const payloadCandidates: Array<Record<string, unknown>> = [
    {
      user_id: params.userId,
      actor_id: params.actorId,
      type: params.kind,
      kind: params.kind,
      title: params.title,
      body: body || null,
      link_url: linkUrl || null,
      metadata,
    },
    {
      user_id: params.userId,
      type: params.kind,
      kind: params.kind,
      title: params.title,
      body: body || null,
      metadata,
    },
    {
      user_id: params.userId,
      type: params.kind,
      kind: params.kind,
      title: params.title,
      metadata,
    },
    {
      user_id: params.userId,
      type: params.kind,
      kind: params.kind,
      message: params.title,
      data: metadata,
    },
  ];

  let lastError: { message?: string; code?: string } | null = null;
  const serviceAny = params.serviceClient as unknown as {
    from: (table: string) => {
      insert: (values: Record<string, unknown>) => {
        select: (columns: string) => {
          single: () => Promise<{
            error: { message?: string; code?: string } | null;
            data?: { id?: string } | null;
          }>;
        };
      };
    };
  };

  for (const candidate of payloadCandidates) {
    const payload = { ...candidate };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const insertRes = await serviceAny.from("notifications").insert(payload).select("id").single();
      if (!insertRes.error) {
        return { ok: true, notificationId: insertRes.data?.id ?? null };
      }

      lastError = insertRes.error;
      const message = insertRes.error.message ?? "";
      if (insertRes.error.code === "23505" || message.toLowerCase().includes("duplicate")) {
        return { ok: true, notificationId: null };
      }

      const missingColumn = extractMissingColumnFromError(message);
      if (missingColumn) {
        const changed = applyNotificationMissingColumnCompatibilitySwap(payload, missingColumn, {
          userId: params.userId,
          actorId: params.actorId,
          kind: params.kind,
          title: params.title,
          body,
          linkUrl,
          metadata,
        });
        if (changed) continue;

        const value = notificationFallbackValue(missingColumn, {
          userId: params.userId,
          actorId: params.actorId,
          kind: params.kind,
          title: params.title,
          body,
          linkUrl,
          metadata,
        });
        if (value !== undefined && !Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
          payload[missingColumn] = value;
          continue;
        }
      }

      if (isNullColumnConstraintError(message)) {
        const nullColumn = extractNullColumnFromError(message);
        const value = notificationFallbackValue(nullColumn, {
          userId: params.userId,
          actorId: params.actorId,
          kind: params.kind,
          title: params.title,
          body,
          linkUrl,
          metadata,
        });
        if (value !== undefined) {
          payload[nullColumn] = value;
          continue;
        }
      }

      if (!isMissingSchemaError(message)) {
        return { ok: false, error: message || "Unable to create notification." };
      }
      break;
    }
  }

  if (!lastError) return { ok: false, error: "notification_insert_failed" };
  if (isMissingSchemaError(lastError.message ?? "")) {
    return {
      ok: false,
      error:
        "Notifications schema missing or outdated. Apply scripts/sql/2026-02-15_threads_trips_syncs_notifications.sql and scripts/sql/2026-02-19_notifications_hardening.sql.",
    };
  }
  return { ok: false, error: lastError.message ?? "Unable to create notification." };
}

export async function sendAdminThreadNotice(params: {
  serviceClient: SupabaseServiceClient;
  actorId: string;
  recipientUserId: string;
  title: string;
  message: string;
  notificationBody?: string | null;
  notificationKind?: string;
  metadata?: Record<string, unknown>;
}) {
  const actorId = trimText(params.actorId);
  const recipientUserId = trimText(params.recipientUserId);
  const title = trimText(params.title);
  const message = trimText(params.message) || title;

  if (!actorId || !recipientUserId) {
    throw new Error("Admin notice requires actor and recipient ids.");
  }

  const rpcClient = params.serviceClient as unknown as RpcInvoker;
  const metadata = {
    ...(params.metadata ?? {}),
    admin_notice: true,
    delivery_channel: "messages",
    sender_role: "admin",
  };

  // When the admin is also the recipient (testing on own content), the pair-thread
  // RPC requires two distinct users. Skip the thread message but still deliver
  // the in-app notification so it appears in the notification center.
  if (actorId === recipientUserId) {
    const notificationResult = await insertNotificationCompat({
      serviceClient: params.serviceClient,
      userId: recipientUserId,
      actorId,
      kind: trimText(params.notificationKind) || "admin_message",
      title,
      body: trimText(params.notificationBody) || message,
      linkUrl: `/notifications`,
      metadata,
    });
    return {
      threadId: null,
      threadToken: null,
      notificationId: notificationResult.ok ? notificationResult.notificationId : null,
      notificationError: notificationResult.ok ? null : notificationResult.error,
    };
  }

  const threadRes = await rpcClient.rpc("cx_ensure_pair_thread", {
    p_user_a: actorId,
    p_user_b: recipientUserId,
    p_actor: actorId,
  });
  if (threadRes.error) {
    throw new Error(threadRes.error.message ?? "Could not open admin thread.");
  }

  const threadId = trimText(typeof threadRes.data === "string" ? threadRes.data : "");
  if (!threadId) {
    throw new Error("Could not open admin thread.");
  }

  const emitRes = await rpcClient.rpc("cx_emit_thread_event", {
    p_thread_id: threadId,
    p_sender_id: actorId,
    p_body: message,
    p_message_type: "system",
    p_context_tag: "regular_chat",
    p_status_tag: "active",
    p_metadata: metadata,
  });
  if (emitRes.error) {
    throw new Error(emitRes.error.message ?? "Could not send admin thread message.");
  }

  const threadToken = `direct:${threadId}`;
  const notificationResult = await insertNotificationCompat({
    serviceClient: params.serviceClient,
    userId: recipientUserId,
    actorId,
    kind: trimText(params.notificationKind) || "admin_message",
    title,
    body: trimText(params.notificationBody) || message,
    linkUrl: `/messages?thread=${encodeURIComponent(threadToken)}`,
    metadata: {
      ...metadata,
      thread_id: threadId,
      thread_token: threadToken,
    },
  });

  return {
    threadId,
    threadToken,
    notificationId: notificationResult.ok ? notificationResult.notificationId : null,
    notificationError: notificationResult.ok ? null : notificationResult.error,
  };
}
