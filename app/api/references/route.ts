import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";
import { dispatchReferencePromptEmails } from "@/lib/email/reference-prompts";
import {
  normalizeReferenceContextTag,
  type ReferenceContextTag,
} from "@/lib/activities/types";

type UnsafeSupabaseClient = SupabaseClient;
type SupabaseUserClient = UnsafeSupabaseClient;
type SupabaseAdminClient = UnsafeSupabaseClient;

const REFERENCE_COLUMNS_CACHE_TTL_MS = 60_000;
let cachedReferenceColumns:
  | {
      expiresAt: number;
      columns: Set<string>;
    }
  | null = null;

const REFERENCE_REPLY_MAX_CHARS = 300;

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

type ReferenceEntityType = "connection" | "sync" | "trip" | "event";

function normalizeContextTag(value: string): ReferenceContextTag {
  return normalizeReferenceContextTag(value);
}

function normalizeReferenceEntityType(value: string): ReferenceEntityType {
  const key = normalizeReferenceContextTag(value);
  if (key === "practice" || key === "private_class" || key === "group_class" || key === "workshop") return "sync";
  if (key === "travel_together" || key === "hosting" || key === "stay_as_guest") return "trip";
  if (key === "event" || key === "festival" || key === "social_dance" || key === "competition") return "event";
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

function pickRowId(row: unknown) {
  if (!row || typeof row !== "object") return "";
  const value = (row as { id?: unknown }).id;
  return typeof value === "string" ? value : "";
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
    linkUrl: `/profile/${params.recipientId}`,
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
  const notificationsTable = admin.from("notifications" as never) as unknown as {
    insert: (values: Record<string, unknown>) => Promise<{ error: { message: string; code?: string } | null }>;
  };

  for (const candidate of payloadCandidates) {
    const payload = { ...candidate };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const insertRes = await notificationsTable.insert(payload);
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
    contextTag: string;
    sentiment: string;
    rating?: number | null;
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
  if (key === "text") return params.referenceBody.trim();
  if (key === "context") return params.contextTag || params.entityType || "connection";
  if (key === "context_tag") return params.contextTag || params.entityType || "collaboration";
  if (key === "entity_type") return params.entityType || "connection";
  if (key === "entity_id") return params.entityId;
  if (key === "sentiment") return params.sentiment;
  if (key === "rating") return params.rating ?? mapSentimentToRating(params.sentiment);
  if (key === "created_at") return new Date().toISOString();
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
    rating?: number | null;
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
  if (key === "text" && "text" in payload) {
    delete payload.text;
    payload.body = params.referenceBody.trim();
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
  if (key === "context_tag" && "context_tag" in payload) {
    delete payload.context_tag;
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
  contextTag: string;
  sentiment: string;
  rating?: number | null;
  referenceBody: string;
  entityType: string;
  entityId: string;
  syncId: string;
}) {
  const payload: Record<string, unknown> = {};
  const cleanBody = params.referenceBody.trim();
  const context = params.contextTag || params.entityType || "connection";
  const syncValue = params.entityType === "sync" ? params.syncId || params.entityId || "" : params.syncId || "";
  const columns = params.columns;

  // If we can inspect schema, fill every compatible synonym that exists.
  if (columns) {
    if (params.connectionId && columns.has("connection_id")) payload.connection_id = params.connectionId;
    if (params.connectionId && columns.has("connection_request_id")) payload.connection_request_id = params.connectionId;

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
    if (columns.has("text")) payload.text = cleanBody;

    if (columns.has("context")) payload.context = context;
    if (columns.has("context_tag")) payload.context_tag = context;
    if (columns.has("entity_type")) payload.entity_type = params.entityType;
    if (columns.has("entity_id")) payload.entity_id = params.entityId;

    if (columns.has("sentiment")) payload.sentiment = params.sentiment;
    if (columns.has("rating")) payload.rating = params.rating ?? mapSentimentToRating(params.sentiment);

    if (columns.has("sync_id") && syncValue) payload.sync_id = syncValue;
  } else {
    // Unknown schema fallback: use modern first.
    if (params.connectionId) payload.connection_id = params.connectionId;
    payload.author_id = params.meId;
    payload.recipient_id = params.recipientId;
    payload.context = context;
    payload.context_tag = params.contextTag || context;
    payload.entity_type = params.entityType;
    payload.entity_id = params.entityId;
    payload.sentiment = params.sentiment;
    payload.body = cleanBody;
    payload.text = cleanBody;
    if (syncValue) payload.sync_id = syncValue;
  }

  const hasAnyBody =
    "body" in payload ||
    "content" in payload ||
    "feedback" in payload ||
    "comment" in payload ||
    "reference_text" in payload ||
    "text" in payload;
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
  contextTag: string;
  sentiment: string;
  rating?: number | null;
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
    contextTag: params.contextTag,
    sentiment: params.sentiment,
    rating: params.rating,
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
  const referencesTable = params.supabase.from("references" as never) as unknown as {
    insert: (values: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{ error: { message: string; code?: string } | null; data: { id: string } }>;
      };
    };
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const inserted = await referencesTable.insert(payload).select("id").single();
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
      rating: params.rating,
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
      contextTag: params.contextTag,
      sentiment: params.sentiment,
      rating: params.rating,
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

function applyReferenceRequestCompletionMatch<T extends {
  eq: (column: string, value: unknown) => T;
}>(query: T, params: {
  meId: string;
  recipientId: string;
  contextTag: string;
}) {
  const next = query
    .eq("user_id", params.meId)
    .eq("peer_user_id", params.recipientId)
    .eq("context_tag", params.contextTag)
    .eq("status", "pending");

  return next;
}

async function resolveAcceptedConnectionId(params: {
  supabase: SupabaseUserClient;
  meId: string;
  recipientId: string;
  requestedConnectionId?: string;
}) {
  const requested = (params.requestedConnectionId ?? "").trim();
  if (requested) {
    const byId = await params.supabase
      .from("connections")
      .select("id,status,requester_id,target_id,blocked_by")
      .eq("id", requested)
      .maybeSingle();
    if (!byId.error && byId.data) {
      const row = byId.data as {
        id?: string;
        status?: string;
        requester_id?: string;
        target_id?: string;
        blocked_by?: string | null;
      };
      const pairOk =
        (row.requester_id === params.meId && row.target_id === params.recipientId) ||
        (row.requester_id === params.recipientId && row.target_id === params.meId);
      if (pairOk && row.status === "accepted" && !row.blocked_by && row.id) {
        return row.id;
      }
    }
  }

  const connectionRes = await params.supabase
    .from("connections")
    .select("id")
    .eq("status", "accepted")
    .is("blocked_by", null)
    .or(
      `and(requester_id.eq.${params.meId},target_id.eq.${params.recipientId}),and(requester_id.eq.${params.recipientId},target_id.eq.${params.meId})`
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (connectionRes.error) return "";
  return pickRowId(connectionRes.data);
}

async function hasCompletedPracticeInteraction(params: {
  supabase: SupabaseUserClient;
  meId: string;
  recipientId: string;
}) {
  const syncRes = await params.supabase
    .from("connection_syncs")
    .select("id")
    .eq("status", "completed")
    .or(
      `and(requester_id.eq.${params.meId},recipient_id.eq.${params.recipientId}),and(requester_id.eq.${params.recipientId},recipient_id.eq.${params.meId})`
    )
    .limit(1)
    .maybeSingle();
  if (!syncRes.error) {
    return Boolean(pickRowId(syncRes.data));
  }
  if (!isMissingSchemaError(syncRes.error.message)) {
    return false;
  }

  const legacyRes = await params.supabase
    .from("syncs")
    .select("id,completed_by")
    .eq("completed_by", params.meId)
    .limit(1);
  if (legacyRes.error) return false;
  return Array.isArray(legacyRes.data) && legacyRes.data.length > 0;
}

async function hasEligibleCompletedSync(params: {
  supabase: SupabaseUserClient;
  meId: string;
  recipientId: string;
  connectionId: string;
  syncId: string;
}) {
  const syncRes = await params.supabase
    .from("connection_syncs")
    .select("id")
    .eq("id", params.syncId)
    .eq("connection_id", params.connectionId)
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .gte("completed_at", new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString())
    .or(
      `and(requester_id.eq.${params.meId},recipient_id.eq.${params.recipientId}),and(requester_id.eq.${params.recipientId},recipient_id.eq.${params.meId})`
    )
    .maybeSingle();
  if (!syncRes.error) {
    return Boolean(pickRowId(syncRes.data));
  }
  if (!isMissingSchemaError(syncRes.error.message)) {
    return false;
  }

  const legacyRes = await params.supabase
    .from("syncs")
    .select("id,connection_id,completed_by,completed_at")
    .eq("id", params.syncId)
    .eq("connection_id", params.connectionId)
    .eq("completed_by", params.meId)
    .not("completed_at", "is", null)
    .gte("completed_at", new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString())
    .maybeSingle();
  if (legacyRes.error) return false;
  return Boolean(pickRowId(legacyRes.data));
}

async function findExistingReferenceForEntity(params: {
  supabase: SupabaseUserClient;
  meId: string;
  entityType: ReferenceEntityType;
  entityId: string;
}) {
  const columns = await getReferenceColumns(params.supabase);
  const authorColumns = ["author_id", "from_user_id", "source_id"];
  const entityColumns = params.entityType === "sync" ? ["entity_id", "sync_id"] : ["entity_id"];
  const clients = [getSupabaseAdminClient(), params.supabase].filter(Boolean) as Array<SupabaseAdminClient | SupabaseUserClient>;

  for (const client of clients) {
    const direct = await client
      .from("references")
      .select("id")
      .eq("author_id", params.meId)
      .or(
        params.entityType === "sync"
          ? `entity_id.eq.${params.entityId},sync_id.eq.${params.entityId}`
          : `entity_id.eq.${params.entityId}`
      )
      .limit(1)
      .maybeSingle();

    const directId = pickRowId(direct.data);
    if (!direct.error && directId) {
      return directId;
    }
  }

  for (const client of clients) {
    for (const authorColumn of authorColumns) {
      if (columns && !columns.has(authorColumn)) continue;

      for (const entityColumn of entityColumns) {
        if (columns && !columns.has(entityColumn)) continue;

        const existing = await client
          .from("references")
          .select("id")
          .eq(authorColumn, params.meId)
          .eq(entityColumn, params.entityId)
          .limit(1)
          .maybeSingle();

        const existingId = pickRowId(existing.data);
        if (!existing.error && existingId) {
          return existingId;
        }
        if (existing.error && !isMissingSchemaError(existing.error.message)) {
          break;
        }
      }
    }
  }

  return "";
}

async function findExistingReferenceForPairContext(params: {
  supabase: SupabaseUserClient;
  meId: string;
  recipientId: string;
  contextTag: string;
}) {
  const columns = await getReferenceColumns(params.supabase);
  const authorColumns = ["author_id", "from_user_id", "source_id"];
  const recipientColumns = ["recipient_id", "to_user_id", "target_id"];
  const contextColumns = ["context_tag", "context", "entity_type"];
  const clients = [getSupabaseAdminClient(), params.supabase].filter(Boolean) as Array<SupabaseAdminClient | SupabaseUserClient>;

  for (const client of clients) {
    const direct = await client
      .from("references")
      .select("id")
      .eq("author_id", params.meId)
      .eq("recipient_id", params.recipientId)
      .eq("context_tag", params.contextTag)
      .limit(1)
      .maybeSingle();

    const directId = pickRowId(direct.data);
    if (!direct.error && directId) {
      return directId;
    }
  }

  for (const client of clients) {
    for (const authorColumn of authorColumns) {
      if (columns && !columns.has(authorColumn)) continue;
      for (const recipientColumn of recipientColumns) {
        if (columns && !columns.has(recipientColumn)) continue;
        for (const contextColumn of contextColumns) {
          if (columns && !columns.has(contextColumn)) continue;

          const existing = await client
            .from("references")
            .select("id")
            .eq(authorColumn, params.meId)
            .eq(recipientColumn, params.recipientId)
            .eq(contextColumn, params.contextTag)
            .limit(1)
            .maybeSingle();

          const existingId = pickRowId(existing.data);
          if (!existing.error && existingId) {
            return existingId;
          }
          if (existing.error && !isMissingSchemaError(existing.error.message)) {
            break;
          }
        }
      }
    }
  }

  return "";
}

async function hasCompletedTripInteraction(params: {
  supabase: SupabaseUserClient;
  meId: string;
  recipientId: string;
}) {
  const reqRes = await params.supabase
    .from("trip_requests")
    .select("id,trip_id,requester_id,status")
    .eq("status", "accepted")
    .in("requester_id", [params.meId, params.recipientId])
    .limit(1500);
  if (reqRes.error) return false;
  const rows = (reqRes.data ?? []) as Array<{ trip_id?: string; requester_id?: string }>;
  const tripIds = Array.from(new Set(rows.map((row) => (typeof row.trip_id === "string" ? row.trip_id : "")).filter(Boolean)));
  if (tripIds.length === 0) return false;

  const todayIso = new Date().toISOString().slice(0, 10);
  const tripsRes = await params.supabase
    .from("trips")
    .select("id,user_id,end_date")
    .in("id", tripIds)
    .lt("end_date", todayIso)
    .limit(1500);
  if (tripsRes.error) return false;

  const tripsById = new Map(
    ((tripsRes.data ?? []) as Array<{ id?: string; user_id?: string }>).map((row) => [
      typeof row.id === "string" ? row.id : "",
      typeof row.user_id === "string" ? row.user_id : "",
    ])
  );

  return rows.some((row) => {
    const tripId = typeof row.trip_id === "string" ? row.trip_id : "";
    const requesterId = typeof row.requester_id === "string" ? row.requester_id : "";
    const ownerId = tripsById.get(tripId) ?? "";
    return (
      (requesterId === params.meId && ownerId === params.recipientId) ||
      (requesterId === params.recipientId && ownerId === params.meId)
    );
  });
}

async function getCompletedHostingRole(params: {
  supabase: SupabaseUserClient;
  meId: string;
  recipientId: string;
}): Promise<"host" | "guest" | null> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const rowsRes = await params.supabase
    .from("hosting_requests")
    .select("id,sender_user_id,recipient_user_id,request_type,status,departure_date")
    .eq("status", "accepted")
    .lt("departure_date", todayIso)
    .or(
      `and(sender_user_id.eq.${params.meId},recipient_user_id.eq.${params.recipientId}),and(sender_user_id.eq.${params.recipientId},recipient_user_id.eq.${params.meId})`
    )
    .limit(600);
  if (rowsRes.error) return null;

  const rows = (rowsRes.data ?? []) as Array<{
    sender_user_id?: string;
    recipient_user_id?: string;
    request_type?: string;
  }>;
  for (const row of rows) {
    const senderId = typeof row.sender_user_id === "string" ? row.sender_user_id : "";
    const recipientId = typeof row.recipient_user_id === "string" ? row.recipient_user_id : "";
    const requestType = typeof row.request_type === "string" ? row.request_type : "";
    if (!senderId || !recipientId) continue;

    if (requestType === "request_hosting") {
      if (recipientId === params.meId && senderId === params.recipientId) return "host";
      if (senderId === params.meId && recipientId === params.recipientId) return "guest";
    } else if (requestType === "offer_to_host") {
      if (senderId === params.meId && recipientId === params.recipientId) return "host";
      if (recipientId === params.meId && senderId === params.recipientId) return "guest";
    }
  }
  return null;
}

async function getCompletedEventContext(params: {
  supabase: SupabaseUserClient;
  meId: string;
  recipientId: string;
}): Promise<{ attended: boolean; festival: boolean }> {
  const memberStatuses = ["host", "going", "waitlist"];
  const [mineRes, peerRes] = await Promise.all([
    params.supabase
      .from("event_members")
      .select("event_id,status")
      .eq("user_id", params.meId)
      .in("status", memberStatuses)
      .limit(1500),
    params.supabase
      .from("event_members")
      .select("event_id,status")
      .eq("user_id", params.recipientId)
      .in("status", memberStatuses)
      .limit(1500),
  ]);
  if (mineRes.error || peerRes.error) {
    return { attended: false, festival: false };
  }

  const mineEventIds = new Set(
    ((mineRes.data ?? []) as Array<{ event_id?: string }>)
      .map((row) => (typeof row.event_id === "string" ? row.event_id : ""))
      .filter(Boolean)
  );
  const sharedEventIds = ((peerRes.data ?? []) as Array<{ event_id?: string }>)
    .map((row) => (typeof row.event_id === "string" ? row.event_id : ""))
    .filter((eventId) => mineEventIds.has(eventId));
  if (!sharedEventIds.length) {
    return { attended: false, festival: false };
  }

  const nowIso = new Date().toISOString();
  const eventsRes = await params.supabase
    .from("events")
    .select("id,title,ends_at")
    .in("id", sharedEventIds)
    .lt("ends_at", nowIso)
    .limit(600);
  if (eventsRes.error) {
    return { attended: false, festival: false };
  }

  const endedEvents = (eventsRes.data ?? []) as Array<{ title?: string | null }>;
  if (!endedEvents.length) {
    return { attended: false, festival: false };
  }
  const festival = endedEvents.some((event) => {
    const title = typeof event.title === "string" ? event.title.toLowerCase() : "";
    return title.includes("festival") || title.includes("congress");
  });
  return { attended: true, festival };
}

async function ensureReferenceContextEligibility(params: {
  supabase: SupabaseUserClient;
  meId: string;
  recipientId: string;
  contextTag: ReferenceContextTag;
  hasAcceptedConnection: boolean;
}) {
  if (params.contextTag === "collaboration" || params.contextTag === "content_video") {
    return params.hasAcceptedConnection;
  }

  if (
    params.contextTag === "practice" ||
    params.contextTag === "private_class" ||
    params.contextTag === "group_class" ||
    params.contextTag === "workshop"
  ) {
    if (params.hasAcceptedConnection) return true;
    return hasCompletedPracticeInteraction({
      supabase: params.supabase,
      meId: params.meId,
      recipientId: params.recipientId,
    });
  }

  if (params.contextTag === "travel_together") {
    return hasCompletedTripInteraction({
      supabase: params.supabase,
      meId: params.meId,
      recipientId: params.recipientId,
    });
  }

  if (params.contextTag === "hosting" || params.contextTag === "stay_as_guest") {
    const role = await getCompletedHostingRole({
      supabase: params.supabase,
      meId: params.meId,
      recipientId: params.recipientId,
    });
    return (
      (params.contextTag === "hosting" && role === "host") ||
      (params.contextTag === "stay_as_guest" && role === "guest")
    );
  }

  if (
    params.contextTag === "event" ||
    params.contextTag === "festival" ||
    params.contextTag === "social_dance" ||
    params.contextTag === "competition"
  ) {
    const result = await getCompletedEventContext({
      supabase: params.supabase,
      meId: params.meId,
      recipientId: params.recipientId,
    });
    if (!result.attended) return false;
    if (params.contextTag === "festival") return result.festival;
    return true;
  }

  return false;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const connectionIdInput = typeof body?.connectionId === "string" ? body.connectionId : "";
    const recipientId = typeof body?.recipientId === "string" ? body.recipientId : "";
    const entityTypeRaw =
      typeof body?.contextTag === "string"
        ? body.contextTag
        : typeof body?.context_tag === "string"
          ? body.context_tag
          : typeof body?.entityType === "string"
            ? body.entityType
            : typeof body?.context === "string"
              ? body.context
              : "collaboration";
    const contextTag = normalizeContextTag(entityTypeRaw);
    const referenceEntityType = normalizeReferenceEntityType(entityTypeRaw);
    const referenceBody =
      typeof body?.text === "string"
        ? body.text
        : typeof body?.body === "string"
          ? body.body
          : "";

    const ratingRaw = body && typeof body === "object" ? (body as Record<string, unknown>).rating : null;
    const parsedRating =
      typeof ratingRaw === "number" && Number.isFinite(ratingRaw)
        ? Math.round(ratingRaw)
        : typeof ratingRaw === "string" && ratingRaw.trim()
          ? Math.round(Number(ratingRaw))
          : null;
    const rating = parsedRating && parsedRating >= 1 && parsedRating <= 5 ? parsedRating : null;

    const sentimentRaw = typeof body?.sentiment === "string" ? body.sentiment.toLowerCase().trim() : "";
    const sentiment =
      sentimentRaw === "positive" || sentimentRaw === "neutral" || sentimentRaw === "negative"
        ? sentimentRaw
        : rating !== null
          ? rating >= 4
            ? "positive"
            : rating <= 2
              ? "negative"
              : "neutral"
          : "neutral";

    const entityIdInput =
      typeof body?.entityId === "string" && body.entityId.trim().length > 0 ? body.entityId.trim() : "";
    const referenceRequestIdInput =
      typeof body?.referenceRequestId === "string" && body.referenceRequestId.trim().length > 0
        ? body.referenceRequestId.trim()
        : "";

    if (!recipientId || !referenceBody.trim()) {
      return NextResponse.json(
        { ok: false, error: "recipientId and text are required." },
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

    const acceptedConnectionId = await resolveAcceptedConnectionId({
      supabase,
      meId: authData.user.id,
      recipientId,
      requestedConnectionId: connectionIdInput,
    });

    const eligible = await ensureReferenceContextEligibility({
      supabase,
      meId: authData.user.id,
      recipientId,
      contextTag,
      hasAcceptedConnection: Boolean(acceptedConnectionId),
    });
    if (!eligible) {
      return NextResponse.json(
        { ok: false, error: "Reference not allowed for this context yet. Complete the related interaction first." },
        { status: 400 }
      );
    }

    // Keep compatibility with legacy schemas requiring connection_id.
    let anyConnectionId = acceptedConnectionId;
    if (!anyConnectionId) {
      const anyConnectionRes = await supabase
        .from("connections")
        .select("id")
        .or(
          `and(requester_id.eq.${authData.user.id},target_id.eq.${recipientId}),and(requester_id.eq.${recipientId},target_id.eq.${authData.user.id})`
        )
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!anyConnectionRes.error) {
        anyConnectionId = pickRowId(anyConnectionRes.data);
      }
    }

    const entityId = entityIdInput || acceptedConnectionId || anyConnectionId || `${contextTag}:${Date.now()}`;

    if (referenceEntityType === "sync") {
      if (!acceptedConnectionId || !entityIdInput) {
        return NextResponse.json({ ok: false, error: "sync_reference_not_allowed" }, { status: 400 });
      }

      const exactSyncEligible = await hasEligibleCompletedSync({
        supabase,
        meId: authData.user.id,
        recipientId,
        connectionId: acceptedConnectionId,
        syncId: entityIdInput,
      });
      if (!exactSyncEligible) {
        return NextResponse.json({ ok: false, error: "sync_reference_not_allowed" }, { status: 400 });
      }
    }

    if (referenceEntityType === "connection") {
      return NextResponse.json(
        { ok: false, error: "Connection acceptance unlocks chat but does not create references." },
        { status: 400 }
      );
    }

    const duplicateReferenceId = await findExistingReferenceForPairContext({
      supabase,
      meId: authData.user.id,
      recipientId,
      contextTag,
    });
    if (duplicateReferenceId) {
      return NextResponse.json({ ok: false, error: "duplicate_reference_not_allowed" }, { status: 400 });
    }

    if (entityIdInput || referenceEntityType === "sync") {
      const duplicateReferenceIdForEntity = await findExistingReferenceForEntity({
        supabase,
        meId: authData.user.id,
        entityType: referenceEntityType,
        entityId: entityIdInput || acceptedConnectionId || anyConnectionId,
      });
      if (duplicateReferenceIdForEntity) {
        return NextResponse.json({ ok: false, error: "duplicate_reference_not_allowed" }, { status: 400 });
      }
    }

    if (acceptedConnectionId) {
      const created = await supabase.rpc("create_reference_v2", {
        p_connection_id: acceptedConnectionId,
        p_entity_type: referenceEntityType,
        p_entity_id: entityIdInput || acceptedConnectionId,
        p_recipient_id: recipientId,
        p_sentiment: sentiment,
        p_body: referenceBody,
      });

      if (!created.error) {
        const referenceId = typeof created.data === "string" && created.data ? created.data : entityId;

        const contextTagSync = await supabase
          .from("references")
          .update({ context_tag: contextTag })
          .eq("id", referenceId);
        if (contextTagSync.error && !isMissingSchemaError(contextTagSync.error.message)) {
          throw contextTagSync.error;
        }

        await ensureReferenceReceivedNotification({
          actorId: authData.user.id,
          recipientId,
          referenceId,
          entityType: referenceEntityType,
          entityId: entityIdInput || acceptedConnectionId,
        });

        await sendAppEmailBestEffort({
          kind: "reference_received",
          recipientUserId: recipientId,
          actorUserId: authData.user.id,
          referenceId,
        });

        if (referenceRequestIdInput) {
          const markByIdRes = await applyReferenceRequestCompletionMatch(
            supabase.from("reference_requests").update({
              status: "completed",
              completed_reference_id: referenceId,
              updated_at: new Date().toISOString(),
            }).eq("id", referenceRequestIdInput),
            {
              meId: authData.user.id,
              recipientId,
              contextTag,
            }
          );
          if (markByIdRes.error && !isMissingSchemaError(markByIdRes.error.message)) {
            throw markByIdRes.error;
          }
        }

        const markRes = await supabase.rpc("cx_mark_reference_request_completed", { p_reference_id: referenceId });
        if (markRes.error && !isMissingSchemaError(markRes.error.message)) {
          throw markRes.error;
        }

        const syncPromptsRes = await supabase.rpc("cx_sync_reference_requests");
        if (syncPromptsRes.error && !isMissingSchemaError(syncPromptsRes.error.message)) {
          throw syncPromptsRes.error;
        }
        await dispatchReferencePromptEmails({ userId: authData.user.id, limit: 100 });

        return NextResponse.json({
          ok: true,
          reference_id: referenceId,
          context_tag: contextTag,
          rating,
          mode: "rpc_reference",
        });
      }

      if (!isReferenceCompatWriteError(created.error.message)) {
        return NextResponse.json({ ok: false, error: created.error.message }, { status: 400 });
      }
    }

    const compat = await insertReferenceCompat({
      supabase,
      meId: authData.user.id,
      connectionId: anyConnectionId,
      recipientId,
      contextTag,
      sentiment,
      rating,
      referenceBody,
      entityType: referenceEntityType,
      entityId,
      syncId: referenceEntityType === "sync" ? entityIdInput : "",
    });
    if (!compat.ok) {
      return NextResponse.json({ ok: false, error: `compat_insert_failed: ${compat.error}` }, { status: 400 });
    }

    const compatEntityId = entityIdInput || entityId;
    const compatNormalize = await supabase
      .from("references")
      .update({
        context_tag: contextTag,
        entity_type: referenceEntityType,
        entity_id: compatEntityId,
      })
      .eq("id", compat.referenceId);
    if (compatNormalize.error && !isMissingSchemaError(compatNormalize.error.message)) {
      throw compatNormalize.error;
    }

    if (referenceEntityType === "sync" && entityIdInput) {
      const syncMarker = await supabase
        .from("references")
        .update({ sync_id: entityIdInput })
        .eq("id", compat.referenceId);
      if (
        syncMarker.error &&
        !isMissingSchemaError(syncMarker.error.message) &&
        !isForeignKeyError(syncMarker.error.message)
      ) {
        throw syncMarker.error;
      }
    }

    await ensureReferenceReceivedNotification({
      actorId: authData.user.id,
      recipientId,
      referenceId: compat.referenceId,
      entityType: referenceEntityType,
      entityId: compatEntityId,
    });

    await sendAppEmailBestEffort({
      kind: "reference_received",
      recipientUserId: recipientId,
      actorUserId: authData.user.id,
      referenceId: compat.referenceId,
    });

    if (referenceRequestIdInput) {
      const markByIdRes = await applyReferenceRequestCompletionMatch(
        supabase.from("reference_requests").update({
          status: "completed",
          completed_reference_id: compat.referenceId,
          updated_at: new Date().toISOString(),
        }).eq("id", referenceRequestIdInput),
        {
          meId: authData.user.id,
          recipientId,
          contextTag,
        }
      );
      if (markByIdRes.error && !isMissingSchemaError(markByIdRes.error.message)) {
        throw markByIdRes.error;
      }
    }

    const markRes = await supabase.rpc("cx_mark_reference_request_completed", { p_reference_id: compat.referenceId });
    if (markRes.error && !isMissingSchemaError(markRes.error.message)) {
      throw markRes.error;
    }

    const syncPromptsRes = await supabase.rpc("cx_sync_reference_requests");
    if (syncPromptsRes.error && !isMissingSchemaError(syncPromptsRes.error.message)) {
      throw syncPromptsRes.error;
    }
    await dispatchReferencePromptEmails({ userId: authData.user.id, limit: 100 });

    return NextResponse.json({
      ok: true,
      reference_id: compat.referenceId,
      context_tag: contextTag,
      rating,
      mode: "unified_reference",
    });
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
      if (replyText.trim().length > REFERENCE_REPLY_MAX_CHARS) {
        return NextResponse.json(
          { ok: false, error: `Replies must be ${REFERENCE_REPLY_MAX_CHARS} characters or less.` },
          { status: 400 }
        );
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
