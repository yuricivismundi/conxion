import type { SupabaseServiceClient } from "@/lib/supabase/service-role";
import { SERVICE_INQUIRY_KIND_LABELS, type ServiceInquiryRecord } from "@/lib/service-inquiries/types";

type RpcInvoker = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
    options?: { head?: boolean; get?: boolean; count?: "exact" | "planned" | "estimated" }
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function serviceInquiryTitle(inquiryKind: ServiceInquiryRecord["inquiryKind"]) {
  return `${SERVICE_INQUIRY_KIND_LABELS[inquiryKind]} inquiry`;
}

export function buildServiceInquiryContextMetadata(inquiry: ServiceInquiryRecord) {
  return {
    service_inquiry_id: inquiry.id,
    inquiry_kind: inquiry.inquiryKind,
    inquiry_label: SERVICE_INQUIRY_KIND_LABELS[inquiry.inquiryKind],
    requester_message: inquiry.requesterMessage,
    requester_type: inquiry.requesterType,
    requested_dates_text: inquiry.requestedDatesText,
    city: inquiry.city,
  };
}

export async function ensureServiceInquiryThread(params: {
  serviceClient: SupabaseServiceClient;
  inquiry: ServiceInquiryRecord;
  actorUserId: string;
}) {
  const rpc = await (params.serviceClient as unknown as RpcInvoker).rpc("cx_ensure_pair_thread", {
    p_user_a: params.inquiry.requesterId,
    p_user_b: params.inquiry.recipientId,
    p_actor: params.actorUserId,
  });
  if (rpc.error) throw rpc.error;

  const threadId = asString(rpc.data).trim();
  if (!threadId) {
    throw new Error("Could not create the inquiry thread.");
  }

  const mappingUpsert = await params.serviceClient
    .from("service_inquiry_threads" as never)
    .upsert(
      {
        inquiry_id: params.inquiry.id,
        thread_id: threadId,
      } as never,
      { onConflict: "inquiry_id" }
    );
  if (mappingUpsert.error) throw mappingUpsert.error;

  return threadId;
}

export async function upsertServiceInquiryContext(params: {
  serviceClient: SupabaseServiceClient;
  threadId: string;
  inquiry: ServiceInquiryRecord;
  statusTag: "pending" | "info_shared" | "inquiry_followup_pending" | "active" | "declined" | "expired";
  extraMetadata?: Record<string, unknown>;
}) {
  const metadata = {
    ...buildServiceInquiryContextMetadata(params.inquiry),
    ...(params.extraMetadata ?? {}),
  };

  const { error } = await params.serviceClient
    .from("thread_contexts" as never)
    .upsert(
      {
        thread_id: params.threadId,
        source_table: "service_inquiries",
        source_id: params.inquiry.id,
        context_tag: "service_inquiry",
        status_tag: params.statusTag,
        title: serviceInquiryTitle(params.inquiry.inquiryKind),
        city: params.inquiry.city,
        requester_id: params.inquiry.requesterId,
        recipient_id: params.inquiry.recipientId,
        metadata,
        is_pinned: params.statusTag === "pending",
        resolved_at: params.statusTag === "pending" ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "source_table,source_id" }
    );

  if (error) throw error;
}

export async function emitServiceInquiryEvent(params: {
  serviceClient: SupabaseServiceClient;
  threadId: string;
  senderId: string;
  body: string;
  messageType?: "system" | "request";
  statusTag: "pending" | "info_shared" | "inquiry_followup_pending" | "active" | "declined" | "expired";
  metadata?: Record<string, unknown>;
}) {
  const rpc = await (params.serviceClient as unknown as RpcInvoker).rpc("cx_emit_thread_event", {
    p_thread_id: params.threadId,
    p_sender_id: params.senderId,
    p_body: params.body,
    p_message_type: params.messageType ?? "system",
    p_context_tag: "service_inquiry",
    p_status_tag: params.statusTag,
    p_metadata: params.metadata ?? {},
  });
  if (rpc.error) throw rpc.error;
}
