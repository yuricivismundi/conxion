import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import {
  durationMinutesFromTimeRange,
  formatShortDate,
  formatShortTime,
  isDateWithinNextThreeMonths,
} from "@/lib/teacher-bookings";
import { hasTeacherBadgeRole } from "@/lib/teacher-info/roles";
import { canUseTeacherProfile } from "@/lib/teacher-profile/access";
import { isPaymentVerified } from "@/lib/verification";

export const runtime = "nodejs";

type AvailabilitySlot = {
  availabilityId: string;
  teacherId: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number | null;
  note: string | null;
  dateLabel: string;
  timeLabel: string;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const teacherId = url.searchParams.get("teacherId")?.trim() ?? "";
    if (!teacherId) return NextResponse.json({ ok: false, error: "teacherId is required." }, { status: 400 });

    const service = getSupabaseServiceClient();
    const profileRes = await service
      .from("profiles")
      .select("user_id,roles,verified,verified_label")
      .eq("user_id", teacherId)
      .maybeSingle();
    if (profileRes.error || !profileRes.data) {
      return NextResponse.json({ ok: false, error: "Teacher not found." }, { status: 404 });
    }

    const roles = Array.isArray((profileRes.data as { roles?: unknown }).roles)
      ? ((profileRes.data as { roles?: unknown }).roles as unknown[]).filter((item): item is string => typeof item === "string")
      : [];
    if (!hasTeacherBadgeRole(roles)) {
      return NextResponse.json({ ok: false, error: "Teacher not found." }, { status: 404 });
    }

    const teacherProfileRes = await service
      .from("teacher_profiles")
      .select("user_id,teacher_profile_enabled,teacher_profile_trial_ends_at,is_public")
      .eq("user_id", teacherId)
      .maybeSingle();
    const teacherProfile = (teacherProfileRes.data ?? null) as {
      teacher_profile_enabled?: boolean;
      teacher_profile_trial_ends_at?: string | null;
      is_public?: boolean;
    } | null;

    if (
      !teacherProfile ||
      teacherProfile.is_public !== true ||
      !canUseTeacherProfile({
        roles,
        teacherProfileEnabled: teacherProfile.teacher_profile_enabled === true,
        trialEndsAt: typeof teacherProfile.teacher_profile_trial_ends_at === "string" ? teacherProfile.teacher_profile_trial_ends_at : null,
        isVerified: isPaymentVerified(profileRes.data as Record<string, unknown>),
      })
    ) {
      return NextResponse.json({ ok: false, error: "Teacher booking is not available for this profile." }, { status: 400 });
    }

    const availabilityRes = await service
      .from("teacher_session_availability")
      .select("id,teacher_id,availability_date,start_time,end_time,is_available,note")
      .eq("teacher_id", teacherId)
      .eq("is_available", true)
      .order("availability_date", { ascending: true })
      .order("start_time", { ascending: true });
    if (availabilityRes.error) throw availabilityRes.error;

    const acceptedRes = await service
      .from("teacher_session_bookings")
      .select("availability_id")
      .eq("teacher_id", teacherId)
      .eq("status", "accepted");
    if (acceptedRes.error) throw acceptedRes.error;

    const acceptedIds = new Set(
      ((acceptedRes.data ?? []) as Array<{ availability_id?: string | null }>)
        .map((row) => row.availability_id)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    );

    const slots: AvailabilitySlot[] = ((availabilityRes.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => {
        const availabilityId = asString(row.id).trim();
        const date = asString(row.availability_date).trim();
        const startTime = asString(row.start_time).trim();
        const endTime = asString(row.end_time).trim();
        if (!availabilityId || !date || !startTime || !endTime) return null;
        if (!isDateWithinNextThreeMonths(date)) return null;
        if (acceptedIds.has(availabilityId)) return null;
        return {
          availabilityId,
          teacherId,
          date,
          startTime,
          endTime,
          duration: durationMinutesFromTimeRange(startTime, endTime),
          note: typeof row.note === "string" && row.note.trim() ? row.note.trim() : null,
          dateLabel: formatShortDate(date),
          timeLabel: `${formatShortTime(startTime)} - ${formatShortTime(endTime)}`,
        } satisfies AvailabilitySlot;
      })
      .filter((slot): slot is AvailabilitySlot => Boolean(slot));

    return NextResponse.json({ ok: true, slots });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not load booking availability." },
      { status: 500 }
    );
  }
}
