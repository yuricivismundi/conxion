import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendAdminThreadNotice } from "@/lib/admin/communication";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

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

function buildReportNotice(params: {
  action: ModerateAction;
  subject: string;
  ticketCode: string;
  note: string;
}) {
  const subjectLabel = params.subject || "your report";
  const ticketLabel = params.ticketCode ? ` (${params.ticketCode})` : "";
  const noteSuffix = params.note ? `\n\nAdmin note: ${params.note}` : "";

  if (params.action === "resolve") {
    return {
      title: "Report resolved",
      notificationBody: `Admin resolved ${subjectLabel}${ticketLabel}.`,
      message: `Your report for "${subjectLabel}"${ticketLabel} was resolved by admin.${noteSuffix}`,
    };
  }

  if (params.action === "dismiss") {
    return {
      title: "Report reviewed",
      notificationBody: `Admin reviewed ${subjectLabel}${ticketLabel} and dismissed it.`,
      message: `Your report for "${subjectLabel}"${ticketLabel} was reviewed by admin and dismissed.${noteSuffix}`,
    };
  }

  return {
    title: "Report reopened",
    notificationBody: `Admin reopened ${subjectLabel}${ticketLabel}.`,
    message: `Your report for "${subjectLabel}"${ticketLabel} was reopened by admin.${noteSuffix}`,
  };
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

    const service = getSupabaseServiceClient();
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
      service.from("reports").select("id,status,reporter_id,reason").eq("id", reportId).maybeSingle(),
      service
        .from("reference_report_claims")
        .select("id,reporter_id,reporter_email,subject,ticket_code")
        .eq("report_id", reportId)
        .maybeSingle(),
    ]);

    const normalizedReport = (reportRow ?? null) as
      | {
          id?: string;
          status?: string | null;
          reporter_id?: string | null;
          reason?: string | null;
        }
      | null;
    const normalizedClaim = (claimRow ?? null) as
      | {
          id?: string;
          reporter_id?: string | null;
          reporter_email?: string | null;
          subject?: string | null;
          ticket_code?: string | null;
        }
      | null;

    let threadToken: string | null = null;
    let notificationWarning: string | null = null;
    const reporterId = normalizedClaim?.reporter_id ?? normalizedReport?.reporter_id ?? null;
    if (reporterId && reporterId !== authData.user.id) {
      const noticeContent = buildReportNotice({
        action,
        subject: normalizedClaim?.subject ?? normalizedReport?.reason ?? "your report",
        ticketCode: normalizedClaim?.ticket_code ?? "",
        note: note?.trim() ?? "",
      });
      try {
        const notice = await sendAdminThreadNotice({
          serviceClient: service,
          actorId: authData.user.id,
          recipientUserId: reporterId,
          title: noticeContent.title,
          message: noticeContent.message,
          notificationBody: noticeContent.notificationBody,
          metadata: {
            source: "report_moderation",
            report_id: reportId,
            moderation_action: action,
            ticket_code: normalizedClaim?.ticket_code ?? null,
          },
        });
        threadToken = notice.threadToken;
        notificationWarning = notice.notificationError;
      } catch (noticeError: unknown) {
        notificationWarning = noticeError instanceof Error ? noticeError.message : "Could not deliver the reporter update.";
      }
    }

    if (normalizedClaim?.reporter_id) {
      await sendAppEmailBestEffort({
        kind: "support_case_updated",
        recipientUserId: normalizedClaim.reporter_id,
        recipientEmailOverride:
          typeof normalizedClaim.reporter_email === "string" && normalizedClaim.reporter_email.trim().length > 0
            ? normalizedClaim.reporter_email
            : undefined,
        actorUserId: authData.user.id,
        ticketCode: typeof normalizedClaim.ticket_code === "string" ? normalizedClaim.ticket_code : null,
        supportClaimId: typeof normalizedClaim.id === "string" ? normalizedClaim.id : null,
        supportSubject: typeof normalizedClaim.subject === "string" ? normalizedClaim.subject : "Reference report",
        supportStatus: typeof normalizedReport?.status === "string" ? normalizedReport.status : action,
        idempotencySeed: `support-case-update:${reportId}:${typeof normalizedReport?.status === "string" ? normalizedReport.status : action}`,
      });
    }

    return NextResponse.json({
      ok: true,
      moderation_log_id: data ?? null,
      threadToken,
      notificationWarning,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
