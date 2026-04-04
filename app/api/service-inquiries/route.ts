import { NextResponse } from "next/server";
import { hasTeacherBadgeRole } from "@/lib/teacher-info/roles";
import { fetchTeacherInfoProfile } from "@/lib/teacher-info/read-model";
import { countServiceInquiriesThisMonth, SERVICE_INQUIRY_MONTHLY_LIMIT } from "@/lib/service-inquiries/read-model";
import { requireServiceInquiryAuth, jsonError, singleLineTrimmed } from "@/lib/service-inquiries/server";
import { ensureServiceInquiryThread, upsertServiceInquiryContext, emitServiceInquiryEvent } from "@/lib/service-inquiries/thread";
import { isServiceInquiryKind, isServiceInquiryRequesterType, normalizeServiceInquiryRow } from "@/lib/service-inquiries/types";
import { findPendingPairRequestConflict } from "@/lib/requests/pending-pair-conflicts";

export const runtime = "nodejs";

type CreateInquiryPayload = {
  recipientUserId?: unknown;
  inquiryKind?: unknown;
  requesterType?: unknown;
  requesterMessage?: unknown;
  city?: unknown;
  requestedDatesText?: unknown;
};

export async function POST(req: Request) {
  try {
    const auth = await requireServiceInquiryAuth(req);
    if ("error" in auth) return auth.error;

    const body = (await req.json().catch(() => null)) as CreateInquiryPayload | null;
    const recipientUserId = typeof body?.recipientUserId === "string" ? body.recipientUserId.trim() : "";
    const inquiryKind = body?.inquiryKind;
    const requesterType = body?.requesterType;
    if (!recipientUserId) {
      return jsonError("recipientUserId is required.", 400);
    }
    if (!isServiceInquiryKind(inquiryKind)) {
      return jsonError("Invalid inquiry type.", 400);
    }
    if (requesterType !== undefined && requesterType !== null && !isServiceInquiryRequesterType(requesterType)) {
      return jsonError("Invalid requester type.", 400);
    }
    if (recipientUserId === auth.userId) {
      return jsonError("You cannot send a professional inquiry to yourself.", 400);
    }

    const monthlyCount = await countServiceInquiriesThisMonth(auth.serviceClient, auth.userId);
    if (monthlyCount >= SERVICE_INQUIRY_MONTHLY_LIMIT) {
      return jsonError(`You already used all ${SERVICE_INQUIRY_MONTHLY_LIMIT} info requests this month.`, 400);
    }

    const recipientProfileRes = await auth.serviceClient
      .from("profiles" as never)
      .select("user_id,roles")
      .eq("user_id", recipientUserId)
      .maybeSingle();
    if (recipientProfileRes.error || !recipientProfileRes.data) {
      return jsonError("Teacher profile not found.", 404);
    }

    const recipientRoles = Array.isArray((recipientProfileRes.data as { roles?: unknown }).roles)
      ? ((recipientProfileRes.data as { roles?: unknown }).roles as unknown[]).filter((item): item is string => typeof item === "string")
      : [];
    if (!hasTeacherBadgeRole(recipientRoles)) {
      return jsonError("This profile is not accepting professional teacher inquiries.", 400);
    }
    const recipientTeacherProfile = await fetchTeacherInfoProfile(auth.serviceClient, recipientUserId);
    if (recipientTeacherProfile && !recipientTeacherProfile.isEnabled) {
      return jsonError("This profile is not accepting professional teacher inquiries right now.", 400);
    }

    const requesterMessage = singleLineTrimmed(body?.requesterMessage, 220);
    const city = singleLineTrimmed(body?.city, 80);
    const requestedDatesText = singleLineTrimmed(body?.requestedDatesText, 120);
    if (!requesterMessage) {
      return jsonError("Please add a short note so the teacher has context.", 400);
    }

    const pendingConflict = await findPendingPairRequestConflict(auth.serviceClient, {
      actorUserId: auth.userId,
      otherUserId: recipientUserId,
    });
    if (pendingConflict) {
      return jsonError(pendingConflict.message, 409);
    }

    const insertRes = await auth.serviceClient
      .from("service_inquiries" as never)
      .insert({
        requester_id: auth.userId,
        recipient_id: recipientUserId,
        inquiry_kind: inquiryKind,
        requester_type: isServiceInquiryRequesterType(requesterType) ? requesterType : null,
        requester_message: requesterMessage,
        city,
        requested_dates_text: requestedDatesText,
        status: "pending",
      } as never)
      .select("id,requester_id,recipient_id,inquiry_kind,requester_type,requester_message,city,requested_dates_text,status,accepted_at,declined_at,created_at,updated_at")
      .single();

    if (insertRes.error) throw insertRes.error;

    const inquiry = normalizeServiceInquiryRow(insertRes.data);
    if (!inquiry) {
      throw new Error("Could not normalize the created inquiry.");
    }

    const threadId = await ensureServiceInquiryThread({
      serviceClient: auth.serviceClient,
      inquiry,
      actorUserId: auth.userId,
    });

    await upsertServiceInquiryContext({
      serviceClient: auth.serviceClient,
      threadId,
      inquiry,
      statusTag: "pending",
      extraMetadata: {
        requester_followup_used: false,
      },
    });

    // Emit the student's note as the first message so it appears in the inbox preview.
    await emitServiceInquiryEvent({
      serviceClient: auth.serviceClient,
      threadId,
      senderId: auth.userId,
      body: inquiry.requesterMessage ?? "Teaching services request sent.",
      messageType: "request",
      statusTag: "pending",
      metadata: {
        service_inquiry_id: inquiry.id,
        inquiry_kind: inquiry.inquiryKind,
      },
    });

    return NextResponse.json({
      ok: true,
      inquiryId: inquiry.id,
      threadId,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not create the inquiry." },
      { status: 500 }
    );
  }
}
