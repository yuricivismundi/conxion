import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

const ALLOWED_NOTIFICATION_KINDS = new Set([
  "trip_request_received",
  "trip_request_accepted",
  "trip_request_declined",
  "trip_details_updated",
  "reference_received",
]);

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

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase service role configuration.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readTextField(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function notificationContentForKind(kind: string, params: {
  userId: string;
  tripId?: string;
}) {
  if (kind === "trip_request_received") {
    return {
      title: "Trip request received",
      body: "A traveller sent you a request for this trip.",
      linkUrl: params.tripId ? `/messages?thread=trip%3A${params.tripId}` : "/activity?tab=trips",
    };
  }
  if (kind === "trip_request_accepted") {
    return {
      title: "Trip request accepted",
      body: "Your trip request was accepted.",
      linkUrl: params.tripId ? `/messages?thread=trip%3A${params.tripId}` : "/activity?tab=trips",
    };
  }
  if (kind === "trip_request_declined") {
    return {
      title: "Trip request declined",
      body: "A host declined this request. You can send a new one.",
      linkUrl: params.tripId ? `/messages?thread=trip%3A${params.tripId}` : "/discover/travelers",
    };
  }
  if (kind === "trip_details_updated") {
    return {
      title: "Trip details updated",
      body: "A trip you requested has updated its destination or dates. Review if it still works for you.",
      linkUrl: params.tripId ? `/messages?thread=trip%3A${params.tripId}` : "/activity?tab=trips",
    };
  }
  return {
    title: "New reference received",
    body: "You received a new reference.",
    linkUrl: `/profile/${params.userId}`,
  };
}

async function authorizeNotificationRequest(params: {
  service: ReturnType<typeof getServiceClient>;
  actorId: string;
  userId: string;
  kind: string;
  metadata: Record<string, unknown>;
}) {
  if (params.metadata.sample === true) {
    return params.userId === params.actorId;
  }

  if (params.kind === "reference_received") {
    const referenceId = readTextField(params.metadata.reference_id);
    if (!referenceId) return false;

    const referenceRes = await params.service
      .from("references")
      .select("id,author_id,from_user_id,source_id,recipient_id,to_user_id,target_id")
      .eq("id", referenceId)
      .maybeSingle();
    if (referenceRes.error || !referenceRes.data) return false;

    const row = referenceRes.data as Record<string, unknown>;
    const actorMatches = [row.author_id, row.from_user_id, row.source_id].some((value) => value === params.actorId);
    const recipientMatches = [row.recipient_id, row.to_user_id, row.target_id].some((value) => value === params.userId);
    return actorMatches && recipientMatches;
  }

  const tripId = readTextField(params.metadata.trip_id);
  if (!tripId) return false;

  // trip_details_updated: actor is trip owner, recipient has an active request
  if (params.kind === "trip_details_updated") {
    const [tripRes, requestRes] = await Promise.all([
      params.service.from("trips").select("id,user_id").eq("id", tripId).maybeSingle(),
      params.service
        .from("trip_requests")
        .select("id")
        .eq("trip_id", tripId)
        .eq("requester_id", params.userId)
        .in("status", ["pending", "accepted"])
        .limit(1)
        .maybeSingle(),
    ]);
    if (tripRes.error || !tripRes.data) return false;
    const tripRow = tripRes.data as Record<string, unknown>;
    return tripRow.user_id === params.actorId && Boolean(requestRes.data);
  }

  const requestId = readTextField(params.metadata.request_id);
  if (!requestId) return false;

  const [requestRes, tripRes] = await Promise.all([
    params.service
      .from("trip_requests")
      .select("id,trip_id,requester_id,status")
      .eq("id", requestId)
      .eq("trip_id", tripId)
      .maybeSingle(),
    params.service
      .from("trips")
      .select("id,user_id")
      .eq("id", tripId)
      .maybeSingle(),
  ]);

  if (requestRes.error || !requestRes.data || tripRes.error || !tripRes.data) return false;

  const requestRow = requestRes.data as Record<string, unknown>;
  const tripRow = tripRes.data as Record<string, unknown>;
  if (params.kind === "trip_request_received") {
    return requestRow.requester_id === params.actorId && tripRow.user_id === params.userId && requestRow.status === "pending";
  }

  if (requestRow.requester_id !== params.userId || tripRow.user_id !== params.actorId) return false;
  if (params.kind === "trip_request_accepted") return requestRow.status === "accepted";
  if (params.kind === "trip_request_declined") return requestRow.status === "declined";
  return false;
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

function notificationFallbackValue(column: string, params: {
  userId: string;
  actorId: string;
  kind: string;
  title: string;
  body: string;
  linkUrl: string;
  metadata: Record<string, unknown>;
}) {
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

async function insertNotificationCompat(params: {
  service: ReturnType<typeof getServiceClient>;
  userId: string;
  actorId: string;
  kind: string;
  title: string;
  body: string;
  linkUrl: string;
  metadata: Record<string, unknown>;
}) {
  const payloadCandidates: Array<Record<string, unknown>> = [
    {
      user_id: params.userId,
      actor_id: params.actorId,
      type: params.kind,
      kind: params.kind,
      title: params.title,
      body: params.body || null,
      link_url: params.linkUrl || null,
      metadata: params.metadata,
    },
    {
      user_id: params.userId,
      type: params.kind,
      kind: params.kind,
      title: params.title,
      body: params.body || null,
      metadata: params.metadata,
    },
    {
      user_id: params.userId,
      type: params.kind,
      kind: params.kind,
      title: params.title,
      metadata: params.metadata,
    },
    {
      user_id: params.userId,
      type: params.kind,
      kind: params.kind,
      message: params.title,
      data: params.metadata,
    },
  ];

  let lastError: { message: string; code?: string } | null = null;
  const serviceAny = params.service as unknown as {
    from: (table: string) => {
      insert: (values: Record<string, unknown>) => {
        select: (columns: string) => {
          single: () => Promise<{
            error: { message: string; code?: string } | null;
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
        return { ok: true as const, notificationId: (insertRes.data as { id?: string } | null)?.id ?? null };
      }

      lastError = insertRes.error;
      const message = insertRes.error.message ?? "";
      if (insertRes.error.code === "23505" || message.toLowerCase().includes("duplicate")) {
        return { ok: true as const, notificationId: null };
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
        return { ok: false as const, error: message };
      }
      break;
    }
  }

  if (!lastError) return { ok: false as const, error: "notification_insert_failed" };
  if (isMissingSchemaError(lastError.message)) {
    return {
      ok: false as const,
      error:
        "Notifications schema missing or outdated. Apply scripts/sql/2026-02-15_threads_trips_syncs_notifications.sql and scripts/sql/2026-02-19_notifications_hardening.sql.",
    };
  }
  return { ok: false as const, error: lastError.message };
}

function hasSameNotificationFingerprint(
  existing: Array<{ metadata?: Record<string, unknown> | null }>,
  nextMetadata: Record<string, unknown>
) {
  const requestId = typeof nextMetadata.request_id === "string" ? nextMetadata.request_id : "";
  const referenceId = typeof nextMetadata.reference_id === "string" ? nextMetadata.reference_id : "";
  if (!requestId && !referenceId) return false;

  return existing.some((row) => {
    const metadata = row.metadata ?? {};
    if (requestId && metadata.request_id === requestId) return true;
    if (referenceId && metadata.reference_id === referenceId) return true;
    return false;
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | {
          userId?: unknown;
          kind?: unknown;
          title?: unknown;
          body?: unknown;
          linkUrl?: unknown;
          metadata?: unknown;
        }
      | null;

    const userId = readTextField(body?.userId);
    const kind = readTextField(body?.kind);
    const metadata = normalizeMetadata(body?.metadata);

    if (!userId || !kind) {
      return NextResponse.json(
        { ok: false, error: "userId and kind are required." },
        { status: 400 }
      );
    }
    if (!ALLOWED_NOTIFICATION_KINDS.has(kind)) {
      return NextResponse.json({ ok: false, error: "Unsupported notification kind." }, { status: 400 });
    }

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabaseUser = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const service = getServiceClient();
    const isAuthorized = await authorizeNotificationRequest({
      service,
      actorId: authData.user.id,
      userId,
      kind,
      metadata,
    });
    if (!isAuthorized) {
      return NextResponse.json({ ok: false, error: "Notification not allowed." }, { status: 403 });
    }

    const sampleMode = metadata.sample === true && userId === authData.user.id;
    const tripId = readTextField(metadata.trip_id);
    const trustedContent = sampleMode
      ? {
          title: readTextField(body?.title) || "Sample notification",
          body: readTextField(body?.body),
          linkUrl: readTextField(body?.linkUrl),
        }
      : notificationContentForKind(kind, { userId, tripId });

    const recent = await service
      .from("notifications")
      .select("id,metadata")
      .eq("user_id", userId)
      .eq("kind", kind)
      .order("created_at", { ascending: false })
      .limit(30);

    if (recent.error) {
      if (isMissingSchemaError(recent.error.message)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Notifications schema missing or outdated. Apply scripts/sql/2026-02-15_threads_trips_syncs_notifications.sql and scripts/sql/2026-02-19_notifications_hardening.sql.",
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: false, error: recent.error.message }, { status: 400 });
    }

    const rows = (recent.data ?? []) as Array<{ id?: string; metadata?: Record<string, unknown> | null }>;
    if (hasSameNotificationFingerprint(rows, metadata)) {
      return NextResponse.json({ ok: true, duplicated: true });
    }

    const inserted = await insertNotificationCompat({
      service,
      userId,
      actorId: authData.user.id,
      kind,
      title: trustedContent.title,
      body: trustedContent.body || "",
      linkUrl: trustedContent.linkUrl || "",
      metadata,
    });

    if (!inserted.ok) {
      return NextResponse.json({ ok: false, error: inserted.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, notificationId: inserted.notificationId });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
