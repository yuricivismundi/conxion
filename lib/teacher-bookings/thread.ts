import type { SupabaseServiceClient } from "@/lib/supabase/service-role";

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

export type TeacherBookingThreadMeta = {
  bookingId: string;
  teacherId: string;
  studentId: string;
  serviceType: string;
  sessionDate: string;
  sessionTime: string;
  durationMin: number | null;
  note: string | null;
};

export async function ensureTeacherBookingThread(params: {
  serviceClient: SupabaseServiceClient;
  teacherId: string;
  studentId: string;
  actorUserId: string;
}): Promise<string> {
  const rpc = await (params.serviceClient as unknown as RpcInvoker).rpc("cx_ensure_pair_thread", {
    p_user_a: params.teacherId,
    p_user_b: params.studentId,
    p_actor: params.actorUserId,
  });
  if (rpc.error) throw rpc.error;
  const threadId = asString(rpc.data).trim();
  if (!threadId) throw new Error("Could not create booking thread.");
  return threadId;
}

export async function upsertTeacherBookingContext(params: {
  serviceClient: SupabaseServiceClient;
  threadId: string;
  meta: TeacherBookingThreadMeta;
  statusTag: "pending" | "accepted" | "declined" | "cancelled";
}) {
  const { error } = await params.serviceClient
    .from("thread_contexts" as never)
    .upsert(
      {
        thread_id: params.threadId,
        source_table: "teacher_session_bookings",
        source_id: params.meta.bookingId,
        context_tag: "teacher_booking",
        status_tag: params.statusTag,
        title: "Private class booking",
        requester_id: params.meta.studentId,
        recipient_id: params.meta.teacherId,
        metadata: {
          booking_id: params.meta.bookingId,
          teacher_id: params.meta.teacherId,
          student_id: params.meta.studentId,
          service_type: params.meta.serviceType,
          session_date: params.meta.sessionDate,
          session_time: params.meta.sessionTime,
          duration_min: params.meta.durationMin,
          note: params.meta.note,
        },
        is_pinned: params.statusTag === "pending",
        resolved_at: params.statusTag === "pending" ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "source_table,source_id" }
    );
  if (error) throw error;
}

export async function emitTeacherBookingEvent(params: {
  serviceClient: SupabaseServiceClient;
  threadId: string;
  senderId: string;
  body: string;
  statusTag: "pending" | "accepted" | "declined" | "cancelled";
  metadata?: Record<string, unknown>;
}) {
  const rpc = await (params.serviceClient as unknown as RpcInvoker).rpc("cx_emit_thread_event", {
    p_thread_id: params.threadId,
    p_sender_id: params.senderId,
    p_body: params.body,
    p_message_type: "request",
    p_context_tag: "teacher_booking",
    p_status_tag: params.statusTag,
    p_metadata: params.metadata ?? {},
  });
  if (rpc.error) throw rpc.error;
}
