import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { validateCsrfOrigin, csrfError } from "@/lib/security/csrf";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!validateCsrfOrigin(req)) return csrfError();
  try {
    const { id: invitationId } = await context.params;
    if (!invitationId) return NextResponse.json({ ok: false, error: "Missing invitation id." }, { status: 400 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const action = body?.action;
    if (action !== "accept" && action !== "decline") {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }

    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = getSupabaseServiceClient() as any;

    const { data: inv, error: fetchErr } = await service
      .from("event_invitations")
      .select("id,event_id,recipient_user_id,status")
      .eq("id", invitationId)
      .maybeSingle();

    if (fetchErr || !inv) return NextResponse.json({ ok: false, error: "Invitation not found." }, { status: 404 });
    if (inv.recipient_user_id !== authData.user.id) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });

    // Mark invitation status
    await service
      .from("event_invitations")
      .update({ status: action === "accept" ? "accepted" : "declined", updated_at: new Date().toISOString() })
      .eq("id", invitationId);

    if (action === "accept") {
      // Join the event
      const { error: joinErr } = await supabase.rpc("join_event_guarded", { p_event_id: inv.event_id });
      if (joinErr && !joinErr.message?.includes("already_joined")) {
        return NextResponse.json({ ok: false, error: joinErr.message }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true, event_id: inv.event_id });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}
