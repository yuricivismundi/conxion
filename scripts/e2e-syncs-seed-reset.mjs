import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadDotEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const parsed = {};
  if (!fs.existsSync(envPath)) return parsed;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

const DOTENV = loadDotEnvLocal();
function env(name) {
  return process.env[name] || DOTENV[name] || "";
}

function sanitizeNamespace(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function withNamespacedEmail(baseEmail) {
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

function isMissingSchemaError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("relation") ||
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("column")
  );
}

function isLikelyAlreadyExistsError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("already registered") || text.includes("already exists") || text.includes("duplicate");
}

function shouldFallbackSyncRpc(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("function") || text.includes("relation") || text.includes("schema cache") || text.includes("column");
}

async function findUserIdByEmail(adminClient, email) {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 5; page += 1) {
    const listed = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) throw listed.error;
    const match = listed.data.users.find((item) => (item.email || "").toLowerCase() === normalized);
    if (match?.id) return match.id;
    if (listed.data.users.length < 200) break;
  }
  return null;
}

async function ensureUser(adminClient, { email, password, displayName, city, country, avatarUrl, primaryStyle }) {
  let userId = await findUserIdByEmail(adminClient, email);

  if (!userId) {
    const created = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (created.error && !isLikelyAlreadyExistsError(created.error.message)) throw created.error;
    if (!created.error) userId = created.data.user.id;
  }

  if (!userId) userId = await findUserIdByEmail(adminClient, email);
  if (!userId) throw new Error(`Unable to resolve user id for ${email}`);

  const updated = await adminClient.auth.admin.updateUserById(userId, {
    email_confirm: true,
    password,
    user_metadata: { display_name: displayName },
  });
  if (updated.error) throw updated.error;

  const profileUpsert = await adminClient.from("profiles").upsert(
    {
      user_id: userId,
      display_name: displayName,
      city,
      country,
      avatar_url: avatarUrl,
      verified: false,
      roles: ["Social dancer / Student"],
      languages: ["English"],
      interests: ["Practice / Dance Partner"],
      availability: ["Evenings"],
      has_other_style: false,
      dance_skills: {
        [primaryStyle]: {
          level: "Improver (3–9 months)",
        },
      },
    },
    { onConflict: "user_id" }
  );
  if (profileUpsert.error) throw profileUpsert.error;

  return userId;
}

async function ensureAcceptedConnection(adminClient, requesterClient, recipientClient, requesterId, recipientId) {
  const pairFilter = `and(requester_id.eq.${requesterId},target_id.eq.${recipientId}),and(requester_id.eq.${recipientId},target_id.eq.${requesterId})`;

  const existing = await adminClient
    .from("connections")
    .select("id,requester_id,target_id,status")
    .or(pairFilter)
    .order("created_at", { ascending: false })
    .limit(10);
  if (existing.error) throw existing.error;

  const accepted = (existing.data || []).find((row) => row.status === "accepted" && row.id);
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
    const msg = String(createReq.error.message || "").toLowerCase();
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

  const firstPending = (pending.data || []).find((row) => row.status === "pending" && row.id);
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

  const acceptedAfter = (after.data || []).find((row) => row.status === "accepted" && row.id);
  if (!acceptedAfter?.id) throw new Error("Unable to create accepted connection for sync e2e seed.");
  return acceptedAfter.id;
}

async function resetConnectionSyncState(adminClient, connectionId, requesterId, recipientId) {
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

async function createPendingSync(adminClient, requesterClient, { connectionId, requesterId, recipientId }) {
  const rpc = await requesterClient.rpc("propose_connection_sync", {
    p_connection_id: connectionId,
    p_sync_type: "training",
    p_scheduled_at: null,
    p_note: "E2E pending sync",
  });

  if (rpc.error) {
    if (!shouldFallbackSyncRpc(rpc.error.message)) throw rpc.error;

    const fallback = await adminClient.from("connection_syncs").insert({
      connection_id: connectionId,
      requester_id: requesterId,
      recipient_id: recipientId,
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
    .eq("connection_id", connectionId)
    .eq("requester_id", requesterId)
    .eq("recipient_id", recipientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw latest.error;

  const syncId = latest.data?.id || null;
  if (!syncId) throw new Error("Unable to resolve pending sync id after seed.");
  return syncId;
}

async function run() {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error(
      "Missing required env vars. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  const requesterEmail = withNamespacedEmail(
    env("PLAYWRIGHT_E2E_SYNC_REQUESTER_EMAIL") || "conxion.e2e.sync.requester@local.test"
  );
  const recipientEmail = withNamespacedEmail(
    env("PLAYWRIGHT_E2E_SYNC_RECIPIENT_EMAIL") || "conxion.e2e.sync.recipient@local.test"
  );
  const password = env("PLAYWRIGHT_E2E_PASSWORD") || "ConXionE2E!12345";

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const requesterClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const recipientClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const requesterId = await ensureUser(adminClient, {
    email: requesterEmail,
    password,
    displayName: "Sync Requester E2E",
    city: "Tallinn",
    country: "Estonia",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(requesterEmail)}`,
    primaryStyle: "bachata",
  });

  const recipientId = await ensureUser(adminClient, {
    email: recipientEmail,
    password,
    displayName: "Sync Recipient E2E",
    city: "Lisbon",
    country: "Portugal",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(recipientEmail)}`,
    primaryStyle: "salsa",
  });

  const requesterSignIn = await requesterClient.auth.signInWithPassword({ email: requesterEmail, password });
  if (requesterSignIn.error || !requesterSignIn.data.session) {
    throw requesterSignIn.error ?? new Error("Failed to sign in requester for sync seed.");
  }

  const recipientSignIn = await recipientClient.auth.signInWithPassword({ email: recipientEmail, password });
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
  const pendingSyncId = await createPendingSync(adminClient, requesterClient, {
    connectionId,
    requesterId,
    recipientId,
  });

  console.log("[e2e syncs reset] ready", {
    requesterEmail,
    recipientEmail,
    connectionId,
    pendingSyncId,
  });
}

run().catch((error) => {
  console.error("[e2e syncs reset] failed", error);
  process.exitCode = 1;
});
