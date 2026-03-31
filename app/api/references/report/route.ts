import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";
import { REFERENCE_REPORT_REASON_OPTIONS } from "@/lib/references/reporting";
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

function pickString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function pickNullableString(row: Record<string, unknown>, keys: string[]) {
  const value = pickString(row, keys);
  return value || null;
}

function isAllowedReason(value: string): value is (typeof REFERENCE_REPORT_REASON_OPTIONS)[number] {
  return REFERENCE_REPORT_REASON_OPTIONS.includes(value as (typeof REFERENCE_REPORT_REASON_OPTIONS)[number]);
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const referenceId = typeof body?.referenceId === "string" ? body.referenceId.trim() : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    const reporterEmail = typeof body?.reporterEmail === "string" ? body.reporterEmail.trim() : "";
    const profileLink = typeof body?.profileLink === "string" ? body.profileLink.trim() : "";
    const evidenceLinks = Array.isArray(body?.evidenceLinks)
      ? body.evidenceLinks.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
      : [];

    if (!referenceId || !reason || !subject || !description) {
      return NextResponse.json(
        { ok: false, error: "referenceId, reason, subject, and description are required." },
        { status: 400 }
      );
    }

    if (!isAllowedReason(reason)) {
      return NextResponse.json({ ok: false, error: "Invalid report reason." }, { status: 400 });
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

    const me = authData.user.id;

    const { data: existingClaimRaw } = await service
      .from("reference_report_claims")
      .select("id")
      .eq("reporter_id", me)
      .eq("reference_id", referenceId)
      .maybeSingle();
    const existingClaim = (existingClaimRaw ?? null) as { id?: string } | null;

    if (existingClaim?.id) {
      return NextResponse.json(
        { ok: false, error: "You already submitted a report for this reference." },
        { status: 409 }
      );
    }

    const { data: referenceRaw, error: referenceErr } = await service
      .from("references")
      .select("*")
      .eq("id", referenceId)
      .maybeSingle();

    if (referenceErr) {
      return NextResponse.json({ ok: false, error: referenceErr.message }, { status: 400 });
    }

    const row = (referenceRaw ?? {}) as Record<string, unknown>;
    const authorId = pickString(row, ["author_id", "from_user_id", "source_id"]);
    const recipientId = pickString(row, ["recipient_id", "to_user_id", "target_id"]);
    const contextTag = pickNullableString(row, ["context_tag", "context", "entity_type"]);
    const referenceExcerpt =
      pickNullableString(row, ["body", "content", "feedback", "comment", "reference_text"])?.slice(0, 400) ?? null;

    if (!authorId || !recipientId) {
      return NextResponse.json({ ok: false, error: "Reference not found." }, { status: 404 });
    }

    const { data: adminRowRaw } = await service.from("admins").select("user_id").eq("user_id", me).maybeSingle();
    const adminRow = (adminRowRaw ?? null) as { user_id?: string } | null;
    const isAdmin = Boolean(adminRow?.user_id);
    if (!isAdmin && me !== authorId && me !== recipientId) {
      return NextResponse.json(
        { ok: false, error: "You can only report references in your own relationship history." },
        { status: 403 }
      );
    }

    const targetUserId = authorId === me ? recipientId : authorId;

    const reportInsert = {
      reporter_id: me,
      reported_user_id: targetUserId,
      target_user_id: targetUserId,
      context: "reference",
      context_id: looksLikeUuid(referenceId) ? referenceId : null,
      reason,
      note: description,
      status: "open",
    };

    const { data: reportRowRaw, error: reportErr } = await service
      .from("reports" as never)
      .insert(reportInsert as never)
      .select("id")
      .maybeSingle();

    if (reportErr) {
      return NextResponse.json({ ok: false, error: reportErr.message }, { status: 400 });
    }
    const reportRow = (reportRowRaw ?? null) as { id?: string } | null;
    const reportId = typeof reportRow?.id === "string" ? reportRow.id : null;

    const insertPayload = {
      report_id: reportId,
      reference_id: referenceId,
      reporter_id: me,
      target_user_id: targetUserId,
      reference_author_id: authorId,
      reference_recipient_id: recipientId,
      context_tag: contextTag,
      reference_excerpt: referenceExcerpt,
      reason,
      subject,
      description,
      reporter_email: reporterEmail || null,
      profile_link: profileLink || null,
      evidence_links: evidenceLinks,
      updated_at: new Date().toISOString(),
    };

    const { data: claimRowRaw, error: claimErr } = await service
      .from("reference_report_claims" as never)
      .insert(insertPayload as never)
      .select("id,ticket_code")
      .maybeSingle();

    if (claimErr) {
      if (claimErr.code === "23505") {
        return NextResponse.json(
          { ok: false, error: "You already submitted a report for this reference." },
          { status: 409 }
        );
      }
      return NextResponse.json({ ok: false, error: claimErr.message }, { status: 400 });
    }

    const claimRow = (claimRowRaw ?? null) as { id?: string; ticket_code?: string } | null;
    const ticketCode = typeof claimRow?.ticket_code === "string" ? claimRow.ticket_code : null;

    await sendAppEmailBestEffort({
      kind: "support_case_received",
      recipientUserId: me,
      recipientEmailOverride: reporterEmail || undefined,
      referenceId,
      ticketCode,
      supportClaimId: typeof claimRow?.id === "string" ? claimRow.id : null,
      supportSubject: subject,
      supportStatus: "open",
      idempotencySeed: `reference-report:${reportId ?? "na"}:${ticketCode ?? "na"}`,
    });

    return NextResponse.json({
      ok: true,
      reportId,
      claimId: typeof claimRow?.id === "string" ? claimRow.id : null,
      ticketCode,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
