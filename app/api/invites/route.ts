import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isResendConfigured, sendResendEmail } from "@/lib/email/resend";
import {
  INVITES_PER_DAY,
  INVITES_PER_REQUEST,
  INVITE_NOTE_MAX_CHARS,
  INVITE_SAME_ADDRESS_COOLDOWN_DAYS,
  buildInviteEmail,
  isValidInviteEmail,
  normalizeInviteEmail,
  parseInviteEmails,
} from "@/lib/invites/email";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

export const runtime = "nodejs";

type SkipReason = "invalid" | "self" | "recently_invited" | "daily_limit" | "send_failed";

function hashEmail(email: string) {
  return createHash("sha256").update(email).digest("hex");
}

/**
 * POST /api/invites — email up to 5 friends an invite to ConXion.
 * Body: { emails: string | string[], note?: string }
 * Limits: signed-in only, 20 per member per 24h, same address once per 30 days.
 */
export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Please log in to invite friends." }, { status: 401 });

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Please log in to invite friends." }, { status: 401 });
    }
    const user = authData.user;

    if (!isResendConfigured()) {
      return NextResponse.json({ ok: false, error: "Email invites are not available right now. Share your link instead." }, { status: 503 });
    }

    const body = (await req.json().catch(() => null)) as { emails?: string | string[]; note?: string } | null;
    const emails = parseInviteEmails(body?.emails ?? []);
    if (emails.length === 0) {
      return NextResponse.json({ ok: false, error: "Add at least one email address." }, { status: 400 });
    }
    if (emails.length > INVITES_PER_REQUEST) {
      return NextResponse.json({ ok: false, error: `You can invite up to ${INVITES_PER_REQUEST} people at a time.` }, { status: 400 });
    }
    const note = (body?.note ?? "").replace(/\s+/g, " ").trim().slice(0, INVITE_NOTE_MAX_CHARS) || null;

    const service = getSupabaseServiceClient();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cooldownStart = new Date(Date.now() - INVITE_SAME_ADDRESS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [profileRes, sentTodayRes] = await Promise.all([
      service.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle(),
      service
        .from("member_invites")
        .select("id", { count: "exact", head: true })
        .eq("inviter_user_id", user.id)
        .eq("status", "sent")
        .gte("created_at", dayAgo),
    ]);
    if (sentTodayRes.error) {
      return NextResponse.json({ ok: false, error: "Email invites are being set up. Share your link instead." }, { status: 503 });
    }

    let remainingToday = Math.max(INVITES_PER_DAY - Number(sentTodayRes.count ?? 0), 0);
    const inviterName = String((profileRes.data as { display_name?: string | null } | null)?.display_name ?? "").trim();
    const ownEmail = normalizeInviteEmail(user.email ?? "");
    const message = buildInviteEmail({ inviterName, note });

    const sent: string[] = [];
    const skipped: Array<{ email: string; reason: SkipReason }> = [];

    for (const email of emails) {
      if (!isValidInviteEmail(email)) { skipped.push({ email, reason: "invalid" }); continue; }
      if (email === ownEmail) { skipped.push({ email, reason: "self" }); continue; }
      if (remainingToday <= 0) { skipped.push({ email, reason: "daily_limit" }); continue; }

      const emailHash = hashEmail(email);
      const recentRes = await service
        .from("member_invites")
        .select("id", { count: "exact", head: true })
        .eq("invitee_email_hash", emailHash)
        .eq("status", "sent")
        .gte("created_at", cooldownStart);
      if (Number(recentRes.count ?? 0) > 0) { skipped.push({ email, reason: "recently_invited" }); continue; }

      const result = await sendResendEmail({
        to: email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        idempotencyKey: `invite-${user.id}-${emailHash}-${new Date().toISOString().slice(0, 10)}`,
      });

      // member_invites isn't in the generated DB types yet (see scripts/sql/2026-10-21_member_invites.sql).
      const invitesTable = service.from("member_invites" as never) as unknown as {
        insert: (values: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
      };
      await invitesTable.insert({
        inviter_user_id: user.id,
        invitee_email_hash: emailHash,
        status: result.ok ? "sent" : "failed",
      });

      if (result.ok) {
        sent.push(email);
        remainingToday -= 1;
      } else {
        skipped.push({ email, reason: "send_failed" });
      }
    }

    return NextResponse.json({ ok: true, sent, skipped, remainingToday });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}
