import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
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

function shouldFallbackSyncRpc(message: string) {
  const text = message.toLowerCase();
  return text.includes("function") || text.includes("relation") || text.includes("schema cache") || text.includes("column");
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
    requesterEmail: env("PLAYWRIGHT_E2E_SYNC_REQUESTER_EMAIL") || "conxion.e2e.sync.requester@local.test",
    recipientEmail: env("PLAYWRIGHT_E2E_SYNC_RECIPIENT_EMAIL") || "conxion.e2e.sync.recipient@local.test",
    password: env("PLAYWRIGHT_E2E_PASSWORD") || "ConXionE2E!12345",
    requesterName: "Sync Requester E2E",
    recipientName: "Sync Recipient E2E",
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
  if (updated.error) throw updated.error;

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

async function ensureSyncScenario(params: { seedPending: boolean }): Promise<BootstrapResult> {
  const context = buildSeedContext();
  if (!context.ready) return context;

  const adminClient = createClient(context.supabaseUrl, context.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const requesterClient = createClient(context.supabaseUrl, context.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const recipientClient = createClient(context.supabaseUrl, context.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const requesterId = await ensureUser(adminClient, {
    email: context.requesterEmail,
    password: context.password,
    displayName: context.requesterName,
    city: "Tallinn",
    country: "Estonia",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(context.requesterEmail)}`,
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

  const requesterSignIn = await requesterClient.auth.signInWithPassword({
    email: context.requesterEmail,
    password: context.password,
  });
  if (requesterSignIn.error || !requesterSignIn.data.session) {
    throw requesterSignIn.error ?? new Error("Failed to sign in requester for sync seed.");
  }

  const recipientSignIn = await recipientClient.auth.signInWithPassword({
    email: context.recipientEmail,
    password: context.password,
  });
  if (recipientSignIn.error || !recipientSignIn.data.session) {
    throw recipientSignIn.error ?? new Error("Failed to sign in recipient for sync seed.");
  }

  const connectionId = await ensureAcceptedConnection(
    adminClient,
    requesterClient,
    recipientClient,
    requesterId,
    recipientId
  );

  await resetConnectionSyncState(adminClient, connectionId, requesterId, recipientId);

  let pendingSyncId: string | null = null;
  if (params.seedPending) {
    pendingSyncId = await createPendingSync(adminClient, requesterClient, {
      connectionId,
      requesterId,
      recipientId,
    });
  }

  return {
    ready: true,
    scenario: {
      connectionId,
      requesterId,
      recipientId,
      requesterEmail: context.requesterEmail,
      recipientEmail: context.recipientEmail,
      requesterName: context.requesterName,
      recipientName: context.recipientName,
      password: context.password,
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

  const context = buildSeedContext();
  if (!context.ready) return context;

  const browserAnonClient = createClient(context.supabaseUrl, context.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const loginEmail = params.actor === "requester" ? seeded.scenario.requesterEmail : seeded.scenario.recipientEmail;
  await loginPageWithPasswordSession(page, browserAnonClient, loginEmail, seeded.scenario.password);
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

