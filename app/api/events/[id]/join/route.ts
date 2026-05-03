import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import {
  ensureLinkedMemberPairThread,
  mergeLinkedMemberContextMetadata,
  resolveLinkedMember,
} from "@/lib/requests/linked-members";

type JoinAction = "join" | "request" | "leave" | "cancel_request" | "interested" | "not_interested";

function isJoinAction(value: unknown): value is JoinAction {
  return (
    value === "join" ||
    value === "request" ||
    value === "leave" ||
    value === "cancel_request" ||
    value === "interested" ||
    value === "not_interested"
  );
}

function mapActionErrorStatus(message: string) {
  if (message.includes("not_authenticated")) return 401;
  if (message.includes("not_authorized")) return 403;
  if (message.includes("event_not_found") || message.includes("membership_not_found")) return 404;
  if (message.includes("email_verification_required_for_join") || message.includes("new_account_join_limit_reached")) return 429;
  if (
    message.includes("private_event_requires_request") ||
    message.includes("request_event_requires_approval") ||
    message.includes("event_is_request_only") ||
    message.includes("event_is_public") ||
    message.includes("event_is_not_request") ||
    message.includes("event_not_open") ||
    message.includes("event_hidden") ||
    message.includes("already_joined_or_waitlisted") ||
    message.includes("private_group_member_limit_reached") ||
    message.includes("private_group_monthly_limit_reached") ||
    message.includes("invalid_response") ||
    message.includes("request_not_found_or_not_pending") ||
    message.includes("host_cannot_leave_own_event")
  ) {
    return 409;
  }
  return 400;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await context.params;
    if (!eventId) {
      return NextResponse.json({ ok: false, error: "Missing event id." }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const actionRaw = body?.action;
    const note = typeof body?.note === "string" ? body.note : null;
    const linkedMemberUserId = typeof body?.linkedMemberUserId === "string" ? body.linkedMemberUserId.trim() : "";

    if (!isJoinAction(actionRaw)) {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }

    const action = actionRaw;

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabase = getSupabaseUserClient(token);
    const service = getSupabaseServiceClient();
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const eventRes = await service
      .from("events")
      .select("host_user_id")
      .eq("id", eventId)
      .maybeSingle();
    if (eventRes.error) {
      return NextResponse.json({ ok: false, error: eventRes.error.message }, { status: 500 });
    }
    const eventRow = (eventRes.data ?? null) as { host_user_id?: string } | null;
    const hostUserId = typeof eventRow?.host_user_id === "string" ? eventRow.host_user_id : "";

    if (action === "join") {
      const { data, error } = await supabase.rpc("join_event_guarded", { p_event_id: eventId });
      if (error) {
        const message = error.message ?? "Failed to join event.";
        return NextResponse.json({ ok: false, error: message }, { status: mapActionErrorStatus(message) });
      }

      // Add/restore the user in the event's thread so it appears in their inbox.
      // Create the thread on-demand if it doesn't exist yet.
      // On re-join we must clear archived_at (ignoreDuplicates would silently skip archived rows).
      const threadsTable = service.from("threads" as never) as unknown as {
        select: (columns: string) => {
          eq: (column: string, value: string) => {
            eq: (column: string, value: string) => {
              maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
            };
          };
        };
        insert: (value: Record<string, string>) => {
          select: (columns: string) => {
            single: () => Promise<{ data: unknown; error: { message?: string } | null }>;
          };
        };
      };
      const threadParticipantsTable = service.from("thread_participants" as never) as unknown as {
        upsert: (
          value: Record<string, string | null>,
          options: { onConflict: string; ignoreDuplicates: boolean }
        ) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
      const threadContextsTable = service.from("thread_contexts" as never) as unknown as {
        upsert: (
          value: Record<string, unknown>,
          options: { onConflict: string; ignoreDuplicates: boolean }
        ) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
      let eventThreadId: string | null = null;
      const threadRes = await threadsTable
        .select("id")
        .eq("event_id", eventId)
        .eq("thread_type", "event")
        .maybeSingle();
      const threadRow = (threadRes.data ?? null) as { id?: string } | null;
      if (threadRow?.id) {
        eventThreadId = threadRow.id;
      } else if (hostUserId) {
        // Thread doesn't exist yet — create it now
        const newThreadRes = await threadsTable
          .insert({ event_id: eventId, thread_type: "event", created_by: hostUserId })
          .select("id")
          .single();
        const newThreadRow = (newThreadRes.data ?? null) as { id?: string } | null;
        if (newThreadRow?.id) {
          eventThreadId = newThreadRow.id;
          // Add the host as a participant too
          await threadParticipantsTable.upsert(
            { thread_id: eventThreadId, user_id: hostUserId, role: "admin", archived_at: null },
            { onConflict: "thread_id,user_id", ignoreDuplicates: false }
          );
        }
      }
      if (eventThreadId) {
        await threadParticipantsTable.upsert(
          { thread_id: eventThreadId, user_id: authData.user.id, role: "member", archived_at: null },
          { onConflict: "thread_id,user_id", ignoreDuplicates: false }
        );
        // Ensure a thread_contexts row exists so the inbox filter works
        await threadContextsTable.upsert(
          {
            thread_id: eventThreadId,
            source_table: "events",
            source_id: eventId,
            context_tag: "event_chat",
            status_tag: "active",
            requester_id: authData.user.id,
            recipient_id: hostUserId || authData.user.id,
            metadata: { event_id: eventId },
          },
          { onConflict: "source_table,source_id", ignoreDuplicates: true }
        );
      }

      if (hostUserId && hostUserId !== authData.user.id) {
        await sendAppEmailBestEffort({
          kind: "event_joined",
          recipientUserId: hostUserId,
          actorUserId: authData.user.id,
          eventId,
        });
      }
      return NextResponse.json({ ok: true, status: data ?? null });
    }

    if (action === "request") {
      const { data, error } = await supabase.rpc("request_private_event_access", {
        p_event_id: eventId,
        p_note: note,
      });
      if (error) {
        const message = error.message ?? "Failed to request access.";
        return NextResponse.json({ ok: false, error: message }, { status: mapActionErrorStatus(message) });
      }
      const requestId = typeof data === "string" ? data : "";
      if (requestId && hostUserId && hostUserId !== authData.user.id) {
        const linkedMember = await resolveLinkedMember({
          serviceClient: service,
          actorUserId: authData.user.id,
          recipientUserId: hostUserId,
          linkedMemberUserId,
        });

        if (linkedMember) {
          const linkedUpdateRes = await service
            .from("event_requests")
            .update({ linked_member_user_id: linkedMember.userId } as never)
            .eq("id", requestId);
          if (linkedUpdateRes.error) {
            throw new Error(linkedUpdateRes.error.message);
          }

          await mergeLinkedMemberContextMetadata({
            serviceClient: service,
            sourceTable: "event_requests",
            sourceId: requestId,
            linkedMember,
          });

          await ensureLinkedMemberPairThread({
            serviceClient: service,
            actorUserId: authData.user.id,
            linkedMember,
            recipientUserId: hostUserId,
          });
        }
      }
      if (hostUserId && hostUserId !== authData.user.id) {
        await sendAppEmailBestEffort({
          kind: "event_request_received",
          recipientUserId: hostUserId,
          actorUserId: authData.user.id,
          eventId,
        });
      }
      return NextResponse.json({ ok: true, request_id: data ?? null });
    }

    if (action === "interested" || action === "not_interested") {
      const { data, error } = await supabase.rpc("set_event_response", {
        p_event_id: eventId,
        p_response: action,
      });
      if (error) {
        const message = error.message ?? "Failed to save response.";
        return NextResponse.json({ ok: false, error: message }, { status: mapActionErrorStatus(message) });
      }
      return NextResponse.json({ ok: true, status: data ?? null });
    }

    if (action === "cancel_request") {
      const { error } = await supabase.rpc("cancel_event_request", { p_event_id: eventId });
      if (error) {
        const message = error.message ?? "Failed to cancel request.";
        return NextResponse.json({ ok: false, error: message }, { status: mapActionErrorStatus(message) });
      }
      return NextResponse.json({ ok: true });
    }

    const { error } = await supabase.rpc("leave_event", { p_event_id: eventId });
    if (error) {
      const message = error.message ?? "Failed to leave event.";
      return NextResponse.json({ ok: false, error: message }, { status: mapActionErrorStatus(message) });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
