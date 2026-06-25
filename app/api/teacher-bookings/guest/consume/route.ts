/**
 * POST /api/teacher-bookings/guest/consume
 *
 * Called from /book-session after the guest has authenticated via magic link.
 * Marks the guest_booking_intent as consumed, creates the real booking thread,
 * and returns the teacher's profile ID for redirect.
 */
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { validateCsrfOrigin, csrfError } from "@/lib/security/csrf";
import {
  ensureTeacherBookingThread,
  upsertTeacherBookingContext,
  emitTeacherBookingEvent,
} from "@/lib/teacher-bookings/thread";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!validateCsrfOrigin(req)) return csrfError();

  const bearerToken = getBearerToken(req);
  if (!bearerToken) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });

  const userClient = getSupabaseUserClient(bearerToken);
  const { data: authData, error: authErr } = await userClient.auth.getUser(bearerToken);
  if (authErr || !authData.user) return NextResponse.json({ ok: false, error: "Invalid session." }, { status: 401 });

  const userId = authData.user.id;

  let body: { token?: unknown };
  try { body = (await req.json()) as { token?: unknown }; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ ok: false, error: "Token is required." }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = getSupabaseServiceClient() as any;

  // Load the intent
  const { data: intent, error: intentErr } = await service
    .from("guest_booking_intents")
    .select("id, teacher_id, guest_name, message, date_pref, service_type, status, expires_at")
    .eq("token", token)
    .maybeSingle() as { data: {
      id: string; teacher_id: string; guest_name: string; message: string | null;
      date_pref: string | null; service_type: string | null; status: string; expires_at: string;
    } | null; error: unknown };

  if (intentErr || !intent) return NextResponse.json({ ok: false, error: "Booking request not found." }, { status: 404 });
  if (intent.status !== "pending") return NextResponse.json({ ok: false, error: "This booking link has already been used or has expired." }, { status: 410 });
  if (new Date(intent.expires_at as string) < new Date()) {
    await service.from("guest_booking_intents").update({ status: "expired" }).eq("id", intent.id);
    return NextResponse.json({ ok: false, error: "This booking link has expired. Please request a new one." }, { status: 410 });
  }
  if (userId === intent.teacher_id) return NextResponse.json({ ok: false, error: "You cannot book yourself." }, { status: 400 });

  // Mark consumed
  await service.from("guest_booking_intents").update({
    status: "consumed",
    consumed_at: new Date().toISOString(),
    user_id: userId,
  }).eq("id", intent.id);

  // Create the booking thread (same as the regular booking flow)
  try {
    const teacherId = intent.teacher_id as string;
    const serviceType = (intent.service_type as string) || "private_class";
    const note = [
      intent.message ? `Message: ${intent.message}` : null,
      intent.date_pref ? `Preferred date: ${intent.date_pref}` : null,
    ].filter(Boolean).join("\n");

    const threadId = await ensureTeacherBookingThread({
      serviceClient: service,
      teacherId,
      studentId: userId,
      actorUserId: userId,
    });

    await upsertTeacherBookingContext({
      serviceClient: service,
      threadId,
      meta: {
        bookingId: intent.id,
        teacherId,
        studentId: userId,
        serviceType,
        sessionDate: intent.date_pref ?? "",
        sessionTime: "",
        durationMin: null,
        note: note || null,
      },
      statusTag: "pending",
    });

    await emitTeacherBookingEvent({
      serviceClient: service,
      threadId,
      senderId: userId,
      body: note || `Booking request from guest for ${serviceType}`,
      statusTag: "pending",
    });
  } catch (threadErr) {
    console.error("[guest-booking/consume] Thread creation failed:", threadErr);
    // Don't fail the response — guest is verified, redirect them to teacher profile
    // so they can complete booking via the normal flow
  }

  // Get teacher slug/id for redirect
  const { data: profile } = await service
    .from("profiles")
    .select("username")
    .eq("user_id", intent.teacher_id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    teacherId: intent.teacher_id,
    teacherSlug: (profile as { username?: string | null } | null)?.username ?? null,
  });
}
