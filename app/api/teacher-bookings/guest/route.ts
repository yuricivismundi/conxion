/**
 * POST /api/teacher-bookings/guest
 *
 * Accepts a booking intent from a non-authenticated user.
 * 1. Validates the teacher exists and is public.
 * 2. Stores a guest_booking_intents row.
 * 3. Sends a magic-link email to the guest (Supabase OTP → redirects to /book-session?token=...).
 * 4. Notifies the teacher via email (informational — full booking created after guest logs in).
 */
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { sendResendEmail, isResendConfigured } from "@/lib/email/resend";
import { validateCsrfOrigin, csrfError } from "@/lib/security/csrf";

export const runtime = "nodejs";

const MAX_NAME = 80;
const MAX_EMAIL = 320;
const MAX_MESSAGE = 600;
const MAX_DATE_PREF = 120;

function clean(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
  if (!validateCsrfOrigin(req)) return csrfError();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const teacherId = clean(body.teacherId, 36);
  const guestName = clean(body.guestName, MAX_NAME);
  const guestEmail = clean(body.guestEmail, MAX_EMAIL).toLowerCase();
  const message = clean(body.message, MAX_MESSAGE);
  const datePref = clean(body.datePref, MAX_DATE_PREF);
  const serviceType = clean(body.serviceType, 40) || "private_class";

  if (!teacherId) return NextResponse.json({ ok: false, error: "teacherId is required." }, { status: 400 });
  if (!guestName) return NextResponse.json({ ok: false, error: "Your name is required." }, { status: 400 });
  if (!guestEmail || !isValidEmail(guestEmail)) return NextResponse.json({ ok: false, error: "A valid email is required." }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = getSupabaseServiceClient() as any;

  // Verify teacher exists and is public
  const { data: teacher, error: teacherErr } = await service
    .from("teacher_profiles")
    .select("user_id, display_name, teacher_profile_enabled, is_public")
    .eq("user_id", teacherId)
    .maybeSingle();

  if (teacherErr || !teacher) {
    return NextResponse.json({ ok: false, error: "Teacher not found." }, { status: 404 });
  }
  if (!teacher.teacher_profile_enabled || !teacher.is_public) {
    return NextResponse.json({ ok: false, error: "This teacher is not accepting bookings." }, { status: 403 });
  }

  const teacherName = (teacher.display_name as string | null) ?? "the teacher";

  // Get teacher's email for notification
  const { data: teacherAuthUser } = await service.auth.admin.getUserById(teacherId);
  const teacherEmail = teacherAuthUser?.user?.email ?? null;

  // Insert intent
  const { data: intent, error: intentErr } = await service
    .from("guest_booking_intents")
    .insert({
      teacher_id: teacherId,
      guest_name: guestName,
      guest_email: guestEmail,
      message: message || null,
      date_pref: datePref || null,
      service_type: serviceType,
    })
    .select("token")
    .single();

  if (intentErr || !intent) {
    console.error("[guest-booking] Failed to insert intent:", intentErr);
    return NextResponse.json({ ok: false, error: "Could not save booking request. Please try again." }, { status: 500 });
  }

  const token = intent.token as string;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://conxion.social";
  const redirectTo = `${appUrl}/book-session?token=${token}`;

  // Send magic link to guest via Supabase OTP
  const { error: otpErr } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: guestEmail,
    options: { redirectTo },
  });

  if (otpErr) {
    // Non-fatal — guest can still be contacted by teacher via email
    console.error("[guest-booking] Magic link generation failed:", otpErr.message);
  }

  // Email to guest
  if (isResendConfigured()) {
    await sendResendEmail({
      to: guestEmail,
      subject: `Your booking request to ${teacherName} — confirm your email`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#f1f5f9">
          <h2 style="color:#0df2f2">Booking request sent!</h2>
          <p>Hi ${guestName},</p>
          <p>Your booking request to <strong>${teacherName}</strong> has been received.</p>
          ${message ? `<p><em>"${message}"</em></p>` : ""}
          ${datePref ? `<p>Preferred date: <strong>${datePref}</strong></p>` : ""}
          <p>Click the button below to verify your email and complete your booking. The link expires in 48 hours.</p>
          <p style="text-align:center;margin:32px 0">
            <a href="${redirectTo}" style="background:#0df2f2;color:#0a0a0a;padding:14px 28px;border-radius:999px;font-weight:700;text-decoration:none;display:inline-block">
              Confirm &amp; Complete Booking
            </a>
          </p>
          <p style="font-size:12px;color:#64748b">If you didn't request this, you can ignore this email.</p>
        </div>
      `,
      text: `Hi ${guestName},\n\nYour booking request to ${teacherName} has been received.\n\nClick here to confirm your email and complete your booking:\n${redirectTo}\n\nThe link expires in 48 hours.`,
      idempotencyKey: `guest-booking-guest-${token}`,
    });

    // Email to teacher
    if (teacherEmail) {
      await sendResendEmail({
        to: teacherEmail,
        subject: `New booking inquiry from ${guestName}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#f1f5f9">
            <h2 style="color:#0df2f2">New booking inquiry</h2>
            <p><strong>${guestName}</strong> (${guestEmail}) has requested a booking with you.</p>
            ${message ? `<p><strong>Message:</strong> ${message}</p>` : ""}
            ${datePref ? `<p><strong>Preferred date:</strong> ${datePref}</p>` : ""}
            <p>They will receive a confirmation email. Once they verify, the booking will appear in your ConXion messages.</p>
            <p style="font-size:12px;color:#64748b">You can also reply directly to this email to reach them.</p>
          </div>
        `,
        text: `New booking inquiry from ${guestName} (${guestEmail}).\n\n${message ? `Message: ${message}\n` : ""}${datePref ? `Preferred date: ${datePref}\n` : ""}\nThey will receive a confirmation email shortly.`,
        idempotencyKey: `guest-booking-teacher-${token}`,
      });
    }
  }

  return NextResponse.json({ ok: true, message: "Check your email to confirm your booking." });
}
