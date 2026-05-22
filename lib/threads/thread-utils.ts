import type { SupabaseClient } from "@supabase/supabase-js";

export type ThreadContextInput = {
  threadId: string;
  sourceTable: "activities" | "service_inquiries" | "teacher_bookings" | "trips" | "hosting";
  sourceId: string;
  contextTag: string;
  statusTag: string;
  title: string;
  city?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  requesterId: string;
  responderId: string;
  metadata?: Record<string, unknown>;
};

export async function upsertThreadContext(
  client: SupabaseClient,
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>
,
  input: ThreadContextInput
): Promise<boolean> {
  try {
    const { error } = await rpc("cx_upsert_thread_context", {
      p_thread_id: input.threadId,
      p_source_table: input.sourceTable,
      p_source_id: input.sourceId,
      p_context_tag: input.contextTag,
      p_status_tag: input.statusTag,
      p_title: input.title,
      p_city: input.city ?? null,
      p_start_date: input.startDate ?? null,
      p_end_date: input.endDate ?? null,
      p_requester_id: input.requesterId,
      p_recipient_id: input.responderId,
      p_metadata: input.metadata ?? {},
    });

    if (error) {
      console.error("[thread-utils] upsertThreadContext failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[thread-utils] upsertThreadContext exception:", err);
    return false;
  }
}

export async function cancelThreadEntitlements(
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>
,
  sourceType: "activity_request" | "service_inquiry_request" | "teacher_booking_request",
  sourceId: string
): Promise<boolean> {
  try {
    const { error } = await rpc("cx_cancel_request_chat_entitlement", {
      p_source_type: sourceType,
      p_source_id: sourceId,
    });

    if (error) {
      console.error("[thread-utils] cancelThreadEntitlements failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[thread-utils] cancelThreadEntitlements exception:", err);
    return false;
  }
}

export async function ensureThreadExists(
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>
,
  params: {
    userId1: string;
    userId2: string;
    contextType?: "dm" | "connection" | "activity" | "trip" | "hosting" | "group" | "event";
  }
): Promise<string | null> {
  try {
    const { data, error } = await rpc("cx_ensure_dm_thread", {
      p_user1_id: params.userId1,
      p_user2_id: params.userId2,
      p_context_type: params.contextType ?? "dm",
    });

    if (error || !data) {
      console.error("[thread-utils] ensureThreadExists failed:", error?.message ?? "unknown error");
      return null;
    }

    return typeof data === "string" ? data : null;
  } catch (err) {
    console.error("[thread-utils] ensureThreadExists exception:", err);
    return null;
  }
}
