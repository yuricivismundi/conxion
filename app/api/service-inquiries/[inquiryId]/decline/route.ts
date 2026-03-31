import { NextResponse } from "next/server";
import { requireServiceInquiryAuth, jsonError } from "@/lib/service-inquiries/server";
import { emitServiceInquiryEvent, ensureServiceInquiryThread, upsertServiceInquiryContext } from "@/lib/service-inquiries/thread";
import { fetchServiceInquiryById, fetchServiceInquiryThreadByInquiryId } from "@/lib/service-inquiries/read-model";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ inquiryId: string }>;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Could not decline the inquiry.";
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const auth = await requireServiceInquiryAuth(req);
    if ("error" in auth) return auth.error;

    const { inquiryId } = await params;
    if (!inquiryId?.trim()) {
      return jsonError("Inquiry id is required.", 400);
    }

    const inquiry = await fetchServiceInquiryById(auth.serviceClient, inquiryId);
    if (!inquiry) {
      return jsonError("Inquiry not found.", 404);
    }
    if (inquiry.recipientId !== auth.userId) {
      return jsonError("You do not have permission to decline this inquiry.", 403);
    }
    if (!["pending", "accepted"].includes(inquiry.status)) {
      return jsonError("This inquiry cannot be declined.", 400);
    }

    const threadMapping = await fetchServiceInquiryThreadByInquiryId(auth.serviceClient, inquiry.id);
    const threadId =
      threadMapping?.threadId ??
      (await ensureServiceInquiryThread({
        serviceClient: auth.serviceClient,
        inquiry,
        actorUserId: auth.userId,
      }));
    const nowIso = new Date().toISOString();

    const updateInquiryRes = await auth.serviceClient
      .from("service_inquiries" as never)
      .update({
        status: "declined",
        accepted_at: null,
        declined_at: nowIso,
      } as never)
      .eq("id", inquiry.id);
    if (updateInquiryRes.error) throw updateInquiryRes.error;

    await upsertServiceInquiryContext({
      serviceClient: auth.serviceClient,
      threadId,
      inquiry: { ...inquiry, status: "declined", declinedAt: nowIso, updatedAt: nowIso },
      statusTag: "declined",
      extraMetadata: {
        declined_at: nowIso,
      },
    });

    await emitServiceInquiryEvent({
      serviceClient: auth.serviceClient,
      threadId,
      senderId: auth.userId,
      body: "Service inquiry declined.",
      messageType: "request",
      statusTag: "declined",
      metadata: {
        service_inquiry_id: inquiry.id,
        inquiry_kind: inquiry.inquiryKind,
      },
    });

    return NextResponse.json({ ok: true, threadId });
  } catch (error) {
    return NextResponse.json({ ok: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
