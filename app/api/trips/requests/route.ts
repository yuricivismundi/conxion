import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { findPendingPairRequestConflict } from "@/lib/requests/pending-pair-conflicts";

type CreateTripRequestPayload = {
  tripId?: string;
  note?: string | null;
};

function shouldFallbackTripRequestRpc(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("function") ||
    text.includes("column") ||
    text.includes("decided_by") ||
    text.includes("decided_at") ||
    text.includes("not_authenticated") ||
    text.includes("schema cache") ||
    text.includes("on conflict") ||
    text.includes("row-level security")
  );
}

function isTripRequestCompatPayloadError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("column") ||
    text.includes("null value in column") ||
    text.includes("\"reason\"") ||
    text.includes("\"note\"") ||
    text.includes("schema cache")
  );
}

function buildFallbackTripRequestPayloads(params: {
  tripId: string;
  requesterId: string;
  note: string;
}) {
  const fallbackReason = params.note || "Trip join request";

  return [
    {
      trip_id: params.tripId,
      requester_id: params.requesterId,
      reason: fallbackReason,
      note: params.note || null,
      status: "pending",
    },
    {
      trip_id: params.tripId,
      requester_id: params.requesterId,
      reason: fallbackReason,
      status: "pending",
    },
    {
      trip_id: params.tripId,
      requester_id: params.requesterId,
      note: params.note || null,
      status: "pending",
    },
    {
      trip_id: params.tripId,
      requester_id: params.requesterId,
      status: "pending",
    },
  ];
}

async function createTripRequestNotificationCompat(params: {
  service: ReturnType<typeof getSupabaseServiceClient>;
  userId: string;
  tripId: string;
  requestId: string;
}) {
  const notificationRpc = params.service.rpc as unknown as (
    fn: string,
    args?: Record<string, unknown>
  ) => Promise<{ error: { message?: string } | null }>;
  const notificationRes = await notificationRpc("create_notification", {
    p_user_id: params.userId,
    p_kind: "trip_request_received",
    p_title: "New trip request",
    p_body: "You received a new request for your trip.",
    p_link_url: `/trips/${params.tripId}`,
    p_metadata: {
      trip_id: params.tripId,
      request_id: params.requestId,
    },
  });

  const message = String(notificationRes.error?.message ?? "");
  if (notificationRes.error && !shouldFallbackTripRequestRpc(message)) {
    throw new Error(message || "Unable to create trip request notification.");
  }
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as CreateTripRequestPayload | null;
    const tripId = body?.tripId?.trim() ?? "";
    const note = typeof body?.note === "string" ? body.note.trim() : "";

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "tripId is required." }, { status: 400 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const service = getSupabaseServiceClient();
    let requestId = "";
    let createdRequest = true;
    let usedFallback = false;
    let ownerId = "";

    const tripRes = await service.from("trips").select("id,user_id").eq("id", tripId).maybeSingle();
    if (tripRes.error) {
      return NextResponse.json({ ok: false, error: tripRes.error.message }, { status: 400 });
    }

    const tripRow = (tripRes.data ?? null) as { user_id?: string | null } | null;
    ownerId = typeof tripRow?.user_id === "string" ? tripRow.user_id : "";
    if (ownerId && ownerId !== authData.user.id) {
      const pendingConflict = await findPendingPairRequestConflict(service, {
        actorUserId: authData.user.id,
        otherUserId: ownerId,
      });
      if (pendingConflict) {
        return NextResponse.json({ ok: false, error: pendingConflict.message }, { status: 409 });
      }
    }

    const existingActiveRequestRes = await service
      .from("trip_requests")
      .select("id,status")
      .eq("trip_id", tripId)
      .eq("requester_id", authData.user.id)
      .in("status", ["pending", "accepted"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingActiveRequestRes.error) {
      return NextResponse.json({ ok: false, error: existingActiveRequestRes.error.message }, { status: 400 });
    }

    const existingActiveRequest = (existingActiveRequestRes.data ?? null) as { id?: string; status?: string } | null;
    if (typeof existingActiveRequest?.id === "string" && existingActiveRequest.id) {
      const message =
        existingActiveRequest.status === "accepted"
          ? "You already have an active trip request for this trip."
          : "There is already a pending trip request for this trip. Open Requests in Messages to continue.";
      return NextResponse.json({ ok: false, error: message }, { status: 409 });
    }

    const rpcRes = await supabase.rpc("create_trip_request", {
      p_trip_id: tripId,
      p_note: note || null,
    });

    if (rpcRes.error) {
      if (!shouldFallbackTripRequestRpc(rpcRes.error.message)) {
        const message = rpcRes.error.message ?? "Failed to create trip request.";
        const status =
          message.includes("not_authenticated") ? 401 :
          message.includes("trip_not_found") ? 404 :
          message.includes("cannot_request_own_trip") || message.includes("trip_not_active") ? 409 : 400;
        return NextResponse.json({ ok: false, error: message }, { status });
      }
      usedFallback = true;

      const insertPayloads = buildFallbackTripRequestPayloads({
        tripId,
        requesterId: authData.user.id,
        note,
      });

      let inserted = false;
      for (const payload of insertPayloads) {
        const insertRes = await supabase.from("trip_requests").insert(payload);
        if (!insertRes.error) {
          inserted = true;
          break;
        }
        const lower = String(insertRes.error.message ?? "").toLowerCase();
        if (insertRes.error.code === "23505" || lower.includes("duplicate")) {
          inserted = true;
          createdRequest = false;
          break;
        }
        if (!isTripRequestCompatPayloadError(insertRes.error.message)) {
          return NextResponse.json({ ok: false, error: insertRes.error.message }, { status: 400 });
        }
      }

      if (!inserted) {
        return NextResponse.json({ ok: false, error: "Failed to create trip request." }, { status: 400 });
      }
    } else if (typeof rpcRes.data === "string") {
      requestId = rpcRes.data;
    }

    const requestRes = await service
      .from("trip_requests")
      .select("id")
      .eq("trip_id", tripId)
      .eq("requester_id", authData.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (requestRes.error) {
      return NextResponse.json({ ok: false, error: requestRes.error.message }, { status: 400 });
    }

    const requestRow = (requestRes.data ?? null) as { id?: string } | null;

    requestId = requestId || (typeof requestRow?.id === "string" ? requestRow.id : "");

    if (createdRequest && ownerId && ownerId !== authData.user.id) {
      await sendAppEmailBestEffort({
        kind: "trip_request_received",
        recipientUserId: ownerId,
        actorUserId: authData.user.id,
        tripId,
      });
      if (usedFallback && requestId) {
        await createTripRequestNotificationCompat({
          service,
          userId: ownerId,
          tripId,
          requestId,
        });
      }
    }

    return NextResponse.json({ ok: true, id: requestId || null });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
