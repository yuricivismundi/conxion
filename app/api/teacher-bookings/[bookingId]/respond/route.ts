import { NextResponse } from "next/server";
import { validateCsrfOrigin, csrfError } from "@/lib/security/csrf";
import { requireServiceInquiryAuth, jsonError } from "@/lib/service-inquiries/server";
import { buildTeacherBookingCalendarUrl, formatShortDate, formatShortTime } from "@/lib/teacher-bookings";
import { ensureTeacherBookingThread, upsertTeacherBookingContext, emitTeacherBookingEvent } from "@/lib/teacher-bookings/thread";

export const runtime = "nodejs";

async function sendBookingNotificationBestEffort(params: {
  service: ReturnType<typeof import("@/lib/supabase/service-role").getSupabaseServiceClient>;
  recipientId: string;
  actorId: string;
  kind: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
}) {
  const candidates = [
    { user_id: params.recipientId, actor_id: params.actorId, kind: params.kind, title: params.title, body: params.body, metadata: params.metadata, is_read: false },
    { user_id: params.recipientId, actor_id: params.actorId, kind: params.kind, title: params.title, message: params.body, metadata: params.metadata, is_read: false },
    { user_id: params.recipientId, kind: params.kind, title: params.title, body: params.body, metadata: params.metadata },
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

type RespondPayload = {
  action?: unknown;
};

type RouteParams = {
  params: Promise<{ bookingId: string }>;
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request, { params }: RouteParams) {
  if (!validateCsrfOrigin(req)) return csrfError();
  try {
    const auth = await requireServiceInquiryAuth(req);
    if ("error" in auth) return auth.error;

    const { bookingId } = await params;
    if (!bookingId?.trim()) return jsonError("Booking id is required.", 400);

    const body = (await req.json().catch(() => null)) as RespondPayload | null;
    const action = asString(body?.action);
    if (action !== "accept" && action !== "decline") return jsonError("Invalid booking action.", 400);

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

    if (booking.teacher_id !== auth.userId) return jsonError("You do not have permission to manage this booking.", 403);
    if (booking.status !== "pending") return jsonError("Only pending booking requests can be updated.", 400);

    const nowIso = new Date().toISOString();

    if (action === "decline") {
      const declineRes = await auth.serviceClient
        .from("teacher_session_bookings")
        .update({ status: "declined", declined_at: nowIso } as never)
        .eq("id", booking.id);
      if (declineRes.error) throw declineRes.error;

      const teacherProfileRes = await auth.serviceClient
        .from("profiles")
        .select("display_name")
        .eq("user_id", auth.userId)
        .maybeSingle();
      const tName = asString((teacherProfileRes.data as { display_name?: string } | null)?.display_name) || "Teacher";
      void sendBookingNotificationBestEffort({
        service: auth.serviceClient,
        recipientId: booking.student_id,
        actorId: auth.userId,
        kind: "teacher_booking_declined",
        title: "Booking request declined",
        body: `${tName} was unable to accept your booking request for ${formatShortDate(booking.session_date)} at ${formatShortTime(booking.session_time)}.`,
        metadata: { bookingId: booking.id, teacherId: auth.userId },
      });

      // Best-effort: emit declined event to thread
      try {
        const threadId = await ensureTeacherBookingThread({ serviceClient: auth.serviceClient, teacherId: booking.teacher_id, studentId: booking.student_id, actorUserId: auth.userId });
        await upsertTeacherBookingContext({ serviceClient: auth.serviceClient, threadId, meta: { bookingId: booking.id, teacherId: booking.teacher_id, studentId: booking.student_id, serviceType: booking.service_type, sessionDate: booking.session_date, sessionTime: booking.session_time, durationMin: booking.duration_min, note: booking.note }, statusTag: "declined" });
        await emitTeacherBookingEvent({ serviceClient: auth.serviceClient, threadId, senderId: auth.userId, body: `${tName} declined the booking request for ${formatShortDate(booking.session_date)} at ${formatShortTime(booking.session_time)}.`, statusTag: "declined", metadata: { booking_id: booking.id } });
      } catch { /* non-fatal */ }

      return NextResponse.json({ ok: true, status: "declined" });
    }

    if (!booking.availability_id) return jsonError("This booking is missing its availability reference.", 400);

    const acceptedConflictRes = await auth.serviceClient
      .from("teacher_session_bookings")
      .select("id")
      .eq("availability_id", booking.availability_id)
      .eq("status", "accepted")
      .neq("id", booking.id)
      .maybeSingle();
    if (acceptedConflictRes.error) throw acceptedConflictRes.error;
    if (acceptedConflictRes.data) return jsonError("This slot has already been accepted for another booking.", 409);

    const acceptRes = await auth.serviceClient
      .from("teacher_session_bookings")
      .update({ status: "accepted", accepted_at: nowIso, declined_at: null } as never)
      .eq("id", booking.id);
    if (acceptRes.error) throw acceptRes.error;

    const availabilityRes = await auth.serviceClient
      .from("teacher_session_availability")
      .update({ is_available: false } as never)
      .eq("id", booking.availability_id)
      .eq("teacher_id", auth.userId);
    if (availabilityRes.error) throw availabilityRes.error;

    const declineCompetingRes = await auth.serviceClient
      .from("teacher_session_bookings")
      .update({ status: "declined", declined_at: nowIso } as never)
      .eq("availability_id", booking.availability_id)
      .eq("status", "pending")
      .neq("id", booking.id);
    if (declineCompetingRes.error) throw declineCompetingRes.error;

    const profilesRes = await auth.serviceClient
      .from("profiles")
      .select("user_id,display_name")
      .in("user_id", [booking.teacher_id, booking.student_id]);
    if (profilesRes.error) throw profilesRes.error;

    let teacherName = "Teacher";
    let studentName = "Student";
    for (const row of ((profilesRes.data ?? []) as Array<Record<string, unknown>>)) {
      const userId = asString(row.user_id);
      const displayName = asString(row.display_name) || (userId === booking.teacher_id ? "Teacher" : "Student");
      if (userId === booking.teacher_id) teacherName = displayName;
      if (userId === booking.student_id) studentName = displayName;
    }

    const duration = booking.duration_min ?? 60;
    const [hourStr = "00", minuteStr = "00"] = booking.session_time.split(":");
    const startMinutes = Number(hourStr) * 60 + Number(minuteStr);
    const endMinutes = startMinutes + duration;
    const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}:00`;
    const calendarUrl = buildTeacherBookingCalendarUrl({
      title: `Private class — ${teacherName} × ${studentName}`,
      date: booking.session_date,
      startTime: booking.session_time,
      endTime,
      details: [booking.note, `Student: ${studentName}`].filter(Boolean).join("\n"),
    });

    void sendBookingNotificationBestEffort({
      service: auth.serviceClient,
      recipientId: booking.student_id,
      actorId: auth.userId,
      kind: "teacher_booking_accepted",
      title: "Booking request accepted",
      body: `${teacherName} accepted your private class on ${formatShortDate(booking.session_date)} at ${formatShortTime(booking.session_time)}.`,
      metadata: { bookingId: booking.id, teacherId: auth.userId, calendarUrl },
    });

    // Best-effort: emit accepted event to thread
    try {
      const threadId = await ensureTeacherBookingThread({ serviceClient: auth.serviceClient, teacherId: booking.teacher_id, studentId: booking.student_id, actorUserId: auth.userId });
      await upsertTeacherBookingContext({ serviceClient: auth.serviceClient, threadId, meta: { bookingId: booking.id, teacherId: booking.teacher_id, studentId: booking.student_id, serviceType: booking.service_type, sessionDate: booking.session_date, sessionTime: booking.session_time, durationMin: booking.duration_min, note: booking.note }, statusTag: "accepted" });
      await emitTeacherBookingEvent({ serviceClient: auth.serviceClient, threadId, senderId: auth.userId, body: `${teacherName} accepted the booking for ${formatShortDate(booking.session_date)} at ${formatShortTime(booking.session_time)}.`, statusTag: "accepted", metadata: { booking_id: booking.id, calendar_url: calendarUrl } });
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true, status: "accepted", calendarUrl });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not update the booking request." },
      { status: 500 }
    );
  }
}
