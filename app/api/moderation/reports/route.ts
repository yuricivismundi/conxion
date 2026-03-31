import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";

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

type ModerateAction = "resolve" | "dismiss" | "reopen";

function isModerateAction(value: unknown): value is ModerateAction {
  return value === "resolve" || value === "dismiss" || value === "reopen";
}

function mapModerateReportErrorStatus(message: string) {
  if (message.includes("not_authenticated")) return 401;
  if (message.includes("not_authorized")) return 403;
  if (message.includes("report_not_found")) return 404;
  if (message.includes("invalid_action")) return 400;
  return 500;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const reportId = typeof body?.reportId === "string" ? body.reportId : "";
    const action = body?.action;
    const note = typeof body?.note === "string" ? body.note : null;

    if (!reportId || !isModerateAction(action)) {
      return NextResponse.json({ ok: false, error: "reportId and valid action are required." }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const { data, error } = await supabase.rpc("moderate_report", {
      p_report_id: reportId,
      p_action: action,
      p_note: note,
    });
    if (error) {
      const message = error.message ?? "Failed to moderate report.";
      return NextResponse.json({ ok: false, error: message }, { status: mapModerateReportErrorStatus(message) });
    }

    const [{ data: reportRow }, { data: claimRow }] = await Promise.all([
      supabase.from("reports").select("id,status").eq("id", reportId).maybeSingle(),
      supabase
        .from("reference_report_claims")
        .select("id,reporter_id,reporter_email,subject,ticket_code")
        .eq("report_id", reportId)
        .maybeSingle(),
    ]);

    if (claimRow?.reporter_id) {
      await sendAppEmailBestEffort({
        kind: "support_case_updated",
        recipientUserId: claimRow.reporter_id,
        recipientEmailOverride:
          typeof claimRow.reporter_email === "string" && claimRow.reporter_email.trim().length > 0
            ? claimRow.reporter_email
            : undefined,
        actorUserId: authData.user.id,
        ticketCode: typeof claimRow.ticket_code === "string" ? claimRow.ticket_code : null,
        supportClaimId: typeof claimRow.id === "string" ? claimRow.id : null,
        supportSubject: typeof claimRow.subject === "string" ? claimRow.subject : "Reference report",
        supportStatus: typeof reportRow?.status === "string" ? reportRow.status : action,
        idempotencySeed: `support-case-update:${reportId}:${typeof reportRow?.status === "string" ? reportRow.status : action}`,
      });
    }

    return NextResponse.json({ ok: true, moderation_log_id: data ?? null });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
