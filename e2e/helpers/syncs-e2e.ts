import fs from "node:fs";
import path from "node:path";
import { createClient, type Session } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

type BootstrapResult =
  | { ready: true; scenario: SyncScenario }
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
      requesterEmail: string;
      recipientEmail: string;
      password: string;
      requesterName: string;
      recipientName: string;
    }
  | {
      ready: false;
      reason: string;
    };

type SyncSeedRuntime = {
  ready: true;
  adminClient: ReturnType<typeof createClient>;
  requesterClient: ReturnType<typeof createClient>;
  recipientClient: ReturnType<typeof createClient>;
  requesterSession: Session;
  recipientSession: Session;
  requesterId: string;
  recipientId: string;
  supabaseUrl: string;
  anonKey: string;
  requesterEmail: string;
  recipientEmail: string;
  requesterName: string;
  recipientName: string;
  password: string;
};

type ConnectionRow = {
  id?: string;
  requester_id?: string;
  target_id?: string;
  status?: string;
};

export type SyncScenario = {
  connectionId: string;
  requesterId: string;
  recipientId: string;
  requesterEmail: string;
  recipientEmail: string;
  requesterName: string;
  recipientName: string;
  password: string;
  pendingSyncId: string | null;
};

let cachedDotenv: Record<string, string> | null = null;
let cachedSyncSeedRuntimePromise: Promise<SyncSeedRuntime | { ready: false; reason: string }> | null = null;

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
    .slice(0, 12);
}

function withNamespacedEmail(baseEmail: string) {
  const explicit = env("PLAYWRIGHT_E2E_NAMESPACE");
  const implicit =
    process.env.GITHUB_ACTIONS === "true"
      ? `${env("GITHUB_RUN_ID")}-${env("GITHUB_RUN_ATTEMPT")}-${env("GITHUB_JOB")}`
      : "";
  const workerIndex = process.env.TEST_WORKER_INDEX?.trim();
  const localDaily = `p${process.pid.toString(36)}-d${new Date().toISOString().slice(0, 10).replace(/-/g, "")}${workerIndex ? `-w${workerIndex}` : ""}`;
  const namespace = sanitizeNamespace(explicit || implicit || localDaily);
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

function shouldFallbackSyncRpc(message: string) {
  const text = message.toLowerCase();
  return text.includes("function") || text.includes("relation") || text.includes("schema cache") || text.includes("column");
}

function shouldFallbackAcceptedConnectionRpc(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("threads_type_chk") ||
    text.includes("cx_ensure_pair_thread") ||
    text.includes("direct_user_low") ||
    text.includes("direct_user_high") ||
    (text.includes("thread") && text.includes("constraint")) ||
    (text.includes("thread_type") && text.includes("check"))
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
    text.includes("network") ||
    text.includes("rate limit reached") ||
    text.includes("too many requests")
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

function buildSeedContext(): SeedContext {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return {
      ready: false,
      reason: "Missing Supabase env vars for deterministic sync e2e bootstrap.",
    };
  }

  return {
    ready: true,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    requesterEmail: withNamespacedEmail(
      env("PLAYWRIGHT_E2E_SYNC_REQUESTER_EMAIL") || "conxion.e2e.sync.requester@local.test"
    ),
    recipientEmail: withNamespacedEmail(
      env("PLAYWRIGHT_E2E_SYNC_RECIPIENT_EMAIL") || "conxion.e2e.sync.recipient@local.test"
    ),
    password: env("PLAYWRIGHT_E2E_PASSWORD") || "ConXionE2E!12345",
    requesterName: "Sync Requester E2E",
    recipientName: "Sync Recipient E2E",
  };
}

async function ensureUser(
  adminClient: ReturnType<typeof createClient>,
  signInClient: ReturnType<typeof createClient>,
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
  let userId: string | null = null;

  try {
    const created = await withNetworkRetries(() =>
      adminClient.auth.admin.createUser({
        email: params.email,
        password: params.password,
        email_confirm: true,
        user_metadata: { display_name: params.displayName },
      })
    );
    if (created.error && !isLikelyAlreadyExistsError(created.error.message)) throw created.error;
    if (!created.error) {
      userId = created.data.user.id;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isLikelyAlreadyExistsError(message)) {
      throw error;
    }
  }

  if (!userId) {
    const signedIn = await withNetworkRetries(() =>
      signInClient.auth.signInWithPassword({
        email: params.email,
        password: params.password,
      })
    );
    if (signedIn.error || !signedIn.data.user?.id) {
      throw signedIn.error ?? new Error(`Unable to resolve user id for ${params.email}`);
    }
    userId = signedIn.data.user.id;
  }

  const updated = await withNetworkRetries(() =>
    adminClient.auth.admin.updateUserById(userId, {
      email_confirm: true,
      password: params.password,
      user_metadata: { display_name: params.displayName },
    })
  );
  if (updated.error) throw updated.error;

  const profileUpsert = await adminClient.from("profiles").upsert(
    {
      user_id: userId,
      display_name: params.displayName,
      username: `pw${userId.replace(/-/g, "").slice(0, 12)}`,
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
  );
  if (profileUpsert.error) throw profileUpsert.error;

  return userId;
}

async function ensureAcceptedConnection(
  adminClient: ReturnType<typeof createClient>,
  requesterClient: ReturnType<typeof createClient>,
  recipientClient: ReturnType<typeof createClient>,
  requesterId: string,
  recipientId: string
) {
  const pairFilter = `and(requester_id.eq.${requesterId},target_id.eq.${recipientId}),and(requester_id.eq.${recipientId},target_id.eq.${requesterId})`;

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
    p_target_id: recipientId,
    p_context: "member",
    p_connect_reason: "Playwright sync seed",
    p_connect_reason_role: null,
    p_trip_id: null,
    p_note: "Deterministic sync setup",
  });
  if (createReq.error) {
    const msg = createReq.error.message.toLowerCase();
    if (!msg.includes("already_pending_or_connected")) {
      if (shouldFallbackAcceptedConnectionRpc(msg)) {
        throw new Error(
          "connection_thread_schema_outdated: apply scripts/sql/2026-03-09_unified_inbox_request_threads.sql and scripts/sql/2026-03-11_pair_threads_chat_unlock.sql"
        );
      }
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
    const accepter = firstPending.target_id === recipientId ? recipientClient : requesterClient;
    const accept = await accepter.rpc("accept_connection_request", { p_connection_id: firstPending.id });
    if (accept.error) {
      if (!shouldFallbackAcceptedConnectionRpc(accept.error.message)) throw accept.error;
      const fallbackAccept = await adminClient
        .from("connections")
        .update({ status: "accepted" })
        .eq("id", firstPending.id)
        .eq("status", "pending");
      if (fallbackAccept.error) {
        if (shouldFallbackAcceptedConnectionRpc(fallbackAccept.error.message)) {
          throw new Error(
            "connection_thread_schema_outdated: apply scripts/sql/2026-03-09_unified_inbox_request_threads.sql and scripts/sql/2026-03-11_pair_threads_chat_unlock.sql"
          );
        }
        throw fallbackAccept.error;
      }
    }
  }

  const after = await adminClient
    .from("connections")
    .select("id,requester_id,target_id,status")
    .or(pairFilter)
    .order("created_at", { ascending: false })
    .limit(10);
  if (after.error) throw after.error;
  const acceptedAfter = ((after.data ?? []) as ConnectionRow[]).find((row) => row.status === "accepted" && row.id);
  if (!acceptedAfter?.id) throw new Error("Unable to create accepted connection for sync e2e seed.");
  return acceptedAfter.id;
}

async function resetConnectionSyncState(
  adminClient: ReturnType<typeof createClient>,
  connectionId: string,
  requesterId: string,
  recipientId: string
) {
  const clearConnectionSyncs = await adminClient.from("connection_syncs").delete().eq("connection_id", connectionId);
  if (clearConnectionSyncs.error && !isMissingSchemaError(clearConnectionSyncs.error.message)) {
    throw clearConnectionSyncs.error;
  }

  const clearLegacySyncs = await adminClient.from("syncs").delete().eq("connection_id", connectionId);
  if (clearLegacySyncs.error && !isMissingSchemaError(clearLegacySyncs.error.message)) {
    throw clearLegacySyncs.error;
  }

  const clearNotifications = await adminClient
    .from("notifications")
    .delete()
    .in("user_id", [requesterId, recipientId])
    .in("kind", ["sync_proposed", "sync_accepted", "sync_declined", "sync_completed"]);
  if (clearNotifications.error && !isMissingSchemaError(clearNotifications.error.message)) {
    throw clearNotifications.error;
  }
}

async function createPendingSync(
  adminClient: ReturnType<typeof createClient>,
  requesterClient: ReturnType<typeof createClient>,
  params: {
    connectionId: string;
    requesterId: string;
    recipientId: string;
  }
) {
  const rpc = await requesterClient.rpc("propose_connection_sync", {
    p_connection_id: params.connectionId,
    p_sync_type: "training",
    p_scheduled_at: null,
    p_note: "E2E pending sync",
  });

  if (rpc.error) {
    if (!shouldFallbackSyncRpc(rpc.error.message)) throw rpc.error;
    const fallback = await adminClient.from("connection_syncs").insert({
      connection_id: params.connectionId,
      requester_id: params.requesterId,
      recipient_id: params.recipientId,
      sync_type: "training",
      scheduled_at: null,
      note: "E2E pending sync",
      status: "pending",
    });
    if (fallback.error) throw fallback.error;
  }

  const latest = await adminClient
    .from("connection_syncs")
    .select("id")
    .eq("connection_id", params.connectionId)
    .eq("requester_id", params.requesterId)
    .eq("recipient_id", params.recipientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw latest.error;

  const syncId = (latest.data as { id?: string } | null)?.id ?? null;
  if (!syncId) throw new Error("Unable to resolve pending sync id after seed.");
  return syncId;
}

async function loginPageWithSession(page: Page, session: Session) {
  const hashParams = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: "bearer",
  });

  await page.goto(`/auth/callback#${hashParams.toString()}`);
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/callback"), { timeout: 20_000 });
}

async function getSyncSeedRuntime(): Promise<SyncSeedRuntime | { ready: false; reason: string }> {
  if (cachedSyncSeedRuntimePromise) {
    return cachedSyncSeedRuntimePromise;
  }

  cachedSyncSeedRuntimePromise = (async () => {
    const context = buildSeedContext();
    if (!context.ready) return context;

    try {
      const adminClient = createClient(context.supabaseUrl, context.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const requesterClient = createClient(context.supabaseUrl, context.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const recipientClient = createClient(context.supabaseUrl, context.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const requesterId = await ensureUser(adminClient, requesterClient, {
        email: context.requesterEmail,
        password: context.password,
        displayName: context.requesterName,
        city: "Tallinn",
        country: "Estonia",
        avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(context.requesterEmail)}`,
        primaryStyle: "bachata",
      });

      const recipientId = await ensureUser(adminClient, recipientClient, {
        email: context.recipientEmail,
        password: context.password,
        displayName: context.recipientName,
        city: "Lisbon",
        country: "Portugal",
        avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(context.recipientEmail)}`,
        primaryStyle: "salsa",
      });

      const requesterSignIn = await withNetworkRetries(() =>
        requesterClient.auth.signInWithPassword({
          email: context.requesterEmail,
          password: context.password,
        })
      );
      if (requesterSignIn.error || !requesterSignIn.data.session) {
        throw requesterSignIn.error ?? new Error("Failed to sign in requester for sync seed.");
      }

      const recipientSignIn = await withNetworkRetries(() =>
        recipientClient.auth.signInWithPassword({
          email: context.recipientEmail,
          password: context.password,
        })
      );
      if (recipientSignIn.error || !recipientSignIn.data.session) {
        throw recipientSignIn.error ?? new Error("Failed to sign in recipient for sync seed.");
      }

      return {
        ready: true,
        adminClient,
        requesterClient,
        recipientClient,
        requesterSession: requesterSignIn.data.session,
        recipientSession: recipientSignIn.data.session,
        requesterId,
        recipientId,
        supabaseUrl: context.supabaseUrl,
        anonKey: context.anonKey,
        requesterEmail: context.requesterEmail,
        recipientEmail: context.recipientEmail,
        requesterName: context.requesterName,
        recipientName: context.recipientName,
        password: context.password,
      };
    } catch (error) {
      cachedSyncSeedRuntimePromise = null;
      throw error;
    }
  })();

  return cachedSyncSeedRuntimePromise;
}

async function ensureSyncScenario(params: { seedPending: boolean }): Promise<BootstrapResult> {
  const runtime = await getSyncSeedRuntime();
  if (!runtime.ready) return runtime;

  const connectionId = await ensureAcceptedConnection(
    runtime.adminClient,
    runtime.requesterClient,
    runtime.recipientClient,
    runtime.requesterId,
    runtime.recipientId
  );

  await resetConnectionSyncState(runtime.adminClient, connectionId, runtime.requesterId, runtime.recipientId);

  let pendingSyncId: string | null = null;
  if (params.seedPending) {
    pendingSyncId = await createPendingSync(runtime.adminClient, runtime.requesterClient, {
      connectionId,
      requesterId: runtime.requesterId,
      recipientId: runtime.recipientId,
    });
  }

  return {
    ready: true,
    scenario: {
      connectionId,
      requesterId: runtime.requesterId,
      recipientId: runtime.recipientId,
      requesterEmail: runtime.requesterEmail,
      recipientEmail: runtime.recipientEmail,
      requesterName: runtime.requesterName,
      recipientName: runtime.recipientName,
      password: runtime.password,
      pendingSyncId,
    },
  };
}

export async function bootstrapSyncsE2E(
  page: Page,
  params: { actor: "requester" | "recipient"; seedPending: boolean }
): Promise<BootstrapResult> {
  const seeded = await ensureSyncScenario({ seedPending: params.seedPending });
  if (!seeded.ready) return seeded;

  const runtime = await getSyncSeedRuntime();
  if (!runtime.ready) return runtime;

  const session = params.actor === "requester" ? runtime.requesterSession : runtime.recipientSession;
  await loginPageWithSession(page, session);
  await page.goto(`/connections/${seeded.scenario.connectionId}`);
  await page.waitForLoadState("domcontentloaded");

  return seeded;
}

export async function fetchConnectionSyncStatus(params: {
  scenario: SyncScenario;
  syncId: string;
}): Promise<string | null> {
  const context = buildSeedContext();
  if (!context.ready) throw new Error(context.reason);

  const adminClient = createClient(context.supabaseUrl, context.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const syncRes = await adminClient
    .from("connection_syncs")
    .select("status")
    .eq("id", params.syncId)
    .eq("connection_id", params.scenario.connectionId)
    .maybeSingle();
  if (syncRes.error) {
    if (isMissingSchemaError(syncRes.error.message)) return null;
    throw syncRes.error;
  }
  return (syncRes.data as { status?: string } | null)?.status ?? null;
}

export async function waitForConnectionSyncStatus(params: {
  scenario: SyncScenario;
  syncId: string;
  status: "pending" | "accepted" | "declined" | "cancelled" | "completed";
  timeoutMs?: number;
}) {
  const timeoutMs = params.timeoutMs ?? 10_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const status = await fetchConnectionSyncStatus({ scenario: params.scenario, syncId: params.syncId });
    if (status === params.status) return true;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  return false;
}

export async function waitForSyncNotification(params: {
  scenario: SyncScenario;
  kind: "sync_proposed" | "sync_accepted" | "sync_declined" | "sync_completed";
  userId: string;
  syncId?: string | null;
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
      const connectionId = typeof metadata.connection_id === "string" ? metadata.connection_id : "";
      const syncId = typeof metadata.sync_id === "string" ? metadata.sync_id : "";
      if (params.syncId && syncId === params.syncId) return true;
      return connectionId === params.scenario.connectionId;
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
