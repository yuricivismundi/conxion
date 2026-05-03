import { NextResponse } from "next/server";
import { requireServiceInquiryAuth, jsonError, singleLineTrimmed } from "@/lib/service-inquiries/server";
import {
  durationMinutesFromTimeRange,
  isDateWithinNextThreeMonths,
  isTeacherBookingServiceType,
} from "@/lib/teacher-bookings";

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

    return NextResponse.json({ ok: true, booking: insertRes.data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not create the booking request." },
      { status: 500 }
    );
  }
}
