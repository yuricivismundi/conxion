import { NextResponse } from "next/server";
import { validateCsrfOrigin, csrfError } from "@/lib/security/csrf";
import { findPendingPairRequestConflict } from "@/lib/requests/pending-pair-conflicts";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { encodeCursor, decodeCursor, validatePaginationLimit, PaginationResponse } from "@/lib/pagination/cursor";
import { checkDirectInviteRateLimit } from "@/lib/activities/direct-invite-limits";
import {
  ACTIVITY_TYPES,
  LINKED_MEMBER_ACTIVITY_TYPES,
  activityTypeLabel,
  activityUsesDateRange,
  parseActivityType,
} from "@/lib/activities/types";
import { validatePairActivityMonthlyLimit } from "@/lib/activities/limits";
import {
  buildLinkedMemberMetadata,
  ensureLinkedMemberPairThread,
  resolveLinkedMember,
} from "@/lib/requests/linked-members";

type CreateActivityPayload = {
  threadId?: string;
  connectionId?: string;
  recipientUserId?: string;
  activityType?: string;
  note?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  linkedMemberUserId?: string | null;
  /** When true, skips the accepted-base-context requirement (profile direct invite flow) */
  directInvite?: boolean;
};

const LINKED_MEMBER_ELIGIBLE_ACTIVITY_TYPES = new Set(LINKED_MEMBER_ACTIVITY_TYPES);

function parseIsoOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function isMissingSchemaError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("relation") ||
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("column") ||
    text.includes("function")
  );
}

function isDuplicateError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  return error.code === "23505" || message.includes("duplicate");
}

function extractColumnNameFromError(message: string) {
  const missing = message.match(/column \"([^\"]+)\"/i)?.[1];
  if (missing) return missing;
  const nullColumn = message.match(/null value in column \"([^\"]+)\"/i)?.[1];
  if (nullColumn) return nullColumn;
  return "";
}

function isAcceptedStatus(value: unknown) {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  return status === "accepted" || status === "active" || status === "completed";
}

async function createActivityNotificationBestEffort(params: {
  service: ReturnType<typeof getSupabaseServiceClient>;
  userId: string;
  actorId: string;
  kind: string;
  title: string;
  body: string;
  linkUrl: string;
  metadata: Record<string, unknown>;
}) {
  const payloadCandidates: Array<Record<string, unknown>> = [
    {
      user_id: params.userId,
      actor_id: params.actorId,
      kind: params.kind,
      title: params.title,
      body: params.body,
      link_url: params.linkUrl,
      metadata: params.metadata,
      is_read: false,
    },
    {
      user_id: params.userId,
      actor_id: params.actorId,
      kind: params.kind,
      title: params.title,
      message: params.body,
      link_url: params.linkUrl,
      metadata: params.metadata,
      is_read: false,
    },
    {
      user_id: params.userId,
      kind: params.kind,
      title: params.title,
      body: params.body,
      metadata: params.metadata,
    },
    {
      user_id: params.userId,
      kind: params.kind,
      message: params.title,
      data: params.metadata,
    },
  ];

  const notificationsTable = params.service.from("notifications" as never) as unknown as {
    insert: (values: Record<string, unknown>) => Promise<{ error: { message?: string; code?: string } | null }>;
  };

  const fallbackValueForColumn = (column: string) => {
    const key = column.trim().toLowerCase();
    if (key === "user_id" || key === "recipient_id" || key === "to_user_id" || key === "target_id") return params.userId;
    if (key === "actor_id" || key === "sender_id" || key === "from_user_id" || key === "source_id") return params.actorId;
    if (key === "kind" || key === "type" || key === "event_type") return params.kind;
    if (key === "title" || key === "message") return params.title;
    if (key === "body" || key === "content" || key === "text") return params.body;
    if (key === "link_url" || key === "url") return params.linkUrl;
    if (key === "metadata" || key === "data" || key === "payload") return params.metadata;
    if (key === "is_read" || key === "read") return false;
    return undefined;
  };

  try {
    for (const candidate of payloadCandidates) {
      const payload = { ...candidate };
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const insertRes = await notificationsTable.insert(payload);
        if (!insertRes.error) return;

        const message = insertRes.error.message ?? "";
        if (insertRes.error.code === "23505" || message.toLowerCase().includes("duplicate")) {
          return;
        }

        const missingColumn = extractColumnNameFromError(message);
        if (missingColumn) {
          const value = fallbackValueForColumn(missingColumn);
          if (value !== undefined) {
            payload[missingColumn] = value;
            continue;
          }
        }

        if (!isMissingSchemaError(message)) return;
        break;
      }
    }
  } catch {
    // Best effort only. Activity requests should not fail on notification issues.
  }
}

async function ensureThreadParticipantCompat(params: {
  service: ReturnType<typeof getSupabaseServiceClient>;
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
  const threadParticipantsTable = params.service.from("thread_participants" as never) as unknown as {
    insert: (
      value: Record<string, string>
    ) => Promise<{ error: { code?: string; message?: string } | null }>;
  };
  for (const payload of payloads) {
    const insertRes = await threadParticipantsTable.insert(payload);
    if (!insertRes.error || isDuplicateError(insertRes.error)) {
      return true;
    }
    if (isMissingSchemaError(insertRes.error.message ?? "")) {
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

async function resolveConnectionThreadId(params: {
  service: ReturnType<typeof getSupabaseServiceClient>;
  connectionId: string;
  actorId: string;
}) {
  const threadsTable = params.service.from("threads" as never) as unknown as {
    select: (
      columns: string
    ) => {
      eq: (
        column: string,
        value: string
      ) => {
        maybeSingle: () => Promise<{ data: { id?: string | null } | null; error: { code?: string; message?: string } | null }>;
      };
    };
    insert: (
      value: Record<string, string>
    ) => {
      select: (
        columns: string
      ) => {
        maybeSingle: () => Promise<{ data: { id?: string | null } | null; error: { code?: string; message?: string } | null }>;
      };
    };
  };

  const existingRes = await threadsTable.select("id").eq("connection_id", params.connectionId).maybeSingle();
  if (existingRes.error) {
    if (isMissingSchemaError(existingRes.error.message ?? "")) return null;
    throw new Error(existingRes.error.message);
  }

  let threadId = ((existingRes.data ?? null) as { id?: string | null } | null)?.id ?? null;
  if (!threadId) {
    const createdRes = await threadsTable
      .insert({
        thread_type: "connection",
        connection_id: params.connectionId,
        created_by: params.actorId,
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (createdRes.error) {
      if (isDuplicateError(createdRes.error)) {
        const retryRes = await threadsTable.select("id").eq("connection_id", params.connectionId).maybeSingle();
        if (retryRes.error) {
          if (isMissingSchemaError(retryRes.error.message ?? "")) return null;
          throw new Error(retryRes.error.message);
        }
        threadId = ((retryRes.data ?? null) as { id?: string | null } | null)?.id ?? null;
      } else if (isMissingSchemaError(createdRes.error.message ?? "")) {
        return null;
      } else {
        throw new Error(createdRes.error.message);
      }
    } else {
      threadId = ((createdRes.data ?? null) as { id?: string | null } | null)?.id ?? null;
    }
  }

  return threadId;
}

async function resolveDirectThreadId(params: {
  service: ReturnType<typeof getSupabaseServiceClient>;
  actorId: string;
  recipientId: string;
}): Promise<{ dbId: string; token: string } | null> {
  const svc = params.service;
  const { actorId, recipientId } = params;

  // 1. Prefer an existing accepted connection thread — activity contexts belong there.
  const connRes = await svc
    .from("connections")
    .select("id")
    .eq("status", "accepted")
    .or(
      `and(requester_id.eq.${actorId},target_id.eq.${recipientId}),and(requester_id.eq.${recipientId},target_id.eq.${actorId})`
    )
    .limit(1)
    .maybeSingle();
  if (!connRes.error && (connRes.data as { id?: string } | null)?.id) {
    const connectionId = (connRes.data as unknown as { id: string }).id;
    const connThread = await svc
      .from("threads")
      .select("id")
      .eq("thread_type", "connection")
      .eq("connection_id", connectionId)
      .limit(1)
      .maybeSingle();
    if (!connThread.error && (connThread.data as { id?: string } | null)?.id) {
      return { dbId: (connThread.data as unknown as { id: string }).id, token: `conn:${connectionId}` };
    }
  }

  // 2. Find an existing direct thread via thread_participants
  const actorThreads = await svc
    .from("thread_participants")
    .select("thread_id")
    .eq("user_id", actorId);

  if (!actorThreads.error && actorThreads.data?.length) {
    const actorIds = (actorThreads.data as Array<{ thread_id?: string }>)
      .map((r) => r.thread_id)
      .filter((id): id is string => Boolean(id));

    if (actorIds.length > 0) {
      const recipThreads = await svc
        .from("thread_participants")
        .select("thread_id")
        .eq("user_id", recipientId)
        .in("thread_id", actorIds.slice(0, 100));

      if (!recipThreads.error && recipThreads.data?.length) {
        const sharedIds = (recipThreads.data as Array<{ thread_id?: string }>)
          .map((r) => r.thread_id)
          .filter((id): id is string => Boolean(id));

        if (sharedIds.length > 0) {
          const directThread = await svc
            .from("threads")
            .select("id")
            .eq("thread_type", "direct")
            .in("id", sharedIds.slice(0, 100))
            .limit(1)
            .maybeSingle();

          if (!directThread.error && (directThread.data as { id?: string } | null)?.id) {
            const id = (directThread.data as unknown as { id: string }).id;
            return { dbId: id, token: `direct:${id}` };
          }
        }
      }
    }
  }

  // 3. Find via direct_user_low/high (canonical direct thread columns)
  const [userLow, userHigh] = [actorId, recipientId].sort();
  const byCanonical = await svc
    .from("threads")
    .select("id")
    .eq("thread_type", "direct")
    .eq("direct_user_low", userLow)
    .eq("direct_user_high", userHigh)
    .limit(1)
    .maybeSingle();
  if (!byCanonical.error && (byCanonical.data as { id?: string } | null)?.id) {
    const id = (byCanonical.data as unknown as { id: string }).id;
    return { dbId: id, token: `direct:${id}` };
  }

  // 4. Create new direct thread
  const created = await svc
    .from("threads")
    .insert({
      thread_type: "direct",
      created_by: actorId,
      direct_user_low: userLow,
      direct_user_high: userHigh,
      last_message_at: new Date().toISOString(),
    } as never)
    .select("id")
    .maybeSingle();

  if (!created.error && (created.data as { id?: string } | null)?.id) {
    const newThreadId = (created.data as unknown as { id: string }).id;
    await svc.from("thread_participants").insert([
      { thread_id: newThreadId, user_id: actorId },
      { thread_id: newThreadId, user_id: recipientId },
    ] as never).then(() => null, () => null);
    return { dbId: newThreadId, token: `direct:${newThreadId}` };
  }

  // 5. Race condition retry via canonical columns
  if (isDuplicateError(created.error ?? {})) {
    const retry = await svc
      .from("threads")
      .select("id")
      .eq("thread_type", "direct")
      .eq("direct_user_low", userLow)
      .eq("direct_user_high", userHigh)
      .limit(1)
      .maybeSingle();
    if (!retry.error && (retry.data as { id?: string } | null)?.id) {
      const id = (retry.data as unknown as { id: string }).id;
      return { dbId: id, token: `direct:${id}` };
    }
  }

  return null;
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const url = new URL(req.url);
    const limit = validatePaginationLimit(url.searchParams.get("limit"));
    const cursor = url.searchParams.get("cursor");
    const filter = url.searchParams.get("filter") || "pending"; // pending, accepted, declined, all

    const userClient = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const pageSize = limit + 1;

    let query = userClient.from("activities").select(
      "id,thread_id,requester_id,recipient_id,activity_type,status,title,note,start_at,end_at,metadata,created_at,updated_at"
    );

    // Filter by user involvement
    query = query.or(`requester_id.eq.${authData.user.id},recipient_id.eq.${authData.user.id}`);

    // Apply status filter
    if (filter === "pending") {
      query = query.eq("status", "pending");
    } else if (filter === "accepted") {
      query = query.eq("status", "accepted");
    } else if (filter === "declined") {
      query = query.in("status", ["declined", "cancelled"]);
    }
    // filter === "all" has no additional status filter

    // Cursor-based pagination
    if (decodedCursor?.id) {
      query = query.lt("created_at", decodedCursor.sortValue as string).lt("id", decodedCursor.id);
    }

    query = query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(pageSize);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    const items = ((data ?? []) as Array<Record<string, unknown>>).slice(0, limit);
    const hasMore = (data ?? []).length > limit;
    const nextCursor = hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]?.id as string ?? "", items[items.length - 1]?.created_at as string ?? "") : null;

    return NextResponse.json({
      ok: true,
      items,
      cursor: nextCursor,
      hasMore,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load activities." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  if (!validateCsrfOrigin(req)) return csrfError();
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as CreateActivityPayload | null;
    const requestedThreadId = body?.threadId?.trim() ?? "";
    const connectionId = body?.connectionId?.trim() ?? "";
    const recipientUserId = body?.recipientUserId?.trim() ?? "";
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    const rawActivityType = typeof body?.activityType === "string" ? body.activityType.trim() : "";
    const activityType = parseActivityType(rawActivityType);
    const linkedMemberUserId = typeof body?.linkedMemberUserId === "string" ? body.linkedMemberUserId.trim() : "";
    const directInvite = Boolean(body?.directInvite);

    // Check directInvite rate limit before authentication
    if (directInvite && req.headers.get("authorization")) {
      const token = getBearerToken(req);
      if (token) {
        const tempUserClient = getSupabaseUserClient(token);
        const { data: tempAuthData } = await tempUserClient.auth.getUser(token);
        if (tempAuthData?.user) {
          const rateLimit = checkDirectInviteRateLimit(tempAuthData.user.id);
          if (!rateLimit.allowed) {
            return NextResponse.json(
              { ok: false, error: `Too many direct invites. Try again in ${Math.ceil((rateLimit.resetAt!.getTime() - Date.now()) / 1000 / 60)} minutes.` },
              { status: 429 }
            );
          }
        }
      }
    }

    if (!recipientUserId || !rawActivityType) {
      return NextResponse.json(
        { ok: false, error: "recipientUserId and activityType are required." },
        { status: 400 }
      );
    }
    if (!directInvite && !requestedThreadId && !connectionId) {
      return NextResponse.json(
        { ok: false, error: "threadId or connectionId is required (or use directInvite: true)." },
        { status: 400 }
      );
    }
    if (!activityType) {
      return NextResponse.json(
        { ok: false, error: `Invalid activityType. Allowed: ${ACTIVITY_TYPES.map(activityTypeLabel).join(", ")}` },
        { status: 400 }
      );
    }
    const hasDateRange = activityUsesDateRange(activityType);
    const startAt = parseIsoOrNull(body?.startAt);
    const endAtRaw = parseIsoOrNull(body?.endAt);
    const endAt = hasDateRange ? endAtRaw : null;
    if (endAt && !startAt) {
      return NextResponse.json({ ok: false, error: "Start date is required when an end date is set." }, { status: 400 });
    }
    if (startAt && endAt && new Date(endAt).getTime() < new Date(startAt).getTime()) {
      return NextResponse.json({ ok: false, error: "End date must be after start date." }, { status: 400 });
    }

    const supabaseUser = getSupabaseUserClient(token);
    const service = getSupabaseServiceClient();
    const serviceRpc = (fn: string, args?: Record<string, unknown>) =>
      (service as unknown as {
        rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
      }).rpc(fn, args);
    const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    if (authData.user.id === recipientUserId) {
      return NextResponse.json({ ok: false, error: "You cannot create an activity with yourself." }, { status: 400 });
    }

    const pendingConflict = await findPendingPairRequestConflict(service, {
      actorUserId: authData.user.id,
      otherUserId: recipientUserId,
    });
    if (pendingConflict) {
      return NextResponse.json({ ok: false, error: pendingConflict.message }, { status: 409 });
    }

    let threadId = requestedThreadId;
    let threadToken: string | null = null;

    if (!threadId && connectionId) {
      threadId = (await resolveConnectionThreadId({
        service,
        connectionId,
        actorId: authData.user.id,
      })) ?? "";
      if (!threadId) {
        return NextResponse.json({ ok: false, error: "Failed to prepare activity thread." }, { status: 503 });
      }
      threadToken = `conn:${connectionId}`;
      await ensureThreadParticipantCompat({ service, threadId, userId: authData.user.id, includeLastReadAt: true });
      await ensureThreadParticipantCompat({ service, threadId, userId: recipientUserId, includeLastReadAt: false });
    }

    if (!threadId && directInvite) {
      const resolved = await resolveDirectThreadId({
        service,
        actorId: authData.user.id,
        recipientId: recipientUserId,
      });
      if (!resolved) {
        return NextResponse.json({ ok: false, error: "Failed to prepare activity thread." }, { status: 503 });
      }
      threadId = resolved.dbId;
      threadToken = resolved.token;
      await ensureThreadParticipantCompat({ service, threadId, userId: authData.user.id, includeLastReadAt: true });
      await ensureThreadParticipantCompat({ service, threadId, userId: recipientUserId, includeLastReadAt: false });
    }

    // Validate that both participants belong to the thread (skip for directInvite — we just created/ensured it)
    if (!directInvite) {
      const participantsRes = await service
        .from("thread_participants")
        .select("user_id")
        .eq("thread_id", threadId)
        .in("user_id", [authData.user.id, recipientUserId]);

      if (participantsRes.error) {
        const message = participantsRes.error.message ?? "Failed to validate thread participants.";
        const status = isMissingSchemaError(message) ? 503 : 500;
        return NextResponse.json({ ok: false, error: message }, { status });
      }

      const participantIds = new Set(
        ((participantsRes.data ?? []) as Array<{ user_id?: string | null }>)
          .map((row) => (typeof row.user_id === "string" ? row.user_id : ""))
          .filter(Boolean)
      );
      if (!participantIds.has(authData.user.id) || !participantIds.has(recipientUserId)) {
        return NextResponse.json({ ok: false, error: "Both users must belong to the thread." }, { status: 403 });
      }
    }

    // Check for accepted base context (skip for direct invites — the activity IS the first context)
    if (!directInvite) {
      let hasAcceptedBaseContext = false;

      const threadContextsRes = await service
        .from("thread_contexts")
        .select("context_tag,status_tag")
        .eq("thread_id", threadId);

      if (threadContextsRes.error) {
        const message = threadContextsRes.error.message ?? "Failed to validate thread state.";
        const status = isMissingSchemaError(message) ? 503 : 500;
        return NextResponse.json({ ok: false, error: message }, { status });
      }

      hasAcceptedBaseContext = ((threadContextsRes.data ?? []) as Array<{ context_tag?: string | null; status_tag?: string | null }>).some(
        (row) => {
          const tag = typeof row.context_tag === "string" ? row.context_tag : "";
          return tag !== "activity" && isAcceptedStatus(row.status_tag);
        }
      );

      if (!hasAcceptedBaseContext && connectionId) {
        const connectionRes = await service
          .from("connections")
          .select("status,blocked_by")
          .eq("id", connectionId)
          .maybeSingle();

        if (connectionRes.error) {
          const message = connectionRes.error.message ?? "Failed to validate connection state.";
          const status = isMissingSchemaError(message) ? 503 : 500;
          return NextResponse.json({ ok: false, error: message }, { status });
        }

        const connectionRow = connectionRes.data as { status?: string | null; blocked_by?: string | null } | null;
        hasAcceptedBaseContext = Boolean(
          connectionRow &&
            isAcceptedStatus(connectionRow.status) &&
            !connectionRow.blocked_by
        );
      }

      if (!hasAcceptedBaseContext) {
        return NextResponse.json(
          { ok: false, error: "Activities require an accepted connection, trip, hosting, or event context first." },
          { status: 409 }
        );
      }
    }

    const pairLimitCheck = await validatePairActivityMonthlyLimit({
      serviceClient: service,
      requesterUserId: authData.user.id,
      recipientUserId,
      activityType,
    });
    if (!pairLimitCheck.ok) {
      return NextResponse.json({ ok: false, error: pairLimitCheck.error }, { status: 409 });
    }

    const title = activityTypeLabel(activityType);
    const linkedMember = LINKED_MEMBER_ELIGIBLE_ACTIVITY_TYPES.has(activityType)
      ? await resolveLinkedMember({
          serviceClient: service,
          actorUserId: authData.user.id,
          recipientUserId,
          linkedMemberUserId,
        })
      : null;
    const metadata = {
      activity_type: activityType,
      title,
      note: note || null,
      start_at: startAt,
      end_at: endAt,
      ...buildLinkedMemberMetadata(linkedMember),
    };

    const insertRes = await service
      .from("activities")
      .insert({
        thread_id: threadId,
        requester_id: authData.user.id,
        recipient_id: recipientUserId,
        activity_type: activityType,
        status: "pending",
        title,
        note: note || null,
        start_at: startAt,
        end_at: endAt,
        linked_member_user_id: linkedMember?.userId ?? null,
        metadata,
      } as never)
      .select("id")
      .maybeSingle();

    if (insertRes.error) {
      const message = insertRes.error.message ?? "Failed to create activity.";
      const status = isMissingSchemaError(message) ? 503 : 400;
      return NextResponse.json({ ok: false, error: message }, { status });
    }

    const insertRow = (insertRes.data ?? null) as { id?: string | null } | null;
    const activityId = typeof insertRow?.id === "string" ? insertRow.id : "";
    if (!activityId) {
      return NextResponse.json({ ok: false, error: "Activity was created without an id." }, { status: 500 });
    }

    const startDate = startAt ? startAt.slice(0, 10) : null;
    const endDate = endAt ? endAt.slice(0, 10) : null;

    const contextRes = await serviceRpc("cx_upsert_thread_context", {
      p_thread_id: threadId,
      p_source_table: "activities",
      p_source_id: activityId,
      p_context_tag: "activity",
      p_status_tag: "pending",
      p_title: title,
      p_city: null,
      p_start_date: startDate,
      p_end_date: endDate,
      p_requester_id: authData.user.id,
      p_recipient_id: recipientUserId,
      p_metadata: metadata,
    });

    if (contextRes.error) {
      // Rollback: delete the just-inserted activity so it doesn't orphan as a blocking pending entry.
      await service.from("activities").delete().eq("id", activityId);
      return NextResponse.json({ ok: false, error: contextRes.error.message ?? "Failed to update thread context." }, { status: 400 });
    }

    // Best-effort: create the linked-member pair thread. Don't fail the whole request if it errors.
    try {
      await ensureLinkedMemberPairThread({
        serviceClient: service,
        actorUserId: authData.user.id,
        linkedMember,
        recipientUserId,
      });
    } catch {
      // Non-critical — the activity and thread context are already created.
    }

    void createActivityNotificationBestEffort({
      service,
      userId: recipientUserId,
      actorId: authData.user.id,
      kind: "activity_request_received",
      title: `${title} request received`,
      body: note || "You received a new activity request in Messages.",
      linkUrl: `/messages?thread=${encodeURIComponent(threadId)}`,
      metadata: {
        thread_id: threadId,
        activity_id: activityId,
        activity_type: activityType,
      },
    });

    return NextResponse.json({ ok: true, id: activityId, threadId: threadToken ?? threadId });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to create activity." },
      { status: 500 }
    );
  }
}
