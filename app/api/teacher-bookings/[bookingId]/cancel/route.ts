import { NextResponse } from "next/server";
import { validateCsrfOrigin, csrfError } from "@/lib/security/csrf";
import { requireServiceInquiryAuth, jsonError } from "@/lib/service-inquiries/server";
import { formatShortDate, formatShortTime } from "@/lib/teacher-bookings";
import { ensureTeacherBookingThread, upsertTeacherBookingContext, emitTeacherBookingEvent } from "@/lib/teacher-bookings/thread";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ bookingId: string }> };

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function sendCancelNotificationBestEffort(params: {
  service: ReturnType<typeof import("@/lib/supabase/service-role").getSupabaseServiceClient>;
  recipientId: string;
  actorId: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
}) {
  // Never notify the actor about their own action
  if (params.recipientId === params.actorId) return;
  const candidates = [
    { user_id: params.recipientId, actor_id: params.actorId, kind: "teacher_booking_cancelled", title: params.title, body: params.body, metadata: params.metadata, is_read: false },
    { user_id: params.recipientId, actor_id: params.actorId, kind: "teacher_booking_cancelled", title: params.title, message: params.body, metadata: params.metadata, is_read: false },
    { user_id: params.recipientId, kind: "teacher_booking_cancelled", title: params.title, body: params.body, metadata: params.metadata },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = (params.service as any).from("notifications");
  try {
    for (const payload of candidates) {
      const { error } = await table.insert(payload);
      if (!error) return;
      if ((error.code === "23505") || (error.message ?? "").toLowerCase().includes("duplicate")) return;
    }
  } catch { /* best-effort */ }
}

export async function POST(req: Request, { params }: RouteParams) {
  if (!validateCsrfOrigin(req)) return csrfError();
  try {
    const auth = await requireServiceInquiryAuth(req);
    if ("error" in auth) return auth.error;

    const { bookingId } = await params;
    if (!bookingId?.trim()) return jsonError("Booking id is required.", 400);

    const bookingRes = await auth.serviceClient
      .from("teacher_session_bookings")
      .select("id,teacher_id,student_id,availability_id,service_type,session_date,session_time,duration_min,note,status")
      .eq("id", bookingId)
      .maybeSingle();
    if (bookingRes.error) throw bookingRes.error;
    if (!bookingRes.data) return jsonError("Booking not found.", 404);

    const booking = bookingRes.data as {
      id: string;
      teacher_id: string;
      student_id: string;
      availability_id: string | null;
      service_type: string;
      session_date: string;
      session_time: string;
      duration_min: number | null;
      note: string | null;
      status: string;
    };

    // Only the student or teacher can cancel
    const isTeacher = booking.teacher_id === auth.userId;
    const isStudent = booking.student_id === auth.userId;
    if (!isTeacher && !isStudent) return jsonError("You do not have permission to cancel this booking.", 403);

    if (booking.status === "cancelled") return jsonError("This booking is already cancelled.", 400);
    if (booking.status === "declined") return jsonError("This booking was declined, not accepted.", 400);

    const nowIso = new Date().toISOString();

    const cancelRes = await auth.serviceClient
      .from("teacher_session_bookings")
      .update({ status: "cancelled", declined_at: nowIso } as never)
      .eq("id", booking.id);
    if (cancelRes.error) throw cancelRes.error;

    // If it was accepted, re-open the availability slot
    if (booking.status === "accepted" && booking.availability_id) {
      await auth.serviceClient
        .from("teacher_session_availability")
        .update({ is_available: true } as never)
        .eq("id", booking.availability_id)
        .eq("teacher_id", booking.teacher_id);
    }

    // Notify the other party
    const otherUserId = isTeacher ? booking.student_id : booking.teacher_id;
    const actorProfileRes = await auth.serviceClient
      .from("profiles")
      .select("display_name")
      .eq("user_id", auth.userId)
      .maybeSingle();
    const actorName = asString((actorProfileRes.data as { display_name?: string } | null)?.display_name) || (isTeacher ? "Teacher" : "Student");
    const dateLabel = formatShortDate(booking.session_date);
    const timeLabel = formatShortTime(booking.session_time);

    void sendCancelNotificationBestEffort({
      service: auth.serviceClient,
      recipientId: otherUserId,
      actorId: auth.userId,
      title: "Booking cancelled",
      body: `${actorName} cancelled the private class booking for ${dateLabel} at ${timeLabel}.`,
      metadata: { bookingId: booking.id },
    });

    // Best-effort: emit cancelled event to thread
    try {
      const threadId = await ensureTeacherBookingThread({ serviceClient: auth.serviceClient, teacherId: booking.teacher_id, studentId: booking.student_id, actorUserId: auth.userId });
      await upsertTeacherBookingContext({ serviceClient: auth.serviceClient, threadId, meta: { bookingId: booking.id, teacherId: booking.teacher_id, studentId: booking.student_id, serviceType: booking.service_type, sessionDate: booking.session_date, sessionTime: booking.session_time, durationMin: booking.duration_min ?? null, note: booking.note ?? null }, statusTag: "cancelled" });
      await emitTeacherBookingEvent({ serviceClient: auth.serviceClient, threadId, senderId: auth.userId, body: `${actorName} cancelled the booking for ${dateLabel} at ${timeLabel}.`, statusTag: "cancelled", metadata: { booking_id: booking.id } });
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true, status: "cancelled" });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not cancel the booking." },
      { status: 500 }
    );
  }
}
