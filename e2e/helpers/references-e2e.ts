import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

type BootstrapResult =
  | { ready: true; scenario: ReferencesScenario }
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
      authorEmail: string;
      recipientEmail: string;
      password: string;
      authorName: string;
      recipientName: string;
    }
  | {
      ready: false;
      reason: string;
    };

type ConnectionRow = {
  id?: string;
  requester_id?: string;
  target_id?: string;
  status?: string;
};

type ReferenceLookup = {
  id: string;
  sentiment: string;
  body: string;
  entityType: string;
  entityId: string;
  editCount: number;
  replyText: string | null;
};

export type ReferencesScenario = {
  connectionId: string;
  authorId: string;
  recipientId: string;
  authorEmail: string;
  recipientEmail: string;
  authorName: string;
  recipientName: string;
  password: string;
  recentSyncId: string;
  oldSyncId: string;
  supportsV2: boolean;
  supportsEdit: boolean;
  supportsReply: boolean;
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

function sanitizeNamespace(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function withNamespacedEmail(baseEmail: string) {
  const explicit = env("PLAYWRIGHT_E2E_NAMESPACE");
  const implicit =
    process.env.GITHUB_ACTIONS === "true"
      ? `${env("GITHUB_RUN_ID")}-${env("GITHUB_RUN_ATTEMPT")}-${env("GITHUB_JOB")}`
      : "";
  const namespace = sanitizeNamespace(explicit || implicit);
  if (!namespace) return baseEmail;

  const at = baseEmail.indexOf("@");
  if (at <= 0) return baseEmail;
  const local = baseEmail.slice(0, at).split("+")[0];
  const domain = baseEmail.slice(at + 1);
  return `${local}+${namespace}@${domain}`;
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

const REFERENCE_AUTHOR_COLUMNS = ["author_id", "from_user_id", "source_id"] as const;
const REFERENCE_RECIPIENT_COLUMNS = ["recipient_id", "to_user_id", "target_id"] as const;
const REFERENCE_CONNECTION_COLUMNS = ["connection_id", "connection_request_id"] as const;
const REFERENCE_ENTITY_TYPE_COLUMNS = ["entity_type", "context"] as const;
const REFERENCE_ENTITY_ID_COLUMNS = ["entity_id", "sync_id"] as const;
const REFERENCE_BODY_COLUMNS = ["body", "content", "feedback", "comment", "reference_text"] as const;
const REFERENCE_REPLY_COLUMNS = ["reply_text", "reply", "response_text", "reply_body"] as const;

function pickFirstText(row: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return "";
}

function pickFirstOptionalText(row: Record<string, unknown>, keys: readonly string[]) {
  const value = pickFirstText(row, keys);
  return value.length > 0 ? value : null;
}

function pickFirstNumber(row: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function sentimentFromRow(row: Record<string, unknown>) {
  const sentimentRaw = pickFirstText(row, ["sentiment"]);
  const sentiment = sentimentRaw.toLowerCase();
  if (sentiment === "positive" || sentiment === "neutral" || sentiment === "negative") {
    return sentiment;
  }

  const ratingRaw = row.rating;
  if (typeof ratingRaw === "number") {
    if (ratingRaw >= 4) return "positive";
    if (ratingRaw <= 2) return "negative";
    return "neutral";
  }
  if (typeof ratingRaw === "string" && ratingRaw.trim().length > 0) {
    const normalized = ratingRaw.trim().toLowerCase();
    if (normalized === "positive" || normalized === "neutral" || normalized === "negative") {
      return normalized;
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      if (parsed >= 4) return "positive";
      if (parsed <= 2) return "negative";
      return "neutral";
    }
  }
  return "";
}

function createdAtScore(row: Record<string, unknown>) {
  const createdAt = pickFirstText(row, ["created_at"]);
  if (!createdAt) return 0;
  const ms = Date.parse(createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

function expectedCounterpartyId(params: { scenario: ReferencesScenario; authorId: string }) {
  if (params.authorId === params.scenario.authorId) return params.scenario.recipientId;
  if (params.authorId === params.scenario.recipientId) return params.scenario.authorId;
  return "";
}

function referenceRowMatchesEntity(
  row: Record<string, unknown>,
  params: {
    scenario: ReferencesScenario;
    authorId: string;
    entityType: "sync" | "trip" | "event" | "connection";
    entityId: string;
  }
) {
  const rowAuthor = pickFirstText(row, REFERENCE_AUTHOR_COLUMNS);
  const rowRecipient = pickFirstText(row, REFERENCE_RECIPIENT_COLUMNS);
  const rowConnection = pickFirstText(row, REFERENCE_CONNECTION_COLUMNS);
  const rowEntityType = pickFirstText(row, REFERENCE_ENTITY_TYPE_COLUMNS).toLowerCase();
  const rowEntityId = pickFirstText(row, REFERENCE_ENTITY_ID_COLUMNS);
  const expectedRecipient = expectedCounterpartyId({ scenario: params.scenario, authorId: params.authorId });

  if (rowAuthor && rowAuthor !== params.authorId) return false;
  if (rowRecipient && expectedRecipient && rowRecipient !== expectedRecipient) return false;
  if (rowConnection && rowConnection !== params.scenario.connectionId) return false;

  // Preferred exact match.
  if (rowEntityId && rowEntityId === params.entityId) {
    if (!rowEntityType || rowEntityType === params.entityType || (params.entityType === "sync" && rowEntityType === "connection")) {
      return true;
    }
  }

  // For legacy rows without entity markers, fallback to same connection pair for sync references.
  if (params.entityType === "sync" && !rowEntityId) {
    if (rowConnection && rowConnection === params.scenario.connectionId) {
      return true;
    }
  }

  return false;
}

async function fetchReferenceRowsForAuthor(params: {
  adminClient: ReturnType<typeof createClient>;
  scenario: ReferencesScenario;
  authorId: string;
}) {
  const rowsById = new Map<string, Record<string, unknown>>();
  const pushRows = (rows: Array<Record<string, unknown>>) => {
    rows.forEach((row) => {
      const id = pickFirstText(row, ["id"]);
      if (id) {
        rowsById.set(id, row);
        return;
      }
      rowsById.set(`${rowsById.size}:${JSON.stringify(row)}`, row);
    });
  };

  for (const authorColumn of REFERENCE_AUTHOR_COLUMNS) {
    const byAuthor = await params.adminClient.from("references").select("*").eq(authorColumn, params.authorId).limit(1000);
    if (!byAuthor.error) {
      pushRows((byAuthor.data ?? []) as Array<Record<string, unknown>>);
      continue;
    }
    if (!isMissingSchemaError(byAuthor.error.message)) {
      throw byAuthor.error;
    }
  }

  if (rowsById.size === 0) {
    for (const connectionColumn of REFERENCE_CONNECTION_COLUMNS) {
      const byConnection = await params.adminClient
        .from("references")
        .select("*")
        .eq(connectionColumn, params.scenario.connectionId)
        .limit(1000);
      if (!byConnection.error) {
        pushRows((byConnection.data ?? []) as Array<Record<string, unknown>>);
        continue;
      }
      if (!isMissingSchemaError(byConnection.error.message)) {
        throw byConnection.error;
      }
    }
  }

  return Array.from(rowsById.values());
}

function buildSeedContext(): SeedContext {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return {
      ready: false,
      reason: "Missing Supabase env vars for deterministic references e2e bootstrap.",
    };
  }

  return {
    ready: true,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    authorEmail: withNamespacedEmail(
      env("PLAYWRIGHT_E2E_REFERENCE_AUTHOR_EMAIL") || "conxion.e2e.reference.author@local.test"
    ),
    recipientEmail: withNamespacedEmail(
      env("PLAYWRIGHT_E2E_REFERENCE_RECIPIENT_EMAIL") || "conxion.e2e.reference.recipient@local.test"
    ),
    password: env("PLAYWRIGHT_E2E_PASSWORD") || "ConXionE2E!12345",
    authorName: "Reference Author E2E",
    recipientName: "Reference Recipient E2E",
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
  if (updated.error) throw updated.error;

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

async function ensureAcceptedConnection(
  adminClient: ReturnType<typeof createClient>,
  authorClient: ReturnType<typeof createClient>,
  recipientClient: ReturnType<typeof createClient>,
  authorId: string,
  recipientId: string
) {
  const pairFilter = `and(requester_id.eq.${authorId},target_id.eq.${recipientId}),and(requester_id.eq.${recipientId},target_id.eq.${authorId})`;

  const existing = await adminClient
    .from("connections")
    .select("id,requester_id,target_id,status")
    .or(pairFilter)
    .order("created_at", { ascending: false })
    .limit(10);
  if (existing.error) throw existing.error;

  const accepted = ((existing.data ?? []) as ConnectionRow[]).find((row) => row.status === "accepted" && row.id);
  if (accepted?.id) return accepted.id;

  const createReq = await authorClient.rpc("create_connection_request", {
    p_target_id: recipientId,
    p_context: "member",
    p_connect_reason: "Playwright references seed",
    p_connect_reason_role: null,
    p_trip_id: null,
    p_note: "Deterministic references setup",
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
    const accepter = firstPending.target_id === recipientId ? recipientClient : authorClient;
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
  if (!acceptedAfter?.id) throw new Error("Unable to create accepted connection for references e2e seed.");
  return acceptedAfter.id;
}

async function resetReferencesState(
  adminClient: ReturnType<typeof createClient>,
  params: {
    connectionId: string;
    authorId: string;
    recipientId: string;
  }
) {
  for (const connectionColumn of ["connection_id", "connection_request_id"]) {
    const clearRefsByConnection = await adminClient.from("references").delete().eq(connectionColumn, params.connectionId);
    if (clearRefsByConnection.error && !isMissingSchemaError(clearRefsByConnection.error.message)) {
      throw clearRefsByConnection.error;
    }
  }

  for (const authorColumn of ["author_id", "from_user_id", "source_id"]) {
    const clearByAuthor = await adminClient
      .from("references")
      .delete()
      .in(authorColumn, [params.authorId, params.recipientId]);
    if (clearByAuthor.error && !isMissingSchemaError(clearByAuthor.error.message)) {
      throw clearByAuthor.error;
    }
  }

  for (const recipientColumn of ["recipient_id", "to_user_id", "target_id"]) {
    const clearByRecipient = await adminClient
      .from("references")
      .delete()
      .in(recipientColumn, [params.authorId, params.recipientId]);
    if (clearByRecipient.error && !isMissingSchemaError(clearByRecipient.error.message)) {
      throw clearByRecipient.error;
    }
  }

  const candidateIds = new Set<string>();
  const collectIds = (rows: Array<{ id?: string | null }> | null | undefined) => {
    (rows ?? []).forEach((row) => {
      if (typeof row.id === "string" && row.id) {
        candidateIds.add(row.id);
      }
    });
  };

  for (const authorColumn of ["author_id", "from_user_id", "source_id"]) {
    const byAuthor = await adminClient
      .from("references")
      .select("id")
      .in(authorColumn, [params.authorId, params.recipientId])
      .limit(2000);
    if (!byAuthor.error) {
      collectIds((byAuthor.data ?? []) as Array<{ id?: string | null }>);
      continue;
    }
    if (!isMissingSchemaError(byAuthor.error.message)) {
      throw byAuthor.error;
    }
  }

  for (const recipientColumn of ["recipient_id", "to_user_id", "target_id"]) {
    const byRecipient = await adminClient
      .from("references")
      .select("id")
      .in(recipientColumn, [params.authorId, params.recipientId])
      .limit(2000);
    if (!byRecipient.error) {
      collectIds((byRecipient.data ?? []) as Array<{ id?: string | null }>);
      continue;
    }
    if (!isMissingSchemaError(byRecipient.error.message)) {
      throw byRecipient.error;
    }
  }

  for (const connectionColumn of ["connection_id", "connection_request_id"]) {
    const byConnection = await adminClient
      .from("references")
      .select("id")
      .eq(connectionColumn, params.connectionId)
      .limit(2000);
    if (!byConnection.error) {
      collectIds((byConnection.data ?? []) as Array<{ id?: string | null }>);
      continue;
    }
    if (!isMissingSchemaError(byConnection.error.message)) {
      throw byConnection.error;
    }
  }

  if (candidateIds.size > 0) {
    const ids = Array.from(candidateIds);
    const clearByIds = await adminClient.from("references").delete().in("id", ids);
    if (clearByIds.error && !isMissingSchemaError(clearByIds.error.message)) {
      throw clearByIds.error;
    }
  }

  const clearNotifications = await adminClient
    .from("notifications")
    .delete()
    .in("user_id", [params.authorId, params.recipientId])
    .eq("kind", "reference_received");
  if (clearNotifications.error && !isMissingSchemaError(clearNotifications.error.message)) {
    throw clearNotifications.error;
  }

  const clearConnectionSyncs = await adminClient.from("connection_syncs").delete().eq("connection_id", params.connectionId);
  if (clearConnectionSyncs.error && !isMissingSchemaError(clearConnectionSyncs.error.message)) {
    throw clearConnectionSyncs.error;
  }

  const clearLegacySyncs = await adminClient.from("syncs").delete().eq("connection_id", params.connectionId);
  if (clearLegacySyncs.error && !isMissingSchemaError(clearLegacySyncs.error.message)) {
    throw clearLegacySyncs.error;
  }
}

async function seedCompletedSyncs(
  adminClient: ReturnType<typeof createClient>,
  params: { connectionId: string; authorId: string; recipientId: string }
): Promise<{ recentSyncId: string; oldSyncId: string }> {
  const recentCompletedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const oldCompletedAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

  const inserted = await adminClient
    .from("connection_syncs")
    .insert([
      {
        connection_id: params.connectionId,
        requester_id: params.authorId,
        recipient_id: params.recipientId,
        sync_type: "training",
        scheduled_at: null,
        note: "E2E reference recent completed sync",
        status: "completed",
        completed_at: recentCompletedAt,
      },
      {
        connection_id: params.connectionId,
        requester_id: params.authorId,
        recipient_id: params.recipientId,
        sync_type: "workshop",
        scheduled_at: null,
        note: "E2E reference old completed sync",
        status: "completed",
        completed_at: oldCompletedAt,
      },
    ])
    .select("id,completed_at");

  if (inserted.error) throw inserted.error;

  const rows = (inserted.data ?? []) as Array<{ id?: string; completed_at?: string | null }>;
  const recent = rows.find((row) => row.completed_at === recentCompletedAt && row.id)?.id ?? rows[0]?.id ?? null;
  const old =
    rows.find((row) => row.completed_at === oldCompletedAt && row.id)?.id ?? rows[rows.length - 1]?.id ?? null;

  if (!recent || !old) {
    throw new Error("Unable to resolve deterministic completed sync ids for references seed.");
  }

  const legacyInsertWithIds = await adminClient.from("syncs").insert([
    {
      id: recent,
      connection_id: params.connectionId,
      completed_by: params.authorId,
      completed_at: recentCompletedAt,
      note: "E2E reference recent legacy sync",
    },
    {
      id: old,
      connection_id: params.connectionId,
      completed_by: params.recipientId,
      completed_at: oldCompletedAt,
      note: "E2E reference old legacy sync",
    },
  ]);
  if (legacyInsertWithIds.error && !isMissingSchemaError(legacyInsertWithIds.error.message)) {
    const fallbackInsert = await adminClient.from("syncs").insert([
      {
        connection_id: params.connectionId,
        completed_by: params.authorId,
        completed_at: recentCompletedAt,
        note: "E2E reference recent legacy sync",
      },
      {
        connection_id: params.connectionId,
        completed_by: params.recipientId,
        completed_at: oldCompletedAt,
        note: "E2E reference old legacy sync",
      },
    ]);
    if (fallbackInsert.error && !isMissingSchemaError(fallbackInsert.error.message)) {
      throw fallbackInsert.error;
    }
  }

  return { recentSyncId: recent, oldSyncId: old };
}

async function detectRpcSupport(
  client: ReturnType<typeof createClient>,
  fnName: "create_reference_v2" | "update_reference_author" | "reply_reference_receiver",
  args: Record<string, unknown>
) {
  const probe = await client.rpc(fnName, args);
  if (!probe.error) return true;

  const msg = probe.error.message.toLowerCase();
  if (msg.includes("could not find the function")) return false;
  if (msg.includes("function") && msg.includes(fnName)) return false;
  if (msg.includes("schema cache")) return false;
  if (msg.includes("does not exist")) return false;
  if (msg.includes("column")) return false;
  if (msg.includes("\"sync_id\"")) return false;
  return true;
}

async function gotoWithRetry(page: Page, url: string, attempts = 4) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await page.waitForTimeout(400 * attempt);
    }
  }
  throw lastError ?? new Error(`Failed to navigate to ${url}`);
}

async function loginPageWithPasswordSession(
  page: Page,
  anonClient: ReturnType<typeof createClient>,
  supabaseUrl: string,
  email: string,
  password: string
) {
  const signIn = await withNetworkRetries(() => anonClient.auth.signInWithPassword({ email, password }));
  if (signIn.error || !signIn.data.session) {
    throw signIn.error ?? new Error("Missing session after sign in");
  }

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const storageKeys = [`sb-${projectRef}-auth-token`, "supabase.auth.token"];
  const sessionPayload = signIn.data.session;

  await page.addInitScript(
    ({ keys, payload }) => {
      const serialized = JSON.stringify(payload);
      keys.forEach((key) => {
        window.localStorage.setItem(key, serialized);
        window.sessionStorage.setItem(key, serialized);
      });
    },
    {
      keys: storageKeys,
      payload: sessionPayload,
    }
  );

  await gotoWithRetry(page, "/auth");
  await page.evaluate(
    ({ keys, payload }) => {
      const serialized = JSON.stringify(payload);
      keys.forEach((key) => {
        window.localStorage.setItem(key, serialized);
        window.sessionStorage.setItem(key, serialized);
      });
    },
    {
      keys: storageKeys,
      payload: sessionPayload,
    }
  );
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 25_000 });
      break;
    } catch (error) {
      if (attempt >= 3) throw error;
      await page.waitForTimeout(350 * attempt);
    }
  }
}

async function ensureReferencesScenario(): Promise<BootstrapResult> {
  const context = buildSeedContext();
  if (!context.ready) return context;

  const adminClient = createClient(context.supabaseUrl, context.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authorClient = createClient(context.supabaseUrl, context.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const recipientClient = createClient(context.supabaseUrl, context.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authorId = await ensureUser(adminClient, {
    email: context.authorEmail,
    password: context.password,
    displayName: context.authorName,
    city: "Tallinn",
    country: "Estonia",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(context.authorEmail)}`,
    primaryStyle: "bachata",
  });

  const recipientId = await ensureUser(adminClient, {
    email: context.recipientEmail,
    password: context.password,
    displayName: context.recipientName,
    city: "Lisbon",
    country: "Portugal",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(context.recipientEmail)}`,
    primaryStyle: "salsa",
  });

  const authorSignIn = await withNetworkRetries(() =>
    authorClient.auth.signInWithPassword({ email: context.authorEmail, password: context.password })
  );
  if (authorSignIn.error || !authorSignIn.data.session) {
    throw authorSignIn.error ?? new Error("Failed to sign in author for references e2e seed.");
  }

  const recipientSignIn = await withNetworkRetries(() =>
    recipientClient.auth.signInWithPassword({
      email: context.recipientEmail,
      password: context.password,
    })
  );
  if (recipientSignIn.error || !recipientSignIn.data.session) {
    throw recipientSignIn.error ?? new Error("Failed to sign in recipient for references e2e seed.");
  }

  const connectionId = await ensureAcceptedConnection(adminClient, authorClient, recipientClient, authorId, recipientId);
  await resetReferencesState(adminClient, { connectionId, authorId, recipientId });

  const { recentSyncId, oldSyncId } = await seedCompletedSyncs(adminClient, {
    connectionId,
    authorId,
    recipientId,
  });

  const zeroUuid = "00000000-0000-0000-0000-000000000000";
  const supportsV2 = await detectRpcSupport(authorClient, "create_reference_v2", {
    p_connection_id: zeroUuid,
    p_entity_type: "sync",
    p_entity_id: zeroUuid,
    p_recipient_id: recipientId,
    p_sentiment: "positive",
    p_body: "E2E support probe body",
  });

  const supportsEdit = await detectRpcSupport(authorClient, "update_reference_author", {
    p_reference_id: zeroUuid,
    p_sentiment: "neutral",
    p_body: "E2E support probe edit",
  });

  const supportsReply = await detectRpcSupport(recipientClient, "reply_reference_receiver", {
    p_reference_id: zeroUuid,
    p_reply_text: "ok",
  });

  return {
    ready: true,
    scenario: {
      connectionId,
      authorId,
      recipientId,
      authorEmail: context.authorEmail,
      recipientEmail: context.recipientEmail,
      authorName: context.authorName,
      recipientName: context.recipientName,
      password: context.password,
      recentSyncId,
      oldSyncId,
      supportsV2,
      supportsEdit,
      supportsReply,
    },
  };
}

export async function bootstrapReferencesE2E(
  page: Page,
  actor: "author" | "recipient"
): Promise<BootstrapResult> {
  const seeded = await ensureReferencesScenario();
  if (!seeded.ready) return seeded;

  const context = buildSeedContext();
  if (!context.ready) return context;

  const browserAnonClient = createClient(context.supabaseUrl, context.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const loginEmail = actor === "author" ? seeded.scenario.authorEmail : seeded.scenario.recipientEmail;
  await loginPageWithPasswordSession(page, browserAnonClient, context.supabaseUrl, loginEmail, seeded.scenario.password);
  await gotoWithRetry(page, `/references?connectionId=${seeded.scenario.connectionId}`);
  await page.waitForLoadState("domcontentloaded");

  return seeded;
}

export async function fetchReferencesUserAccessToken(params: {
  scenario: ReferencesScenario;
  actor: "author" | "recipient";
}): Promise<string> {
  const context = buildSeedContext();
  if (!context.ready) {
    throw new Error(context.reason);
  }

  const anonClient = createClient(context.supabaseUrl, context.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = params.actor === "author" ? params.scenario.authorEmail : params.scenario.recipientEmail;
  const signIn = await withNetworkRetries(() =>
    anonClient.auth.signInWithPassword({
      email,
      password: params.scenario.password,
    })
  );
  if (signIn.error || !signIn.data.session?.access_token) {
    throw signIn.error ?? new Error(`Failed to sign in ${params.actor} for references token.`);
  }

  return signIn.data.session.access_token;
}

export async function fetchReferenceByEntity(params: {
  scenario: ReferencesScenario;
  authorId: string;
  entityType: "sync" | "trip" | "event" | "connection";
  entityId: string;
}): Promise<ReferenceLookup | null> {
  const context = buildSeedContext();
  if (!context.ready) {
    throw new Error(context.reason);
  }

  const adminClient = createClient(context.supabaseUrl, context.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = await fetchReferenceRowsForAuthor({
    adminClient,
    scenario: params.scenario,
    authorId: params.authorId,
  });
  const matches = rows.filter((row) => referenceRowMatchesEntity(row, params));
  if (matches.length === 0) return null;

  matches.sort((a, b) => createdAtScore(b) - createdAtScore(a));
  const row = matches[0];

  const referenceId = pickFirstText(row, ["id"]) || `${params.entityType}:${params.entityId}:${createdAtScore(row)}`;
  const sentiment = sentimentFromRow(row);
  const body = pickFirstText(row, REFERENCE_BODY_COLUMNS);
  const entityType = pickFirstText(row, REFERENCE_ENTITY_TYPE_COLUMNS).toLowerCase() || params.entityType;
  const entityId = pickFirstText(row, REFERENCE_ENTITY_ID_COLUMNS) || params.entityId;
  const editCount = pickFirstNumber(row, ["edit_count"]);
  const replyText = pickFirstOptionalText(row, REFERENCE_REPLY_COLUMNS);

  return {
    id: referenceId,
    sentiment,
    body,
    entityType,
    entityId,
    editCount,
    replyText,
  };
}

export async function waitForReferenceByEntity(params: {
  scenario: ReferencesScenario;
  authorId: string;
  entityType: "sync" | "trip" | "event" | "connection";
  entityId: string;
  timeoutMs?: number;
}): Promise<ReferenceLookup | null> {
  const timeoutMs = params.timeoutMs ?? 10_000;
  const started = Date.now();

  while (Date.now() - started <= timeoutMs) {
    const row = await fetchReferenceByEntity(params);
    if (row?.id) return row;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  return null;
}

export async function waitForReferenceNotification(params: {
  scenario: ReferencesScenario;
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
      .select("id,created_at")
      .eq("user_id", params.userId)
      .eq("kind", "reference_received")
      .order("created_at", { ascending: false })
      .limit(1);

    if (res.error) {
      if (isMissingSchemaError(res.error.message)) {
        throw new Error(
          "Notifications schema missing or outdated. Apply scripts/sql/2026-02-15_threads_trips_syncs_notifications.sql and scripts/sql/2026-02-19_notifications_hardening.sql."
        );
      }
      throw res.error;
    }

    const rows = (res.data ?? []) as Array<{ created_at?: string | null }>;
    if (rows.length > 0) {
      const createdAt = rows[0]?.created_at ?? null;
      if (!createdAt) return true;
      const ts = Date.parse(createdAt);
      if (!Number.isFinite(ts)) return true;
      if (ts >= started - 120_000) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return false;
}

export async function countReferencesByEntity(params: {
  scenario: ReferencesScenario;
  authorId: string;
  entityType: "sync" | "trip" | "event" | "connection";
  entityId: string;
}): Promise<number> {
  const context = buildSeedContext();
  if (!context.ready) {
    throw new Error(context.reason);
  }

  const adminClient = createClient(context.supabaseUrl, context.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = await fetchReferenceRowsForAuthor({
    adminClient,
    scenario: params.scenario,
    authorId: params.authorId,
  });
  const matches = rows.filter((row) => referenceRowMatchesEntity(row, params));
  const uniqueIds = new Set<string>();
  matches.forEach((row, index) => {
    const id = pickFirstText(row, ["id"]) || `row-${index}-${createdAtScore(row)}`;
    uniqueIds.add(id);
  });
  return uniqueIds.size;
}
