import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@supabase/supabase-js";
import Nav from "@/components/Nav";
import { resolveAvatarUrl } from "@/lib/avatar-storage";
import { hasTeacherBadgeRole } from "@/lib/teacher-info/roles";
import TeacherBookingCalendar from "@/components/teacher/TeacherBookingCalendar";
import TeacherHeroActions from "@/components/teacher/TeacherHeroActions";
import { canUseTeacherProfile } from "@/lib/teacher-profile/access";
import { isPaymentVerified } from "@/lib/verification";
import {
  normalizeTeacherInfoBlockRow,
  type TeacherInfoBlock,
} from "@/lib/teacher-info/types";
import { normalizeProfileMediaRow, sortProfileMedia } from "@/lib/profile-media/types";
import type { ProfileMediaItem } from "@/lib/profile-media/types";
import TeacherExperiencesSection from "@/components/teacher/TeacherExperiencesSection";

// ---------------------------------------------------------------------------
// Supabase helper (public anon client — reads public data only)
// ---------------------------------------------------------------------------

function getSupabasePublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase configuration");
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TeacherProfile = {
  user_id: string;
  headline: string | null;
  bio: string | null;
  availability_summary: string | null;
  teacher_profile_enabled: boolean;
  teacher_profile_trial_started_at: string | null;
  teacher_profile_trial_ends_at: string | null;
  is_public: boolean;
  base_city: string | null;
  base_address: string | null;
  base_country: string | null;
  base_school: string | null;
  travel_available: boolean;
  languages: string[] | null;
};

type RegularClass = {
  id: string;
  title: string;
  style: string | null;
  level: string | null;
  venue_name: string | null;
  city: string | null;
  country: string | null;
  weekday: number | null;
  start_time: string | null;
  duration_min: number | null;
  notes: string | null;
  position: number;
};

type EventTeaching = {
  id: string;
  event_name: string;
  role: string | null;
  city: string | null;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEKDAY_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function formatTime(timeStr: string | null): string {
  if (!timeStr) return "";
  const [hourStr, minuteStr] = timeStr.split(":");
  const hour = parseInt(hourStr, 10);
  const minute = minuteStr ?? "00";
  if (isNaN(hour)) return timeStr;
  const suffix = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return minute === "00" ? `${displayHour}${suffix}` : `${displayHour}:${minute}${suffix}`;
}

function formatEventDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date
    .toLocaleDateString("en-US", { month: "short", year: "numeric" })
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Params = { id: string };

export default async function TeacherProfilePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;

  let supabase: ReturnType<typeof getSupabasePublicClient>;
  try {
    supabase = getSupabasePublicClient();
  } catch {
    redirect(`/profile/${id}`);
  }

  // ── 1. Fetch profile row ────────────────────────────────────────────────
  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, username, display_name, avatar_url, roles, city, country, verified, verified_label")
    .eq("user_id", id)
    .maybeSingle();

  if (profileError || !profileRow) {
    redirect(`/profile/${id}`);
  }

  // Access check: must have teacher badge role
  const roles: string[] = Array.isArray(profileRow.roles) ? profileRow.roles : [];
  if (!hasTeacherBadgeRole(roles)) {
    redirect(`/profile/${id}`);
  }

  // ── 2. Fetch teacher_profiles row ───────────────────────────────────────
  let teacherProfile: TeacherProfile | null = null;
  try {
    const { data, error } = await supabase
      .from("teacher_profiles")
      .select("*")
      .eq("user_id", id)
      .maybeSingle();

    if (!error && data) {
      teacherProfile = data as TeacherProfile;
    }
  } catch {
    // Table may not exist yet — treat as no teacher profile
  }

  const isVerified = isPaymentVerified(profileRow as Record<string, unknown>);
  if (
    !teacherProfile ||
    !teacherProfile.is_public ||
    !canUseTeacherProfile({
      roles,
      teacherProfileEnabled: teacherProfile.teacher_profile_enabled,
      trialEndsAt: teacherProfile.teacher_profile_trial_ends_at,
      isVerified,
    })
  ) {
    redirect(`/profile/${id}`);
  }

  // ── 3–7. Parallel fetches ───────────────────────────────────────────────
  const [
    infoBlocksResult,
    regularClassesResult,
    eventTeachingResult,
    profileMediaResult,
  ] = await Promise.allSettled([
    supabase
      .from("teacher_info_blocks")
      .select("*")
      .eq("user_id", id)
      .eq("is_active", true),
    supabase
      .from("teacher_regular_classes")
      .select("*")
      .eq("user_id", id)
      .eq("is_active", true)
      .order("position", { ascending: true }),
    supabase
      .from("teacher_event_teaching")
      .select("*")
      .eq("user_id", id)
      .eq("is_active", true)
      .order("start_date", { ascending: false, nullsFirst: false }),
    supabase
      .from("profile_media")
      .select("*")
      .eq("user_id", id)
      .eq("status", "ready"),
  ]);

  const infoBlocks: TeacherInfoBlock[] =
    infoBlocksResult.status === "fulfilled" && infoBlocksResult.value.data
      ? infoBlocksResult.value.data
          .map((row) => normalizeTeacherInfoBlockRow(row))
          .filter((b): b is TeacherInfoBlock => b !== null)
      : [];

  const regularClasses: RegularClass[] =
    regularClassesResult.status === "fulfilled" && regularClassesResult.value.data
      ? (regularClassesResult.value.data as RegularClass[])
      : [];

  const eventTeaching: EventTeaching[] =
    eventTeachingResult.status === "fulfilled" && eventTeachingResult.value.data
      ? (eventTeachingResult.value.data as EventTeaching[])
      : [];

  const profileMedia: ProfileMediaItem[] =
    profileMediaResult.status === "fulfilled" && profileMediaResult.value.data
      ? sortProfileMedia(
          profileMediaResult.value.data
            .map((row) => normalizeProfileMediaRow(row))
            .filter((item): item is ProfileMediaItem => item !== null)
        )
      : [];

  // ── Derived values ───────────────────────────────────────────────────────
  const displayName: string = profileRow.display_name ?? "Unknown";
  const avatarUrl = resolveAvatarUrl({ avatarUrl: profileRow.avatar_url });
  const socialProfileHref =
    typeof profileRow.username === "string" && profileRow.username.trim().length > 0
      ? `/u/${encodeURIComponent(profileRow.username)}?view=social`
      : `/profile/${id}?view=social`;
  const languages: string[] = Array.isArray(teacherProfile?.languages)
    ? teacherProfile.languages!
    : [];

  return (
    <div className="min-h-screen bg-[#0e0e0e] text-white overflow-x-hidden">
      <Nav />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 pb-24">

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-12 mb-24">
          {/* Left: photo */}
          <div className="lg:col-span-5">
            <div className="relative">
              {/* Outer neon glow blur */}
              <div className="absolute inset-0 rounded-[22px] bg-gradient-to-br from-[#9333ea]/30 to-[#ff51fa]/40 blur-2xl -z-10 scale-110" />

              {/* Gradient border wrapper */}
              <div className="relative rounded-[20px] p-[2px] bg-gradient-to-br from-zinc-800/20 via-[#9333ea]/60 to-[#ff51fa]/80">
                <div className="rounded-[18px] overflow-hidden">
                  {avatarUrl ? (
                    <Image
                      src={avatarUrl}
                      alt={displayName}
                      width={600}
                      height={520}
                      className="w-full h-[520px] object-cover"
                      priority
                    />
                  ) : (
                    <div className="w-full h-[520px] bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center">
                      <span className="text-8xl font-black text-zinc-600">
                        {displayName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Verified badge overlay */}
                {isVerified && (
                  <div className="absolute -bottom-4 -right-4 bg-zinc-900/90 backdrop-blur-xl px-4 py-3 rounded-xl flex items-center gap-3 border border-white/10 z-20">
                    <div className="w-10 h-10 rounded-full bg-[#c1fffe]/10 flex items-center justify-center">
                      <span
                        className="material-symbols-outlined text-[#c1fffe]"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        verified
                      </span>
                    </div>
                    <div>
                      <p className="font-bold text-white text-xs uppercase tracking-[0.15em]">VERIFIED</p>
                      <p className="text-zinc-400 text-[10px]">Elite Tier Teacher</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: info */}
          <div className="lg:col-span-7 flex flex-col justify-center">
            {/* Teacher badge pill */}
            <span className="inline-flex w-fit px-3 py-1 rounded-full bg-zinc-800 text-[#c1fffe] text-[10px] uppercase font-bold tracking-[0.2em]">
              TEACHER
            </span>

            {/* Name */}
            <h1 className="font-black text-5xl sm:text-6xl lg:text-7xl tracking-tighter text-white mt-4 leading-none">
              {displayName}
            </h1>

            {/* Headline */}
            {teacherProfile?.headline && (
              <p className="text-xl sm:text-2xl text-zinc-400 italic mt-2">
                {teacherProfile.headline}
              </p>
            )}

            {/* Location + languages */}
            {(profileRow.city || profileRow.country || languages.length > 0) && (
              <div className="flex flex-wrap gap-8 mt-6 text-zinc-300 text-sm">
                {(profileRow.city || profileRow.country) && (
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[#c1fffe] text-lg">location_on</span>
                    {[profileRow.city, profileRow.country].filter(Boolean).join(", ")}
                  </span>
                )}
                {languages.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[#ff51fa] text-lg">translate</span>
                    {languages.join(", ")}
                  </span>
                )}
              </div>
            )}

            {/* CTA buttons */}
            <TeacherHeroActions
              userId={id}
              displayName={displayName}
              avatarUrl={avatarUrl}
            />

            {/* View social profile link */}
            <div className="mt-4">
              <Link
                href={socialProfileHref}
                className="inline-flex min-h-[44px] items-center gap-1 text-xs font-semibold uppercase tracking-widest text-[#0df2f2] opacity-70 hover:opacity-100 transition-opacity w-fit"
              >
                Social Profile
                <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              </Link>
            </div>
          </div>
        </section>

        {/* ── Experiences + Videos (tabbed) ───────────────────────────────── */}
        <TeacherExperiencesSection
          infoBlocks={infoBlocks}
          videos={profileMedia.filter((m) => m.kind === "video")}
        />

        <TeacherBookingCalendar teacherUserId={id} teacherName={displayName} />

        {/* ── Weekly Classes ──────────────────────────────────────────────── */}
        <section className="mb-24">
          <div className="mb-12">
            <h2 className="font-black text-4xl tracking-tighter text-white">Weekly Classes</h2>
            <p className="text-zinc-500 mt-3">Ongoing group classes open for enrollment.</p>
          </div>
          {regularClasses.length === 0 ? (
            <div className="border border-white/5 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-3 text-center">
              <span className="material-symbols-outlined text-zinc-700 text-4xl">calendar_month</span>
              <p className="text-zinc-600 text-sm">No weekly classes listed yet.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {regularClasses.map((cls) => (
                <div
                  key={cls.id}
                  className="bg-zinc-900/40 backdrop-blur-xl flex flex-col md:flex-row items-start md:items-center justify-between p-6 rounded-2xl group hover:bg-zinc-900/60 transition-colors border border-white/5"
                >
                  <div className="flex items-center gap-10">
                    <div className="text-center min-w-[64px]">
                      <p className="font-black text-2xl text-[#c1fffe]">
                        {cls.weekday != null ? WEEKDAY_SHORT[cls.weekday] : "–"}
                      </p>
                      <p className="text-xs text-zinc-500 font-bold uppercase">
                        {formatTime(cls.start_time)}
                      </p>
                    </div>
                    <div>
                      <h4 className="font-bold text-xl mb-1 text-white">{cls.title}</h4>
                      {(cls.venue_name || cls.city || cls.country) && (
                        <div className="flex items-center gap-1.5 text-zinc-500">
                          <span className="material-symbols-outlined text-sm">location_on</span>
                          <p className="text-sm">
                            {[cls.venue_name, cls.city, cls.country].filter(Boolean).join(", ")}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-4 md:mt-0">
                    {cls.style && (
                      <span className="px-3 py-1 rounded-full bg-zinc-800 text-zinc-400 text-[10px] font-bold uppercase tracking-widest">
                        {cls.style}
                      </span>
                    )}
                    {cls.level && (
                      <span className="px-3 py-1 rounded-full bg-zinc-800 text-zinc-400 text-[10px] font-bold uppercase tracking-widest">
                        {cls.level}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Global Stage Presence (event teaching) ───────────────────────── */}
        <section className="mb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
            <div className="lg:col-span-4">
              <h2 className="font-black text-5xl tracking-tighter leading-none mb-6 text-white">
                Global<br />Stage<br />Presence
              </h2>
              <p className="text-zinc-500 leading-relaxed">
                Representing the pinnacle of dance at the world&apos;s most prestigious festivals and congresses.
              </p>
            </div>
            <div className="lg:col-span-8 space-y-10 relative">
              {eventTeaching.length === 0 ? (
                <div className="border border-white/5 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-3 text-center">
                  <span className="material-symbols-outlined text-zinc-700 text-4xl">public</span>
                  <p className="text-zinc-600 text-sm">No events listed yet.</p>
                </div>
              ) : (
                <>
                  {/* Vertical gradient line */}
                  <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-[#c1fffe]/50 to-transparent" />
                  {eventTeaching.map((event, i) => (
                    <div key={event.id} className="pl-10 relative">
                      <div
                        className={`absolute left-[-5px] top-1 w-2.5 h-2.5 rounded-full ${
                          i === 0
                            ? "bg-[#c1fffe] shadow-[0_0_10px_#c1fffe]"
                            : "bg-zinc-800"
                        }`}
                      />
                      <p
                        className={`font-black text-xs tracking-[0.2em] uppercase mb-2 ${
                          i === 0 ? "text-[#ff51fa]" : "text-zinc-600"
                        }`}
                      >
                        {formatEventDate(event.start_date)}
                      </p>
                      <h4 className="text-2xl font-bold text-white mb-1">{event.event_name}</h4>
                      <p className="text-zinc-500 italic mb-3">
                        {[event.city, event.country].filter(Boolean).join(", ")}
                      </p>
                      {event.role && (
                        <span className="px-3 py-1 rounded bg-zinc-900 text-zinc-400 text-[10px] font-bold uppercase tracking-widest">
                          {event.role}
                        </span>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </section>

        {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-950 via-zinc-900 to-indigo-950/30 p-16 md:p-24 text-center">
          <div className="relative z-10">
            <h2 className="font-black text-5xl md:text-6xl tracking-tighter text-white mb-6">
              Elevate Your Movement
            </h2>
            <p className="text-zinc-400 text-lg max-w-xl mx-auto mb-10">
              Whether you are starting your journey or refining a professional career, let&apos;s craft your artistic path together.
            </p>
            <TeacherHeroActions
              userId={id}
              displayName={displayName}
              avatarUrl={avatarUrl}
              variant="cta"
            />
          </div>
          <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-[#c1fffe]/[0.08] rounded-full blur-[100px]" />
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-[#ff51fa]/[0.08] rounded-full blur-[100px]" />
        </section>

      </div>
    </div>
  );
}
