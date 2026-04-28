import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

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

    const body = (await req.json().catch(() => null)) as { note?: string } | null;
    const note = typeof body?.note === "string" ? body.note.trim() : "";

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }
    const userId = authData.user.id;

    const service = getSupabaseServiceClient();
    const reqRes = await service
      .from("hosting_requests")
      .select("id,sender_user_id,recipient_user_id,status,arrival_date")
      .eq("id", requestId)
      .maybeSingle();

    const row = reqRes.data as {
      id?: string;
      sender_user_id?: string;
      recipient_user_id?: string;
      status?: string;
      arrival_date?: string | null;
    } | null;

    if (!row?.id) {
      return NextResponse.json({ ok: false, error: "Hosting request not found." }, { status: 404 });
    }

    const isParty = row.sender_user_id === userId || row.recipient_user_id === userId;
    if (!isParty) {
      return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }

    const status = row.status ?? "";

    if (status === "pending") {
      // Pending cancellation — no note required, use existing RPC
      const { error } = await supabase.rpc("cancel_hosting_request", { p_request_id: requestId });
      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (status === "accepted") {
      // Accepted cancellation — note is mandatory
      if (!note) {
        return NextResponse.json(
          { ok: false, error: "A cancellation note is required." },
          { status: 400 }
        );
      }

      // Only allowed before arrival date (start date)
      if (row.arrival_date) {
        const arrivalMs = new Date(`${row.arrival_date}T00:00:00.000Z`).getTime();
        if (Date.now() >= arrivalMs) {
          return NextResponse.json(
            { ok: false, error: "This hosting stay has already started and can no longer be cancelled." },
            { status: 409 }
          );
        }
      }

      const updateRes = await service
        .from("hosting_requests")
        .update({ status: "cancelled", cancellation_note: note, decided_at: new Date().toISOString() } as never)
        .eq("id", requestId)
        .eq("status", "accepted")
        .select("id")
        .maybeSingle();

      if (updateRes.error) {
        return NextResponse.json({ ok: false, error: updateRes.error.message }, { status: 400 });
      }
      if (!(updateRes.data as { id?: string } | null)?.id) {
        return NextResponse.json({ ok: false, error: "Request could not be cancelled." }, { status: 409 });
      }

      // Store the cancellation note in thread context metadata + as a thread message (best effort)
      try {
        const threadRes = await service
          .from("thread_contexts")
          .select("thread_id,metadata")
          .eq("source_id", requestId)
          .maybeSingle();
        const threadCtx = threadRes.data as { thread_id?: string; metadata?: Record<string, unknown> } | null;
        const threadId = threadCtx?.thread_id ?? null;
        if (threadId) {
          // Persist note in context metadata so thread log shows it
          const existingMeta = threadCtx?.metadata ?? {};
          await service
            .from("thread_contexts")
            .update({ metadata: { ...existingMeta, cancellation_note: note }, status_tag: "cancelled" } as never)
            .eq("source_id", requestId);

          await service.from("thread_messages").insert({
            thread_id: threadId,
            sender_id: userId,
            message_type: "text",
            body: `Cancellation note: ${note}`,
          } as never);
        }
      } catch {
        // non-fatal
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { ok: false, error: "Only pending or accepted requests can be cancelled." },
      { status: 409 }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
