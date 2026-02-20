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

function isLikelyAlreadyExistsError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("already registered") || text.includes("already exists") || text.includes("duplicate");
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

async function ensureAcceptedConnection(adminClient, authorClient, recipientClient, authorId, recipientId) {
  const pairFilter = `and(requester_id.eq.${authorId},target_id.eq.${recipientId}),and(requester_id.eq.${recipientId},target_id.eq.${authorId})`;

  const existing = await adminClient
    .from("connections")
    .select("id,requester_id,target_id,status")
    .or(pairFilter)
    .order("created_at", { ascending: false })
    .limit(10);
  if (existing.error) throw existing.error;

  const accepted = (existing.data || []).find((row) => row.status === "accepted" && row.id);
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
    const msg = String(createReq.error.message || "").toLowerCase();
    if (!msg.includes("already_pending_or_connected")) throw createReq.error;
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

  const acceptedAfter = (after.data || []).find((row) => row.status === "accepted" && row.id);
  if (!acceptedAfter?.id) throw new Error("Unable to create accepted connection for references e2e seed.");
  return acceptedAfter.id;
}

async function resetReferencesState(adminClient, { connectionId, authorId, recipientId }) {
  for (const connectionColumn of ["connection_id", "connection_request_id"]) {
    const clearRefsByConnection = await adminClient.from("references").delete().eq(connectionColumn, connectionId);
    if (clearRefsByConnection.error && !isMissingSchemaError(clearRefsByConnection.error.message)) {
      throw clearRefsByConnection.error;
    }
  }

  for (const authorColumn of ["author_id", "from_user_id", "source_id"]) {
    const clearByAuthor = await adminClient
      .from("references")
      .delete()
      .in(authorColumn, [authorId, recipientId]);
    if (clearByAuthor.error && !isMissingSchemaError(clearByAuthor.error.message)) {
      throw clearByAuthor.error;
    }
  }

  for (const recipientColumn of ["recipient_id", "to_user_id", "target_id"]) {
    const clearByRecipient = await adminClient
      .from("references")
      .delete()
      .in(recipientColumn, [authorId, recipientId]);
    if (clearByRecipient.error && !isMissingSchemaError(clearByRecipient.error.message)) {
      throw clearByRecipient.error;
    }
  }

  const candidateIds = new Set();
  const collectIds = (rows) => {
    (rows || []).forEach((row) => {
      if (typeof row?.id === "string" && row.id) {
        candidateIds.add(row.id);
      }
    });
  };

  for (const authorColumn of ["author_id", "from_user_id", "source_id"]) {
    const byAuthor = await adminClient
      .from("references")
      .select("id")
      .in(authorColumn, [authorId, recipientId])
      .limit(2000);
    if (!byAuthor.error) {
      collectIds(byAuthor.data);
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
      .in(recipientColumn, [authorId, recipientId])
      .limit(2000);
    if (!byRecipient.error) {
      collectIds(byRecipient.data);
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
      .eq(connectionColumn, connectionId)
      .limit(2000);
    if (!byConnection.error) {
      collectIds(byConnection.data);
      continue;
    }
    if (!isMissingSchemaError(byConnection.error.message)) {
      throw byConnection.error;
    }
  }

  if (candidateIds.size > 0) {
    const clearByIds = await adminClient.from("references").delete().in("id", Array.from(candidateIds));
    if (clearByIds.error && !isMissingSchemaError(clearByIds.error.message)) {
      throw clearByIds.error;
    }
  }

  const clearNotifications = await adminClient
    .from("notifications")
    .delete()
    .in("user_id", [authorId, recipientId])
    .eq("kind", "reference_received");
  if (clearNotifications.error && !isMissingSchemaError(clearNotifications.error.message)) {
    throw clearNotifications.error;
  }

  const clearConnectionSyncs = await adminClient.from("connection_syncs").delete().eq("connection_id", connectionId);
  if (clearConnectionSyncs.error && !isMissingSchemaError(clearConnectionSyncs.error.message)) {
    throw clearConnectionSyncs.error;
  }

  const clearLegacySyncs = await adminClient.from("syncs").delete().eq("connection_id", connectionId);
  if (clearLegacySyncs.error && !isMissingSchemaError(clearLegacySyncs.error.message)) {
    throw clearLegacySyncs.error;
  }
}

async function seedCompletedSyncs(adminClient, { connectionId, authorId, recipientId }) {
  const recentCompletedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const oldCompletedAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

  const inserted = await adminClient
    .from("connection_syncs")
    .insert([
      {
        connection_id: connectionId,
        requester_id: authorId,
        recipient_id: recipientId,
        sync_type: "training",
        scheduled_at: null,
        note: "E2E reference recent completed sync",
        status: "completed",
        completed_at: recentCompletedAt,
      },
      {
        connection_id: connectionId,
        requester_id: authorId,
        recipient_id: recipientId,
        sync_type: "workshop",
        scheduled_at: null,
        note: "E2E reference old completed sync",
        status: "completed",
        completed_at: oldCompletedAt,
      },
    ])
    .select("id,completed_at");

  if (inserted.error) throw inserted.error;

  const rows = inserted.data || [];
  const recent = rows.find((row) => row.completed_at === recentCompletedAt && row.id)?.id || rows[0]?.id || null;
  const old = rows.find((row) => row.completed_at === oldCompletedAt && row.id)?.id || rows[1]?.id || null;

  if (!recent || !old) {
    throw new Error("Unable to resolve deterministic completed sync ids for references seed.");
  }

  const legacyInsertWithIds = await adminClient.from("syncs").insert([
    {
      id: recent,
      connection_id: connectionId,
      completed_by: authorId,
      completed_at: recentCompletedAt,
      note: "E2E reference recent legacy sync",
    },
    {
      id: old,
      connection_id: connectionId,
      completed_by: recipientId,
      completed_at: oldCompletedAt,
      note: "E2E reference old legacy sync",
    },
  ]);
  if (legacyInsertWithIds.error && !isMissingSchemaError(legacyInsertWithIds.error.message)) {
    const fallbackInsert = await adminClient.from("syncs").insert([
      {
        connection_id: connectionId,
        completed_by: authorId,
        completed_at: recentCompletedAt,
        note: "E2E reference recent legacy sync",
      },
      {
        connection_id: connectionId,
        completed_by: recipientId,
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

async function run() {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error(
      "Missing required env vars. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  const authorEmail = withNamespacedEmail(
    env("PLAYWRIGHT_E2E_REFERENCE_AUTHOR_EMAIL") || "conxion.e2e.reference.author@local.test"
  );
  const recipientEmail = withNamespacedEmail(
    env("PLAYWRIGHT_E2E_REFERENCE_RECIPIENT_EMAIL") || "conxion.e2e.reference.recipient@local.test"
  );
  const password = env("PLAYWRIGHT_E2E_PASSWORD") || "ConXionE2E!12345";

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authorClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const recipientClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authorId = await ensureUser(adminClient, {
    email: authorEmail,
    password,
    displayName: "Reference Author E2E",
    city: "Tallinn",
    country: "Estonia",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(authorEmail)}`,
    primaryStyle: "bachata",
  });

  const recipientId = await ensureUser(adminClient, {
    email: recipientEmail,
    password,
    displayName: "Reference Recipient E2E",
    city: "Lisbon",
    country: "Portugal",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(recipientEmail)}`,
    primaryStyle: "salsa",
  });

  const authorSignIn = await authorClient.auth.signInWithPassword({ email: authorEmail, password });
  if (authorSignIn.error || !authorSignIn.data.session) {
    throw authorSignIn.error || new Error("Failed to sign in author for references reset.");
  }

  const recipientSignIn = await recipientClient.auth.signInWithPassword({ email: recipientEmail, password });
  if (recipientSignIn.error || !recipientSignIn.data.session) {
    throw recipientSignIn.error || new Error("Failed to sign in recipient for references reset.");
  }

  const connectionId = await ensureAcceptedConnection(adminClient, authorClient, recipientClient, authorId, recipientId);
  await resetReferencesState(adminClient, { connectionId, authorId, recipientId });
  const syncs = await seedCompletedSyncs(adminClient, { connectionId, authorId, recipientId });

  console.log("[e2e references reset] ready", {
    authorEmail,
    recipientEmail,
    connectionId,
    recentSyncId: syncs.recentSyncId,
    oldSyncId: syncs.oldSyncId,
  });
}

run().catch((error) => {
  console.error("[e2e references reset] failed", {
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
    message: error?.message || String(error),
  });
  process.exit(1);
});
