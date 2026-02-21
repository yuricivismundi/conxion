import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type SupabaseUserClient = ReturnType<typeof createClient<any>>;
type SupabaseAdminClient = ReturnType<typeof createClient<any>>;

const REFERENCE_COLUMNS_CACHE_TTL_MS = 60_000;
let cachedReferenceColumns:
  | {
      expiresAt: number;
      columns: Set<string>;
    }
  | null = null;

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

function isReferenceCompatWriteError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("function") ||
    text.includes("create_reference_v2") ||
    text.includes("create_reference(") ||
    text.includes("schema cache") ||
    text.includes("column") ||
    text.includes("null value in column") ||
    text.includes("\"sync_id\"") ||
    text.includes("does not exist")
  );
}

function isDuplicateConstraintError(message: string) {
  const text = message.toLowerCase();
  return text.includes("duplicate") || text.includes("unique constraint") || text.includes("already exists");
}

function isForeignKeyError(message: string) {
  const text = message.toLowerCase();
  return text.includes("foreign key") || text.includes("violates foreign key");
}

function isRatingConstraintError(message: string) {
  const text = message.toLowerCase();
  return text.includes("references_rating_check") || (text.includes("rating") && text.includes("check constraint"));
}

function normalizeEntityType(value: string) {
  const key = value.trim().toLowerCase();
  if (key === "sync" || key === "trip" || key === "event" || key === "connection") return key;
  return "connection";
}

function within15Days(value: string | null | undefined) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const delta = Date.now() - date.getTime();
  return delta >= 0 && delta <= 15 * 24 * 60 * 60 * 1000;
}

function pickFirstString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "";
}

function pickFirstNumber(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function pickFirstNullableText(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function mapSentimentToRating(sentiment: string) {
  if (sentiment === "positive") return 5;
  if (sentiment === "neutral") return 3;
  return 1;
}

function ratingCandidatesForSentiment(sentiment: string): Array<string | number> {
  const key = sentiment.trim().toLowerCase();
  if (key === "positive") {
    return ["positive", "POSITIVE", 5, "5", 3, "3", 1, "1"];
  }
  if (key === "neutral") {
    return ["neutral", "NEUTRAL", 3, "3", 2, "2", 0, "0", 1, "1"];
  }
  return ["negative", "NEGATIVE", 1, "1", 0, "0", -1, "-1", 2, "2", 3, "3"];
}

function applyRatingCandidate(
  payload: Record<string, unknown>,
  sentiment: string,
  candidate: string | number
) {
  payload.rating = candidate;
  const normalizedCandidate = typeof candidate === "string" ? candidate.toLowerCase() : "";
  if (normalizedCandidate === "positive" || normalizedCandidate === "neutral" || normalizedCandidate === "negative") {
    payload.sentiment = normalizedCandidate;
    return;
  }
  // Keep sentiment aligned even when rating is numeric/text numeric.
  payload.sentiment = sentiment;
}

function getSupabaseAdminClient(): SupabaseAdminClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return null;

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getReferenceReadClient(supabase: SupabaseUserClient) {
  return getSupabaseAdminClient() ?? supabase;
}

async function ensureReferenceReceivedNotification(params: {
  actorId: string;
  recipientId: string;
  referenceId: string;
  entityType: string;
  entityId: string;
}) {
  const admin = getSupabaseAdminClient();
  if (!admin) return;

  const recent = await admin
    .from("notifications")
    .select("id,metadata")
    .eq("user_id", params.recipientId)
    .eq("kind", "reference_received")
    .order("created_at", { ascending: false })
    .limit(40);

  if (recent.error) {
    if (isMissingSchemaError(recent.error.message)) return;
    throw recent.error;
  }

  const rows = (recent.data ?? []) as Array<{ metadata?: Record<string, unknown> | null }>;
  if (params.referenceId) {
    const duplicate = rows.some((row) => {
      const metadata = row.metadata ?? {};
      return metadata.reference_id === params.referenceId;
    });
    if (duplicate) return;
  }

  const notificationArgs = {
    userId: params.recipientId,
    actorId: params.actorId,
    kind: "reference_received",
    title: "New reference received",
    body: "You received a new reference.",
    linkUrl: `/members/${params.recipientId}`,
    metadata: {
      reference_id: params.referenceId || null,
      entity_type: params.entityType,
      entity_id: params.entityId,
    },
  };

  const fallbackValueForColumn = (column: string) => {
    const key = column.trim().toLowerCase();
    if (key === "user_id" || key === "recipient_id" || key === "to_user_id" || key === "target_id") return notificationArgs.userId;
    if (key === "actor_id" || key === "sender_id" || key === "from_user_id" || key === "source_id") return notificationArgs.actorId;
    if (key === "kind" || key === "type" || key === "event_type") return notificationArgs.kind;
    if (key === "title" || key === "message") return notificationArgs.title;
    if (key === "body" || key === "content" || key === "text") return notificationArgs.body;
    if (key === "link_url" || key === "url") return notificationArgs.linkUrl;
    if (key === "metadata" || key === "data" || key === "payload") return notificationArgs.metadata;
    if (key === "is_read" || key === "read") return false;
    return undefined;
  };

  const applyMissingColumnCompatibilitySwap = (payload: Record<string, unknown>, missingColumn: string) => {
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
      payload.message = notificationArgs.body;
      return true;
    }
    if (key === "title" && "title" in payload) {
      delete payload.title;
      payload.message = notificationArgs.title;
      return true;
    }
    if (key === "kind" && "kind" in payload) {
      delete payload.kind;
      payload.type = notificationArgs.kind;
      return true;
    }
    if (key === "metadata" && "metadata" in payload) {
      delete payload.metadata;
      payload.data = notificationArgs.metadata;
      return true;
    }
    if (key === "user_id" && "user_id" in payload) {
      delete payload.user_id;
      payload.recipient_id = notificationArgs.userId;
      return true;
    }
    if (key === "recipient_id" && "recipient_id" in payload) {
      delete payload.recipient_id;
      payload.user_id = notificationArgs.userId;
      return true;
    }
    return false;
  };

  const payloadCandidates: Array<Record<string, unknown>> = [
    {
      user_id: notificationArgs.userId,
      actor_id: notificationArgs.actorId,
      kind: notificationArgs.kind,
      title: notificationArgs.title,
      body: notificationArgs.body,
      link_url: notificationArgs.linkUrl,
      metadata: notificationArgs.metadata,
    },
    {
      user_id: notificationArgs.userId,
      kind: notificationArgs.kind,
      title: notificationArgs.title,
      body: notificationArgs.body,
      metadata: notificationArgs.metadata,
    },
    {
      user_id: notificationArgs.userId,
      kind: notificationArgs.kind,
      title: notificationArgs.title,
      metadata: notificationArgs.metadata,
    },
    {
      user_id: notificationArgs.userId,
      kind: notificationArgs.kind,
      message: notificationArgs.title,
      data: notificationArgs.metadata,
    },
  ];

  let lastError: { message: string; code?: string } | null = null;

  for (const candidate of payloadCandidates) {
    const payload = { ...candidate };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const insertRes = await admin.from("notifications").insert(payload);
      if (!insertRes.error) return;

      lastError = insertRes.error;
      const message = insertRes.error.message ?? "";
      if (insertRes.error.code === "23505" || message.toLowerCase().includes("duplicate")) {
        return;
      }

      const missingColumn = extractColumnNameFromError(message);
      if (missingColumn) {
        const changed = applyMissingColumnCompatibilitySwap(payload, missingColumn);
        if (changed) {
          continue;
        }
        const value = fallbackValueForColumn(missingColumn);
        if (value !== undefined && !Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
          payload[missingColumn] = value;
          continue;
        }
      }

      const nullColumn = message.match(/null value in column \"([^\"]+)\"/i)?.[1] ?? "";
      if (nullColumn) {
        const value = fallbackValueForColumn(nullColumn);
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

  if (lastError && !isMissingSchemaError(lastError.message)) {
    throw lastError;
  }
}

async function getReferenceColumns(supabase?: SupabaseUserClient) {
  const now = Date.now();
  if (cachedReferenceColumns && cachedReferenceColumns.expiresAt > now) {
    return cachedReferenceColumns.columns;
  }

  const fetchColumns = async (client: SupabaseUserClient | SupabaseAdminClient | null) => {
    if (!client) return null;
    const res = await client
      .from("information_schema.columns")
      .select("column_name")
      .eq("table_schema", "public")
      .eq("table_name", "references");
    if (res.error) return null;

    const columns = new Set(
      ((res.data ?? []) as Array<{ column_name?: string | null }>)
        .map((row) => (typeof row.column_name === "string" ? row.column_name : ""))
        .filter(Boolean)
    );
    return columns.size > 0 ? columns : null;
  };

  const admin = getSupabaseAdminClient();
  const columns = (await fetchColumns(admin)) ?? (await fetchColumns(supabase ?? null));
  if (!columns) return null;

  cachedReferenceColumns = {
    expiresAt: now + REFERENCE_COLUMNS_CACHE_TTL_MS,
    columns,
  };
  return columns;
}

async function resolveLegacySyncId(params: {
  supabase: SupabaseUserClient;
  connectionId: string;
  entityType: string;
  entityId: string;
}) {
  if (params.entityType === "sync" && params.entityId) {
    const legacyById = await params.supabase.from("syncs").select("id").eq("id", params.entityId).maybeSingle();
    if (!legacyById.error && typeof legacyById.data?.id === "string" && legacyById.data.id) {
      return legacyById.data.id;
    }

    const modernById = await params.supabase
      .from("connection_syncs")
      .select("id,connection_id,completed_at")
      .eq("id", params.entityId)
      .maybeSingle();

    const modern = modernById.data as
      | {
          id?: string;
          connection_id?: string;
          completed_at?: string | null;
        }
      | null;

    if (!modernById.error && modern?.id && modern.connection_id) {
      const legacyForConnection = await params.supabase
        .from("syncs")
        .select("id,completed_at")
        .eq("connection_id", modern.connection_id)
        .order("completed_at", { ascending: false })
        .limit(50);

      let legacyRows = ((legacyForConnection.data ?? []) as Array<{ id?: string; completed_at?: string | null }>).filter(
        (row) => typeof row.id === "string" && row.id
      );
      if ((legacyRows.length === 0 && legacyForConnection.error) || isMissingSchemaError(legacyForConnection.error?.message ?? "")) {
        const fallbackLegacyForConnection = await params.supabase
          .from("syncs")
          .select("id")
          .eq("connection_id", modern.connection_id)
          .limit(50);
        legacyRows = ((fallbackLegacyForConnection.data ?? []) as Array<{ id?: string; completed_at?: string | null }>).filter(
          (row) => typeof row.id === "string" && row.id
        );
      }

      if (legacyRows.length > 0) {
        if (modern.completed_at) {
          const target = new Date(modern.completed_at).getTime();
          if (!Number.isNaN(target)) {
            let bestId = legacyRows[0].id as string;
            let bestDelta = Number.MAX_SAFE_INTEGER;

            legacyRows.forEach((row) => {
              const value = row.completed_at ? new Date(row.completed_at).getTime() : NaN;
              if (Number.isNaN(value)) return;
              const delta = Math.abs(value - target);
              if (delta < bestDelta) {
                bestDelta = delta;
                bestId = row.id as string;
              }
            });

            if (bestId) return bestId;
          }
        }

        return legacyRows[0].id as string;
      }
    }

    return params.entityId;
  }

  const modern = await params.supabase
    .from("connection_syncs")
    .select("id")
    .eq("connection_id", params.connectionId)
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!modern.error && typeof modern.data?.id === "string" && modern.data.id) {
    return modern.data.id;
  }

  const legacy = await params.supabase
    .from("syncs")
    .select("id")
    .eq("connection_id", params.connectionId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!legacy.error && typeof legacy.data?.id === "string" && legacy.data.id) {
    return legacy.data.id;
  }

  return "";
}

async function ensureLegacySyncRowForCompat(params: {
  supabase: SupabaseUserClient;
  syncId: string;
  connectionId: string;
  meId: string;
}) {
  if (!params.syncId) return "";

  const existing = await params.supabase.from("syncs").select("id").eq("id", params.syncId).maybeSingle();
  if (!existing.error && typeof existing.data?.id === "string" && existing.data.id) {
    return existing.data.id;
  }
  if (existing.error && !isMissingSchemaError(existing.error.message)) {
    return params.syncId;
  }

  const nowIso = new Date().toISOString();
  const resolveExistingForActor = async () => {
    const byActor = await params.supabase
      .from("syncs")
      .select("id")
      .eq("connection_id", params.connectionId)
      .eq("completed_by", params.meId)
      .limit(1)
      .maybeSingle();
    if (!byActor.error && typeof byActor.data?.id === "string" && byActor.data.id) {
      return byActor.data.id;
    }
    const byConnection = await params.supabase
      .from("syncs")
      .select("id")
      .eq("connection_id", params.connectionId)
      .limit(1)
      .maybeSingle();
    if (!byConnection.error && typeof byConnection.data?.id === "string" && byConnection.data.id) {
      return byConnection.data.id;
    }
    return "";
  };

  const payloads: Array<Record<string, unknown>> = [
    {
      id: params.syncId,
      connection_id: params.connectionId,
      completed_by: params.meId,
      completed_at: nowIso,
      note: "Compat sync for reference",
    },
    {
      id: params.syncId,
      connection_id: params.connectionId,
      completed_by: params.meId,
      note: "Compat sync for reference",
    },
    {
      id: params.syncId,
      connection_id: params.connectionId,
      completed_by: params.meId,
    },
    {
      connection_id: params.connectionId,
      completed_by: params.meId,
      completed_at: nowIso,
      note: "Compat sync for reference",
    },
    {
      connection_id: params.connectionId,
      completed_by: params.meId,
      note: "Compat sync for reference",
    },
    {
      connection_id: params.connectionId,
      completed_by: params.meId,
    },
  ];

  for (const payload of payloads) {
    const inserted = await params.supabase.from("syncs").insert(payload).select("id").single();
    if (!inserted.error) {
      return (inserted.data?.id as string) || params.syncId;
    }

    if (isDuplicateConstraintError(inserted.error.message)) {
      const existingId = await resolveExistingForActor();
      return existingId || params.syncId;
    }
    if (!isReferenceCompatWriteError(inserted.error.message) && !isForeignKeyError(inserted.error.message)) {
      break;
    }
  }

  const existingId = await resolveExistingForActor();
  if (existingId) return existingId;
  return params.syncId;
}

async function hasDuplicateSyncReference(params: {
  supabase: SupabaseUserClient;
  authorId: string;
  recipientId: string;
  connectionId: string;
  syncId: string;
}) {
  const readClient = getReferenceReadClient(params.supabase);
  const authorColumns = ["author_id", "from_user_id", "source_id"];
  const recipientColumns = ["recipient_id", "to_user_id", "target_id"];
  const connectionColumns = ["connection_id", "connection_request_id"];

  const rowById = new Map<string, Record<string, unknown>>();
  const pushRows = (rows: Array<Record<string, unknown>>) => {
    rows.forEach((row) => {
      const id = typeof row.id === "string" ? row.id : "";
      if (id) {
        rowById.set(id, row);
        return;
      }
      rowById.set(`${rowById.size}:${JSON.stringify(row)}`, row);
    });
  };

  let scannedByConnection = false;
  for (const connectionColumn of connectionColumns) {
    const byConnection = await readClient
      .from("references")
      .select("*")
      .eq(connectionColumn, params.connectionId)
      .limit(1000);
    if (!byConnection.error) {
      pushRows((byConnection.data ?? []) as Array<Record<string, unknown>>);
      scannedByConnection = true;
      break;
    }
    if (!isMissingSchemaError(byConnection.error.message)) {
      break;
    }
  }

  if (!scannedByConnection || rowById.size === 0) {
    for (const authorColumn of authorColumns) {
      const byAuthor = await readClient.from("references").select("*").eq(authorColumn, params.authorId).limit(1000);
      if (!byAuthor.error) {
        pushRows((byAuthor.data ?? []) as Array<Record<string, unknown>>);
        break;
      }
      if (!isMissingSchemaError(byAuthor.error.message)) {
        break;
      }
    }
  }

  if (rowById.size === 0) {
    for (const recipientColumn of recipientColumns) {
      const byRecipient = await readClient
        .from("references")
        .select("*")
        .eq(recipientColumn, params.recipientId)
        .limit(1000);
      if (!byRecipient.error) {
        pushRows((byRecipient.data ?? []) as Array<Record<string, unknown>>);
        break;
      }
      if (!isMissingSchemaError(byRecipient.error.message)) {
        break;
      }
    }
  }

  const rows = Array.from(rowById.values());
  if (rows.length === 0) {
    return false;
  }

  for (const row of rows) {
    const rowAuthor = pickFirstString(row, authorColumns);
    const rowRecipient = pickFirstString(row, recipientColumns);
    const rowConnection = pickFirstString(row, connectionColumns);
    if (rowAuthor && rowAuthor !== params.authorId) continue;
    if (rowRecipient && rowRecipient !== params.recipientId) continue;
    if (rowConnection && rowConnection !== params.connectionId) continue;

    const entityType = pickFirstString(row, ["entity_type", "context"]).toLowerCase();
    const entityId = pickFirstString(row, ["entity_id", "sync_id"]);
    const syncId = pickFirstString(row, ["sync_id", "entity_id"]);

    if (entityType === "sync" && (entityId === params.syncId || syncId === params.syncId)) {
      return true;
    }
    if (!entityType && (entityId === params.syncId || syncId === params.syncId)) {
      return true;
    }

    // Fallback dedupe for heavily legacy schemas that do not persist sync/entity markers consistently.
    if (rowConnection === params.connectionId && rowRecipient === params.recipientId) {
      return true;
    }
  }

  return false;
}

async function ensureSyncReferenceEligibility(params: {
  supabase: SupabaseUserClient;
  connectionId: string;
  meId: string;
  recipientId: string;
  syncId: string;
}) {
  if (!params.syncId) {
    return { ok: false, error: "sync_reference_not_allowed" as const };
  }

  const readClient = getReferenceReadClient(params.supabase);
  const syncRes = await params.supabase
    .from("connection_syncs")
    .select("id,connection_id,requester_id,recipient_id,status,completed_at")
    .eq("id", params.syncId)
    .maybeSingle();

  if (syncRes.error && !isMissingSchemaError(syncRes.error.message)) {
    return { ok: false, error: syncRes.error.message };
  }

  const sync = syncRes.data as
    | {
        id?: string;
        connection_id?: string;
        requester_id?: string;
        recipient_id?: string;
        status?: string;
        completed_at?: string | null;
      }
    | null;

  if (sync?.id) {
    const hasMemberColumns = Boolean(sync.requester_id) && Boolean(sync.recipient_id);
    const membersOk =
      !hasMemberColumns ||
      (sync.requester_id === params.meId && sync.recipient_id === params.recipientId) ||
      (sync.requester_id === params.recipientId && sync.recipient_id === params.meId);
    const status = sync.status ?? "completed";

    let completedAtOk = Boolean(sync.completed_at) && within15Days(sync.completed_at);
    if (!completedAtOk) {
      const fallbackLegacyWindow = await readClient
        .from("syncs")
        .select("completed_at")
        .eq("id", params.syncId)
        .eq("connection_id", params.connectionId)
        .maybeSingle();
      if (!fallbackLegacyWindow.error) {
        const legacyCompletedAt = (fallbackLegacyWindow.data as { completed_at?: string | null } | null)?.completed_at;
        completedAtOk = within15Days(legacyCompletedAt ?? null);
      }
    }

    if (sync.connection_id !== params.connectionId || status !== "completed" || !completedAtOk || !membersOk) {
      return { ok: false, error: "sync_reference_not_allowed" as const };
    }
  } else {
    // Legacy fallback path: if modern table is unavailable, require at least a legacy sync row.
    const legacySync = await readClient
      .from("syncs")
      .select("id,connection_id,completed_at")
      .eq("id", params.syncId)
      .eq("connection_id", params.connectionId)
      .maybeSingle();
    if (legacySync.error) {
      return { ok: false, error: "sync_reference_not_allowed" as const };
    }
    if (!legacySync.data) {
      return { ok: false, error: "sync_reference_not_allowed" as const };
    }
    const completedAt = (legacySync.data as { completed_at?: string | null }).completed_at;
    if (!within15Days(completedAt ?? null)) {
      return { ok: false, error: "sync_reference_not_allowed" as const };
    }
  }

  if (
    await hasDuplicateSyncReference({
      supabase: params.supabase,
      authorId: params.meId,
      recipientId: params.recipientId,
      connectionId: params.connectionId,
      syncId: params.syncId,
    })
  ) {
    return { ok: false, error: "duplicate_reference_not_allowed" as const };
  }

  return { ok: true };
}

function extractColumnNameFromError(message: string) {
  const couldNotFind = message.match(/could not find the '([^']+)' column/i);
  if (couldNotFind?.[1]) return couldNotFind[1];

  const missing = message.match(/column \"([^\"]+)\" does not exist/i);
  if (missing?.[1]) return missing[1];

  const nullConstraint = message.match(/null value in column \"([^\"]+)\"/i);
  if (nullConstraint?.[1]) return nullConstraint[1];

  return "";
}

function fallbackValueForColumn(
  column: string,
  params: {
    meId: string;
    connectionId: string;
    recipientId: string;
    sentiment: string;
    referenceBody: string;
    entityType: string;
    entityId: string;
    syncId: string;
  }
) {
  const syncValue = params.entityType === "sync" ? params.syncId || params.entityId || "" : params.syncId || "";
  const key = column.trim().toLowerCase();

  if (key === "connection_id" || key === "connection_request_id") return params.connectionId;
  if (key === "author_id" || key === "from_user_id" || key === "source_id") return params.meId;
  if (key === "recipient_id" || key === "to_user_id" || key === "target_id") return params.recipientId;
  if (key === "body" || key === "content" || key === "comment" || key === "reference_text" || key === "feedback") {
    return params.referenceBody.trim();
  }
  if (key === "context") return params.entityType || "connection";
  if (key === "entity_type") return params.entityType || "connection";
  if (key === "entity_id") return params.entityId;
  if (key === "sentiment") return params.sentiment;
  if (key === "rating") return mapSentimentToRating(params.sentiment);
  if (key === "sync_id") return syncValue || null;

  return undefined;
}

function applyMissingColumnCompatibilitySwap(
  payload: Record<string, unknown>,
  missingColumn: string,
  params: {
    meId: string;
    connectionId: string;
    recipientId: string;
    sentiment: string;
    referenceBody: string;
    entityType: string;
    entityId: string;
    syncId: string;
  }
) {
  const key = missingColumn.trim().toLowerCase();

  if (key === "body" && "body" in payload) {
    delete payload.body;
    payload.content = params.referenceBody.trim();
    return true;
  }
  if (key === "feedback" && "body" in payload) {
    delete payload.body;
    payload.feedback = params.referenceBody.trim();
    return true;
  }
  if (key === "feedback" && "content" in payload) {
    delete payload.content;
    payload.feedback = params.referenceBody.trim();
    return true;
  }
  if (key === "feedback" && "comment" in payload) {
    delete payload.comment;
    payload.feedback = params.referenceBody.trim();
    return true;
  }
  if (key === "feedback" && "reference_text" in payload) {
    delete payload.reference_text;
    payload.feedback = params.referenceBody.trim();
    return true;
  }
  if (key === "content" && "content" in payload) {
    delete payload.content;
    payload.body = params.referenceBody.trim();
    return true;
  }
  if (key === "body" && "feedback" in payload) {
    delete payload.feedback;
    payload.body = params.referenceBody.trim();
    return true;
  }
  if (key === "content" && "feedback" in payload) {
    delete payload.feedback;
    payload.content = params.referenceBody.trim();
    return true;
  }
  if (key === "author_id" && "author_id" in payload) {
    delete payload.author_id;
    payload.from_user_id = params.meId;
    return true;
  }
  if (key === "from_user_id" && "from_user_id" in payload) {
    delete payload.from_user_id;
    payload.author_id = params.meId;
    return true;
  }
  if (key === "source_id" && "source_id" in payload) {
    delete payload.source_id;
    payload.author_id = params.meId;
    return true;
  }
  if (key === "author_id" && "source_id" in payload) {
    delete payload.source_id;
    payload.from_user_id = params.meId;
    return true;
  }
  if (key === "from_user_id" && "source_id" in payload) {
    delete payload.source_id;
    payload.author_id = params.meId;
    return true;
  }
  if (key === "recipient_id" && "recipient_id" in payload) {
    delete payload.recipient_id;
    payload.to_user_id = params.recipientId;
    return true;
  }
  if (key === "to_user_id" && "to_user_id" in payload) {
    delete payload.to_user_id;
    payload.recipient_id = params.recipientId;
    return true;
  }
  if (key === "target_id" && "target_id" in payload) {
    delete payload.target_id;
    payload.recipient_id = params.recipientId;
    return true;
  }
  if (key === "recipient_id" && "target_id" in payload) {
    delete payload.target_id;
    payload.to_user_id = params.recipientId;
    return true;
  }
  if (key === "to_user_id" && "target_id" in payload) {
    delete payload.target_id;
    payload.recipient_id = params.recipientId;
    return true;
  }
  if (key === "connection_id" && "connection_id" in payload) {
    delete payload.connection_id;
    payload.connection_request_id = params.connectionId;
    return true;
  }
  if (key === "connection_request_id" && "connection_request_id" in payload) {
    delete payload.connection_request_id;
    payload.connection_id = params.connectionId;
    return true;
  }
  if (key === "sentiment" && "sentiment" in payload) {
    delete payload.sentiment;
    payload.rating = mapSentimentToRating(params.sentiment);
    return true;
  }
  if (key === "rating" && "rating" in payload) {
    delete payload.rating;
    payload.sentiment = params.sentiment;
    return true;
  }

  if (key === "context" && "context" in payload) {
    delete payload.context;
    return true;
  }
  if (key === "entity_type" && "entity_type" in payload) {
    delete payload.entity_type;
    return true;
  }
  if (key === "entity_id" && "entity_id" in payload) {
    delete payload.entity_id;
    return true;
  }
  if (key === "sync_id" && "sync_id" in payload) {
    delete payload.sync_id;
    return true;
  }

  return false;
}

function buildReferenceCompatPayload(params: {
  columns: Set<string> | null;
  meId: string;
  connectionId: string;
  recipientId: string;
  sentiment: string;
  referenceBody: string;
  entityType: string;
  entityId: string;
  syncId: string;
}) {
  const payload: Record<string, unknown> = {};
  const cleanBody = params.referenceBody.trim();
  const context = params.entityType || "connection";
  const syncValue = params.entityType === "sync" ? params.syncId || params.entityId || "" : params.syncId || "";
  const columns = params.columns;

  if (params.entityType === "sync" && !syncValue) {
    return { ok: false as const, error: "sync_reference_not_allowed" };
  }

  // If we can inspect schema, fill every compatible synonym that exists.
  if (columns) {
    if (columns.has("connection_id")) payload.connection_id = params.connectionId;
    if (columns.has("connection_request_id")) payload.connection_request_id = params.connectionId;

    if (columns.has("author_id")) payload.author_id = params.meId;
    if (columns.has("from_user_id")) payload.from_user_id = params.meId;
    if (columns.has("source_id")) payload.source_id = params.meId;

    if (columns.has("recipient_id")) payload.recipient_id = params.recipientId;
    if (columns.has("to_user_id")) payload.to_user_id = params.recipientId;
    if (columns.has("target_id")) payload.target_id = params.recipientId;

    if (columns.has("body")) payload.body = cleanBody;
    if (columns.has("content")) payload.content = cleanBody;
    if (columns.has("feedback")) payload.feedback = cleanBody;
    if (columns.has("comment")) payload.comment = cleanBody;
    if (columns.has("reference_text")) payload.reference_text = cleanBody;

    if (columns.has("context")) payload.context = context;
    if (columns.has("entity_type")) payload.entity_type = params.entityType;
    if (columns.has("entity_id")) payload.entity_id = params.entityId;

    if (columns.has("sentiment")) payload.sentiment = params.sentiment;
    if (columns.has("rating")) payload.rating = mapSentimentToRating(params.sentiment);

    if (columns.has("sync_id") && syncValue) payload.sync_id = syncValue;
  } else {
    // Unknown schema fallback: use modern first.
    payload.connection_id = params.connectionId;
    payload.author_id = params.meId;
    payload.recipient_id = params.recipientId;
    payload.context = context;
    payload.sentiment = params.sentiment;
    payload.body = cleanBody;
    if (syncValue) payload.sync_id = syncValue;
  }

  const hasAnyBody =
    "body" in payload ||
    "content" in payload ||
    "feedback" in payload ||
    "comment" in payload ||
    "reference_text" in payload;
  if (!hasAnyBody) {
    return { ok: false as const, error: "reference_text_column_missing" };
  }

  return { ok: true as const, payload, syncValue };
}

async function insertReferenceCompat(params: {
  supabase: SupabaseUserClient;
  meId: string;
  connectionId: string;
  recipientId: string;
  sentiment: string;
  referenceBody: string;
  entityType: string;
  entityId: string;
  syncId: string;
  legacySyncId?: string;
}) {
  const columns = await getReferenceColumns(params.supabase);
  const payloadResult = buildReferenceCompatPayload({
    columns,
    meId: params.meId,
    connectionId: params.connectionId,
    recipientId: params.recipientId,
    sentiment: params.sentiment,
    referenceBody: params.referenceBody,
    entityType: params.entityType,
    entityId: params.entityId,
    syncId: params.syncId,
  });
  if (!payloadResult.ok) {
    return { ok: false as const, error: payloadResult.error };
  }

  const payload = { ...payloadResult.payload };
  let lastMessage = "insert_failed";
  const ratingCandidates = ratingCandidatesForSentiment(params.sentiment);
  let ratingCandidateIndex = 0;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const inserted = await params.supabase.from("references").insert(payload).select("id").single();
    if (!inserted.error) {
      return { ok: true as const, referenceId: inserted.data.id as string };
    }

    const message = inserted.error.message ?? "insert_failed";
    lastMessage = message;
    if (isDuplicateConstraintError(message)) {
      return { ok: false as const, error: "duplicate_reference_not_allowed" };
    }
    if (isForeignKeyError(message) && params.entityType === "sync") {
      // Try alternate sync id target first (legacy/modern mismatch across environments),
      // then fallback to entity-level sync linkage without hard FK.
      if ("sync_id" in payload && params.legacySyncId && params.legacySyncId !== payload.sync_id) {
        payload.sync_id = params.legacySyncId;
        continue;
      }
      if ("sync_id" in payload) {
        delete payload.sync_id;
        continue;
      }
      return { ok: false as const, error: "sync_reference_not_allowed" };
    }
    if (!isReferenceCompatWriteError(message)) {
      return { ok: false as const, error: message };
    }

    if (isRatingConstraintError(message)) {
      // Retry with compatible rating encodings/scale for legacy schemas.
      let changedRating = false;
      while (ratingCandidateIndex < ratingCandidates.length) {
        const candidate = ratingCandidates[ratingCandidateIndex];
        ratingCandidateIndex += 1;
        if (payload.rating === candidate) continue;
        applyRatingCandidate(payload, params.sentiment, candidate);
        changedRating = true;
        break;
      }
      if (changedRating) {
        continue;
      }
    }

    const missingColumn = extractColumnNameFromError(message);
    if (!missingColumn) {
      break;
    }

    const changedBySwap = applyMissingColumnCompatibilitySwap(payload, missingColumn, {
      meId: params.meId,
      connectionId: params.connectionId,
      recipientId: params.recipientId,
      sentiment: params.sentiment,
      referenceBody: params.referenceBody,
      entityType: params.entityType,
      entityId: params.entityId,
      syncId: payloadResult.syncValue,
    });
    if (changedBySwap) {
      continue;
    }

    const fallbackValue = fallbackValueForColumn(missingColumn, {
      meId: params.meId,
      connectionId: params.connectionId,
      recipientId: params.recipientId,
      sentiment: params.sentiment,
      referenceBody: params.referenceBody,
      entityType: params.entityType,
      entityId: params.entityId,
      syncId: payloadResult.syncValue,
    });
    if (fallbackValue !== undefined && !Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
      payload[missingColumn] = fallbackValue;
      continue;
    }

    break;
  }

  return { ok: false as const, error: lastMessage };
}

function getSupabaseUserClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(url, anon, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createSyncReferenceWithFallback(params: {
  supabase: SupabaseUserClient;
  meId: string;
  connectionId: string;
  recipientId: string;
  sentiment: string;
  referenceBody: string;
  entityId: string;
}) {
  const rawSyncId = params.entityId.trim();
  const resolvedLegacyCandidate = await resolveLegacySyncId({
    supabase: params.supabase,
    connectionId: params.connectionId,
    entityType: "sync",
    entityId: rawSyncId,
  });

  const primarySyncId = rawSyncId || resolvedLegacyCandidate || "";
  const eligibilitySyncId = primarySyncId;
  const eligibility = await ensureSyncReferenceEligibility({
    supabase: params.supabase,
    connectionId: params.connectionId,
    meId: params.meId,
    recipientId: params.recipientId,
    syncId: eligibilitySyncId,
  });
  if (!eligibility.ok) {
    return { ok: false as const, status: 400, error: eligibility.error };
  }

  const v2 = await params.supabase.rpc("create_reference_v2", {
    p_connection_id: params.connectionId,
    p_entity_type: "sync",
    p_entity_id: primarySyncId,
    p_recipient_id: params.recipientId,
    p_sentiment: params.sentiment,
    p_body: params.referenceBody,
  });
  if (!v2.error) {
    return { ok: true as const, referenceId: (v2.data as string) ?? "", mode: "v2_sync" };
  }

  const v2Message = v2.error.message ?? "";
  if (!isReferenceCompatWriteError(v2Message)) {
    return { ok: false as const, status: 400, error: v2Message };
  }

  const legacySyncId = await ensureLegacySyncRowForCompat({
    supabase: params.supabase,
    syncId: resolvedLegacyCandidate || rawSyncId,
    connectionId: params.connectionId,
    meId: params.meId,
  });

  const compatSync = await insertReferenceCompat({
    supabase: params.supabase,
    meId: params.meId,
    connectionId: params.connectionId,
    recipientId: params.recipientId,
    sentiment: params.sentiment,
    referenceBody: params.referenceBody,
    entityType: "sync",
    entityId: primarySyncId,
    syncId: primarySyncId,
    legacySyncId,
  });
  if (!compatSync.ok) {
    return {
      ok: false as const,
      status: 400,
      error: `compat_sync_insert_failed: ${compatSync.error} (sync_candidate=${primarySyncId || "null"} legacy_sync_candidate=${legacySyncId || "null"} entity_id=${primarySyncId || "null"})`,
    };
  }

  return { ok: true as const, referenceId: compatSync.referenceId, mode: "compat_sync_insert" };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const connectionIdInput = typeof body?.connectionId === "string" ? body.connectionId : "";
    const recipientId = typeof body?.recipientId === "string" ? body.recipientId : "";
    const sentiment = typeof body?.sentiment === "string" ? body.sentiment : "";
    const referenceBody = typeof body?.body === "string" ? body.body : "";
    const entityTypeRaw =
      typeof body?.entityType === "string"
        ? body.entityType
        : typeof body?.context === "string"
          ? body.context
          : "connection";
    const entityType = normalizeEntityType(entityTypeRaw);
    const entityId =
      typeof body?.entityId === "string" && body.entityId.trim().length > 0 ? body.entityId.trim() : connectionIdInput;

    if (!recipientId || !sentiment || !referenceBody.trim()) {
      return NextResponse.json(
        { ok: false, error: "recipientId, sentiment, and body are required." },
        { status: 400 }
      );
    }

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    let connectionId = connectionIdInput.trim();

    if (!connectionId && entityType === "sync" && entityId) {
      const syncRes = await supabase
        .from("connection_syncs")
        .select("connection_id")
        .eq("id", entityId)
        .maybeSingle();
      connectionId = typeof syncRes.data?.connection_id === "string" ? syncRes.data.connection_id : "";
    }

    if (!connectionId) {
      const connectionRes = await supabase
        .from("connections")
        .select("id")
        .eq("status", "accepted")
        .is("blocked_by", null)
        .or(
          `and(requester_id.eq.${authData.user.id},target_id.eq.${recipientId}),and(requester_id.eq.${recipientId},target_id.eq.${authData.user.id})`
        )
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      connectionId = typeof connectionRes.data?.id === "string" ? connectionRes.data.id : "";
    }

    if (!connectionId) {
      return NextResponse.json(
        { ok: false, error: "No eligible accepted connection found for this reference." },
        { status: 400 }
      );
    }

    if (entityType === "sync") {
      const syncResult = await createSyncReferenceWithFallback({
        supabase,
        meId: authData.user.id,
        connectionId,
        recipientId,
        sentiment,
        referenceBody,
        entityId,
      });
      if (!syncResult.ok) {
        return NextResponse.json({ ok: false, error: syncResult.error }, { status: syncResult.status });
      }

      await ensureReferenceReceivedNotification({
        actorId: authData.user.id,
        recipientId,
        referenceId: syncResult.referenceId,
        entityType: "sync",
        entityId,
      });

      return NextResponse.json({
        ok: true,
        reference_id: syncResult.referenceId,
        mode: syncResult.mode,
      });
    }

    const v2 = await supabase.rpc("create_reference_v2", {
      p_connection_id: connectionId,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_recipient_id: recipientId,
      p_sentiment: sentiment,
      p_body: referenceBody,
    });
    if (!v2.error) {
      const referenceId = typeof v2.data === "string" ? v2.data : "";
      await ensureReferenceReceivedNotification({
        actorId: authData.user.id,
        recipientId,
        referenceId,
        entityType,
        entityId,
      });
      return NextResponse.json({ ok: true, reference_id: v2.data ?? null, mode: "v2" });
    }

    const legacy = await supabase.rpc("create_reference", {
      p_connection_id: connectionId,
      p_recipient_id: recipientId,
      p_sentiment: sentiment,
      p_body: referenceBody,
      p_context: typeof body?.context === "string" ? body.context : entityType,
    });
    if (!legacy.error) {
      const referenceId = typeof legacy.data === "string" ? legacy.data : "";
      await ensureReferenceReceivedNotification({
        actorId: authData.user.id,
        recipientId,
        referenceId,
        entityType,
        entityId,
      });
      return NextResponse.json({ ok: true, reference_id: legacy.data ?? null, mode: "legacy" });
    }

    const v2Message = v2.error.message ?? "";
    const legacyMessage = legacy.error.message ?? "";
    if (!isReferenceCompatWriteError(v2Message) && !isReferenceCompatWriteError(legacyMessage)) {
      return NextResponse.json({ ok: false, error: legacyMessage || v2Message }, { status: 400 });
    }

    const compat = await insertReferenceCompat({
      supabase,
      meId: authData.user.id,
      connectionId,
      recipientId,
      sentiment,
      referenceBody,
      entityType,
      entityId,
      syncId: "",
    });
    if (!compat.ok) {
      return NextResponse.json({ ok: false, error: `compat_insert_failed: ${compat.error}` }, { status: 400 });
    }

    await ensureReferenceReceivedNotification({
      actorId: authData.user.id,
      recipientId,
      referenceId: compat.referenceId,
      entityType,
      entityId,
    });

    return NextResponse.json({ ok: true, reference_id: compat.referenceId, mode: "compat_insert" });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const mode = typeof body?.mode === "string" ? body.mode : "";
    const referenceId = typeof body?.referenceId === "string" ? body.referenceId : "";
    if (!mode || !referenceId) {
      return NextResponse.json({ ok: false, error: "mode and referenceId are required." }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    if (mode === "edit") {
      const sentiment = typeof body?.sentiment === "string" ? body.sentiment : "";
      const text = typeof body?.body === "string" ? body.body : "";
      if (!sentiment || !text.trim()) {
        return NextResponse.json({ ok: false, error: "sentiment and body are required for edit." }, { status: 400 });
      }

      const updated = await supabase.rpc("update_reference_author", {
        p_reference_id: referenceId,
        p_sentiment: sentiment,
        p_body: text,
      });
      if (!updated.error) {
        return NextResponse.json({ ok: true, reference_id: updated.data ?? referenceId, mode: "rpc_edit" });
      }

      if (!isReferenceCompatWriteError(updated.error.message)) {
        return NextResponse.json({ ok: false, error: updated.error.message }, { status: 400 });
      }

      const rowRes = await supabase.from("references").select("*").eq("id", referenceId).maybeSingle();
      if (rowRes.error || !rowRes.data) {
        return NextResponse.json({ ok: false, error: rowRes.error?.message ?? "reference_not_found" }, { status: 400 });
      }

      const row = rowRes.data as Record<string, unknown>;
      const authorId = pickFirstString(row, ["author_id", "from_user_id", "source_id"]);
      const createdAt = pickFirstString(row, ["created_at", "createdAt"]);
      const editCount = pickFirstNumber(row, ["edit_count", "editCount"]);
      const lastEditedAt = pickFirstNullableText(row, ["last_edited_at", "lastEditedAt"]);
      if (authorId !== authData.user.id) {
        return NextResponse.json({ ok: false, error: "reference_update_not_allowed" }, { status: 403 });
      }
      if (!within15Days(createdAt || null)) {
        return NextResponse.json({ ok: false, error: "reference_update_not_allowed" }, { status: 400 });
      }
      if (editCount >= 1 || (typeof lastEditedAt === "string" && lastEditedAt.trim().length > 0)) {
        return NextResponse.json({ ok: false, error: "reference_update_not_allowed" }, { status: 400 });
      }

      const columns = await getReferenceColumns(supabase);
      const rowColumns = new Set(Object.keys(row));
      const hasColumn = (name: string) => rowColumns.has(name) || Boolean(columns?.has(name));
      const clean = text.trim();
      const nowIso = new Date().toISOString();

      const payload: Record<string, unknown> = {};
      if (hasColumn("body")) payload.body = clean;
      if (hasColumn("content")) payload.content = clean;
      if (hasColumn("feedback")) payload.feedback = clean;
      if (hasColumn("comment")) payload.comment = clean;
      if (hasColumn("reference_text")) payload.reference_text = clean;

      if (hasColumn("sentiment")) payload.sentiment = sentiment;
      if (hasColumn("rating")) payload.rating = mapSentimentToRating(sentiment);
      if (hasColumn("edit_count")) payload.edit_count = editCount + 1;
      if (hasColumn("last_edited_at")) payload.last_edited_at = nowIso;
      if (hasColumn("updated_at")) payload.updated_at = nowIso;

      if (!("body" in payload || "content" in payload || "feedback" in payload || "comment" in payload || "reference_text" in payload)) {
        payload.body = clean;
      }

      const authorColumns = ["author_id", "from_user_id", "source_id"];
      let lastError = "reference_update_not_allowed";
      for (const authorColumn of authorColumns) {
        const fallbackUpdate = await supabase
          .from("references")
          .update(payload)
          .eq("id", referenceId)
          .eq(authorColumn, authData.user.id)
          .select("id")
          .single();
        if (!fallbackUpdate.error) {
          return NextResponse.json({ ok: true, reference_id: fallbackUpdate.data.id ?? referenceId, mode: "compat_edit" });
        }
        lastError = fallbackUpdate.error.message;
        if (!isMissingSchemaError(lastError) && !isReferenceCompatWriteError(lastError)) {
          break;
        }
      }

      return NextResponse.json({ ok: false, error: lastError }, { status: 400 });
    }

    if (mode === "reply") {
      const replyText = typeof body?.replyText === "string" ? body.replyText : "";
      if (!replyText.trim()) {
        return NextResponse.json({ ok: false, error: "replyText is required for reply." }, { status: 400 });
      }

      const replied = await supabase.rpc("reply_reference_receiver", {
        p_reference_id: referenceId,
        p_reply_text: replyText,
      });
      if (!replied.error) {
        return NextResponse.json({ ok: true, reference_id: replied.data ?? referenceId, mode: "rpc_reply" });
      }

      if (!isReferenceCompatWriteError(replied.error.message)) {
        return NextResponse.json({ ok: false, error: replied.error.message }, { status: 400 });
      }

      const rowRes = await supabase.from("references").select("*").eq("id", referenceId).maybeSingle();
      if (rowRes.error || !rowRes.data) {
        return NextResponse.json({ ok: false, error: rowRes.error?.message ?? "reference_not_found" }, { status: 400 });
      }

      const row = rowRes.data as Record<string, unknown>;
      const recipientId = pickFirstString(row, ["recipient_id", "to_user_id", "target_id"]);
      const createdAt = pickFirstString(row, ["created_at", "createdAt"]);
      const existingReply = pickFirstNullableText(row, ["reply_text", "reply", "response_text", "reply_body"]);
      if (recipientId !== authData.user.id) {
        return NextResponse.json({ ok: false, error: "reference_reply_not_allowed" }, { status: 403 });
      }
      if (!within15Days(createdAt || null)) {
        return NextResponse.json({ ok: false, error: "reference_reply_not_allowed" }, { status: 400 });
      }
      if (typeof existingReply === "string" && existingReply.trim().length > 0) {
        return NextResponse.json({ ok: false, error: "reference_reply_not_allowed" }, { status: 400 });
      }

      const columns = await getReferenceColumns(supabase);
      const rowColumns = new Set(Object.keys(row));
      const hasColumn = (name: string) => rowColumns.has(name) || Boolean(columns?.has(name));
      const cleanReply = replyText.trim();
      const nowIso = new Date().toISOString();

      const payload: Record<string, unknown> = {};
      if (hasColumn("reply_text")) payload.reply_text = cleanReply;
      if (hasColumn("reply")) payload.reply = cleanReply;
      if (hasColumn("response_text")) payload.response_text = cleanReply;
      if (hasColumn("reply_body")) payload.reply_body = cleanReply;
      if (hasColumn("replied_by")) payload.replied_by = authData.user.id;
      if (hasColumn("responder_id")) payload.responder_id = authData.user.id;
      if (hasColumn("replied_at")) payload.replied_at = nowIso;
      if (hasColumn("reply_at")) payload.reply_at = nowIso;
      if (hasColumn("updated_at")) payload.updated_at = nowIso;

      if (!("reply_text" in payload || "reply" in payload || "response_text" in payload || "reply_body" in payload)) {
        payload.reply_text = cleanReply;
      }

      const recipientColumns = ["recipient_id", "to_user_id", "target_id"];
      let lastError = "reference_reply_not_allowed";
      for (const recipientColumn of recipientColumns) {
        const fallbackReply = await supabase
          .from("references")
          .update(payload)
          .eq("id", referenceId)
          .eq(recipientColumn, authData.user.id)
          .select("id")
          .single();
        if (!fallbackReply.error) {
          return NextResponse.json({
            ok: true,
            reference_id: fallbackReply.data.id ?? referenceId,
            mode: "compat_reply",
          });
        }
        lastError = fallbackReply.error.message;
        if (!isMissingSchemaError(lastError) && !isReferenceCompatWriteError(lastError)) {
          break;
        }
      }

      return NextResponse.json({ ok: false, error: lastError }, { status: 400 });
    }

    return NextResponse.json({ ok: false, error: "Unsupported mode." }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
