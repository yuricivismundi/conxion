import { NextResponse } from "next/server";
import { requireServiceInquiryAuth, jsonError } from "@/lib/service-inquiries/server";
import { emitServiceInquiryEvent, ensureServiceInquiryThread, upsertServiceInquiryContext } from "@/lib/service-inquiries/thread";
import { fetchServiceInquiryById, fetchServiceInquiryThreadByInquiryId } from "@/lib/service-inquiries/read-model";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ inquiryId: string }>;
};

function currentActivationWindow() {
  const now = new Date();
  const activationEnd = new Date(now);
  activationEnd.setMonth(activationEnd.getMonth() + 1);
  return {
    nowIso: now.toISOString(),
    activationStartIso: now.toISOString(),
    activationEndIso: activationEnd.toISOString(),
  };
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
      return jsonError("You do not have permission to convert this inquiry.", 403);
    }
    if (inquiry.status !== "accepted") {
      return jsonError("Only accepted inquiries can become a normal chat.", 400);
    }

    const threadMapping = await fetchServiceInquiryThreadByInquiryId(auth.serviceClient, inquiry.id);
    const threadId =
      threadMapping?.threadId ??
      (await ensureServiceInquiryThread({
        serviceClient: auth.serviceClient,
        inquiry,
        actorUserId: auth.userId,
      }));

    if (!threadMapping?.requesterFollowupUsed) {
      return jsonError("A follow-up message is required before converting this inquiry to chat.", 400);
    }

    const { nowIso, activationStartIso, activationEndIso } = currentActivationWindow();

    const participantUpsert = await auth.serviceClient
      .from("thread_participants" as never)
      .upsert(
        {
          thread_id: threadId,
          user_id: auth.userId,
          role: "member",
          messaging_state: "active",
          archived_at: null,
          activated_at: nowIso,
          activation_cycle_start: activationStartIso,
          activation_cycle_end: activationEndIso,
          state_changed_at: nowIso,
          last_read_at: nowIso,
        } as never,
        { onConflict: "thread_id,user_id" }
      );
    if (participantUpsert.error) throw participantUpsert.error;

    await upsertServiceInquiryContext({
      serviceClient: auth.serviceClient,
      threadId,
      inquiry: { ...inquiry, updatedAt: nowIso },
      statusTag: "active",
      extraMetadata: {
        conversation_accepted_at: nowIso,
        requester_followup_used: true,
      },
    });

    await emitServiceInquiryEvent({
      serviceClient: auth.serviceClient,
      threadId,
      senderId: auth.userId,
      body: "Conversation activated.",
      messageType: "system",
      statusTag: "active",
      metadata: {
        service_inquiry_id: inquiry.id,
        inquiry_kind: inquiry.inquiryKind,
      },
    });

    return NextResponse.json({ ok: true, threadId });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not activate the conversation." },
      { status: 500 }
    );
  }
}
