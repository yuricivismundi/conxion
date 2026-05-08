import { NextResponse } from "next/server";
import { validateCsrfOrigin, csrfError } from "@/lib/security/csrf";
import { requireServiceInquiryAuth, jsonError, singleLineTrimmed } from "@/lib/service-inquiries/server";
import {
  durationMinutesFromTimeRange,
  isDateWithinNextThreeMonths,
  isTeacherBookingServiceType,
  formatShortDate,
  formatShortTime,
} from "@/lib/teacher-bookings";
import {
  ensureTeacherBookingThread,
  upsertTeacherBookingContext,
  emitTeacherBookingEvent,
} from "@/lib/teacher-bookings/thread";

export const runtime = "nodejs";

type CreateBookingPayload = {
  teacherId?: unknown;
  availabilityId?: unknown;
  serviceType?: unknown;
  note?: unknown;
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  if (!validateCsrfOrigin(req)) return csrfError();
  try {
    const auth = await requireServiceInquiryAuth(req);
    if ("error" in auth) return auth.error;

    const body = (await req.json().catch(() => null)) as CreateBookingPayload | null;
    const teacherId = asString(body?.teacherId);
    const availabilityId = asString(body?.availabilityId);
    const serviceType = body?.serviceType;
    const note = singleLineTrimmed(body?.note, 220);

    if (!teacherId || !availabilityId) return jsonError("teacherId and availabilityId are required.", 400);
    if (!isTeacherBookingServiceType(serviceType)) return jsonError("Invalid booking service type.", 400);
    if (teacherId === auth.userId) return jsonError("You cannot book yourself.", 400);

    const availabilityRes = await auth.serviceClient
      .from("teacher_session_availability")
      .select("id,teacher_id,availability_date,start_time,end_time,is_available")
      .eq("id", availabilityId)
      .eq("teacher_id", teacherId)
      .maybeSingle();
    if (availabilityRes.error) throw availabilityRes.error;
    if (!availabilityRes.data) return jsonError("Availability slot not found.", 404);

    const availability = availabilityRes.data as {
      id: string;
      teacher_id: string;
      availability_date: string;
      start_time: string;
      end_time: string;
      is_available: boolean;
    };
    if (availability.is_available !== true) return jsonError("This slot is no longer available.", 409);
    if (!isDateWithinNextThreeMonths(availability.availability_date)) {
      return jsonError("Bookings are limited to the next 3 months.", 400);
    }

    const acceptedRes = await auth.serviceClient
      .from("teacher_session_bookings")
      .select("id")
      .eq("availability_id", availability.id)
      .eq("status", "accepted")
      .maybeSingle();
    if (acceptedRes.error) throw acceptedRes.error;
    if (acceptedRes.data) return jsonError("This slot has already been booked.", 409);

    const insertRes = await auth.serviceClient
      .from("teacher_session_bookings")
      .insert({
        teacher_id: teacherId,
        student_id: auth.userId,
        availability_id: availability.id,
        service_type: serviceType,
        session_date: availability.availability_date,
        session_time: availability.start_time,
        duration_min: durationMinutesFromTimeRange(availability.start_time, availability.end_time),
        note,
        status: "pending",
      } as never)
      .select("id,teacher_id,student_id,availability_id,service_type,session_date,session_time,duration_min,note,status,created_at,accepted_at,declined_at")
      .single();
    if (insertRes.error) throw insertRes.error;

    const booking = insertRes.data as {
      id: string; teacher_id: string; student_id: string; service_type: string;
      session_date: string; session_time: string; duration_min: number | null; note: string | null;
    };

    // Best-effort: create/reuse DM thread and emit booking card event
    try {
      const threadId = await ensureTeacherBookingThread({
        serviceClient: auth.serviceClient,
        teacherId: booking.teacher_id,
        studentId: booking.student_id,
        actorUserId: auth.userId,
      });
      await upsertTeacherBookingContext({
        serviceClient: auth.serviceClient,
        threadId,
        meta: {
          bookingId: booking.id,
          teacherId: booking.teacher_id,
          studentId: booking.student_id,
          serviceType: booking.service_type,
          sessionDate: booking.session_date,
          sessionTime: booking.session_time,
          durationMin: booking.duration_min,
          note: booking.note,
        },
        statusTag: "pending",
      });
      await emitTeacherBookingEvent({
        serviceClient: auth.serviceClient,
        threadId,
        senderId: auth.userId,
        body: `Booking request for ${formatShortDate(booking.session_date)} at ${formatShortTime(booking.session_time)}`,
        statusTag: "pending",
        metadata: { booking_id: booking.id },
      });
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true, booking: insertRes.data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not create the booking request." },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  try {
    const auth = await requireServiceInquiryAuth(req);
    if ("error" in auth) return auth.error;

    const bookingsRes = await auth.serviceClient
      .from("teacher_session_bookings")
      .select("id,teacher_id,student_id,service_type,session_date,session_time,duration_min,note,status,created_at,accepted_at,declined_at")
      .eq("student_id", auth.userId)
      .order("session_date", { ascending: false })
      .order("session_time", { ascending: false })
      .limit(50);
    if (bookingsRes.error) throw bookingsRes.error;

    const teacherIds = [...new Set((bookingsRes.data ?? []).map((b: Record<string, unknown>) => b.teacher_id as string))];
    let teacherProfiles: Array<{ user_id: string; display_name: string | null; avatar_url: string | null }> = [];
    if (teacherIds.length > 0) {
      const profilesRes = await auth.serviceClient
        .from("profiles")
        .select("user_id,display_name,avatar_url")
        .in("user_id", teacherIds);
      if (!profilesRes.error) teacherProfiles = (profilesRes.data ?? []) as typeof teacherProfiles;
    }

    return NextResponse.json({ ok: true, bookings: bookingsRes.data ?? [], teacherProfiles });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not load booking requests." },
      { status: 500 }
    );
  }
}
