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

const LOCAL_REACTIONS_STORAGE_KEY = "cx_messages_reactions_local_v1";
const LOCAL_MANUAL_UNREAD_STORAGE_KEY = "cx_messages_manual_unread_v1";
const LOCAL_THREAD_DRAFTS_STORAGE_KEY = "cx_messages_thread_drafts_v1";

function sanitizeNamespace(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 12);
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

function missingSchemaError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("relation") ||
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("column")
  );
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
    if (created.error && !String(created.error.message || "").toLowerCase().includes("already")) {
      throw created.error;
    }
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

async function ensureAcceptedConnection(adminClient, requesterClient, targetClient, requesterId, targetId) {
  const pairFilter = `and(requester_id.eq.${requesterId},target_id.eq.${targetId}),and(requester_id.eq.${targetId},target_id.eq.${requesterId})`;

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
    p_target_id: targetId,
    p_context: "member",
    p_connect_reason: "Playwright seed",
    p_connect_reason_role: null,
    p_trip_id: null,
    p_note: "Deterministic thread setup",
  });
  if (createReq.error && !String(createReq.error.message || "").toLowerCase().includes("already_pending_or_connected")) {
    throw createReq.error;
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
    const accepter = firstPending.target_id === targetId ? targetClient : requesterClient;
    const accept = await accepter.rpc("accept_connection_request", { p_connection_id: firstPending.id });
    if (accept.error) throw accept.error;
  }

  const after = await adminClient
    .from("connections")
    .select("id,status")
    .or(pairFilter)
    .order("created_at", { ascending: false })
    .limit(10);
  if (after.error) throw after.error;

  const acceptedAfter = (after.data || []).find((row) => row.status === "accepted" && row.id);
  if (!acceptedAfter?.id) throw new Error("Unable to create accepted connection for e2e");
  return acceptedAfter.id;
}

async function ensureConnectionThread(adminClient, { connectionId, primaryId, secondaryId }) {
  const existing = await adminClient.from("threads").select("id").eq("connection_id", connectionId).maybeSingle();
  if (existing.error) {
    if (missingSchemaError(existing.error.message)) return null;
    throw existing.error;
  }
  const existingId = existing.data?.id || null;
  if (existingId) return existingId;

  const inserted = await adminClient
    .from("threads")
    .insert({
      thread_type: "connection",
      connection_id: connectionId,
      created_by: primaryId,
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (inserted.error) {
    if (missingSchemaError(inserted.error.message)) return null;
    throw inserted.error;
  }

  const threadId = inserted.data?.id || null;
  if (!threadId) return null;

  const participantUpsert = await adminClient.from("thread_participants").upsert(
    [
      { thread_id: threadId, user_id: primaryId, role: "member" },
      { thread_id: threadId, user_id: secondaryId, role: "member" },
    ],
    { onConflict: "thread_id,user_id" }
  );
  if (participantUpsert.error && !missingSchemaError(participantUpsert.error.message)) {
    throw participantUpsert.error;
  }

  return threadId;
}

async function resetMessageState(adminClient, { connectionId, primaryId, secondaryId }) {
  const threadId = await ensureConnectionThread(adminClient, { connectionId, primaryId, secondaryId });

  if (threadId) {
    const resetPrefs = await adminClient
      .from("thread_participants")
      .update({ archived_at: null, muted_until: null, pinned_at: null, last_read_at: null })
      .eq("thread_id", threadId);
    if (resetPrefs.error) {
      if (!missingSchemaError(resetPrefs.error.message)) throw resetPrefs.error;
      const fallbackReset = await adminClient.from("thread_participants").update({ last_read_at: null }).eq("thread_id", threadId);
      if (fallbackReset.error && !missingSchemaError(fallbackReset.error.message)) {
        throw fallbackReset.error;
      }
    }
  }

  const clearConnectionReactions = await adminClient
    .from("message_reactions")
    .delete()
    .eq("thread_kind", "connection")
    .eq("thread_id", connectionId);
  if (clearConnectionReactions.error && !missingSchemaError(clearConnectionReactions.error.message)) {
    throw clearConnectionReactions.error;
  }

  if (threadId) {
    const clearThreadMessages = await adminClient.from("thread_messages").delete().eq("thread_id", threadId);
    if (clearThreadMessages.error && !missingSchemaError(clearThreadMessages.error.message)) {
      throw clearThreadMessages.error;
    }
  }

  const clearMessages = await adminClient.from("messages").delete().eq("connection_id", connectionId);
  if (clearMessages.error && !missingSchemaError(clearMessages.error.message)) {
    throw clearMessages.error;
  }
}

async function seedUnreadMessage(targetClient, connectionId) {
  const rpc = await targetClient.rpc("send_message", {
    p_connection_id: connectionId,
    p_body: "Unread ping from your connection.",
  });
  if (rpc.error) throw rpc.error;
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

  const primaryEmail = withNamespacedEmail(
    env("PLAYWRIGHT_E2E_EMAIL") || "conxion.e2e.messages.primary@local.test"
  );
  const secondaryEmail = withNamespacedEmail(
    env("PLAYWRIGHT_E2E_PEER_EMAIL") || "conxion.e2e.messages.peer@local.test"
  );
  const password = env("PLAYWRIGHT_E2E_PASSWORD") || "ConXionE2E!12345";

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const primaryClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const secondaryClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const primaryId = await ensureUser(adminClient, {
    email: primaryEmail,
    password,
    displayName: "Playwright Primary",
    city: "Tallinn",
    country: "Estonia",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(primaryEmail)}`,
    primaryStyle: "bachata",
  });
  const secondaryId = await ensureUser(adminClient, {
    email: secondaryEmail,
    password,
    displayName: "Playwright Peer",
    city: "Lisbon",
    country: "Portugal",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(secondaryEmail)}`,
    primaryStyle: "salsa",
  });

  const signPrimary = await primaryClient.auth.signInWithPassword({ email: primaryEmail, password });
  if (signPrimary.error || !signPrimary.data.session) throw signPrimary.error || new Error("Failed to sign in primary user");

  const signSecondary = await secondaryClient.auth.signInWithPassword({ email: secondaryEmail, password });
  if (signSecondary.error || !signSecondary.data.session) throw signSecondary.error || new Error("Failed to sign in peer user");

  const connectionId = await ensureAcceptedConnection(adminClient, primaryClient, secondaryClient, primaryId, secondaryId);
  await resetMessageState(adminClient, { connectionId, primaryId, secondaryId });
  await seedUnreadMessage(secondaryClient, connectionId);

  console.log("[e2e messages reset] ready", {
    primaryEmail,
    secondaryEmail,
    connectionId,
    localStorageKeysToClear: [
      LOCAL_MANUAL_UNREAD_STORAGE_KEY,
      LOCAL_REACTIONS_STORAGE_KEY,
      LOCAL_THREAD_DRAFTS_STORAGE_KEY,
    ],
  });
}

run().catch((error) => {
  console.error("[e2e messages reset] failed", error);
  process.exitCode = 1;
});
