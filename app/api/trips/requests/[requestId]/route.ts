import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

type TripRequestAction = "accept" | "decline" | "cancel";

type UpdateTripRequestPayload = {
  action?: TripRequestAction;
};

function pickRowId(row: unknown) {
  if (!row || typeof row !== "object") return null;
  const value = (row as { id?: unknown }).id;
  return typeof value === "string" ? value : null;
}

function shouldFallbackTripRequestRpc(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("function") ||
    text.includes("column") ||
    text.includes("decided_by") ||
    text.includes("decided_at") ||
    text.includes("schema cache") ||
    text.includes("on conflict")
  );
}

function isMissingSchemaError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("relation") ||
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("column") ||
    (text.includes("null value in column") && text.includes("role"))
  );
}

function isDuplicateError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  return error.code === "23505" || message.includes("duplicate");
}

async function ensureThreadParticipantCompat(params: {
  service: ReturnType<typeof getSupabaseServiceClient>;
  threadId: string;
  userId: string;
  role: "owner" | "member";
}) {
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, string>> = [
    { thread_id: params.threadId, user_id: params.userId, role: params.role, last_read_at: nowIso },
    { thread_id: params.threadId, user_id: params.userId, role: params.role },
    { thread_id: params.threadId, user_id: params.userId, last_read_at: nowIso },
    { thread_id: params.threadId, user_id: params.userId },
  ];

  let compatError: { message?: string } | null = null;
  const threadParticipantsTable = params.service.from("thread_participants" as never) as unknown as {
    insert: (values: Record<string, string>) => Promise<{ error: { code?: string; message?: string } | null }>;
  };
  for (const payload of payloads) {
    const insertRes = await threadParticipantsTable.insert(payload);
    if (!insertRes.error || isDuplicateError(insertRes.error)) return true;
    const message = String(insertRes.error.message ?? "");
    if (isMissingSchemaError(message)) {
      compatError = insertRes.error;
      continue;
    }
    throw new Error(message || "Unable to insert thread participant.");
  }

  if (compatError) {
    throw new Error(compatError.message ?? "Unable to insert thread participant.");
  }
  return false;
}

async function ensureTripThreadCompat(params: {
  service: ReturnType<typeof getSupabaseServiceClient>;
  tripId: string;
  ownerId: string;
  requesterId: string;
  actorId: string;
}) {
  const threadsTable = params.service.from("threads" as never) as unknown as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ error: { message?: string } | null; data: unknown }>;
      };
    };
    insert: (values: Record<string, string>) => {
      select: (columns: string) => {
        maybeSingle: () => Promise<{ error: { message?: string; code?: string } | null; data: unknown }>;
      };
    };
  };

  const existingRes = await threadsTable.select("id").eq("trip_id", params.tripId).maybeSingle();
  if (existingRes.error) {
    const message = String(existingRes.error.message ?? "");
    if (isMissingSchemaError(message)) return null;
    throw new Error(message || "Unable to load trip thread.");
  }

  let threadId = pickRowId(existingRes.data);
  if (!threadId) {
    const createdRes = await threadsTable
      .insert({
        thread_type: "trip",
        trip_id: params.tripId,
        created_by: params.actorId,
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (createdRes.error) {
      if (isDuplicateError(createdRes.error)) {
        const retryRes = await threadsTable.select("id").eq("trip_id", params.tripId).maybeSingle();
        if (retryRes.error) {
          const message = String(retryRes.error.message ?? "");
          if (isMissingSchemaError(message)) return null;
          throw new Error(message || "Unable to reload trip thread.");
        }
        threadId = pickRowId(retryRes.data);
      } else if (isMissingSchemaError(String(createdRes.error.message ?? ""))) {
        return null;
      } else {
        throw new Error(String(createdRes.error.message ?? "") || "Unable to create trip thread.");
      }
    } else {
      threadId = pickRowId(createdRes.data);
    }
  }

  if (!threadId) return null;

  await ensureThreadParticipantCompat({
    service: params.service,
    threadId,
    userId: params.ownerId,
    role: "owner",
  });
  await ensureThreadParticipantCompat({
    service: params.service,
    threadId,
    userId: params.requesterId,
    role: "member",
  });

  return threadId;
}

async function createTripNotificationCompat(params: {
  service: ReturnType<typeof getSupabaseServiceClient>;
  userId: string;
  kind: "trip_request_accepted" | "trip_request_declined";
  title: string;
  tripId: string;
  requestId: string;
}) {
  const notificationRpc = params.service.rpc as unknown as (
    fn: string,
    args?: Record<string, unknown>
  ) => Promise<{ error: { message?: string } | null }>;
  const notificationRes = await notificationRpc("create_notification", {
    p_user_id: params.userId,
    p_kind: params.kind,
    p_title: params.title,
    p_body: null,
    p_link_url: `/trips/${params.tripId}`,
    p_metadata: {
      trip_id: params.tripId,
      request_id: params.requestId,
    },
  });

  const message = String(notificationRes.error?.message ?? "");
  if (notificationRes.error && !shouldFallbackTripRequestRpc(message)) {
    throw new Error(message || "Unable to create trip notification.");
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await context.params;
    if (!requestId) {
      return NextResponse.json({ ok: false, error: "Missing requestId." }, { status: 400 });
    }

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as UpdateTripRequestPayload | null;
    const action = body?.action;
    if (action !== "accept" && action !== "decline" && action !== "cancel") {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const service = getSupabaseServiceClient();
    const requestRes = await service
      .from("trip_requests")
      .select("id,trip_id,requester_id,status")
      .eq("id", requestId)
      .maybeSingle();

    const requestRow = requestRes.data as
      | {
          id?: string;
          trip_id?: string;
          requester_id?: string;
          status?: string;
        }
      | null;

    if (!requestRow?.id || !requestRow.trip_id || !requestRow.requester_id || !requestRow.status) {
      return NextResponse.json({ ok: false, error: "Trip request not found." }, { status: 404 });
    }

    if (action === "cancel") {
      const rpcRes = await supabase.rpc("cancel_trip_request", { p_request_id: requestId });
      if (rpcRes.error) {
        if (!shouldFallbackTripRequestRpc(rpcRes.error.message)) {
          return NextResponse.json({ ok: false, error: rpcRes.error.message }, { status: 400 });
        }

        if (requestRow.requester_id !== authData.user.id) {
          return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
        }
        if (requestRow.status !== "pending") {
          return NextResponse.json({ ok: false, error: "Trip request is not pending." }, { status: 409 });
        }

        const fallback = await service
          .from("trip_requests")
          .update({ status: "cancelled" } as never)
          .eq("id", requestId)
          .eq("requester_id", authData.user.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();
        if (fallback.error) {
          return NextResponse.json({ ok: false, error: fallback.error.message }, { status: 400 });
        }
        const fallbackRow = (fallback.data ?? null) as { id?: string } | null;
        if (!fallbackRow?.id) {
          return NextResponse.json({ ok: false, error: "Trip request is not pending." }, { status: 409 });
        }
      }

      return NextResponse.json({ ok: true, trip_id: requestRow.trip_id });
    }

    const tripRes = await service
      .from("trips")
      .select("user_id")
      .eq("id", requestRow.trip_id)
      .maybeSingle();

    const tripRow = (tripRes.data ?? null) as { user_id?: string } | null;
    const ownerId = typeof tripRow?.user_id === "string" ? tripRow.user_id : "";

    const rpcRes = await supabase.rpc("respond_trip_request", {
      p_request_id: requestId,
      p_action: action,
    });

    let usedFallback = false;
    if (rpcRes.error) {
      if (!shouldFallbackTripRequestRpc(rpcRes.error.message)) {
        return NextResponse.json({ ok: false, error: rpcRes.error.message }, { status: 400 });
      }
      usedFallback = true;

      if (!ownerId || ownerId !== authData.user.id) {
        return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
      }
      if (requestRow.status !== "pending") {
        return NextResponse.json({ ok: false, error: "Trip request is not pending." }, { status: 409 });
      }

      const decidedAt = new Date().toISOString();
      const fallbackPayloads = [
        { status: action === "accept" ? "accepted" : "declined", decided_by: authData.user.id, decided_at: decidedAt },
        { status: action === "accept" ? "accepted" : "declined" },
      ];

      let updated = false;
      let lastFallbackError: string | null = null;
      for (const payload of fallbackPayloads) {
        const fallback = await service
          .from("trip_requests")
          .update(payload as never)
          .eq("id", requestId)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();

        if (!fallback.error) {
          const fallbackRow = (fallback.data ?? null) as { id?: string } | null;
          if (fallbackRow?.id) {
            updated = true;
            break;
          }
          lastFallbackError = "Trip request is not pending.";
          continue;
        }

        lastFallbackError = fallback.error.message;
        const lower = fallback.error.message.toLowerCase();
        if (lower.includes("column") || lower.includes("schema cache")) {
          continue;
        }
        return NextResponse.json({ ok: false, error: fallback.error.message }, { status: 400 });
      }

      if (!updated) {
        return NextResponse.json({ ok: false, error: lastFallbackError ?? "Failed to update trip request." }, { status: 409 });
      }

      if (action === "accept") {
        await ensureTripThreadCompat({
          service,
          tripId: requestRow.trip_id,
          ownerId,
          requesterId: requestRow.requester_id,
          actorId: authData.user.id,
        });
      }
    }

    if (usedFallback) {
      await createTripNotificationCompat({
        service,
        userId: requestRow.requester_id,
        kind: action === "accept" ? "trip_request_accepted" : "trip_request_declined",
        title: action === "accept" ? "Trip request accepted" : "Trip request declined",
        tripId: requestRow.trip_id,
        requestId,
      });
    }

    return NextResponse.json({ ok: true, trip_id: requestRow.trip_id });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
