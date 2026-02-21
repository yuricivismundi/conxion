import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type RouteContext = { params: Promise<{ tripId: string }> };

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

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing Supabase service role configuration.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureThreadParticipantCompat(params: {
  service: ReturnType<typeof getServiceClient>;
  threadId: string;
  userId: string;
  includeLastReadAt?: boolean;
}) {
  const nowIso = new Date().toISOString();
  const payloads: Array<Record<string, string>> = [];

  if (params.includeLastReadAt !== false) {
    payloads.push({ thread_id: params.threadId, user_id: params.userId, role: "member", last_read_at: nowIso });
  }
  payloads.push({ thread_id: params.threadId, user_id: params.userId, role: "member" });
  if (params.includeLastReadAt !== false) {
    payloads.push({ thread_id: params.threadId, user_id: params.userId, last_read_at: nowIso });
  }
  payloads.push({ thread_id: params.threadId, user_id: params.userId });

  let compatError: { message?: string } | null = null;
  for (const payload of payloads) {
    const insertRes = await params.service.from("thread_participants").insert(payload);
    if (!insertRes.error || isDuplicateError(insertRes.error)) {
      return true;
    }

    if (isMissingSchemaError(insertRes.error.message)) {
      compatError = insertRes.error;
      continue;
    }
    throw new Error(insertRes.error.message);
  }

  if (compatError) {
    throw new Error(compatError.message ?? "Unable to insert thread participant.");
  }
  return false;
}

async function resolveTripThreadId(params: {
  service: ReturnType<typeof getServiceClient>;
  tripId: string;
  actorId: string;
}) {
  const existingRes = await params.service.from("threads").select("id").eq("trip_id", params.tripId).maybeSingle();
  if (existingRes.error) {
    if (isMissingSchemaError(existingRes.error.message)) return null;
    throw new Error(existingRes.error.message);
  }

  let threadId = existingRes.data?.id ?? null;
  if (!threadId) {
    const createdRes = await params.service
      .from("threads")
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
        const retryRes = await params.service.from("threads").select("id").eq("trip_id", params.tripId).maybeSingle();
        if (retryRes.error) {
          if (isMissingSchemaError(retryRes.error.message)) return null;
          throw new Error(retryRes.error.message);
        }
        threadId = retryRes.data?.id ?? null;
      } else if (isMissingSchemaError(createdRes.error.message)) {
        return null;
      } else {
        throw new Error(createdRes.error.message);
      }
    } else {
      threadId = createdRes.data?.id ?? null;
    }
  }

  return threadId;
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { tripId } = await context.params;
    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Missing trip id." }, { status: 400 });
    }

    let explicitRequesterId: string | null = null;
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("application/json")) {
      const body = (await req.json().catch(() => null)) as { requesterId?: unknown } | null;
      if (typeof body?.requesterId === "string" && body.requesterId.trim().length > 0) {
        explicitRequesterId = body.requesterId.trim();
      }
    }

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabaseUser = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }
    const meId = authData.user.id;

    const service = getServiceClient();

    const tripRes = await service.from("trips").select("id,user_id").eq("id", tripId).maybeSingle();
    if (tripRes.error) {
      return NextResponse.json({ ok: false, error: tripRes.error.message }, { status: 400 });
    }
    const trip = tripRes.data as { id?: string; user_id?: string | null } | null;
    if (!trip?.id || !trip.user_id) {
      return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
    }

    let allowed = trip.user_id === meId;
    if (!allowed) {
      const reqRes = await service
        .from("trip_requests")
        .select("id")
        .eq("trip_id", tripId)
        .eq("requester_id", meId)
        .eq("status", "accepted")
        .limit(1)
        .maybeSingle();
      if (reqRes.error && !isMissingSchemaError(reqRes.error.message)) {
        return NextResponse.json({ ok: false, error: reqRes.error.message }, { status: 400 });
      }
      allowed = Boolean(reqRes.data);
    }
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "Not authorized for trip thread." }, { status: 403 });
    }

    const threadId = await resolveTripThreadId({
      service,
      tripId,
      actorId: meId,
    });

    if (!threadId) {
      return NextResponse.json({ ok: true, threadId: null, legacy: true });
    }

    const acceptedRes = await service
      .from("trip_requests")
      .select("requester_id,status")
      .eq("trip_id", tripId)
      .eq("status", "accepted")
      .limit(500);
    if (acceptedRes.error && !isMissingSchemaError(acceptedRes.error.message)) {
      return NextResponse.json({ ok: false, error: acceptedRes.error.message }, { status: 400 });
    }

    const acceptedRequesterIds = ((acceptedRes.data ?? []) as Array<{ requester_id?: string | null }>)
      .map((row) => row.requester_id ?? "")
      .filter(Boolean);

    const participantIds = Array.from(
      new Set(
        [trip.user_id, meId, explicitRequesterId, ...acceptedRequesterIds].filter(
          (value): value is string => typeof value === "string" && value.length > 0
        )
      )
    );

    for (const userId of participantIds) {
      await ensureThreadParticipantCompat({
        service,
        threadId,
        userId,
        includeLastReadAt: userId === meId,
      });
    }

    return NextResponse.json({ ok: true, threadId });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
