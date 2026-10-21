import { NextResponse } from "next/server";
import { escapeHtml } from "@/lib/email/branding";
import { sendResendEmail } from "@/lib/email/resend";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

export const runtime = "nodejs";

const KINDS = new Set(["bug", "idea", "other"]);
const MAX_PER_DAY = 15;

/**
 * POST /api/feedback — beta feedback from the in-app button.
 * Body: { kind: "bug" | "idea" | "other", message: string, pageUrl?: string }
 * Saves to beta_feedback and emails BETA_FEEDBACK_EMAIL (best effort).
 */
export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Please log in to send feedback." }, { status: 401 });

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Please log in to send feedback." }, { status: 401 });
    }
    const user = authData.user;

    const body = (await req.json().catch(() => null)) as { kind?: string; message?: string; pageUrl?: string } | null;
    const kind = KINDS.has(body?.kind ?? "") ? (body?.kind as string) : "other";
    const message = (body?.message ?? "").trim().slice(0, 2000);
    if (message.length < 3) {
      return NextResponse.json({ ok: false, error: "Tell us a bit more (at least a few words)." }, { status: 400 });
    }
    const pageUrl = (body?.pageUrl ?? "").slice(0, 500) || null;
    const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 300) || null;

    const service = getSupabaseServiceClient();
    // beta_feedback isn't in the generated DB types yet (scripts/sql/2026-10-21_beta_feedback.sql).
    const table = service.from("beta_feedback" as never) as unknown as {
      select: (cols: string, opts: { count: "exact"; head: true }) => {
        eq: (c: string, v: string) => { gte: (c: string, v: string) => Promise<{ count: number | null; error: { message?: string } | null }> };
      };
      insert: (values: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
    };

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = await table.select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", dayAgo);
    if (recent.error) {
      return NextResponse.json({ ok: false, error: "Feedback is being set up. Please use the WhatsApp group for now." }, { status: 503 });
    }
    if (Number(recent.count ?? 0) >= MAX_PER_DAY) {
      return NextResponse.json({ ok: false, error: "Thanks! You've sent a lot today. Please continue tomorrow or in the WhatsApp group." }, { status: 429 });
    }

    const insert = await table.insert({ user_id: user.id, kind, message, page_url: pageUrl, user_agent: userAgent });
    if (insert.error) {
      return NextResponse.json({ ok: false, error: "Couldn't save your feedback. Try again." }, { status: 500 });
    }

    const notifyTo = process.env.BETA_FEEDBACK_EMAIL?.trim();
    if (notifyTo) {
      const profile = await service.from("profiles").select("display_name,username").eq("user_id", user.id).maybeSingle();
      const who = String((profile.data as { display_name?: string | null } | null)?.display_name ?? user.email ?? user.id);
      const subject = `[Beta ${kind}] ${message.slice(0, 60)}`;
      const lines = [`From: ${who} (${user.email ?? "no email"})`, `Page: ${pageUrl ?? "-"}`, `Kind: ${kind}`, "", message];
      await sendResendEmail({
        to: notifyTo,
        subject,
        text: lines.join("\n"),
        html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(lines.join("\n"))}</pre>`,
      }).catch(() => null);
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}
