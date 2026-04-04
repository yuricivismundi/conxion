import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { activityTypeLabel } from "@/lib/activities/types";

type ActivityAction = "accept" | "decline" | "cancel";

type UpdateActivityPayload = {
  action?: ActivityAction;
};

function isActivityAction(value: unknown): value is ActivityAction {
  return value === "accept" || value === "decline" || value === "cancel";
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

function extractColumnNameFromError(message: string) {
  const missing = message.match(/column \"([^\"]+)\"/i)?.[1];
  if (missing) return missing;
  const nullColumn = message.match(/null value in column \"([^\"]+)\"/i)?.[1];
  if (nullColumn) return nullColumn;
  return "";
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
    // Best effort only. Activity state updates should not fail on notification issues.
  }
}

export async function POST(req: Request, context: { params: Promise<{ activityId: string }> }) {
  try {
    const { activityId } = await context.params;
    if (!activityId) {
      return NextResponse.json({ ok: false, error: "Missing activityId." }, { status: 400 });
    }

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as UpdateActivityPayload | null;
    const action = body?.action;
    if (!isActivityAction(action)) {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }

    const supabaseUser = getSupabaseUserClient(token);
    const service = getSupabaseServiceClient();
    const userRpc = (fn: string, args?: Record<string, unknown>) =>
      supabaseUser.rpc(fn, args) as unknown as Promise<{ data: unknown; error: { message?: string } | null }>;
    const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const currentRes = await service
      .from("activities")
      .select("id,thread_id,requester_id,recipient_id,activity_type,status,title,note,start_at,end_at,metadata")
      .eq("id", activityId)
      .maybeSingle();
    if (currentRes.error) {
      const message = currentRes.error.message ?? "Failed to load activity.";
      const status = isMissingSchemaError(message) ? 503 : 500;
      return NextResponse.json({ ok: false, error: message }, { status });
    }

    const current = currentRes.data as
      | {
          id?: string | null;
          thread_id?: string | null;
          requester_id?: string | null;
          recipient_id?: string | null;
          activity_type?: string | null;
          status?: string | null;
          title?: string | null;
          note?: string | null;
          start_at?: string | null;
          end_at?: string | null;
          metadata?: Record<string, unknown> | null;
        }
      | null;

    if (!current?.id || !current.thread_id || !current.requester_id || !current.recipient_id || !current.activity_type) {
      return NextResponse.json({ ok: false, error: "Activity not found." }, { status: 404 });
    }
    if (current.status !== "pending") {
      return NextResponse.json({ ok: false, error: "Activity is no longer pending." }, { status: 409 });
    }

    const isRequester = authData.user.id === current.requester_id;
    const isRecipient = authData.user.id === current.recipient_id;
    if (!isRequester && !isRecipient) {
      return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }
    if (action === "accept" && !isRecipient) {
      return NextResponse.json({ ok: false, error: "Only the recipient can accept." }, { status: 403 });
    }
    if (action === "decline" && !isRecipient) {
      return NextResponse.json({ ok: false, error: "Only the recipient can decline." }, { status: 403 });
    }
    if (action === "cancel" && !isRequester) {
      return NextResponse.json({ ok: false, error: "Only the sender can cancel." }, { status: 403 });
    }

    const nextStatus = action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled";
    const acceptedAt = action === "accept" ? new Date().toISOString() : null;
    const resolvedAt = action === "accept" ? null : new Date().toISOString();
    const metadata = {
      ...(current.metadata ?? {}),
      activity_type: current.activity_type,
      title: current.title ?? activityTypeLabel(current.activity_type),
      note: current.note ?? null,
      start_at: current.start_at ?? null,
      end_at: current.end_at ?? null,
      activity_id: current.id,
    };

    const updateRes = await service
      .from("activities")
      .update({
        status: nextStatus,
        accepted_at: acceptedAt,
        resolved_at: resolvedAt,
      } as never)
      .eq("id", activityId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (updateRes.error) {
      return NextResponse.json({ ok: false, error: updateRes.error.message }, { status: 400 });
    }
    const updatedRow = (updateRes.data ?? null) as { id?: string | null } | null;
    if (!updatedRow?.id) {
      return NextResponse.json({ ok: false, error: "Activity was not updated." }, { status: 409 });
    }

    const startDate = current.start_at ? current.start_at.slice(0, 10) : null;
    const endDate = current.end_at ? current.end_at.slice(0, 10) : null;
    const title = current.title ?? activityTypeLabel(current.activity_type);

    const contextRes = await userRpc("cx_upsert_thread_context", {
      p_thread_id: current.thread_id,
      p_source_table: "activities",
      p_source_id: current.id,
      p_context_tag: "activity",
      p_status_tag: nextStatus,
      p_title: title,
      p_city: null,
      p_start_date: startDate,
      p_end_date: endDate,
      p_requester_id: current.requester_id,
      p_recipient_id: current.recipient_id,
      p_metadata: metadata,
    });

    if (contextRes.error) {
      return NextResponse.json({ ok: false, error: contextRes.error.message }, { status: 400 });
    }

    if (nextStatus === "accepted" || nextStatus === "declined" || nextStatus === "cancelled") {
      const targetUserId =
        nextStatus === "cancelled" ? current.recipient_id : current.requester_id;
      void createActivityNotificationBestEffort({
        service,
        userId: targetUserId,
        actorId: authData.user.id,
        kind:
          nextStatus === "accepted"
            ? "activity_request_accepted"
            : nextStatus === "declined"
            ? "activity_request_declined"
            : "activity_request_cancelled",
        title:
          nextStatus === "accepted"
            ? `${title} request accepted`
            : nextStatus === "declined"
            ? `${title} request declined`
            : `${title} request cancelled`,
        body:
          nextStatus === "accepted"
            ? "Your activity request was accepted."
            : nextStatus === "declined"
            ? "Your activity request was declined."
            : "The activity request was cancelled.",
        linkUrl: `/messages?thread=${encodeURIComponent(current.thread_id)}`,
        metadata: {
          thread_id: current.thread_id,
          activity_id: current.id,
          activity_type: current.activity_type,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to update activity." },
      { status: 500 }
    );
  }
}
