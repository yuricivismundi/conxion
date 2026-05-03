import fs from "node:fs";
import path from "node:path";
import { createClient, type Session } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

type BootstrapResult =
  | { ready: true }
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

type SeedContext =
  | {
      ready: true;
      supabaseUrl: string;
      anonKey: string;
      serviceRoleKey: string;
      primaryEmail: string;
      secondaryEmail: string;
      password: string;
    }
  | {
      ready: false;
      reason: string;
    };

type MessagesSeedRuntime = {
  ready: true;
  adminClient: ReturnType<typeof createClient>;
  requesterClient: ReturnType<typeof createClient>;
  targetClient: ReturnType<typeof createClient>;
  requesterSession: Session;
  targetSession: Session;
  primaryId: string;
  secondaryId: string;
  supabaseUrl: string;
  anonKey: string;
  primaryEmail: string;
  password: string;
};

const LOCAL_MANUAL_UNREAD_STORAGE_KEY = "cx_messages_manual_unread_v1";
const LOCAL_REACTIONS_STORAGE_KEY = "cx_messages_reactions_local_v1";
const LOCAL_THREAD_DRAFTS_STORAGE_KEY = "cx_messages_thread_drafts_v1";

let cachedDotenv: Record<string, string> | null = null;
let cachedMessagesSeedRuntimePromise: Promise<MessagesSeedRuntime | { ready: false; reason: string }> | null = null;

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
  return (
    text.includes("already registered") ||
    text.includes("already been registered") ||
    text.includes("already exists") ||
    text.includes("duplicate")
  );
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

function isRetryableAuthError(error: unknown) {
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

async function withAuthRetries<T>(fn: () => Promise<T>, attempts = 5, baseDelayMs = 500): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableAuthError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  throw lastError ?? new Error("auth_retry_failed");
}

function buildSeedContext(): SeedContext {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return {
      ready: false,
      reason: "Missing Supabase env vars for deterministic e2e bootstrap.",
    };
  }

  return {
    ready: true,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    primaryEmail: withNamespacedEmail(env("PLAYWRIGHT_E2E_EMAIL") || "conxion.e2e.messages.primary@local.test"),
    secondaryEmail: withNamespacedEmail(
      env("PLAYWRIGHT_E2E_PEER_EMAIL") || "conxion.e2e.messages.peer@local.test"
    ),
    password: env("PLAYWRIGHT_E2E_PASSWORD") || "ConXionE2E!12345",
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
    const created = await withAuthRetries(() =>
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
    const signedIn = await withAuthRetries(() =>
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

  const updated = await withAuthRetries(() =>
    adminClient.auth.admin.updateUserById(userId, {
      email_confirm: true,
      password: params.password,
      user_metadata: { display_name: params.displayName },
    })
  );
  if (updated.error) {
    throw updated.error;
  }

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
    p_connect_reason: "Playwright seed",
    p_connect_reason_role: null,
    p_trip_id: null,
    p_note: "Deterministic thread setup",
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
    const accepter = firstPending.target_id === targetId ? targetClient : requesterClient;
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
  if (!acceptedAfter?.id) throw new Error("Unable to create accepted connection for e2e");
  return acceptedAfter.id;
}

async function ensureConnectionThread(
  adminClient: ReturnType<typeof createClient>,
  params: { connectionId: string; primaryId: string; secondaryId: string }
) {
  const existing = await adminClient.from("threads").select("id").eq("connection_id", params.connectionId).maybeSingle();
  if (existing.error) {
    if (isMissingSchemaError(existing.error.message)) return null;
    throw existing.error;
  }

  const existingId = (existing.data as { id?: string } | null)?.id ?? null;
  if (existingId) {
    return existingId;
  }

  const inserted = await adminClient
    .from("threads")
    .insert({
      thread_type: "connection",
      connection_id: params.connectionId,
      created_by: params.primaryId,
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (inserted.error) {
    if (isMissingSchemaError(inserted.error.message)) return null;
    throw inserted.error;
  }
  const createdId = (inserted.data as { id?: string } | null)?.id ?? null;
  if (!createdId) return null;

  const participants = await adminClient.from("thread_participants").upsert(
    [
      { thread_id: createdId, user_id: params.primaryId, role: "member" },
      { thread_id: createdId, user_id: params.secondaryId, role: "member" },
    ],
    { onConflict: "thread_id,user_id" }
  );
  if (participants.error && !isMissingSchemaError(participants.error.message)) {
    throw participants.error;
  }

  return createdId;
}

async function resetMessageSeedState(
  adminClient: ReturnType<typeof createClient>,
  params: {
    connectionId: string;
    primaryId: string;
    secondaryId: string;
  }
) {
  const threadId = await ensureConnectionThread(adminClient, params);

  if (threadId) {
    const resetPrefs = await adminClient
      .from("thread_participants")
      .update({
        archived_at: null,
        muted_until: null,
        pinned_at: null,
        last_read_at: null,
      })
      .eq("thread_id", threadId);

    if (resetPrefs.error) {
      if (!isMissingSchemaError(resetPrefs.error.message)) {
        throw resetPrefs.error;
      }
      const fallbackReset = await adminClient.from("thread_participants").update({ last_read_at: null }).eq("thread_id", threadId);
      if (fallbackReset.error && !isMissingSchemaError(fallbackReset.error.message)) {
        throw fallbackReset.error;
      }
    }
  }

  const clearConnectionReactions = await adminClient
    .from("message_reactions")
    .delete()
    .eq("thread_kind", "connection")
    .eq("thread_id", params.connectionId);
  if (clearConnectionReactions.error && !isMissingSchemaError(clearConnectionReactions.error.message)) {
    throw clearConnectionReactions.error;
  }

  if (threadId) {
    const clearActivityContexts = await adminClient
      .from("thread_contexts")
      .delete()
      .eq("thread_id", threadId)
      .eq("source_table", "activities");
    if (clearActivityContexts.error && !isMissingSchemaError(clearActivityContexts.error.message)) {
      throw clearActivityContexts.error;
    }

    const clearActivities = await adminClient.from("activities").delete().eq("thread_id", threadId);
    if (clearActivities.error && !isMissingSchemaError(clearActivities.error.message)) {
      throw clearActivities.error;
    }

    const clearThreadMessages = await adminClient.from("thread_messages").delete().eq("thread_id", threadId);
    if (clearThreadMessages.error && !isMissingSchemaError(clearThreadMessages.error.message)) {
      throw clearThreadMessages.error;
    }
  }

  const clearLegacyMessages = await adminClient.from("messages").delete().eq("connection_id", params.connectionId);
  if (clearLegacyMessages.error && !isMissingSchemaError(clearLegacyMessages.error.message)) {
    throw clearLegacyMessages.error;
  }
}

async function seedUnreadMessage(targetClient: ReturnType<typeof createClient>, connectionId: string) {
  const rpc = await targetClient.rpc("send_message", {
    p_connection_id: connectionId,
    p_body: "Unread ping from your connection.",
  });
  if (rpc.error) throw rpc.error;
}

async function gotoWithRetry(page: Page, url: string, attempts = 4) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "commit", timeout: 45_000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await page.waitForTimeout(400 * attempt);
    }
  }
  throw lastError ?? new Error(`Failed to navigate to ${url}`);
}

async function loginPageWithSession(page: Page, supabaseUrl: string, session: Session) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const storageKeys = [`sb-${projectRef}-auth-token`, "supabase.auth.token"];
  const sessionPayload = session;

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
}

async function getMessagesSeedRuntime(): Promise<MessagesSeedRuntime | { ready: false; reason: string }> {
  if (cachedMessagesSeedRuntimePromise) {
    return cachedMessagesSeedRuntimePromise;
  }

  cachedMessagesSeedRuntimePromise = (async () => {
    const context = buildSeedContext();
    if (!context.ready) return context;

    try {
      const adminClient = createClient(context.supabaseUrl, context.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const requesterClient = createClient(context.supabaseUrl, context.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const targetClient = createClient(context.supabaseUrl, context.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const primaryId = await ensureUser(adminClient, requesterClient, {
        email: context.primaryEmail,
        password: context.password,
        displayName: "Playwright Primary",
        city: "Tallinn",
        country: "Estonia",
        avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(context.primaryEmail)}`,
        primaryStyle: "bachata",
      });
      const secondaryId = await ensureUser(adminClient, targetClient, {
        email: context.secondaryEmail,
        password: context.password,
        displayName: "Playwright Peer",
        city: "Lisbon",
        country: "Portugal",
        avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(context.secondaryEmail)}`,
        primaryStyle: "salsa",
      });

      const requesterSignIn = await withAuthRetries(() =>
        requesterClient.auth.signInWithPassword({
          email: context.primaryEmail,
          password: context.password,
        })
      );
      if (requesterSignIn.error || !requesterSignIn.data.session) {
        throw requesterSignIn.error ?? new Error("Failed to sign in requester for e2e seed.");
      }

      const targetSignIn = await withAuthRetries(() =>
        targetClient.auth.signInWithPassword({
          email: context.secondaryEmail,
          password: context.password,
        })
      );
      if (targetSignIn.error || !targetSignIn.data.session) {
        throw targetSignIn.error ?? new Error("Failed to sign in target for e2e seed.");
      }

      return {
        ready: true,
        adminClient,
        requesterClient,
        targetClient,
        requesterSession: requesterSignIn.data.session,
        targetSession: targetSignIn.data.session,
        primaryId,
        secondaryId,
        supabaseUrl: context.supabaseUrl,
        anonKey: context.anonKey,
        primaryEmail: context.primaryEmail,
        password: context.password,
      };
    } catch (error) {
      cachedMessagesSeedRuntimePromise = null;
      throw error;
    }
  })();

  return cachedMessagesSeedRuntimePromise;
}

async function ensureMessagesSeed() {
  const runtime = await getMessagesSeedRuntime();
  if (!runtime.ready) return runtime;

  const connectionId = await ensureAcceptedConnection(
    runtime.adminClient,
    runtime.requesterClient,
    runtime.targetClient,
    runtime.primaryId,
    runtime.secondaryId
  );
  await resetMessageSeedState(runtime.adminClient, {
    connectionId,
    primaryId: runtime.primaryId,
    secondaryId: runtime.secondaryId,
  });
  await seedUnreadMessage(runtime.targetClient, connectionId);

  return {
    ready: true as const,
    supabaseUrl: runtime.supabaseUrl,
    anonKey: runtime.anonKey,
    primaryEmail: runtime.primaryEmail,
    password: runtime.password,
    requesterSession: runtime.requesterSession,
    targetSession: runtime.targetSession,
  };
}

export async function resetMessagesE2ESeed(): Promise<BootstrapResult> {
  const seedResult = await ensureMessagesSeed();
  if (!seedResult.ready) {
    return seedResult;
  }
  return { ready: true };
}

export async function bootstrapMessagesPeerE2E(
  page: Page,
  options?: {
    initialPath?: string;
  }
): Promise<BootstrapResult> {
  const seedResult = await ensureMessagesSeed();
  if (!seedResult.ready) {
    return seedResult;
  }

  await loginPageWithSession(page, seedResult.supabaseUrl, seedResult.targetSession);

  await gotoWithRetry(page, options?.initialPath ?? "/messages");
  await page.waitForLoadState("domcontentloaded");

  if (!options?.initialPath || options.initialPath.startsWith("/messages")) {
    await page.evaluate((keys) => {
      keys.forEach((key) => window.localStorage.removeItem(key));
    }, [LOCAL_MANUAL_UNREAD_STORAGE_KEY, LOCAL_REACTIONS_STORAGE_KEY, LOCAL_THREAD_DRAFTS_STORAGE_KEY]);
  }

  return { ready: true };
}

export async function bootstrapMessagesAuthE2E(
  page: Page,
  options?: {
    initialPath?: string;
  }
): Promise<BootstrapResult> {
  const runtime = await getMessagesSeedRuntime();
  if (!runtime.ready) {
    return runtime;
  }

  await loginPageWithSession(page, runtime.supabaseUrl, runtime.requesterSession);
  await gotoWithRetry(page, options?.initialPath ?? "/");
  await page.waitForLoadState("domcontentloaded");

  return { ready: true };
}

export async function bootstrapMessagesE2E(
  page: Page,
  options?: {
    initialPath?: string;
  }
): Promise<BootstrapResult> {
  const seedResult = await ensureMessagesSeed();
  if (!seedResult.ready) {
    return seedResult;
  }

  await loginPageWithSession(page, seedResult.supabaseUrl, seedResult.requesterSession);

  await gotoWithRetry(page, options?.initialPath ?? "/messages");
  await page.waitForLoadState("domcontentloaded");
  if (!options?.initialPath || options.initialPath.startsWith("/messages")) {
    await page.evaluate((keys) => {
      keys.forEach((key) => window.localStorage.removeItem(key));
    }, [LOCAL_MANUAL_UNREAD_STORAGE_KEY, LOCAL_REACTIONS_STORAGE_KEY, LOCAL_THREAD_DRAFTS_STORAGE_KEY]);
  }

  return { ready: true };
}
