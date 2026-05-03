import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

type RespondAction = "accept" | "decline";

function isRespondAction(value: unknown): value is RespondAction {
  return value === "accept" || value === "decline";
}

function mapRespondErrorStatus(message: string) {
  if (message.includes("not_authenticated")) return 401;
  if (message.includes("not_authorized")) return 403;
  if (message.includes("event_not_found") || message.includes("request_not_found")) return 404;
  if (message.includes("request_not_pending") || message.includes("invalid_action")) return 409;
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
    const action = body?.action;
    const requestId = typeof body?.requestId === "string" ? body.requestId : "";
    const requesterId = typeof body?.requesterId === "string" ? body.requesterId : "";

    if (!isRespondAction(action)) {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }

    if (!requestId && !requesterId) {
      return NextResponse.json(
        { ok: false, error: "requestId or requesterId is required." },
        { status: 400 }
      );
    }

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

    const eventHostRes = await service
      .from("events")
      .select("host_user_id")
      .eq("id", eventId)
      .maybeSingle();
    const eventHostRow = (eventHostRes.data ?? null) as { host_user_id?: string } | null;
    const hostUserId = typeof eventHostRow?.host_user_id === "string" ? eventHostRow.host_user_id : "";
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

    if (requestId) {
      const requestRes = await service
        .from("event_requests")
        .select("id,event_id,requester_id")
        .eq("id", requestId)
        .maybeSingle();
      if (requestRes.error) {
        return NextResponse.json({ ok: false, error: requestRes.error.message }, { status: 500 });
      }
      const requestRow = (requestRes.data ?? null) as { requester_id?: string; event_id?: string | null } | null;
      if (typeof requestRow?.event_id === "string" && requestRow.event_id !== eventId) {
        return NextResponse.json({ ok: false, error: "Request does not belong to this event." }, { status: 404 });
      }
      const { data, error } = await supabase.rpc("respond_event_request", {
        p_request_id: requestId,
        p_action: action,
      });
      if (error) {
        const message = error.message ?? "Failed to process request.";
        return NextResponse.json({ ok: false, error: message }, { status: mapRespondErrorStatus(message) });
      }
      const requesterIdResolved = typeof requestRow?.requester_id === "string" ? requestRow.requester_id : "";
      const eventIdResolved = typeof requestRow?.event_id === "string" ? requestRow.event_id : eventId;

      // When accepting, add the requester to the event's thread (create thread on-demand if needed)
      if (action === "accept" && requesterIdResolved) {
        let eventThreadId: string | null = null;
        const threadRes = await threadsTable
          .select("id")
          .eq("event_id", eventIdResolved)
          .eq("thread_type", "event")
          .maybeSingle();
        const threadRow = (threadRes.data ?? null) as { id?: string } | null;
        if (threadRow?.id) {
          eventThreadId = threadRow.id;
        } else if (hostUserId) {
          const newThreadRes = await threadsTable
            .insert({ event_id: eventIdResolved, thread_type: "event", created_by: hostUserId })
            .select("id")
            .single();
          const newThreadRow = (newThreadRes.data ?? null) as { id?: string } | null;
          if (newThreadRow?.id) {
            eventThreadId = newThreadRow.id;
            await threadParticipantsTable.upsert(
              { thread_id: eventThreadId, user_id: hostUserId, role: "admin", archived_at: null },
              { onConflict: "thread_id,user_id", ignoreDuplicates: false }
            );
          }
        }
        if (eventThreadId) {
          await threadParticipantsTable.upsert(
            { thread_id: eventThreadId, user_id: requesterIdResolved, role: "member", archived_at: null },
            { onConflict: "thread_id,user_id", ignoreDuplicates: false }
          );
        }
      }

      if (requesterIdResolved) {
        await sendAppEmailBestEffort({
          kind: action === "accept" ? "event_request_accepted" : "event_request_declined",
          recipientUserId: requesterIdResolved,
          actorUserId: authData.user.id,
          eventId: eventIdResolved,
        });
      }
      return NextResponse.json({ ok: true, event_id: data ?? eventId });
    }

    const existingRequestRes = await service
      .from("event_requests")
      .select("id,event_id,requester_id")
      .eq("event_id", eventId)
      .eq("requester_id", requesterId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingRequestRes.error) {
      return NextResponse.json({ ok: false, error: existingRequestRes.error.message }, { status: 500 });
    }
    const existingRequestRow = (existingRequestRes.data ?? null) as { event_id?: string | null } | null;

    const { data, error } = await supabase.rpc("respond_event_request_by_id", {
      p_event_id: eventId,
      p_requester_id: requesterId,
      p_action: action,
    });

    if (error) {
      const message = error.message ?? "Failed to process request.";
      return NextResponse.json({ ok: false, error: message }, { status: mapRespondErrorStatus(message) });
    }

    const resolvedEventId = typeof existingRequestRow?.event_id === "string" ? existingRequestRow.event_id : eventId;

    // When accepting, add the requester to the event's thread (create on-demand if needed)
    if (action === "accept" && requesterId) {
      let eventThreadId: string | null = null;
      const threadRes = await threadsTable
        .select("id")
        .eq("event_id", resolvedEventId)
        .eq("thread_type", "event")
        .maybeSingle();
      const threadRow = (threadRes.data ?? null) as { id?: string } | null;
      if (threadRow?.id) {
        eventThreadId = threadRow.id;
      } else if (hostUserId) {
        const newThreadRes = await threadsTable
          .insert({ event_id: resolvedEventId, thread_type: "event", created_by: hostUserId })
          .select("id")
          .single();
        const newThreadRow = (newThreadRes.data ?? null) as { id?: string } | null;
        if (newThreadRow?.id) {
          eventThreadId = newThreadRow.id;
          await threadParticipantsTable.upsert(
            { thread_id: eventThreadId, user_id: hostUserId, role: "admin", archived_at: null },
            { onConflict: "thread_id,user_id", ignoreDuplicates: false }
          );
        }
      }
      if (eventThreadId) {
        await threadParticipantsTable.upsert(
          { thread_id: eventThreadId, user_id: requesterId, role: "member", archived_at: null },
          { onConflict: "thread_id,user_id", ignoreDuplicates: false }
        );
      }
    }

    if (requesterId) {
      await sendAppEmailBestEffort({
        kind: action === "accept" ? "event_request_accepted" : "event_request_declined",
        recipientUserId: requesterId,
        actorUserId: authData.user.id,
        eventId: resolvedEventId,
      });
    }

    return NextResponse.json({ ok: true, event_id: data ?? eventId });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
