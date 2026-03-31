import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

type ActionType = "accept" | "decline" | "undo_decline" | "cancel" | "block" | "unblock" | "report";

type ActionPayload = {
  connId?: string;
  targetUserId?: string;
  action?: ActionType;
  reason?: string;
  note?: string;
  context?: "connection" | "trip" | "message" | "profile" | "reference";
  contextId?: string | null;
};

function getSupabaseUserClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(url, anon, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isActionType(value: unknown): value is ActionType {
  return (
    value === "accept" ||
    value === "decline" ||
    value === "undo_decline" ||
    value === "cancel" ||
    value === "block" ||
    value === "unblock" ||
    value === "report"
  );
}

function mapConnectionActionErrorStatus(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("not_authenticated")) return 401;
  if (
    lower.includes("not_authorized") ||
    lower.includes("not_found_or_not_allowed") ||
    lower.includes("connection_not_found_or_not_allowed") ||
    lower.includes("target_not_found_or_not_allowed")
  ) {
    return 403;
  }
  if (lower.includes("report_reason_required") || lower.includes("missing_target") || lower.includes("invalid_action")) {
    return 400;
  }
  if (lower.includes("not_found")) return 404;
  if (
    lower.includes("cannot_") ||
    lower.includes("pending") ||
    lower.includes("accepted") ||
    lower.includes("declined") ||
    lower.includes("cancelled") ||
    lower.includes("blocked")
  ) {
    return 409;
  }
  return 400;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as ActionPayload | null;
    const connId = body?.connId;
    const action = body?.action;
    const targetUserId = body?.targetUserId;
    const reason = body?.reason?.trim() ?? "";
    const note = body?.note?.trim() ?? "";
    const context = body?.context ?? "connection";
    const contextId = body?.contextId ?? connId ?? null;

    if (!isActionType(action)) {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }
    if (!connId && !((action === "block" || action === "report") && targetUserId)) {
      return NextResponse.json(
        { ok: false, error: "Missing connId (or targetUserId for block/report)." },
        { status: 400 }
      );
    }

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabase = getSupabaseUserClient(token);
    const service = getSupabaseServiceClient();

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    if (action === "accept") {
      const connectionRes = connId
        ? await service.from("connections").select("id,requester_id").eq("id", connId).maybeSingle()
        : null;
      if (connectionRes?.error) {
        return NextResponse.json({ ok: false, error: connectionRes.error.message }, { status: 500 });
      }
      const connectionRow = (connectionRes?.data ?? null) as { requester_id?: string } | null;
      const { error } = await supabase.rpc("accept_connection_request", { p_connection_id: connId });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: mapConnectionActionErrorStatus(error.message) });
      const requesterId = typeof connectionRow?.requester_id === "string" ? connectionRow.requester_id : "";
      if (requesterId) {
        await sendAppEmailBestEffort({
          kind: "connection_request_accepted",
          recipientUserId: requesterId,
          actorUserId: authData.user.id,
          connectionId: connId ?? null,
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "decline") {
      const connectionRes = connId
        ? await service.from("connections").select("id,requester_id").eq("id", connId).maybeSingle()
        : null;
      if (connectionRes?.error) {
        return NextResponse.json({ ok: false, error: connectionRes.error.message }, { status: 500 });
      }
      const connectionRow = (connectionRes?.data ?? null) as { requester_id?: string } | null;
      const { error } = await supabase.rpc("decline_connection_request", { p_connection_id: connId });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: mapConnectionActionErrorStatus(error.message) });
      const requesterId = typeof connectionRow?.requester_id === "string" ? connectionRow.requester_id : "";
      if (requesterId) {
        await sendAppEmailBestEffort({
          kind: "connection_request_declined",
          recipientUserId: requesterId,
          actorUserId: authData.user.id,
          connectionId: connId ?? null,
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "undo_decline") {
      const { error } = await supabase.rpc("undo_decline_connection_request", { p_connection_id: connId });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: mapConnectionActionErrorStatus(error.message) });
      return NextResponse.json({ ok: true });
    }

    if (action === "cancel") {
      const { error } = await supabase.rpc("cancel_connection_request", { p_connection_id: connId });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: mapConnectionActionErrorStatus(error.message) });
      return NextResponse.json({ ok: true });
    }

    if (action === "block") {
      const { data, error } = await supabase.rpc("block_connection", {
        p_connection_id: connId ?? null,
        p_target_user_id: targetUserId ?? null,
      });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: mapConnectionActionErrorStatus(error.message) });
      return NextResponse.json({ ok: true, connection_id: data ?? null });
    }

    if (action === "unblock") {
      const { error } = await supabase.rpc("unblock_connection", { p_connection_id: connId });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: mapConnectionActionErrorStatus(error.message) });
      return NextResponse.json({ ok: true });
    }

    if (!reason) {
      return NextResponse.json({ ok: false, error: "Report reason is required." }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("create_report", {
      p_connection_id: connId ?? null,
      p_target_user_id: targetUserId ?? null,
      p_context: context,
      p_context_id: contextId,
      p_reason: reason,
      p_note: note || null,
    });
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: mapConnectionActionErrorStatus(error.message) });
    }
    return NextResponse.json({ ok: true, report_id: data ?? null });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
