import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

type RespondPayload = {
  action?: "accepted" | "declined";
};

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

    const body = (await req.json().catch(() => null)) as RespondPayload | null;
    const action = body?.action;
    if (action !== "accepted" && action !== "declined") {
      return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }

    const supabase = getSupabaseUserClient(token);
    const service = getSupabaseServiceClient();
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const requestRes = await service
      .from("hosting_requests")
      .select("id,sender_user_id,trip_id")
      .eq("id", requestId)
      .maybeSingle();
    if (requestRes.error) {
      return NextResponse.json({ ok: false, error: requestRes.error.message }, { status: 500 });
    }
    const requestRow = (requestRes.data ?? null) as { sender_user_id?: string; trip_id?: string | null } | null;

    const { data, error } = await supabase.rpc("respond_hosting_request", {
      p_request_id: requestId,
      p_action: action,
    });

    if (error) {
      const message = error.message ?? "Failed to respond to hosting request.";
      const status =
        message.includes("not_authenticated") ? 401 :
        message.includes("not_found") ? 404 :
        message.includes("not_pending") ? 409 : 400;
      return NextResponse.json({ ok: false, error: message }, { status });
    }

    const senderUserId = typeof requestRow?.sender_user_id === "string" ? requestRow.sender_user_id : "";
    const tripId = typeof requestRow?.trip_id === "string" ? requestRow.trip_id : null;
    if (senderUserId) {
      await sendAppEmailBestEffort({
        kind: action === "accepted" ? "hosting_request_accepted" : "hosting_request_declined",
        recipientUserId: senderUserId,
        actorUserId: authData.user.id,
        hostingRequestId: requestId,
        tripId,
      });
    }

    return NextResponse.json({ ok: true, id: data ?? null });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
