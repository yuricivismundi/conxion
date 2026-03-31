import { NextResponse } from "next/server";
import { requireServiceInquiryAuth, jsonError, singleLineTrimmed } from "@/lib/service-inquiries/server";

export const runtime = "nodejs";

type FollowupPayload = {
  body?: unknown;
};

type RouteParams = {
  params: Promise<{ inquiryId: string }>;
};

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const auth = await requireServiceInquiryAuth(req);
    if ("error" in auth) return auth.error;

    const { inquiryId } = await params;
    if (!inquiryId?.trim()) {
      return jsonError("Inquiry id is required.", 400);
    }

    const body = (await req.json().catch(() => null)) as FollowupPayload | null;
    const followupBody = singleLineTrimmed(body?.body, 220);
    if (!followupBody) {
      return jsonError("Follow-up message is required.", 400);
    }

    const rpc = await auth.userClient.rpc("cx_send_service_inquiry_followup", {
      p_inquiry_id: inquiryId,
      p_body: followupBody,
    });
    if (rpc.error) {
      return jsonError(rpc.error.message || "Could not send the follow-up.", 400);
    }

    return NextResponse.json({ ok: true, ...(typeof rpc.data === "object" && rpc.data ? (rpc.data as object) : {}) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not send the follow-up." },
      { status: 500 }
    );
  }
}
