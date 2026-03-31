import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeServiceInquiryRow,
  normalizeServiceInquiryThreadRow,
  type ServiceInquiryRecord,
  type ServiceInquiryThreadRecord,
} from "@/lib/service-inquiries/types";

export const SERVICE_INQUIRY_MONTHLY_LIMIT = 5;

const SERVICE_INQUIRY_SELECT =
  "id,requester_id,recipient_id,inquiry_kind,requester_type,requester_message,city,requested_dates_text,status,accepted_at,declined_at,created_at,updated_at";

const SERVICE_INQUIRY_THREAD_SELECT =
  "id,inquiry_id,thread_id,shared_block_ids,requester_followup_used,teacher_intro_note,created_at";

export async function fetchServiceInquiryById(
  client: SupabaseClient,
  inquiryId: string
): Promise<ServiceInquiryRecord | null> {
  const { data, error } = await client.from("service_inquiries").select(SERVICE_INQUIRY_SELECT).eq("id", inquiryId).maybeSingle();
  if (error) throw error;
  return normalizeServiceInquiryRow(data);
}

export async function fetchServiceInquiryThreadByInquiryId(
  client: SupabaseClient,
  inquiryId: string
): Promise<ServiceInquiryThreadRecord | null> {
  const { data, error } = await client
    .from("service_inquiry_threads")
    .select(SERVICE_INQUIRY_THREAD_SELECT)
    .eq("inquiry_id", inquiryId)
    .maybeSingle();
  if (error) throw error;
  return normalizeServiceInquiryThreadRow(data);
}

export async function countServiceInquiriesThisMonth(
  client: SupabaseClient,
  requesterId: string,
  at = new Date()
): Promise<number> {
  const cycleStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
  const { count, error } = await client
    .from("service_inquiries")
    .select("id", { count: "exact", head: true })
    .eq("requester_id", requesterId)
    .gte("created_at", cycleStart);

  if (error) throw error;
  return count ?? 0;
}
