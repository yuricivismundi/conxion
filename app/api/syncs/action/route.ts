import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type SyncAction = "propose" | "accept" | "decline" | "cancel" | "complete";

function isMissingSchemaError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("relation") ||
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("column")
  );
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

function actionLabel(action: Exclude<SyncAction, "propose">) {
  if (action === "accept") return "accepted";
  if (action === "decline") return "declined";
  if (action === "cancel") return "cancelled";
  return "completed";
}

function toSyncType(value: unknown): "training" | "social_dancing" | "workshop" {
  if (value === "social_dancing" || value === "workshop") return value;
  return "training";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const actionRaw = typeof body?.action === "string" ? body.action : "";
    if (!["propose", "accept", "decline", "cancel", "complete"].includes(actionRaw)) {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }
    const action = actionRaw as SyncAction;

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

    if (action === "propose") {
      const connectionId = typeof body?.connectionId === "string" ? body.connectionId : "";
      const syncType = toSyncType(body?.syncType);
      const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;
      const scheduledAt = typeof body?.scheduledAt === "string" && body.scheduledAt.trim() ? body.scheduledAt : null;

      if (!connectionId) {
        return NextResponse.json({ ok: false, error: "Missing connectionId." }, { status: 400 });
      }

      const connRes = await service
        .from("connections")
        .select("id,status,requester_id,target_id")
        .eq("id", connectionId)
        .maybeSingle();

      if (connRes.error) {
        return NextResponse.json({ ok: false, error: connRes.error.message }, { status: 400 });
      }

      const conn = connRes.data as
        | {
            id?: string;
            status?: string;
            requester_id?: string;
            target_id?: string;
          }
        | null;

      if (!conn?.id || !conn.requester_id || !conn.target_id) {
        return NextResponse.json({ ok: false, error: "Connection not found." }, { status: 404 });
      }

      if (conn.status !== "accepted") {
        return NextResponse.json({ ok: false, error: "Connection not accepted." }, { status: 400 });
      }

      if (conn.requester_id !== meId && conn.target_id !== meId) {
        return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
      }

      const recipientId = conn.requester_id === meId ? conn.target_id : conn.requester_id;

      const insertRes = await service
        .from("connection_syncs")
        .insert({
          connection_id: connectionId,
          requester_id: meId,
          recipient_id: recipientId,
          sync_type: syncType,
          scheduled_at: scheduledAt,
          note,
          status: "pending",
        })
        .select("id,status")
        .single();

      if (insertRes.error) {
        return NextResponse.json({ ok: false, error: insertRes.error.message }, { status: 400 });
      }

      return NextResponse.json({ ok: true, syncId: insertRes.data.id, status: insertRes.data.status });
    }

    const syncId = typeof body?.syncId === "string" ? body.syncId : "";
    const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;

    if (!syncId) {
      return NextResponse.json({ ok: false, error: "Missing syncId." }, { status: 400 });
    }

    const syncRes = await service
      .from("connection_syncs")
      .select("id,connection_id,requester_id,recipient_id,status")
      .eq("id", syncId)
      .maybeSingle();

    if (syncRes.error) {
      if (isMissingSchemaError(syncRes.error.message)) {
        return NextResponse.json({ ok: false, error: "connection_syncs not available in schema." }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: syncRes.error.message }, { status: 400 });
    }

    const sync = syncRes.data as
      | {
          id?: string;
          connection_id?: string;
          requester_id?: string;
          recipient_id?: string;
          status?: string;
        }
      | null;

    if (!sync?.id || !sync.connection_id || !sync.requester_id || !sync.recipient_id) {
      return NextResponse.json({ ok: false, error: "Sync not found." }, { status: 404 });
    }

    const isRequester = sync.requester_id === meId;
    const isRecipient = sync.recipient_id === meId;
    if (!isRequester && !isRecipient) {
      return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }

    if ((action === "accept" || action === "decline") && !isRecipient) {
      return NextResponse.json({ ok: false, error: "Only recipient can respond." }, { status: 403 });
    }

    if ((action === "accept" || action === "decline" || action === "cancel") && sync.status !== "pending") {
      return NextResponse.json({ ok: false, error: "Sync is not pending." }, { status: 400 });
    }

    if (action === "complete" && sync.status !== "accepted") {
      return NextResponse.json({ ok: false, error: "Sync is not accepted." }, { status: 400 });
    }

    const payload: Record<string, unknown> = {};
    if (action === "accept") payload.status = "accepted";
    if (action === "decline") payload.status = "declined";
    if (action === "cancel") payload.status = "cancelled";
    if (action === "complete") {
      payload.status = "completed";
      payload.completed_at = new Date().toISOString();
      if (note) payload.note = note;
    }

    const updateRes = await service.from("connection_syncs").update(payload).eq("id", sync.id).select("id,status").single();
    if (updateRes.error) {
      return NextResponse.json({ ok: false, error: updateRes.error.message }, { status: 400 });
    }

    if (action === "complete") {
      const legacyInsert = await service.from("syncs").insert({
        connection_id: sync.connection_id,
        completed_by: meId,
        note: note ?? null,
      });
      if (legacyInsert.error && !isMissingSchemaError(legacyInsert.error.message)) {
        const message = legacyInsert.error.message.toLowerCase();
        if (!message.includes("duplicate")) {
          return NextResponse.json({ ok: false, error: legacyInsert.error.message }, { status: 400 });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      syncId: updateRes.data.id,
      status: updateRes.data.status,
      action: actionLabel(action),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
