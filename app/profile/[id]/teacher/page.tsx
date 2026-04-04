import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@supabase/supabase-js";
import Nav from "@/components/Nav";
import { resolveAvatarUrl } from "@/lib/avatar-storage";
import { hasTeacherBadgeRole } from "@/lib/teacher-info/roles";
import TeacherHeroActions from "@/components/teacher/TeacherHeroActions";
import {
  TEACHER_INFO_KIND_LABELS,
  normalizeTeacherInfoBlockRow,
  getTeacherInfoTemplateText,
  type TeacherInfoBlock,
  type TeacherInfoBlockKind,
} from "@/lib/teacher-info/types";

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
  is_public: boolean;
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

type WeeklyAvailabilitySlot = {
  id: string;
  weekday: number;
  start_time: string | null;
  end_time: string | null;
  label: string | null;
  is_flexible: boolean;
  note: string | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEKDAY_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

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

function kindToIcon(kind: TeacherInfoBlockKind): string {
  switch (kind) {
    case "private_class":
      return "person_book";
    case "group_class":
      return "groups";
    case "workshop":
      return "school";
    case "show":
      return "theater_comedy";
    case "organizer_collab":
      return "edit_note";
    case "other":
    default:
      return "star";
  }
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
    .select("user_id, display_name, avatar_url, roles, city, country")
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

  // ── 3. Fetch service blocks ─────────────────────────────────────────────
  let infoBlocks: TeacherInfoBlock[] = [];
  try {
    const { data } = await supabase
      .from("teacher_info_blocks")
      .select("*")
      .eq("user_id", id)
      .eq("is_active", true);
    if (data) {
      infoBlocks = data
        .map((row) => normalizeTeacherInfoBlockRow(row))
        .filter((b): b is TeacherInfoBlock => b !== null);
    }
  } catch {
    // Non-fatal
  }

  // ── 4. Fetch regular classes ────────────────────────────────────────────
  let regularClasses: RegularClass[] = [];
  try {
    const { data } = await supabase
      .from("teacher_regular_classes")
      .select("*")
      .eq("user_id", id)
      .eq("is_active", true)
      .order("position", { ascending: true });
    if (data) regularClasses = data as RegularClass[];
  } catch {
    // Non-fatal
  }

  // ── 5. Fetch event teaching ─────────────────────────────────────────────
  let eventTeaching: EventTeaching[] = [];
  try {
    const { data } = await supabase
      .from("teacher_event_teaching")
      .select("*")
      .eq("user_id", id)
      .eq("is_active", true)
      .order("start_date", { ascending: false, nullsFirst: false });
    if (data) eventTeaching = data as EventTeaching[];
  } catch {
    // Non-fatal
  }

  // ── 6. Fetch weekly availability ────────────────────────────────────────
  let weeklyAvailability: WeeklyAvailabilitySlot[] = [];
  try {
    const { data } = await supabase
      .from("teacher_weekly_availability")
      .select("*")
      .eq("user_id", id)
      .order("weekday")
      .order("start_time");
    if (data) weeklyAvailability = data as WeeklyAvailabilitySlot[];
  } catch {
    // Non-fatal
  }

  // ── Derived values ───────────────────────────────────────────────────────
  const isVerified = roles.includes("verified");
  const displayName: string = profileRow.display_name ?? "Unknown";
  const avatarUrl = resolveAvatarUrl({ avatarUrl: profileRow.avatar_url });
  const languages: string[] = Array.isArray(teacherProfile?.languages)
    ? teacherProfile.languages!
    : [];

  // Group availability by weekday (0=Sun … 6=Sat)
  const availByDay: Record<number, WeeklyAvailabilitySlot[]> = {};
  for (const slot of weeklyAvailability) {
    if (!availByDay[slot.weekday]) availByDay[slot.weekday] = [];
    availByDay[slot.weekday].push(slot);
  }

  // Ordered Mon–Sun (1,2,3,4,5,6,0)
  const DISPLAY_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  return (
    <div className="min-h-screen bg-[#0e0e0e] text-white">
      <Nav />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 pb-24">

        {/* ── View switcher ───────────────────────────────────────────────── */}
        <div className="mb-10 flex items-center gap-3">
          <Link
            href={`/profile/${id}`}
            className="px-4 py-2 rounded-full border border-zinc-700 text-zinc-400 text-xs uppercase font-bold tracking-[0.2em] hover:border-zinc-500 hover:text-zinc-300 transition-all"
          >
            Social Profile
          </Link>
          <span className="px-4 py-2 rounded-full bg-[#c1fffe]/10 border border-[#c1fffe]/30 text-[#c1fffe] text-xs uppercase font-bold tracking-[0.2em]">
            Teacher Profile
          </span>
        </div>

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
                href={`/profile/${id}`}
                className="text-zinc-600 hover:text-zinc-400 text-xs uppercase tracking-widest flex items-center gap-1 transition-colors w-fit"
              >
                Social Profile
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              </Link>
            </div>
          </div>
        </section>

        {/* ── Curated Experiences (info blocks) ───────────────────────────── */}
        <section className="mb-24">
          <div className="mb-12">
            <h2 className="font-black text-4xl tracking-tighter text-white">Curated Experiences</h2>
            <p className="text-zinc-500 mt-3 max-w-lg">
              Bespoke training programs designed for rapid growth and artistic development.
            </p>
          </div>
          {infoBlocks.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(["private_class", "group_class", "workshop"] as TeacherInfoBlockKind[]).map((kind) => (
                <div key={kind} className="bg-zinc-900/20 backdrop-blur-2xl p-8 rounded-2xl border border-white/5 border-dashed flex flex-col items-center justify-center gap-4 min-h-[200px]">
                  <span className="material-symbols-outlined text-zinc-700 text-4xl">{kindToIcon(kind)}</span>
                  <p className="text-zinc-700 text-sm font-bold uppercase tracking-widest">{TEACHER_INFO_KIND_LABELS[kind]}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {infoBlocks.map((block) => {
                const bodyText = getTeacherInfoTemplateText(block);
                const priceText = block.contentJson.priceText;
                const ctaText = block.contentJson.ctaText;
                return (
                  <div
                    key={block.id}
                    className="bg-zinc-900/40 backdrop-blur-2xl p-8 rounded-2xl hover:-translate-y-2 transition-all duration-500 group border border-white/5"
                  >
                    <span className="material-symbols-outlined text-[#c1fffe] text-4xl mb-6 group-hover:scale-110 transition-transform block">
                      {kindToIcon(block.kind)}
                    </span>
                    <h3 className="font-bold text-xl mb-3 text-white">{block.title}</h3>
                    {bodyText && (
                      <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                        {bodyText.slice(0, 150)}
                        {bodyText.length > 150 ? "…" : ""}
                      </p>
                    )}
                    {priceText && (
                      <p className="text-[#ff51fa] font-black text-xl tracking-tighter">{priceText}</p>
                    )}
                    {ctaText && !priceText && (
                      <p className="text-[#ff51fa] font-black text-xl tracking-tighter">{ctaText}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Private Class Availability (weekly availability) ─────────────── */}
        <div className="bg-zinc-950 p-10 rounded-2xl mb-24">
          <div className="mb-8">
            <h2 className="font-black text-4xl tracking-tighter text-white">Private Class Availability</h2>
            <p className="text-zinc-500 mt-3">Weekly schedule for private sessions.</p>
          </div>
          <div className="grid grid-cols-7 gap-3">
            {DISPLAY_DAY_ORDER.map((dayIndex) => {
              const slots = availByDay[dayIndex] ?? [];
              return (
                <div key={dayIndex} className="flex flex-col gap-2">
                  <p className="uppercase tracking-widest text-zinc-500 text-[10px] font-bold text-center mb-1">
                    {WEEKDAY_SHORT[dayIndex]}
                  </p>
                  {slots.length === 0 ? (
                    <div className="h-8 rounded-lg bg-zinc-900/30 border border-transparent" />
                  ) : (
                    slots.map((slot) => (
                      <span
                        key={slot.id}
                        className={`px-2 py-1.5 rounded-lg text-[10px] font-bold text-center leading-tight ${
                          slot.is_flexible || slot.label
                            ? "text-[#c1fffe] bg-[#c1fffe]/5 border border-[#c1fffe]/20"
                            : "bg-zinc-900/50 text-zinc-400 border border-transparent"
                        }`}
                      >
                        {slot.label ?? (slot.is_flexible ? "Flexible" : formatTime(slot.start_time))}
                      </span>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Weekly Studio Classes ────────────────────────────────────────── */}
        <section className="mb-24">
          <div className="mb-12">
            <h2 className="font-black text-4xl tracking-tighter text-white">Weekly Studio Classes</h2>
            <p className="text-zinc-500 mt-3">Ongoing group classes open for enrollment.</p>
          </div>
          {regularClasses.length === 0 ? (
            <div className="border border-white/5 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-3 text-center">
              <span className="material-symbols-outlined text-zinc-700 text-4xl">calendar_month</span>
              <p className="text-zinc-600 text-sm">No regular classes listed yet.</p>
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
