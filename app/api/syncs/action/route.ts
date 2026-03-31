import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";

type SyncAction = "propose" | "accept" | "decline" | "cancel" | "complete";

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

function shouldFallbackSyncRpc(message: string) {
  const text = message.toLowerCase();
  return (
    isMissingSchemaError(message) ||
    text.includes("function") ||
    text.includes("policy") ||
    text.includes("not_authenticated")
  );
}

function mapSyncActionErrorStatus(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("not_authenticated")) return 401;
  if (lower.includes("not_authorized")) return 403;
  if (lower.includes("sync_not_found")) return 404;
  if (lower.includes("invalid_action") || lower.includes("invalid_sync_type")) return 400;
  if (
    lower.includes("sync_not_pending") ||
    lower.includes("sync_not_accepted") ||
    lower.includes("connection_not_eligible") ||
    lower.includes("connection_not_eligible_for_sync")
  ) {
    return 409;
  }
  return 400;
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
    actorId?: string | null;
    kind: string;
    title: string;
    body?: string | null;
    linkUrl: string;
    metadata: Record<string, unknown>;
  }
) {
  const key = column.trim().toLowerCase();
  if (key === "user_id" || key === "recipient_id" || key === "to_user_id" || key === "target_id") return params.userId;
  if (key === "actor_id" || key === "sender_id" || key === "from_user_id" || key === "source_id") return params.actorId ?? null;
  if (key === "kind" || key === "type" || key === "event_type") return params.kind;
  if (key === "title" || key === "message") return params.title;
  if (key === "body" || key === "content" || key === "text") return params.body ?? params.title;
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
    actorId?: string | null;
    kind: string;
    title: string;
    body?: string | null;
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
    payload.message = params.body ?? params.title;
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

async function insertNotificationCompat(params: {
  service: ReturnType<typeof getServiceClient>;
  userId: string;
  actorId?: string | null;
  kind: string;
  title: string;
  body?: string | null;
  linkUrl: string;
  metadata: Record<string, unknown>;
}) {
  const payloadCandidates: Array<Record<string, unknown>> = [
    {
      user_id: params.userId,
      actor_id: params.actorId ?? null,
      kind: params.kind,
      title: params.title,
      body: params.body ?? null,
      link_url: params.linkUrl,
      metadata: params.metadata,
    },
    {
      user_id: params.userId,
      kind: params.kind,
      title: params.title,
      body: params.body ?? null,
      metadata: params.metadata,
    },
    {
      user_id: params.userId,
      kind: params.kind,
      title: params.title,
      metadata: params.metadata,
    },
    {
      user_id: params.userId,
      kind: params.kind,
      message: params.title,
      data: params.metadata,
    },
  ];

  let lastError: { message?: string; code?: string } | null = null;

  for (const candidate of payloadCandidates) {
    const payload = { ...candidate };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const insertRes = await params.service.from("notifications").insert(payload);
      if (!insertRes.error) return true;

      lastError = insertRes.error;
      const message = insertRes.error.message ?? "";
      if (insertRes.error.code === "23505" || message.toLowerCase().includes("duplicate")) {
        return true;
      }

      const missingColumn = extractMissingColumnFromError(message);
      if (missingColumn) {
        const changed = applyNotificationMissingColumnCompatibilitySwap(payload, missingColumn, params);
        if (changed) {
          continue;
        }
        const value = notificationFallbackValue(missingColumn, params);
        if (value !== undefined && !Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
          payload[missingColumn] = value;
          continue;
        }
      }

      if (isNullColumnConstraintError(message)) {
        const nullColumn = extractNullColumnFromError(message);
        const value = notificationFallbackValue(nullColumn, params);
        if (value !== undefined) {
          payload[nullColumn] = value;
          continue;
        }
      }

      if (!isMissingSchemaError(message)) {
        throw insertRes.error;
      }
      break;
    }
  }

  if (lastError && !isMissingSchemaError(lastError.message ?? "")) {
    throw new Error(lastError.message ?? "Unable to create notification.");
  }
  return false;
}

async function createSyncNotificationCompat(params: {
  service: ReturnType<typeof getServiceClient>;
  userId: string;
  actorId?: string | null;
  kind: "sync_proposed" | "sync_accepted" | "sync_declined" | "sync_completed";
  title: string;
  body?: string | null;
  connectionId: string;
  syncId: string;
  syncType?: string | null;
}) {
  const notificationRes = await params.service.rpc("create_notification", {
    p_user_id: params.userId,
    p_kind: params.kind,
    p_title: params.title,
    p_body: params.body ?? null,
    p_link_url: `/connections/${params.connectionId}`,
    p_metadata: {
      connection_id: params.connectionId,
      sync_id: params.syncId,
      ...(params.syncType ? { sync_type: params.syncType } : {}),
    },
  });

  if (notificationRes.error && !shouldFallbackSyncRpc(notificationRes.error.message)) {
    throw new Error(notificationRes.error.message);
  }

  const existingRes = await params.service
    .from("notifications")
    .select("id,metadata")
    .eq("user_id", params.userId)
    .eq("kind", params.kind)
    .order("created_at", { ascending: false })
    .limit(20);
  if (existingRes.error && !shouldFallbackSyncRpc(existingRes.error.message)) {
    throw new Error(existingRes.error.message);
  }

  const exists = ((existingRes.data ?? []) as Array<{ metadata?: Record<string, unknown> | null }>).some((row) => {
    const metadata = row.metadata ?? {};
    return metadata.sync_id === params.syncId || metadata.connection_id === params.connectionId;
  });
  if (exists) return;

  await insertNotificationCompat({
    service: params.service,
    userId: params.userId,
    actorId: params.actorId ?? null,
    kind: params.kind,
    title: params.title,
    body: params.body ?? null,
    linkUrl: `/connections/${params.connectionId}`,
    metadata: {
      connection_id: params.connectionId,
      sync_id: params.syncId,
      ...(params.syncType ? { sync_type: params.syncType } : {}),
    },
  });
}

async function ensureSyncNotificationCompat(params: {
  service: ReturnType<typeof getServiceClient>;
  userId: string;
  actorId?: string | null;
  kind: "sync_proposed" | "sync_accepted" | "sync_declined" | "sync_completed";
  title: string;
  body?: string | null;
  connectionId: string;
  syncId: string;
  syncType?: string | null;
}) {
  const existingRes = await params.service
    .from("notifications")
    .select("id,metadata,created_at")
    .eq("user_id", params.userId)
    .eq("kind", params.kind)
    .order("created_at", { ascending: false })
    .limit(20);

  if (existingRes.error && !shouldFallbackSyncRpc(existingRes.error.message)) {
    throw new Error(existingRes.error.message);
  }

  const exists = ((existingRes.data ?? []) as Array<{ metadata?: Record<string, unknown> | null }>).some((row) => {
    const metadata = row.metadata ?? {};
    return metadata.sync_id === params.syncId || metadata.connection_id === params.connectionId;
  });
  if (exists) return;

  await createSyncNotificationCompat(params);
}

async function ensureSyncStateSideEffects(params: {
  service: ReturnType<typeof getServiceClient>;
  meId: string;
  syncId: string;
  action: "propose" | "accept" | "decline" | "complete";
}) {
  const syncRes = await params.service
    .from("connection_syncs")
    .select("id,connection_id,requester_id,recipient_id,sync_type")
    .eq("id", params.syncId)
    .maybeSingle();

  if (syncRes.error) {
    if (shouldFallbackSyncRpc(syncRes.error.message)) return;
    throw new Error(syncRes.error.message);
  }

  const sync = syncRes.data as
    | {
        id?: string;
        connection_id?: string;
        requester_id?: string;
        recipient_id?: string;
        sync_type?: string | null;
      }
    | null;

  if (!sync?.id || !sync.connection_id || !sync.requester_id || !sync.recipient_id) return;

  if (params.action === "propose") {
    await ensureSyncNotificationCompat({
      service: params.service,
      userId: sync.recipient_id,
      kind: "sync_proposed",
      title: "New sync proposal",
      body: "You received a new sync proposal.",
      connectionId: sync.connection_id,
      syncId: sync.id,
      syncType: sync.sync_type ?? null,
      actorId: sync.requester_id,
    });
    return;
  }

  const recipientUserId =
    params.action === "accept" || params.action === "decline"
      ? sync.requester_id
      : sync.requester_id === params.meId
        ? sync.recipient_id
        : sync.requester_id;
  const kind =
    params.action === "accept"
      ? "sync_accepted"
      : params.action === "decline"
        ? "sync_declined"
        : "sync_completed";

  await ensureSyncNotificationCompat({
    service: params.service,
    userId: recipientUserId,
    kind,
    title:
      params.action === "accept"
        ? "Sync accepted"
        : params.action === "decline"
          ? "Sync declined"
          : "Sync marked completed",
    body: params.action === "complete" ? "A sync was marked completed. You can now leave a reference." : null,
    connectionId: sync.connection_id,
    syncId: sync.id,
    actorId: params.meId,
  });
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing Supabase service role configuration.");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function actionLabel(action: Exclude<SyncAction, "propose">) {
  if (action === "accept") return "accepted";
  if (action === "decline") return "declined";
  if (action === "cancel") return "cancelled";
  return "completed";
}

function toSyncType(value: unknown): "training" | "social_dancing" | "workshop" {
  if (value === "social_dancing" || value === "workshop") return value;
  return "training";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const actionRaw = typeof body?.action === "string" ? body.action : "";
    if (!["propose", "accept", "decline", "cancel", "complete"].includes(actionRaw)) {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }
    const action = actionRaw as SyncAction;

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabaseUser = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }
    const meId = authData.user.id;

    const service = getServiceClient();

    if (action === "propose") {
      const connectionId = typeof body?.connectionId === "string" ? body.connectionId : "";
      const syncType = toSyncType(body?.syncType);
      const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;
      const scheduledAt = typeof body?.scheduledAt === "string" && body.scheduledAt.trim() ? body.scheduledAt : null;

      if (!connectionId) {
        return NextResponse.json({ ok: false, error: "Missing connectionId." }, { status: 400 });
      }

      const proposed = await supabaseUser.rpc("propose_connection_sync", {
        p_connection_id: connectionId,
        p_sync_type: syncType,
        p_scheduled_at: scheduledAt,
        p_note: note,
      });
      if (!proposed.error) {
        if (typeof proposed.data === "string" && proposed.data) {
          await ensureSyncStateSideEffects({
            service,
            meId,
            syncId: proposed.data,
            action: "propose",
          });
        }
        return NextResponse.json({ ok: true, syncId: proposed.data ?? null, status: "pending" });
      }
      if (!shouldFallbackSyncRpc(proposed.error.message)) {
        return NextResponse.json(
          { ok: false, error: proposed.error.message },
          { status: mapSyncActionErrorStatus(proposed.error.message) }
        );
      }

      const connRes = await service
        .from("connections")
        .select("id,status,requester_id,target_id")
        .eq("id", connectionId)
        .maybeSingle();

      if (connRes.error) {
        return NextResponse.json({ ok: false, error: connRes.error.message }, { status: 400 });
      }

      const conn = connRes.data as
        | {
            id?: string;
            status?: string;
            requester_id?: string;
            target_id?: string;
          }
        | null;

      if (!conn?.id || !conn.requester_id || !conn.target_id) {
        return NextResponse.json({ ok: false, error: "Connection not found." }, { status: 404 });
      }

      if (conn.status !== "accepted") {
        return NextResponse.json({ ok: false, error: "Connection not accepted." }, { status: 400 });
      }

      if (conn.requester_id !== meId && conn.target_id !== meId) {
        return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
      }

      const recipientId = conn.requester_id === meId ? conn.target_id : conn.requester_id;

      const insertRes = await service
        .from("connection_syncs")
        .insert({
          connection_id: connectionId,
          requester_id: meId,
          recipient_id: recipientId,
          sync_type: syncType,
          scheduled_at: scheduledAt,
          note,
          status: "pending",
        })
        .select("id,status")
        .single();

      if (insertRes.error) {
        return NextResponse.json({ ok: false, error: insertRes.error.message }, { status: 400 });
      }

      await sendAppEmailBestEffort({
        kind: "sync_proposed",
        recipientUserId: recipientId,
        actorUserId: meId,
        connectionId,
        syncId: insertRes.data.id,
      });
      await createSyncNotificationCompat({
        service,
        userId: recipientId,
        kind: "sync_proposed",
        title: "New sync proposal",
        body: "You received a new sync proposal.",
        connectionId,
        syncId: insertRes.data.id,
        syncType,
        actorId: meId,
      });

      return NextResponse.json({ ok: true, syncId: insertRes.data.id, status: insertRes.data.status });
    }

    const syncId = typeof body?.syncId === "string" ? body.syncId : "";
    const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;

    if (!syncId) {
      return NextResponse.json({ ok: false, error: "Missing syncId." }, { status: 400 });
    }

    if (action === "accept" || action === "decline") {
      const responded = await supabaseUser.rpc("respond_connection_sync", {
        p_sync_id: syncId,
        p_action: action,
        p_note: note,
      });
      if (!responded.error) {
        if (typeof responded.data === "string" && responded.data) {
          await ensureSyncStateSideEffects({
            service,
            meId,
            syncId: responded.data,
            action,
          });
        }
        return NextResponse.json({
          ok: true,
          syncId: responded.data ?? syncId,
          status: action === "accept" ? "accepted" : "declined",
          action: actionLabel(action),
        });
      }
      if (!shouldFallbackSyncRpc(responded.error.message)) {
        return NextResponse.json(
          { ok: false, error: responded.error.message },
          { status: mapSyncActionErrorStatus(responded.error.message) }
        );
      }
    } else if (action === "cancel") {
      const cancelled = await supabaseUser.rpc("cancel_connection_sync", {
        p_sync_id: syncId,
      });
      if (!cancelled.error) {
        return NextResponse.json({
          ok: true,
          syncId: cancelled.data ?? syncId,
          status: "cancelled",
          action: actionLabel(action),
        });
      }
      if (!shouldFallbackSyncRpc(cancelled.error.message)) {
        return NextResponse.json(
          { ok: false, error: cancelled.error.message },
          { status: mapSyncActionErrorStatus(cancelled.error.message) }
        );
      }
    } else if (action === "complete") {
      const completed = await supabaseUser.rpc("complete_connection_sync", {
        p_sync_id: syncId,
        p_note: note,
      });
      if (!completed.error) {
        if (typeof completed.data === "string" && completed.data) {
          await ensureSyncStateSideEffects({
            service,
            meId,
            syncId: completed.data,
            action: "complete",
          });
        }
        return NextResponse.json({
          ok: true,
          syncId: completed.data ?? syncId,
          status: "completed",
          action: actionLabel(action),
        });
      }
      if (!shouldFallbackSyncRpc(completed.error.message)) {
        return NextResponse.json(
          { ok: false, error: completed.error.message },
          { status: mapSyncActionErrorStatus(completed.error.message) }
        );
      }
    }

    const syncRes = await service
      .from("connection_syncs")
      .select("id,connection_id,requester_id,recipient_id,status")
      .eq("id", syncId)
      .maybeSingle();

    if (syncRes.error) {
      if (isMissingSchemaError(syncRes.error.message)) {
        return NextResponse.json({ ok: false, error: "connection_syncs not available in schema." }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: syncRes.error.message }, { status: 400 });
    }

    const sync = syncRes.data as
      | {
          id?: string;
          connection_id?: string;
          requester_id?: string;
          recipient_id?: string;
          status?: string;
        }
      | null;

    if (!sync?.id || !sync.connection_id || !sync.requester_id || !sync.recipient_id) {
      return NextResponse.json({ ok: false, error: "Sync not found." }, { status: 404 });
    }

    const isRequester = sync.requester_id === meId;
    const isRecipient = sync.recipient_id === meId;
    if (!isRequester && !isRecipient) {
      return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }

    if ((action === "accept" || action === "decline") && !isRecipient) {
      return NextResponse.json({ ok: false, error: "Only recipient can respond." }, { status: 403 });
    }

    if ((action === "accept" || action === "decline" || action === "cancel") && sync.status !== "pending") {
      return NextResponse.json({ ok: false, error: "Sync is not pending." }, { status: 400 });
    }

    if (action === "complete" && sync.status !== "accepted") {
      return NextResponse.json({ ok: false, error: "Sync is not accepted." }, { status: 400 });
    }

    const payload: Record<string, unknown> = {};
    if (action === "accept") payload.status = "accepted";
    if (action === "decline") payload.status = "declined";
    if (action === "cancel") payload.status = "cancelled";
    if (action === "complete") {
      payload.status = "completed";
      payload.completed_at = new Date().toISOString();
      if (note) payload.note = note;
    }

    const updateRes = await service.from("connection_syncs").update(payload).eq("id", sync.id).select("id,status").single();
    if (updateRes.error) {
      return NextResponse.json({ ok: false, error: updateRes.error.message }, { status: 400 });
    }

    if (action === "complete") {
      const legacyInsert = await service.from("syncs").insert({
        connection_id: sync.connection_id,
        completed_by: meId,
        note: note ?? null,
      });
      if (legacyInsert.error && !isMissingSchemaError(legacyInsert.error.message)) {
        const message = legacyInsert.error.message.toLowerCase();
        if (!message.includes("duplicate")) {
          return NextResponse.json({ ok: false, error: legacyInsert.error.message }, { status: 400 });
        }
      }
    }

    if (action === "accept" || action === "decline" || action === "complete") {
      const recipientUserId =
        action === "accept" || action === "decline"
          ? sync.requester_id
          : sync.requester_id === meId
            ? sync.recipient_id
            : sync.requester_id;
      const kind =
        action === "accept"
          ? "sync_accepted"
          : action === "decline"
            ? "sync_declined"
            : "sync_completed";

      await sendAppEmailBestEffort({
        kind,
        recipientUserId,
        actorUserId: meId,
        connectionId: sync.connection_id,
        syncId,
      });

      await createSyncNotificationCompat({
        service,
        userId: recipientUserId,
        kind,
        title:
          action === "accept"
            ? "Sync accepted"
            : action === "decline"
              ? "Sync declined"
              : "Sync marked completed",
        body: action === "complete" ? "A sync was marked completed. You can now leave a reference." : null,
        connectionId: sync.connection_id,
        syncId,
      });
    }

    return NextResponse.json({
      ok: true,
      syncId: updateRes.data.id,
      status: updateRes.data.status,
      action: actionLabel(action),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
