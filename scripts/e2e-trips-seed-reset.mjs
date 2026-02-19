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

function shouldFallbackTripRequestRpc(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("function") ||
    text.includes("column") ||
    text.includes("decided_by") ||
    text.includes("decided_at") ||
    text.includes("schema cache") ||
    text.includes("on conflict")
  );
}

function isTripRequestCompatPayloadError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("column") ||
    text.includes("null value in column") ||
    text.includes("\"reason\"") ||
    text.includes("\"note\"") ||
    text.includes("schema cache")
  );
}

async function resolveTripRequestReason(adminClient) {
  const sample = await adminClient
    .from("trip_requests")
    .select("reason")
    .not("reason", "is", null)
    .limit(1)
    .maybeSingle();
  if (!sample.error) {
    const value = sample.data?.reason;
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "E2E outgoing request";
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
    p_connect_reason: "Playwright trips seed",
    p_connect_reason_role: null,
    p_trip_id: null,
    p_note: "Deterministic trips setup",
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
  if (!acceptedAfter?.id) throw new Error("Unable to create accepted connection for trips e2e");
  return acceptedAfter.id;
}

function toIsoDateParts(date) {
  return date.toISOString().slice(0, 10);
}

async function createTrip(adminClient, ownerId) {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() + 3);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 2);

  const existingSeed = await adminClient
    .from("trips")
    .select("id")
    .eq("user_id", ownerId)
    .eq("purpose", "E2E Trip Request Smoke")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const existingSeedId = existingSeed.data?.id || null;
  if (existingSeedId) return existingSeedId;

  const existingAny = await adminClient
    .from("trips")
    .select("id")
    .eq("user_id", ownerId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const existingAnyId = existingAny.data?.id || null;
  if (existingAnyId) {
    await adminClient
      .from("trips")
      .update({
        destination_city: "E2E Trip City",
        destination_country: "Estonia",
        start_date: toIsoDateParts(startDate),
        end_date: toIsoDateParts(endDate),
        purpose: "E2E Trip Request Smoke",
        status: "active",
      })
      .eq("id", existingAnyId);
    return existingAnyId;
  }

  const basePayload = {
    user_id: ownerId,
    destination_city: "E2E Trip City",
    destination_country: "Estonia",
    start_date: toIsoDateParts(startDate),
    end_date: toIsoDateParts(endDate),
    purpose: "E2E Trip Request Smoke",
    status: "active",
    note: "Deterministic trips smoke seed",
  };

  let insert = await adminClient.from("trips").insert(basePayload).select("id").single();
  if (insert.error) {
    const msg = String(insert.error.message || "").toLowerCase();
    if (msg.includes("column") && msg.includes("note")) {
      const fallback = { ...basePayload };
      delete fallback.note;
      insert = await adminClient.from("trips").insert(fallback).select("id").single();
    }
    if (
      insert.error &&
      insert.error.code === "P0001" &&
      String(insert.error.message || "").toLowerCase().includes("trip creation rate limit")
    ) {
      const retryAny = await adminClient
        .from("trips")
        .select("id")
        .eq("user_id", ownerId)
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const retryAnyId = retryAny.data?.id || null;
      if (retryAnyId) return retryAnyId;

      const anyTrip = await adminClient.from("trips").select("id").order("start_date", { ascending: false }).limit(1).maybeSingle();
      const anyTripId = anyTrip.data?.id || null;
      if (anyTripId) {
        await adminClient
          .from("trips")
          .update({
            user_id: ownerId,
            destination_city: "E2E Trip City",
            destination_country: "Estonia",
            start_date: toIsoDateParts(startDate),
            end_date: toIsoDateParts(endDate),
            purpose: "E2E Trip Request Smoke",
            status: "active",
          })
          .eq("id", anyTripId);
        return anyTripId;
      }
    }
  }

  if (insert.error) throw insert.error;
  const tripId = insert.data?.id || null;
  if (!tripId) throw new Error("Failed to create e2e trip.");
  return tripId;
}

async function createPendingRequest(adminClient, requesterClient, requesterId, ownerId, tripId) {
  const reasonValue = await resolveTripRequestReason(adminClient);
  const rpc = await requesterClient.rpc("create_trip_request", {
    p_trip_id: tripId,
    p_note: "E2E outgoing request",
  });
  if (rpc.error) {
    if (!shouldFallbackTripRequestRpc(rpc.error.message)) throw rpc.error;

    const existingRes = await adminClient
      .from("trip_requests")
      .select("id")
      .eq("trip_id", tripId)
      .eq("requester_id", requesterId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (existingRes.error) throw existingRes.error;

    const existingId = (existingRes.data || [])[0]?.id || null;
    if (existingId) {
      const updatePayloads = [
        { status: "pending", reason: reasonValue, note: "E2E outgoing request" },
        { status: "pending", reason: reasonValue },
        { status: "pending", note: "E2E outgoing request" },
        { status: "pending" },
      ];
      let updateError = null;
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
      const insertPayloads = [
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
      let insertError = null;
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

  const requestRow = await adminClient
    .from("trip_requests")
    .select("id")
    .eq("trip_id", tripId)
    .eq("requester_id", requesterId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (requestRow.error) throw requestRow.error;
  const requestId = requestRow.data?.id || null;
  if (!requestId) throw new Error("Unable to resolve pending trip request id after seed insert.");

  const hasNotification = await adminClient
    .from("notifications")
    .select("id")
    .eq("user_id", ownerId)
    .eq("kind", "trip_request_received")
    .order("created_at", { ascending: false })
    .limit(1);
  if (hasNotification.error) {
    const message = String(hasNotification.error.message || "").toLowerCase();
    if (!message.includes("relation") && !message.includes("schema cache")) throw hasNotification.error;
  }

  if ((hasNotification.data || []).length === 0) {
    const notifyRes = await adminClient.from("notifications").insert({
      user_id: ownerId,
      actor_id: requesterId,
      kind: "trip_request_received",
      title: "New trip request",
      body: "You received a new request for your trip.",
      link_url: `/trips/${tripId}`,
      metadata: {
        trip_id: tripId,
        request_id: requestId,
        requester_id: requesterId,
      },
    });
    if (notifyRes.error) {
      const message = String(notifyRes.error.message || "").toLowerCase();
      if (!message.includes("relation") && !message.includes("schema cache")) throw notifyRes.error;
    }
  }
}

async function enforceTripOwner(adminClient, tripId, ownerId) {
  const updateRes = await adminClient
    .from("trips")
    .update({
      user_id: ownerId,
      status: "active",
    })
    .eq("id", tripId);
  if (updateRes.error && !String(updateRes.error.message || "").toLowerCase().includes("column")) {
    throw updateRes.error;
  }
}

async function clearTripThreads(adminClient, tripId) {
  const threads = await adminClient.from("threads").select("id").eq("trip_id", tripId).limit(20);
  if (threads.error) {
    const message = String(threads.error.message || "").toLowerCase();
    if (message.includes("relation") || message.includes("schema cache")) return;
    throw threads.error;
  }

  const threadIds = (threads.data || []).map((row) => row.id).filter(Boolean);
  if (threadIds.length === 0) return;

  const deleteMessages = await adminClient.from("thread_messages").delete().in("thread_id", threadIds);
  if (deleteMessages.error) {
    const message = String(deleteMessages.error.message || "").toLowerCase();
    if (!message.includes("relation") && !message.includes("schema cache")) throw deleteMessages.error;
  }

  const deleteParticipants = await adminClient.from("thread_participants").delete().in("thread_id", threadIds);
  if (deleteParticipants.error) {
    const message = String(deleteParticipants.error.message || "").toLowerCase();
    if (!message.includes("relation") && !message.includes("schema cache")) throw deleteParticipants.error;
  }

  const deleteThreads = await adminClient.from("threads").delete().in("id", threadIds);
  if (deleteThreads.error) {
    const message = String(deleteThreads.error.message || "").toLowerCase();
    if (!message.includes("relation") && !message.includes("schema cache")) throw deleteThreads.error;
  }
}

async function clearTripNotifications(adminClient, ownerId, requesterId) {
  const kinds = ["trip_request_received", "trip_request_accepted", "trip_request_declined"];
  for (const userId of [ownerId, requesterId]) {
    const result = await adminClient.from("notifications").delete().eq("user_id", userId).in("kind", kinds);
    if (result.error) {
      const message = String(result.error.message || "").toLowerCase();
      if (!message.includes("relation") && !message.includes("schema cache")) throw result.error;
    }
  }
}

async function clearTripRequests(adminClient, tripId) {
  const result = await adminClient.from("trip_requests").delete().eq("trip_id", tripId);
  if (result.error) {
    const message = String(result.error.message || "").toLowerCase();
    if (!message.includes("relation") && !message.includes("schema cache")) throw result.error;
  }
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

  const ownerEmail = env("PLAYWRIGHT_E2E_TRIP_OWNER_EMAIL") || "conxion.e2e.trip.owner@local.test";
  const requesterEmail = env("PLAYWRIGHT_E2E_TRIP_REQUESTER_EMAIL") || "conxion.e2e.trip.requester@local.test";
  const password = env("PLAYWRIGHT_E2E_PASSWORD") || "ConXionE2E!12345";

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ownerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const requesterClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ownerId = await ensureUser(adminClient, {
    email: ownerEmail,
    password,
    displayName: "Trip Owner E2E",
    city: "Tallinn",
    country: "Estonia",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(ownerEmail)}`,
    primaryStyle: "bachata",
  });
  const requesterId = await ensureUser(adminClient, {
    email: requesterEmail,
    password,
    displayName: "Trip Requester E2E",
    city: "Lisbon",
    country: "Portugal",
    avatarUrl: `https://i.pravatar.cc/300?u=${encodeURIComponent(requesterEmail)}`,
    primaryStyle: "salsa",
  });

  const signOwner = await ownerClient.auth.signInWithPassword({ email: ownerEmail, password });
  if (signOwner.error || !signOwner.data.session) throw signOwner.error || new Error("Failed to sign in owner user");

  const signRequester = await requesterClient.auth.signInWithPassword({ email: requesterEmail, password });
  if (signRequester.error || !signRequester.data.session) throw signRequester.error || new Error("Failed to sign in requester user");

  await ensureAcceptedConnection(adminClient, ownerClient, requesterClient, ownerId, requesterId);

  const tripId = await createTrip(adminClient, ownerId);
  await enforceTripOwner(adminClient, tripId, ownerId);
  await clearTripThreads(adminClient, tripId);
  await clearTripNotifications(adminClient, ownerId, requesterId);
  await clearTripRequests(adminClient, tripId);
  await createPendingRequest(adminClient, requesterClient, requesterId, ownerId, tripId);

  console.log("[e2e trips reset] ready", {
    ownerEmail,
    requesterEmail,
    tripId,
  });
}

run().catch((error) => {
  console.error("[e2e trips reset] failed", error);
  process.exitCode = 1;
});
