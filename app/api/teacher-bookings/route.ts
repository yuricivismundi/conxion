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
import { getBillingAccountStateForUserId } from "@/lib/billing/account-state";
import { getPlanLimits } from "@/lib/billing/limits";

export const runtime = "nodejs";

type CreateBookingPayload = {
  teacherId?: unknown;
  availabilityId?: unknown;
  serviceType?: unknown;
  note?: unknown;
  requestedStartTime?: unknown;
  requestedEndTime?: unknown;
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTime(value: string) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
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
    const requestedStartTime = normalizeTime(asString(body?.requestedStartTime));
    const requestedEndTime = normalizeTime(asString(body?.requestedEndTime));

    if (!teacherId || !availabilityId) return jsonError("teacherId and availabilityId are required.", 400);
    if (!isTeacherBookingServiceType(serviceType)) return jsonError("Invalid booking service type.", 400);
    if (teacherId === auth.userId) return jsonError("You cannot book yourself.", 400);
    if (!requestedStartTime || !requestedEndTime) return jsonError("Pick a start and end time within the available window.", 400);
    if (requestedEndTime <= requestedStartTime) return jsonError("End time must be after start time.", 400);

    // Enforce monthly booking-request limit per plan tier.
    const accountState = await getBillingAccountStateForUserId(auth.serviceClient, auth.userId);
    const planLimits = getPlanLimits(accountState.currentPlanId);
    const bookingLimit = planLimits.bookingRequestsPerMonth;
    if (bookingLimit !== null) {
      const cycleStart = new Date();
      cycleStart.setUTCDate(1);
      cycleStart.setUTCHours(0, 0, 0, 0);
      const countRes = await auth.serviceClient
        .from("teacher_session_bookings")
        .select("id", { count: "exact", head: true })
        .eq("student_id", auth.userId)
        .gte("created_at", cycleStart.toISOString());
      if (countRes.error) throw countRes.error;
      const used = countRes.count ?? 0;
      if (used >= bookingLimit) {
        return jsonError(`You already used all ${bookingLimit} booking requests this month.`, 400);
      }
    }

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

    const windowStart = (availability.start_time || "").slice(0, 8);
    const windowEnd = (availability.end_time || "").slice(0, 8);
    if (requestedStartTime < windowStart || requestedEndTime > windowEnd) {
      return jsonError("Your selected time must be within the teacher's available window.", 400);
    }

    // Mark availability as unavailable (atomically prevents race condition on concurrent bookings)
    const updateAvailRes = await auth.serviceClient
      .from("teacher_session_availability")
      .update({ is_available: false } as never)
      .eq("id", availability.id)
      .eq("is_available", true)
      .select("id")
      .maybeSingle();
    if (updateAvailRes.error) throw updateAvailRes.error;
    if (!updateAvailRes.data) return jsonError("This slot is no longer available.", 409);

    try {
      const insertRes = await auth.serviceClient
        .from("teacher_session_bookings")
        .insert({
          teacher_id: teacherId,
          student_id: auth.userId,
          availability_id: availability.id,
          service_type: serviceType,
          session_date: availability.availability_date,
          session_time: requestedStartTime,
          duration_min: durationMinutesFromTimeRange(requestedStartTime, requestedEndTime),
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
        const endTime = (() => {
          const [hh, mm] = requestedStartTime.split(":").map(Number);
          const minutes = (booking.duration_min ?? 0) + hh * 60 + mm;
          const eh = Math.floor((minutes / 60) % 24);
          const em = minutes % 60;
          return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}:00`;
        })();
        await emitTeacherBookingEvent({
          serviceClient: auth.serviceClient,
          threadId,
          senderId: auth.userId,
          body: `Booking request for ${formatShortDate(booking.session_date)} from ${formatShortTime(booking.session_time)} to ${formatShortTime(endTime)}`,
          statusTag: "pending",
          metadata: { booking_id: booking.id },
        });
      } catch { /* non-fatal */ }

      return NextResponse.json({ ok: true, booking: insertRes.data });
    } catch (insertErr) {
      // Restore availability if booking insertion failed
      try {
        await auth.serviceClient
          .from("teacher_session_availability")
          .update({ is_available: true } as never)
          .eq("id", availability.id);
      } catch {
        // If restore also fails, log and continue (slot will be stuck unavailable, but this is rare)
        console.error("[teacher-bookings] Failed to restore availability after booking insert failure");
      }
      throw insertErr;
    }
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
