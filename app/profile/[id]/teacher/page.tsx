import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@supabase/supabase-js";
import Nav from "@/components/Nav";
import { resolveAvatarUrl } from "@/lib/avatar-storage";
import type { Metadata } from "next";
import { canUseTeacherProfile, isTeacherProfileEligible } from "@/lib/teacher-profile/access";
import { DANCE_PAGE_NAME, dancePagePath, resolveDancePageLabel, showsTeachingSections } from "@/lib/dance-page";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { readPublicAppUrl } from "@/lib/public-app-url";
import TeacherBookingCalendar from "@/components/teacher/TeacherBookingCalendar";
import TeacherHeroActions from "@/components/teacher/TeacherHeroActions";
import { isPaymentVerified } from "@/lib/verification";
import {
  normalizeTeacherInfoBlockRow,
  type TeacherInfoBlock,
} from "@/lib/teacher-info/types";
import { normalizeProfileMediaRow, sortProfileMedia } from "@/lib/profile-media/types";
import type { ProfileMediaItem } from "@/lib/profile-media/types";
import TeacherExperiencesSection from "@/components/teacher/TeacherExperiencesSection";
import TeacherOwnerActions from "@/components/teacher/TeacherOwnerActions";
import ProfileSettingsMenu from "@/components/teacher/ProfileSettingsMenu";
import ShareTeacherProfileButton from "@/components/teacher/ShareTeacherProfileButton";
import TeacherReferencesSection from "@/components/teacher/TeacherReferencesSection";

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
  page_label?: string | null;
};

type UpcomingEvent = {
  id: string;
  title: string;
  event_type: string | null;
  city: string | null;
  country: string | null;
  starts_at: string;
  is_host: boolean;
};

type Competition = {
  id: string;
  event_name: string;
  city: string | null;
  country: string | null;
  style: string;
  division: string;
  role: string;
  result: string;
  year: number;
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

type TeacherReference = {
  id: string;
  client_name: string;
  client_context: string | null;
  testimonial: string;
  rating: number | null;
  reference_year: number | null;
  sort_order?: number;
  verified: boolean;
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

function formatUpcomingDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
}

/**
 * Upcoming public events the member hosts or attends, plus their competition
 * history. These tables are private by RLS, so they are read with the service
 * client and only for members whose Dance Page is public.
 */
async function fetchDancePageActivity(userId: string): Promise<{ upcoming: UpcomingEvent[]; competitions: Competition[] }> {
  try {
    const service = getSupabaseServiceClient();
    const nowIso = new Date().toISOString();
    const [membersRes, hostedRes, competitionsRes] = await Promise.all([
      service
        .from("event_members")
        .select("event_id,status")
        .eq("user_id", userId)
        .in("status", ["host", "going"]),
      service
        .from("events")
        .select("id")
        .eq("host_user_id", userId)
        .gte("starts_at", nowIso),
      service
        .from("dance_competitions_user")
        .select("id,event_name,city,country,style,division,role,result,year")
        .eq("user_id", userId)
        .order("year", { ascending: false })
        .limit(30),
    ]);

    const hostIds = new Set<string>((hostedRes.data ?? []).map((r: { id: string }) => r.id));
    for (const row of (membersRes.data ?? []) as Array<{ event_id: string; status: string }>) {
      if (row.status === "host") hostIds.add(row.event_id);
    }
    const eventIds = Array.from(
      new Set<string>([...hostIds, ...((membersRes.data ?? []) as Array<{ event_id: string }>).map((r) => r.event_id)])
    );

    let upcoming: UpcomingEvent[] = [];
    if (eventIds.length > 0) {
      const eventsRes = await service
        .from("events")
        .select("id,title,event_type,city,country,starts_at,status,hidden_by_admin,event_access_type")
        .in("id", eventIds)
        .eq("status", "published")
        .in("event_access_type", ["public", "request"])
        .gte("starts_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(12);
      upcoming = ((eventsRes.data ?? []) as Array<Record<string, unknown>>)
        .filter((e) => e.hidden_by_admin !== true)
        .map((e) => ({
          id: String(e.id),
          title: String(e.title ?? "Event"),
          event_type: typeof e.event_type === "string" ? e.event_type : null,
          city: typeof e.city === "string" ? e.city : null,
          country: typeof e.country === "string" ? e.country : null,
          starts_at: String(e.starts_at),
          is_host: hostIds.has(String(e.id)),
        }));
    }

    return { upcoming, competitions: (competitionsRes.data ?? []) as Competition[] };
  } catch {
    return { upcoming: [], competitions: [] };
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Params = { id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const supabase = getSupabasePublicClient();
    const [{ data: profile }, { data: page }] = await Promise.all([
      supabase.from("profiles").select("display_name,avatar_url,roles,city,country,username").eq("user_id", id).maybeSingle(),
      supabase.from("teacher_profiles").select("*").eq("user_id", id).maybeSingle(),
    ]);
    if (!profile?.display_name) return { title: `${DANCE_PAGE_NAME} — ConXion` };
    const label = resolveDancePageLabel((page as TeacherProfile | null)?.page_label, profile.roles as string[] | null);
    const name = String(profile.display_name);
    const location = [profile.city, profile.country].filter(Boolean).join(", ");
    const title = `${name} · ${label} — ConXion`;
    const headline = (page as TeacherProfile | null)?.headline;
    const description = headline
      ? headline.slice(0, 160)
      : `${name}${location ? ` · ${location}` : ""}. Upcoming events, competitions and dance journey on ConXion.`;
    const avatarUrl = resolveAvatarUrl({ avatarUrl: profile.avatar_url as string | null });
    const images = avatarUrl ? [{ url: avatarUrl, width: 400, height: 400, alt: name }] : [];
    return {
      title,
      description,
      alternates: { canonical: `${readPublicAppUrl()}${dancePagePath({ username: profile.username as string | null, userId: id })}` },
      openGraph: { title, description, images, type: "profile" },
      twitter: { card: "summary", title, description, images: images.map((i) => i.url) },
    };
  } catch {
    return { title: `${DANCE_PAGE_NAME} — ConXion` };
  }
}

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

  // Access check: Dance Page eligibility (any member during early access)
  const roles: string[] = Array.isArray(profileRow.roles) ? profileRow.roles : [];
  if (!isTeacherProfileEligible(roles)) {
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
    manualRefsResult,
    verifiedRefsResult,
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
    supabase
      .from("teacher_references")
      .select("id,client_name,client_context,testimonial,rating,reference_year,sort_order")
      .eq("teacher_user_id", id)
      .eq("is_public", true)
      .eq("status", "published")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("references")
      .select("id,reference_from_user_id,reference_context_tag,reference_content,rating,created_at,profiles!reference_from_user_id(display_name)")
      .eq("reference_to_user_id", id)
      .order("created_at", { ascending: false }),
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

  const manualRefs: TeacherReference[] =
    manualRefsResult.status === "fulfilled" && manualRefsResult.value.data
      ? (manualRefsResult.value.data as any[]).map((r) => ({ ...r, verified: false }))
      : [];

  const verifiedRefs: TeacherReference[] =
    verifiedRefsResult.status === "fulfilled" && verifiedRefsResult.value.data
      ? (verifiedRefsResult.value.data as any[]).map((r) => ({
          id: r.id,
          client_name: (r.profiles as any)?.display_name ?? "Member",
          client_context: r.reference_context_tag ?? null,
          testimonial: r.reference_content ?? "",
          rating: typeof r.rating === "number" ? r.rating : null,
          reference_year: r.created_at ? new Date(r.created_at).getFullYear() : null,
          verified: true,
        }))
      : [];

  const teacherReferences: TeacherReference[] = [...verifiedRefs, ...manualRefs];

  const { upcoming: upcomingEvents, competitions } = await fetchDancePageActivity(id);
  const pageLabel = resolveDancePageLabel(teacherProfile.page_label, roles);
  const showTeaching = showsTeachingSections(pageLabel, roles);
  const showStagePresence = eventTeaching.length > 0 || showTeaching || pageLabel === "Artist" || pageLabel === "Performer" || pageLabel === "DJ";

  // ── Derived values ───────────────────────────────────────────────────────
  const displayName: string = profileRow.display_name ?? "Unknown";
  const avatarUrl = resolveAvatarUrl({ avatarUrl: profileRow.avatar_url });
  const socialProfileHref =
    typeof profileRow.username === "string" && profileRow.username.trim().length > 0
      ? `/u/${encodeURIComponent(profileRow.username)}`
      : `/profile/${id}`;
  const languages: string[] = Array.isArray(teacherProfile?.languages)
    ? teacherProfile.languages!
    : [];

  return (
    <div className="min-h-screen bg-[#0e0e0e] text-white overflow-x-hidden">
      <Nav />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 pb-32 md:pb-24">

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="relative grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-10 lg:gap-12 mb-12 sm:mb-20 lg:mb-24">
          {/* Share + Switch Profile - Top right of hero section (desktop) */}
          <div className="hidden lg:flex items-center gap-2 absolute top-0 right-0 z-30">
            <ShareTeacherProfileButton displayName={displayName} size="compact" />
            <TeacherOwnerActions profileUserId={id} socialProfileHref={socialProfileHref} size="compact" />
          </div>

          {/* Left: photo */}
          <div className="lg:col-span-5">
            {/* Share + Switcher row (mobile only) */}
            <div className="flex items-center justify-end mb-2 lg:hidden">
              <div className="flex items-center gap-2">
                <ShareTeacherProfileButton displayName={displayName} size="compact" />
                <TeacherOwnerActions profileUserId={id} socialProfileHref={socialProfileHref} size="compact" />
              </div>
            </div>

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
                      className="w-full h-[340px] sm:h-[440px] lg:h-[520px] object-cover"
                      priority
                    />
                  ) : (
                    <div className="w-full h-[340px] sm:h-[440px] lg:h-[520px] bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center">
                      <span className="text-8xl font-black text-zinc-600">
                        {displayName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Verified badge overlay */}
                {isVerified && (
                  <div className="absolute -bottom-4 -right-4 z-20 flex items-center gap-2.5 rounded-2xl border border-white/10 bg-zinc-900/90 px-4 py-2.5 backdrop-blur-xl"
                    style={{ boxShadow: "0 0 18px rgba(0,245,255,0.18), 0 0 6px rgba(255,0,255,0.12)" }}>
                    <span
                      className="material-symbols-outlined text-[22px]"
                      style={{ fontVariationSettings: "'FILL' 1", background: "linear-gradient(135deg,#00F5FF,#FF00FF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
                    >
                      verified
                    </span>
                    <p className="bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] bg-clip-text text-xs font-black uppercase tracking-[0.18em] text-transparent">
                      Verified
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: info */}
          <div className="lg:col-span-7 flex flex-col justify-center">
            {/* Page label (Teacher, Artist, DJ, …) */}
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[#ff51fa]/30 bg-[#ff51fa]/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-[#ffb3fb]">
              <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
              {pageLabel}
            </span>

            {/* Name */}
            <h1 className="font-black text-4xl sm:text-6xl lg:text-7xl tracking-tighter text-white mt-3 lg:mt-4 leading-none">
              {displayName}
            </h1>

            {/* Headline */}
            {teacherProfile?.headline && (
              <p className="text-xl sm:text-2xl text-zinc-400 italic mt-2">
                {teacherProfile.headline}
              </p>
            )}

            {/* Location */}
            {(profileRow.city || profileRow.country) && (
              <div className="flex flex-wrap gap-8 mt-6 text-zinc-300 text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[#c1fffe] text-lg">location_on</span>
                  {[profileRow.city, profileRow.country].filter(Boolean).join(", ")}
                </span>
              </div>
            )}

            {/* CTA buttons */}
            {showTeaching ? (
              <TeacherHeroActions
                userId={id}
                displayName={displayName}
                avatarUrl={avatarUrl}
              />
            ) : (
              <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 pt-6">
                <Link
                  href={socialProfileHref}
                  className="bg-gradient-to-r from-[#c1fffe] to-[#ff51fa] text-zinc-900 px-8 py-4 rounded-full font-black uppercase text-sm tracking-widest flex items-center justify-center gap-2 hover:scale-105 transition-transform shadow-[0_0_30px_rgba(193,255,254,0.3)]"
                >
                  Connect on ConXion
                  <span className="material-symbols-outlined text-[18px]">person_add</span>
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* ── Biography · Videos (tabbed) + Services + Booking ───────────── */}
        <TeacherExperiencesSection
          infoBlocks={infoBlocks}
          videos={profileMedia.filter((m) => m.kind === "video")}
          bio={teacherProfile.bio}
          languages={languages}
        />

        {/* ── Upcoming events (where to find them next) ──────────────────────── */}
        <section className="mb-12 sm:mb-24">
          <div className="mb-6 sm:mb-10">
            <h2 className="font-black text-3xl sm:text-4xl tracking-tighter text-white">Where to find me next</h2>
            <p className="mt-2 text-sm text-zinc-500">Upcoming events, socials and festivals on ConXion.</p>
          </div>
          {upcomingEvents.length === 0 ? (
            <div className="border border-white/5 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-3 text-center">
              <span className="material-symbols-outlined text-zinc-700 text-4xl">event_upcoming</span>
              <p className="text-zinc-600 text-sm">No upcoming events yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {upcomingEvents.map((event) => (
                <Link
                  key={event.id}
                  href={`/events/${event.id}`}
                  className="group flex flex-col gap-2 rounded-2xl border border-white/5 bg-zinc-900/40 p-5 transition-colors hover:border-[#c1fffe]/30 hover:bg-zinc-900/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#ff51fa]">{formatUpcomingDate(event.starts_at)}</p>
                    {event.is_host ? (
                      <span className="rounded-full bg-[#c1fffe]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#c1fffe]">Hosting</span>
                    ) : null}
                  </div>
                  <h4 className="text-lg font-bold leading-snug text-white group-hover:text-[#c1fffe]">{event.title}</h4>
                  <p className="text-sm text-zinc-500">
                    {[event.event_type, [event.city, event.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* ── Competition history ──────────────────────────────────────────── */}
        {competitions.length > 0 || pageLabel === "Competitor" ? (
        <section className="mb-12 sm:mb-24">
          <div className="mb-6 sm:mb-10">
            <h2 className="font-black text-3xl sm:text-4xl tracking-tighter text-white">Competitions</h2>
            <p className="mt-2 text-sm text-zinc-500">Results and divisions over the years.</p>
          </div>
          {competitions.length === 0 ? (
            <div className="border border-white/5 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-3 text-center">
              <span className="material-symbols-outlined text-zinc-700 text-4xl">emoji_events</span>
              <p className="text-zinc-600 text-sm">No competitions added yet.</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-white/5 rounded-2xl border border-white/5 bg-zinc-900/30">
              {competitions.map((c) => (
                <div key={c.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <p className="min-w-[52px] font-black text-xl text-[#c1fffe]">{c.year}</p>
                    <div>
                      <h4 className="font-bold text-white">{c.event_name}</h4>
                      <p className="text-sm text-zinc-500">
                        {[c.style, c.division, c.role, [c.city, c.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`w-fit rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                      c.result === "Winner"
                        ? "bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] text-[#071116]"
                        : c.result === "Finalist"
                          ? "bg-[#ff51fa]/15 text-[#ffb3fb]"
                          : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {c.result}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        ) : null}

        {showTeaching ? (
        <>
        {/* ── Private Class Booking ─────────────────────────────────────────── */}
        <section data-tour="tour-book-session" className="mb-12 sm:mb-24">
          <div className="mb-3">
            <h2 className="font-black text-3xl sm:text-4xl tracking-tighter text-white">Session Availability</h2>
            <p className="mt-2 text-sm text-zinc-500">Browse open slots and book a private class directly.</p>
          </div>
          <div>
            <TeacherBookingCalendar teacherUserId={id} teacherName={displayName} />
          </div>
        </section>

        {/* ── Weekly Classes ──────────────────────────────────────────────── */}
        <section className="mb-12 sm:mb-24">
          <div className="mb-8 sm:mb-12">
            <h2 className="font-black text-3xl sm:text-4xl tracking-tighter text-white">Weekly Classes</h2>
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
                  <div className="flex items-center gap-5 sm:gap-10">
                    <div className="text-center min-w-[64px]">
                      <p className="font-black text-2xl text-[#c1fffe]">
                        {cls.weekday != null ? WEEKDAY_SHORT[cls.weekday] : "–"}
                      </p>
                      <p className="text-xs text-zinc-500 font-bold uppercase">
                        {formatTime(cls.start_time)}
                      </p>
                      {cls.duration_min ? (
                        <p className="mt-0.5 text-[10px] text-zinc-600 font-semibold uppercase">
                          {cls.duration_min} min
                        </p>
                      ) : null}
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

        </>
        ) : null}

        {/* ── Stage Presence (festivals taught / performed at) ─────────────── */}
        {showStagePresence ? (
        <section className="mb-12 sm:mb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16">
            <div className="lg:col-span-4">
              <h2 className="font-black text-3xl sm:text-5xl tracking-tighter leading-none mb-4 sm:mb-6 text-white">
                <span className="lg:hidden">Stage Presence</span>
                <span className="hidden lg:inline">Stage<br />Presence</span>
              </h2>
              <p className="text-zinc-500 leading-relaxed">
                Festivals, congresses and stages taught or performed at.
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
        ) : null}

        {/* ── References ───────────────────────────────────────────────────── */}
        <TeacherReferencesSection references={teacherReferences} />

      </div>
    </div>
  );
}
