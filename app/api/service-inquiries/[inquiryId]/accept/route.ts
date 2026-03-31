import { NextResponse } from "next/server";
import { fetchTeacherInfoBlocks, fetchTeacherInfoProfile } from "@/lib/teacher-info/read-model";
import { requireServiceInquiryAuth, fetchTeacherProfileSummary, jsonError, singleLineTrimmed } from "@/lib/service-inquiries/server";
import { ensureServiceInquiryThread, upsertServiceInquiryContext } from "@/lib/service-inquiries/thread";
import { fetchServiceInquiryById, fetchServiceInquiryThreadByInquiryId } from "@/lib/service-inquiries/read-model";
import { SERVICE_INQUIRY_KIND_LABELS } from "@/lib/service-inquiries/types";

export const runtime = "nodejs";

type RpcInvoker = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
    options?: { head?: boolean; get?: boolean; count?: "exact" | "planned" | "estimated" }
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

type AcceptPayload = {
  selectedBlockIds?: unknown;
  introNote?: unknown;
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

    const body = (await req.json().catch(() => null)) as AcceptPayload | null;
    const selectedBlockIds = Array.isArray(body?.selectedBlockIds)
      ? body.selectedBlockIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (selectedBlockIds.length < 1) {
      return jsonError("Select at least one info block to share.", 400);
    }

    const inquiry = await fetchServiceInquiryById(auth.serviceClient, inquiryId);
    if (!inquiry) {
      return jsonError("Inquiry not found.", 404);
    }
    if (inquiry.recipientId !== auth.userId) {
      return jsonError("You do not have permission to accept this inquiry.", 403);
    }
    if (inquiry.status !== "pending") {
      return jsonError("Only pending inquiries can be accepted.", 400);
    }

    const [allBlocks, teacherProfileConfig, teacherSummary] = await Promise.all([
      fetchTeacherInfoBlocks(auth.serviceClient, auth.userId, { activeOnly: true }),
      fetchTeacherInfoProfile(auth.serviceClient, auth.userId),
      fetchTeacherProfileSummary(auth.serviceClient, auth.userId),
    ]);
    const selectedBlocks = allBlocks.filter((block) => selectedBlockIds.includes(block.id));
    if (selectedBlocks.length < 1) {
      return jsonError("Selected blocks are not available.", 400);
    }

    const threadMapping = await fetchServiceInquiryThreadByInquiryId(auth.serviceClient, inquiry.id);
    const threadId =
      threadMapping?.threadId ??
      (await ensureServiceInquiryThread({
        serviceClient: auth.serviceClient,
        inquiry,
        actorUserId: auth.userId,
      }));

    const introNote = singleLineTrimmed(body?.introNote, 220);
    const nowIso = new Date().toISOString();

    const updateInquiryRes = await auth.serviceClient
      .from("service_inquiries" as never)
      .update({
        status: "accepted",
        accepted_at: nowIso,
      } as never)
      .eq("id", inquiry.id);
    if (updateInquiryRes.error) throw updateInquiryRes.error;

    const mappingUpdate = await auth.serviceClient
      .from("service_inquiry_threads" as never)
      .update({
        thread_id: threadId,
        shared_block_ids: selectedBlocks.map((block) => block.id),
        teacher_intro_note: introNote,
      } as never)
      .eq("inquiry_id", inquiry.id);
    if (mappingUpdate.error) throw mappingUpdate.error;

    await upsertServiceInquiryContext({
      serviceClient: auth.serviceClient,
      threadId,
      inquiry: { ...inquiry, status: "accepted", acceptedAt: nowIso, updatedAt: nowIso },
      statusTag: "info_shared",
      extraMetadata: {
        requester_followup_used: false,
        accepted_at: nowIso,
      },
    });

    const emitEventRes = await (auth.userClient as unknown as RpcInvoker).rpc("cx_emit_thread_event", {
      p_thread_id: threadId,
      p_sender_id: auth.userId,
      p_body: `${SERVICE_INQUIRY_KIND_LABELS[inquiry.inquiryKind]} details shared.`,
      p_message_type: "system",
      p_context_tag: "service_inquiry",
      p_status_tag: "info_shared",
      p_metadata: {
        card_type: "teacher_inquiry_share",
        service_inquiry_id: inquiry.id,
        inquiry_kind: inquiry.inquiryKind,
        headline: teacherProfileConfig?.headline ?? null,
        intro_text: teacherProfileConfig?.introText ?? null,
        teacher_intro_note: introNote,
        teacher_summary: teacherSummary,
        shared_at: nowIso,
        selected_blocks: selectedBlocks.map((block) => ({
          id: block.id,
          userId: block.userId,
          kind: block.kind,
          title: block.title,
          shortSummary: block.shortSummary,
          contentJson: block.contentJson,
          isActive: block.isActive,
          position: block.position,
          createdAt: block.createdAt,
          updatedAt: block.updatedAt,
        })),
      },
    });
    if (emitEventRes.error) {
      throw emitEventRes.error;
    }

    return NextResponse.json({
      ok: true,
      threadId,
      inquiryId: inquiry.id,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not accept the inquiry." },
      { status: 500 }
    );
  }
}
