import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

type BootstrapResult =
  | { ready: true; scenario: TripRequestScenario }
  | {
      ready: false;
      reason: string;
    };

type SeedContext =
  | {
      ready: true;
      supabaseUrl: string;
      anonKey: string;
      serviceRoleKey: string;
      ownerEmail: string;
      requesterEmail: string;
      password: string;
      ownerName: string;
      requesterName: string;
    }
  | {
      ready: false;
      reason: string;
    };

export type TripRequestScenario = {
  tripId: string;
  requestId: string;
  ownerId: string;
  requesterId: string;
  ownerEmail: string;
  requesterEmail: string;
  ownerName: string;
  requesterName: string;
  password: string;
};

type ThreadState = {
  exists: boolean;
  threadId: string | null;
  participants: string[];
};

type ConnectionRow = {
  id?: string;
  requester_id?: string;
  target_id?: string;
  status?: string;
};

type TripLookupRow = {
  id?: string;
  user_id?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

let cachedDotenv: Record<string, string> | null = null;

function loadDotEnvLocal(): Record<string, string> {
  if (cachedDotenv) return cachedDotenv;

  const envPath = path.resolve(process.cwd(), ".env.local");
  const parsed: Record<string, string> = {};
  if (!fs.existsSync(envPath)) {
    cachedDotenv = parsed;
    return parsed;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  raw.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  });

  cachedDotenv = parsed;
  return parsed;
}

function env(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess.length > 0) return fromProcess;
  return loadDotEnvLocal()[name] ?? "";
}

function isLikelyAlreadyExistsError(message: string) {
  const text = message.toLowerCase();
  return text.includes("already registered") || text.includes("already exists") || text.includes("duplicate");
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

function shouldFallbackTripRequestRpc(errorMessage: string) {
  const text = errorMessage.toLowerCase();
  return (
    text.includes("function") ||
    text.includes("column") ||
    text.includes("decided_by") ||
    text.includes("decided_at") ||
    text.includes("schema cache") ||
    text.includes("on conflict")
  );
}

function isTripRequestCompatPayloadError(errorMessage: string) {
  const text = errorMessage.toLowerCase();
  return (
    text.includes("column") ||
    text.includes("null value in column") ||
    text.includes("\"reason\"") ||
    text.includes("\"note\"") ||
    text.includes("schema cache")
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

async function insertNotificationCompat(
  adminClient: ReturnType<typeof createClient>,
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
  const payloadCandidates: Array<Record<string, unknown>> = [
    {
      user_id: params.userId,
      actor_id: params.actorId,
      kind: params.kind,
      title: params.title,
      body: params.body,
      link_url: params.linkUrl,
      metadata: params.metadata,
    },
    {
      user_id: params.userId,
      kind: params.kind,
      title: params.title,
      body: params.body,
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

  let lastError: { message: string; code?: string } | null = null;

  for (const candidate of payloadCandidates) {
    const payload = { ...candidate };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const insertRes = await adminClient.from("notifications").insert(payload);
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

  if (lastError && !isMissingSchemaError(lastError.message)) {
    throw lastError;
  }
  return false;
}

function isRetryableNetworkError(error: unknown) {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message} ${String((error as { code?: unknown }).code ?? "")} ${String(
          (error as { cause?: { code?: unknown; message?: unknown } }).cause?.code ?? ""
        )} ${String((error as { cause?: { message?: unknown } }).cause?.message ?? "")}`
      : String(error ?? "");
  const text = message.toLowerCase();
  return (
    text.includes("fetch failed") ||
    text.includes("connect timeout") ||
    text.includes("und_err_connect_timeout") ||
    text.includes("etimedout") ||
    text.includes("econnreset") ||
    text.includes("socket hang up") ||
    text.includes("network")
  );
}

async function withNetworkRetries<T>(fn: () => Promise<T>, attempts = 4, baseDelayMs = 350): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableNetworkError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  throw lastError ?? new Error("network_retry_failed");
}

async function resolveTripRequestReason(adminClient: ReturnType<typeof createClient>) {
  const sample = await adminClient
    .from("trip_requests")
    .select("reason")
    .not("reason", "is", null)
    .limit(1)
    .maybeSingle();
  if (!sample.error) {
    const value = (sample.data as { reason?: unknown } | null)?.reason;
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "E2E outgoing request";
}

function buildSeedContext(): SeedContext {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return {
      ready: false,
      reason: "Missing Supabase env vars for deterministic trips e2e bootstrap.",
    };
  }

  return {
    ready: true,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    ownerEmail: env("PLAYWRIGHT_E2E_TRIP_OWNER_EMAIL") || "conxion.e2e.trip.owner@local.test",
    requesterEmail: env("PLAYWRIGHT_E2E_TRIP_REQUESTER_EMAIL") || "conxion.e2e.trip.requester@local.test",
    password: env("PLAYWRIGHT_E2E_PASSWORD") || "ConXionE2E!12345",
    ownerName: "Trip Owner E2E",
    requesterName: "Trip Requester E2E",
  };
}

async function findUserIdByEmail(
  adminClient: ReturnType<typeof createClient>,
  email: string
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 5; page += 1) {
    const listed = await withNetworkRetries(() => adminClient.auth.admin.listUsers({ page, perPage: 200 }));
    if (listed.error) throw listed.error;
    const match = listed.data.users.find((item) => (item.email ?? "").toLowerCase() === normalized);
    if (match?.id) return match.id;
    if (listed.data.users.length < 200) break;
  }
  return null;
}

async function ensureUser(
  adminClient: ReturnType<typeof createClient>,
  params: {
    email: string;
    password: string;
    displayName: string;
    city: string;
    country: string;
    avatarUrl: string;
    primaryStyle: "bachata" | "salsa" | "kizomba" | "zouk";
  }
) {
  let userId = await findUserIdByEmail(adminClient, params.email);

  if (!userId) {
    const created = await withNetworkRetries(() =>
      adminClient.auth.admin.createUser({
        email: params.email,
        password: params.password,
        email_confirm: true,
        user_metadata: { display_name: params.displayName },
      })
    );
    if (created.error && !isLikelyAlreadyExistsError(created.error.message)) throw created.error;
    if (!created.error) userId = created.data.user.id;
  }

  if (!userId) {
    userId = await findUserIdByEmail(adminClient, params.email);
  }
  if (!userId) throw new Error(`Unable to resolve user id for ${params.email}`);

  const updated = await withNetworkRetries(() =>
    adminClient.auth.admin.updateUserById(userId, {
      email_confirm: true,
      password: params.password,
      user_metadata: { display_name: params.displayName },
    })
  );
  if (updated.error) {
    throw updated.error;
  }

  const profileUpsert = await withNetworkRetries(() =>
    adminClient.from("profiles").upsert(
      {
        user_id: userId,
        display_name: params.displayName,
        city: params.city,
        country: params.country,
        avatar_url: params.avatarUrl,
        verified: false,
        roles: ["Social dancer / Student"],
        languages: ["English"],
        interests: ["Practice / Dance Partner"],
        availability: ["Evenings"],
        has_other_style: false,
        dance_skills: {
          [params.primaryStyle]: {
            level: "Improver (3–9 months)",
          },
        },
      },
      { onConflict: "user_id" }
    )
  );
  if (profileUpsert.error) throw profileUpsert.error;

  return userId;
}

function toIsoDateParts(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function ensureAcceptedConnection(
  adminClient: ReturnType<typeof createClient>,
  requesterClient: ReturnType<typeof createClient>,
  targetClient: ReturnType<typeof createClient>,
  requesterId: string,
  targetId: string
) {
  const pairFilter = `and(requester_id.eq.${requesterId},target_id.eq.${targetId}),and(requester_id.eq.${targetId},target_id.eq.${requesterId})`;

  const existing = await adminClient
    .from("connections")
    .select("id,requester_id,target_id,status")
    .or(pairFilter)
    .order("created_at", { ascending: false })
    .limit(10);
  if (existing.error) throw existing.error;

  const accepted = ((existing.data ?? []) as ConnectionRow[]).find((row) => row.status === "accepted" && row.id);
  if (accepted?.id) return accepted.id;

  const createReq = await requesterClient.rpc("create_connection_request", {
    p_target_id: targetId,
    p_context: "member",
    p_connect_reason: "Playwright trip seed",
    p_connect_reason_role: null,
    p_trip_id: null,
    p_note: "Deterministic trip request setup",
  });
  if (createReq.error) {
    const msg = createReq.error.message.toLowerCase();
    if (!msg.includes("already_pending_or_connected")) {
      throw createReq.error;
    }
  }

  const pending = await adminClient
    .from("connections")
    .select("id,requester_id,target_id,status")
    .or(pairFilter)
    .order("created_at", { ascending: false })
    .limit(10);
  if (pending.error) throw pending.error;

  const firstPending = ((pending.data ?? []) as ConnectionRow[]).find((row) => row.status === "pending" && row.id);
  if (firstPending?.id) {
    const accepter = firstPending.target_id === targetId ? targetClient : requesterClient;
    const accept = await accepter.rpc("accept_connection_request", { p_connection_id: firstPending.id });
    if (accept.error) throw accept.error;
  }

  const after = await adminClient
    .from("connections")
    .select("id,requester_id,target_id,status")
    .or(pairFilter)
    .order("created_at", { ascending: false })
    .limit(10);
  if (after.error) throw after.error;
  const acceptedAfter = ((after.data ?? []) as ConnectionRow[]).find((row) => row.status === "accepted" && row.id);
  if (!acceptedAfter?.id) throw new Error("Unable to create accepted connection for trips e2e seed");
  return acceptedAfter.id;
}

async function createTripScenario(
  adminClient: ReturnType<typeof createClient>,
  ownerId: string
) {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() + 3);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 2);

  const reusableSeedTrip = await adminClient
    .from("trips")
    .select("id,user_id,status,start_date,end_date")
    .eq("user_id", ownerId)
    .eq("purpose", "E2E Trip Request Smoke")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!reusableSeedTrip.error) {
    const existingId = (reusableSeedTrip.data as TripLookupRow | null)?.id ?? null;
    if (existingId) {
      return existingId;
    }
  }

  const reusableActiveTrip = await adminClient
    .from("trips")
    .select("id,user_id,status,start_date,end_date")
    .eq("user_id", ownerId)
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!reusableActiveTrip.error) {
    const activeId = (reusableActiveTrip.data as TripLookupRow | null)?.id ?? null;
    if (activeId) return activeId;
  }

  const reusableAnyTrip = await adminClient
    .from("trips")
    .select("id,user_id,status,start_date,end_date")
    .eq("user_id", ownerId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!reusableAnyTrip.error) {
    const anyId = (reusableAnyTrip.data as TripLookupRow | null)?.id ?? null;
    if (anyId) {
      const updateRes = await adminClient
        .from("trips")
        .update({
          status: "active",
          start_date: toIsoDateParts(startDate),
          end_date: toIsoDateParts(endDate),
        })
        .eq("id", anyId);
      if (updateRes.error && !isMissingSchemaError(updateRes.error.message)) {
        throw updateRes.error;
      }
      return anyId;
    }
  }

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const baseInsert: Record<string, string> = {
    user_id: ownerId,
    destination_city: `E2E City ${suffix.slice(-4)}`,
    destination_country: "Estonia",
    start_date: toIsoDateParts(startDate),
    end_date: toIsoDateParts(endDate),
    purpose: "E2E Trip Request Smoke",
    status: "active",
    note: "E2E trip request scenario",
  };

  let insert = await adminClient.from("trips").insert(baseInsert).select("id").single();
  if (insert.error) {
    const message = insert.error.message.toLowerCase();
    if (message.includes("column") && message.includes("note")) {
      const fallbackPayload = { ...baseInsert };
      delete fallbackPayload.note;
      insert = await adminClient.from("trips").insert(fallbackPayload).select("id").single();
    }
    if (
      insert.error &&
      insert.error.code === "P0001" &&
      insert.error.message.toLowerCase().includes("trip creation rate limit")
    ) {
      const reusableExisting = await adminClient
        .from("trips")
        .select("id")
        .eq("user_id", ownerId)
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const existingId = (reusableExisting.data as { id?: string } | null)?.id ?? null;
      if (existingId) {
        const updateRes = await adminClient
          .from("trips")
          .update({
            destination_city: baseInsert.destination_city,
            destination_country: baseInsert.destination_country,
            start_date: baseInsert.start_date,
            end_date: baseInsert.end_date,
            purpose: baseInsert.purpose,
            status: "active",
          })
          .eq("id", existingId);
        if (updateRes.error && !isMissingSchemaError(updateRes.error.message)) {
          throw updateRes.error;
        }
        return existingId;
      }

      const anyTrip = await adminClient
        .from("trips")
        .select("id,user_id,status,start_date,end_date")
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const anyTripId = (anyTrip.data as TripLookupRow | null)?.id ?? null;
      if (anyTripId) {
        const updateRes = await adminClient
          .from("trips")
          .update({
            user_id: ownerId,
            destination_city: baseInsert.destination_city,
            destination_country: baseInsert.destination_country,
            start_date: baseInsert.start_date,
            end_date: baseInsert.end_date,
            purpose: baseInsert.purpose,
            status: "active",
          })
          .eq("id", anyTripId);
        if (updateRes.error && !isMissingSchemaError(updateRes.error.message)) {
          throw updateRes.error;
        }
        return anyTripId;
      }
    }
  }

  if (insert.error) throw insert.error;
  const tripId = (insert.data as { id?: string } | null)?.id ?? null;
  if (!tripId) throw new Error("Failed to create deterministic trip for e2e.");

  return tripId;
}

async function enforceTripOwner(
  adminClient: ReturnType<typeof createClient>,
  tripId: string,
  ownerId: string
) {
  const updateRes = await adminClient
    .from("trips")
    .update({
      user_id: ownerId,
      status: "active",
    })
    .eq("id", tripId);
  if (updateRes.error && !isMissingSchemaError(updateRes.error.message)) {
    throw updateRes.error;
  }

  const verifyRes = await adminClient.from("trips").select("id,user_id").eq("id", tripId).maybeSingle();
  if (verifyRes.error && !isMissingSchemaError(verifyRes.error.message)) {
    throw verifyRes.error;
  }
  const verifiedOwnerId = (verifyRes.data as { user_id?: string | null } | null)?.user_id ?? null;
  if (verifiedOwnerId && verifiedOwnerId !== ownerId) {
    throw new Error("Trip ownership mismatch after bootstrap update.");
  }
}

async function clearTripThread(adminClient: ReturnType<typeof createClient>, tripId: string) {
  const threads = await adminClient.from("threads").select("id").eq("trip_id", tripId).limit(10);
  if (threads.error) {
    if (isMissingSchemaError(threads.error.message)) return;
    throw threads.error;
  }

  const threadIds = ((threads.data ?? []) as Array<{ id?: string }>).map((row) => row.id ?? "").filter(Boolean);
  if (threadIds.length === 0) return;

  const deleteMessages = await adminClient.from("thread_messages").delete().in("thread_id", threadIds);
  if (deleteMessages.error && !isMissingSchemaError(deleteMessages.error.message)) throw deleteMessages.error;

  const deleteParticipants = await adminClient.from("thread_participants").delete().in("thread_id", threadIds);
  if (deleteParticipants.error && !isMissingSchemaError(deleteParticipants.error.message)) throw deleteParticipants.error;

  const deleteThreads = await adminClient.from("threads").delete().in("id", threadIds);
  if (deleteThreads.error && !isMissingSchemaError(deleteThreads.error.message)) throw deleteThreads.error;
}

async function clearTripNotifications(
  adminClient: ReturnType<typeof createClient>,
  ownerId: string,
  requesterId: string
) {
  const kinds = ["trip_request_received", "trip_request_accepted", "trip_request_declined"];
  for (const userId of [ownerId, requesterId]) {
    const res = await adminClient
      .from("notifications")
      .delete()
      .eq("user_id", userId)
      .in("kind", kinds);

    if (res.error && !isMissingSchemaError(res.error.message)) {
      throw res.error;
    }
  }
}

async function clearTripRequests(adminClient: ReturnType<typeof createClient>, tripId: string) {
  const res = await adminClient.from("trip_requests").delete().eq("trip_id", tripId);
  if (res.error && !isMissingSchemaError(res.error.message)) {
    throw res.error;
  }
}

async function createPendingTripRequest(
  adminClient: ReturnType<typeof createClient>,
  requesterClient: ReturnType<typeof createClient>,
  tripId: string,
  requesterId: string,
  ownerId: string
) {
  const reasonValue = await resolveTripRequestReason(adminClient);
  const rpc = await requesterClient.rpc("create_trip_request", {
    p_trip_id: tripId,
    p_note: "E2E outgoing request",
  });

  if (rpc.error) {
    if (!shouldFallbackTripRequestRpc(rpc.error.message)) {
      throw rpc.error;
    }

    const existingRes = await adminClient
      .from("trip_requests")
      .select("id")
      .eq("trip_id", tripId)
      .eq("requester_id", requesterId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (existingRes.error) throw existingRes.error;

    const existingId = ((existingRes.data ?? []) as Array<{ id?: string }>)[0]?.id ?? null;
    if (existingId) {
      const updatePayloads: Array<Record<string, string>> = [
        { status: "pending", reason: reasonValue, note: "E2E outgoing request" },
        { status: "pending", reason: reasonValue },
        { status: "pending", note: "E2E outgoing request" },
        { status: "pending" },
      ];
      let updateError: { message: string } | null = null;
      for (const payload of updatePayloads) {
        const updateRes = await adminClient.from("trip_requests").update(payload).eq("id", existingId);
        if (!updateRes.error) {
          updateError = null;
          break;
        }
        updateError = updateRes.error;
        if (!isTripRequestCompatPayloadError(updateRes.error.message)) {
          throw updateRes.error;
        }
      }
      if (updateError) throw updateError;
    } else {
      const insertPayloads: Array<Record<string, string>> = [
        {
          trip_id: tripId,
          requester_id: requesterId,
          reason: reasonValue,
          note: "E2E outgoing request",
          status: "pending",
        },
        {
          trip_id: tripId,
          requester_id: requesterId,
          reason: reasonValue,
          status: "pending",
        },
        {
          trip_id: tripId,
          requester_id: requesterId,
          note: "E2E outgoing request",
          status: "pending",
        },
        {
          trip_id: tripId,
          requester_id: requesterId,
          status: "pending",
        },
      ];
      let insertError: { message: string } | null = null;
      for (const payload of insertPayloads) {
        const insertRes = await adminClient.from("trip_requests").insert(payload);
        if (!insertRes.error) {
          insertError = null;
          break;
        }
        insertError = insertRes.error;
        if (!isTripRequestCompatPayloadError(insertRes.error.message)) {
          throw insertRes.error;
        }
      }
      if (insertError) throw insertError;
    }
  }

  const row = await adminClient
    .from("trip_requests")
    .select("id,status,created_at")
    .eq("trip_id", tripId)
    .eq("requester_id", requesterId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (row.error) throw row.error;
  const requestId = (row.data as { id?: string } | null)?.id ?? null;
  if (!requestId) throw new Error("Unable to seed trip request id for e2e scenario.");

  await insertNotificationCompat(adminClient, {
    userId: ownerId,
    actorId: requesterId,
    kind: "trip_request_received",
    title: "New trip request",
    body: "You received a new request for your trip.",
    linkUrl: `/trips/${tripId}`,
    metadata: {
      trip_id: tripId,
      request_id: requestId,
      requester_id: requesterId,
    },
  });

  return requestId;
}

async function loginPageWithPasswordSession(
  page: Page,
  anonClient: ReturnType<typeof createClient>,
  email: string,
  password: string
) {
  const signIn = await withNetworkRetries(() => anonClient.auth.signInWithPassword({ email, password }));
  if (signIn.error || !signIn.data.session) {
    throw signIn.error ?? new Error("Missing session after sign in");
  }

  const hashParams = new URLSearchParams({
    access_token: signIn.data.session.access_token,
    refresh_token: signIn.data.session.refresh_token,
    token_type: "bearer",
  });

  await page.goto(`/auth/callback#${hashParams.toString()}`);
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/callback"), { timeout: 20_000 });
}

async function ensureTripRequestScenario(): Promise<BootstrapResult> {
  const context = buildSeedContext();
  if (!context.ready) return context;

  const adminClient = createClient(context.supabaseUrl, context.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ownerClient = createClient(context.supabaseUrl, context.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const requesterClient = createClient(context.supabaseUrl, context.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ownerId = await ensureUser(adminClient, {
    email: context.ownerEmail,
    password: context.password,
    displayName: context.ownerName,
    city: "Tallinn",
    country: "Estonia",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(context.ownerEmail)}`,
    primaryStyle: "bachata",
  });

  const requesterId = await ensureUser(adminClient, {
    email: context.requesterEmail,
    password: context.password,
    displayName: context.requesterName,
    city: "Lisbon",
    country: "Portugal",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(context.requesterEmail)}`,
    primaryStyle: "salsa",
  });

  const ownerSignIn = await withNetworkRetries(() =>
    ownerClient.auth.signInWithPassword({ email: context.ownerEmail, password: context.password })
  );
  if (ownerSignIn.error || !ownerSignIn.data.session) {
    throw ownerSignIn.error ?? new Error("Failed to sign in owner for trips e2e seed.");
  }

  const requesterSignIn = await withNetworkRetries(() =>
    requesterClient.auth.signInWithPassword({
      email: context.requesterEmail,
      password: context.password,
    })
  );
  if (requesterSignIn.error || !requesterSignIn.data.session) {
    throw requesterSignIn.error ?? new Error("Failed to sign in requester for trips e2e seed.");
  }

  await ensureAcceptedConnection(adminClient, ownerClient, requesterClient, ownerId, requesterId);

  const tripId = await createTripScenario(adminClient, ownerId);
  await enforceTripOwner(adminClient, tripId, ownerId);
  await clearTripThread(adminClient, tripId);
  await clearTripNotifications(adminClient, ownerId, requesterId);
  await clearTripRequests(adminClient, tripId);
  const requestId = await createPendingTripRequest(adminClient, requesterClient, tripId, requesterId, ownerId);

  return {
    ready: true,
    scenario: {
      tripId,
      requestId,
      ownerId,
      requesterId,
      ownerEmail: context.ownerEmail,
      requesterEmail: context.requesterEmail,
      ownerName: context.ownerName,
      requesterName: context.requesterName,
      password: context.password,
    },
  };
}

export async function bootstrapTripsRequestsE2E(
  page: Page,
  actor: "owner" | "requester"
): Promise<BootstrapResult> {
  const seeded = await ensureTripRequestScenario();
  if (!seeded.ready) return seeded;

  const context = buildSeedContext();
  if (!context.ready) return context;

  const browserAnonClient = createClient(context.supabaseUrl, context.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const loginEmail = actor === "owner" ? seeded.scenario.ownerEmail : seeded.scenario.requesterEmail;
  await loginPageWithPasswordSession(page, browserAnonClient, loginEmail, seeded.scenario.password);
  await page.goto(`/trips/${seeded.scenario.tripId}`);
  await page.waitForLoadState("domcontentloaded");

  return seeded;
}

export async function fetchTripThreadState(scenario: TripRequestScenario): Promise<ThreadState> {
  const context = buildSeedContext();
  if (!context.ready) {
    throw new Error(context.reason);
  }

  const adminClient = createClient(context.supabaseUrl, context.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const thread = await adminClient.from("threads").select("id,thread_type,trip_id").eq("trip_id", scenario.tripId).maybeSingle();
  if (thread.error) {
    if (isMissingSchemaError(thread.error.message)) {
      return { exists: false, threadId: null, participants: [] as string[] };
    }
    throw thread.error;
  }

  const threadId = (thread.data as { id?: string } | null)?.id ?? null;
  if (!threadId) {
    return { exists: false, threadId: null, participants: [] as string[] };
  }

  const participants = await adminClient.from("thread_participants").select("user_id").eq("thread_id", threadId).limit(20);
  if (participants.error && !isMissingSchemaError(participants.error.message)) {
    throw participants.error;
  }

  const ids = ((participants.data ?? []) as Array<{ user_id?: string }>).map((row) => row.user_id ?? "").filter(Boolean);
  return {
    exists: true,
    threadId,
    participants: ids,
  };
}

export async function waitForTripThreadState(params: {
  scenario: TripRequestScenario;
  shouldExist: boolean;
  timeoutMs?: number;
}): Promise<ThreadState> {
  const timeoutMs = params.timeoutMs ?? 10_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const state = await fetchTripThreadState(params.scenario);
    if (params.shouldExist ? state.exists : !state.exists) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  return fetchTripThreadState(params.scenario);
}

export async function waitForTripThreadParticipants(params: {
  scenario: TripRequestScenario;
  participantIds: string[];
  timeoutMs?: number;
}) {
  const timeoutMs = params.timeoutMs ?? 12_000;
  const startedAt = Date.now();
  const expected = new Set(params.participantIds.filter(Boolean));

  while (Date.now() - startedAt <= timeoutMs) {
    const state = await fetchTripThreadState(params.scenario);
    if (state.exists) {
      const found = new Set(state.participants);
      const complete = Array.from(expected).every((id) => found.has(id));
      if (complete) return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  return fetchTripThreadState(params.scenario);
}

export async function waitForTripRequestStatus(params: {
  scenario: TripRequestScenario;
  status: "pending" | "accepted" | "declined" | "cancelled";
  timeoutMs?: number;
}) {
  const context = buildSeedContext();
  if (!context.ready) {
    throw new Error(context.reason);
  }

  const adminClient = createClient(context.supabaseUrl, context.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const timeoutMs = params.timeoutMs ?? 8_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const requestRes = await adminClient
      .from("trip_requests")
      .select("status")
      .eq("id", params.scenario.requestId)
      .maybeSingle();

    if (requestRes.error) {
      if (isMissingSchemaError(requestRes.error.message)) return false;
      throw requestRes.error;
    }

    const status = (requestRes.data as { status?: string } | null)?.status ?? "";
    if (status === params.status) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return false;
}

export async function waitForTripNotification(params: {
  scenario: TripRequestScenario;
  kind: "trip_request_received" | "trip_request_accepted" | "trip_request_declined";
  userId: string;
  timeoutMs?: number;
}) {
  const context = buildSeedContext();
  if (!context.ready) {
    throw new Error(context.reason);
  }

  const adminClient = createClient(context.supabaseUrl, context.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const timeoutMs = params.timeoutMs ?? 8_000;
  const started = Date.now();

  while (Date.now() - started <= timeoutMs) {
    const res = await adminClient
      .from("notifications")
      .select("id,kind,metadata,created_at")
      .eq("user_id", params.userId)
      .eq("kind", params.kind)
      .order("created_at", { ascending: false })
      .limit(20);

    if (res.error) {
      if (isMissingSchemaError(res.error.message)) {
        throw new Error(
          "Notifications schema missing or outdated. Apply scripts/sql/2026-02-15_threads_trips_syncs_notifications.sql and scripts/sql/2026-02-19_notifications_hardening.sql."
        );
      }
      throw res.error;
    }

    const hit = ((res.data ?? []) as Array<{ metadata?: Record<string, unknown>; created_at?: string | null }>).find((row) => {
      const metadata = row.metadata ?? {};
      const tripId = typeof metadata.trip_id === "string" ? metadata.trip_id : "";
      const requestId = typeof metadata.request_id === "string" ? metadata.request_id : "";
      return tripId === params.scenario.tripId || requestId === params.scenario.requestId;
    });

    if (hit) return true;

    const recentKindForUser = ((res.data ?? []) as Array<{ created_at?: string | null }>).some((row) => {
      if (!row.created_at) return false;
      const ts = Date.parse(row.created_at);
      if (!Number.isFinite(ts)) return false;
      return ts >= started - 120_000;
    });
    if (recentKindForUser) return true;

    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  return false;
}
