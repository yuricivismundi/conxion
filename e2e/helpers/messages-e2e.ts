import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
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

const LOCAL_MANUAL_UNREAD_STORAGE_KEY = "cx_messages_manual_unread_v1";
const LOCAL_REACTIONS_STORAGE_KEY = "cx_messages_reactions_local_v1";
const LOCAL_THREAD_DRAFTS_STORAGE_KEY = "cx_messages_thread_drafts_v1";

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
    .slice(0, 12);
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

async function findUserIdByEmail(
  adminClient: ReturnType<typeof createClient>,
  email: string
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 5; page += 1) {
    const listed = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
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
    const created = await adminClient.auth.admin.createUser({
      email: params.email,
      password: params.password,
      email_confirm: true,
      user_metadata: { display_name: params.displayName },
    });
    if (created.error && !isLikelyAlreadyExistsError(created.error.message)) throw created.error;
    if (!created.error) userId = created.data.user.id;
  }

  if (!userId) {
    userId = await findUserIdByEmail(adminClient, params.email);
  }
  if (!userId) throw new Error(`Unable to resolve user id for ${params.email}`);

  const updated = await adminClient.auth.admin.updateUserById(userId, {
    email_confirm: true,
    password: params.password,
    user_metadata: { display_name: params.displayName },
  });
  if (updated.error) {
    throw updated.error;
  }

  const profileUpsert = await adminClient.from("profiles").upsert(
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

async function loginPageWithPasswordSession(
  page: Page,
  anonClient: ReturnType<typeof createClient>,
  email: string,
  password: string
) {
  const signIn = await anonClient.auth.signInWithPassword({ email, password });
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

async function ensureMessagesSeed() {
  const context = buildSeedContext();
  if (!context.ready) return context;

  const adminClient = createClient(context.supabaseUrl, context.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const requesterClient = createClient(context.supabaseUrl, context.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const targetClient = createClient(context.supabaseUrl, context.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const primaryId = await ensureUser(adminClient, {
    email: context.primaryEmail,
    password: context.password,
    displayName: "Playwright Primary",
    city: "Tallinn",
    country: "Estonia",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(context.primaryEmail)}`,
    primaryStyle: "bachata",
  });
  const secondaryId = await ensureUser(adminClient, {
    email: context.secondaryEmail,
    password: context.password,
    displayName: "Playwright Peer",
    city: "Lisbon",
    country: "Portugal",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(context.secondaryEmail)}`,
    primaryStyle: "salsa",
  });

  const requesterSignIn = await requesterClient.auth.signInWithPassword({
    email: context.primaryEmail,
    password: context.password,
  });
  if (requesterSignIn.error || !requesterSignIn.data.session) {
    throw requesterSignIn.error ?? new Error("Failed to sign in requester for e2e seed.");
  }

  const targetSignIn = await targetClient.auth.signInWithPassword({
    email: context.secondaryEmail,
    password: context.password,
  });
  if (targetSignIn.error || !targetSignIn.data.session) {
    throw targetSignIn.error ?? new Error("Failed to sign in target for e2e seed.");
  }

  const connectionId = await ensureAcceptedConnection(adminClient, requesterClient, targetClient, primaryId, secondaryId);
  await resetMessageSeedState(adminClient, {
    connectionId,
    primaryId,
    secondaryId,
  });
  await seedUnreadMessage(targetClient, connectionId);

  return {
    ready: true as const,
    supabaseUrl: context.supabaseUrl,
    anonKey: context.anonKey,
    primaryEmail: context.primaryEmail,
    password: context.password,
  };
}

export async function resetMessagesE2ESeed(): Promise<BootstrapResult> {
  const seedResult = await ensureMessagesSeed();
  if (!seedResult.ready) {
    return seedResult;
  }
  return { ready: true };
}

export async function bootstrapMessagesE2E(page: Page): Promise<BootstrapResult> {
  const seedResult = await ensureMessagesSeed();
  if (!seedResult.ready) {
    return seedResult;
  }

  const browserAnonClient = createClient(seedResult.supabaseUrl, seedResult.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await loginPageWithPasswordSession(page, browserAnonClient, seedResult.primaryEmail, seedResult.password);

  await page.goto("/messages");
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate((keys) => {
    keys.forEach((key) => window.localStorage.removeItem(key));
  }, [LOCAL_MANUAL_UNREAD_STORAGE_KEY, LOCAL_REACTIONS_STORAGE_KEY, LOCAL_THREAD_DRAFTS_STORAGE_KEY]);

  return { ready: true };
}
