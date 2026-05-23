"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { cx } from "@/lib/cx";

type ProfileRow = {
  user_id: string;
  display_name: string | null;
  city: string | null;
  country: string | null;
  roles: string[] | null;
  dance_skills: Record<string, { level?: string }> | null;
  dance_styles: string[] | null;
  avatar_path: string | null;
  bio: string | null;
};

type Suggestion = {
  id: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  title: string;
  body: string;
  cta: string;
  href: string;
  priority: number;
};

function pickPrimaryStyle(profile: ProfileRow | null): string | null {
  if (!profile) return null;
  if (Array.isArray(profile.dance_styles) && profile.dance_styles.length > 0) {
    return profile.dance_styles[0] ?? null;
  }
  const skills = profile.dance_skills;
  if (skills && typeof skills === "object") {
    const keys = Object.keys(skills);
    if (keys.length > 0) return keys[0];
  }
  return null;
}

function getLevel(profile: ProfileRow | null, style: string | null): string | null {
  if (!profile || !style) return null;
  const skill = profile.dance_skills?.[style];
  return skill?.level ?? null;
}

function isBeginnerLevel(level: string | null): boolean {
  if (!level) return false;
  return /beginner|improver/i.test(level);
}

function isTeacherLike(roles: string[] | null): boolean {
  if (!roles) return false;
  return roles.some((r) => /teacher|studio.*owner|dj|artist/i.test(r));
}

function isOrganizerLike(roles: string[] | null): boolean {
  if (!roles) return false;
  return roles.some((r) => /organizer|promoter|studio.*owner/i.test(r));
}

function buildSuggestions(profile: ProfileRow | null): Suggestion[] {
  if (!profile) return [];

  const suggestions: Suggestion[] = [];
  const primaryStyle = pickPrimaryStyle(profile);
  const level = getLevel(profile, primaryStyle);
  const city = profile.city?.trim() || "";
  const isTeacher = isTeacherLike(profile.roles);
  const isOrganizer = isOrganizerLike(profile.roles);
  const isBeginner = isBeginnerLevel(level);
  const hasAvatar = Boolean(profile.avatar_path);
  const hasBio = Boolean(profile.bio && profile.bio.trim());

  // 1. Find dancers nearby with matching style (always relevant for any role)
  if (primaryStyle) {
    const cityQuery = city ? `&city=${encodeURIComponent(city)}` : "";
    const suffix = isBeginner ? " at your level" : "";
    suggestions.push({
      id: "discover-dancers",
      icon: "diversity_3",
      iconBg: "border-cyan-300/35 bg-cyan-400/10",
      iconColor: "text-cyan-300",
      title: city ? `Find ${primaryStyle} dancers in ${city}` : `Find ${primaryStyle} dancers nearby`,
      body: `Discover people${suffix} who share your style and connect.`,
      cta: "Discover dancers",
      href: `/discover?style=${encodeURIComponent(primaryStyle)}${cityQuery}`,
      priority: 10,
    });
  } else {
    suggestions.push({
      id: "discover",
      icon: "diversity_3",
      iconBg: "border-cyan-300/35 bg-cyan-400/10",
      iconColor: "text-cyan-300",
      title: "Discover the community",
      body: "Browse dancers, teachers, and organizers near you.",
      cta: "Open discover",
      href: "/discover",
      priority: 10,
    });
  }

  // 2. Browse upcoming events (always relevant)
  suggestions.push({
    id: "events",
    icon: "calendar_month",
    iconBg: "border-fuchsia-300/35 bg-fuchsia-400/10",
    iconColor: "text-fuchsia-300",
    title: city ? `Upcoming events in ${city}` : "Upcoming events near you",
    body: "Socials, workshops, and festivals to attend.",
    cta: "Browse events",
    href: "/events",
    priority: 9,
  });

  // 3. Role-specific suggestion
  if (isTeacher) {
    suggestions.push({
      id: "teacher-profile",
      icon: "school",
      iconBg: "border-amber-300/35 bg-amber-400/10",
      iconColor: "text-amber-300",
      title: "Set up your teacher profile",
      body: "Add classes, services, and availability so students can find and book you.",
      cta: "Open teacher profile",
      href: "/me/edit/teacher-profile",
      priority: 11,
    });
  } else if (isOrganizer) {
    suggestions.push({
      id: "create-event",
      icon: "event_available",
      iconBg: "border-violet-300/35 bg-violet-400/10",
      iconColor: "text-violet-300",
      title: "Create your first event",
      body: "Post a social, workshop, or festival and invite your community.",
      cta: "Create event",
      href: "/events/new",
      priority: 11,
    });
  } else {
    // Default: start an activity (practice/private class request)
    suggestions.push({
      id: "first-activity",
      icon: "auto_awesome",
      iconBg: "border-emerald-300/35 bg-emerald-400/10",
      iconColor: "text-emerald-300",
      title: isBeginner ? "Find a practice partner" : "Post your first activity",
      body: isBeginner
        ? "Connect with dancers who want to practice together."
        : "Whether a practice, private class, or trip — share what you're looking for.",
      cta: "Start an activity",
      href: "/activity",
      priority: 11,
    });
  }

  // 4. Trips / Travel — relevant if availability mentions travel (we don't have it here but it's broadly useful)
  suggestions.push({
    id: "trips",
    icon: "flight_takeoff",
    iconBg: "border-sky-300/35 bg-sky-400/10",
    iconColor: "text-sky-300",
    title: "Plan a dance trip",
    body: "Tell the community when and where you'll be traveling.",
    cta: "Plan trip",
    href: "/trips",
    priority: 6,
  });

  // 5. Complete profile — only if something's missing
  if (!hasAvatar || !hasBio) {
    const missing: string[] = [];
    if (!hasAvatar) missing.push("photo");
    if (!hasBio) missing.push("short bio");
    suggestions.push({
      id: "complete-profile",
      icon: "person_edit",
      iconBg: "border-rose-300/35 bg-rose-400/10",
      iconColor: "text-rose-300",
      title: "Complete your profile",
      body: `Add a ${missing.join(" and ")} — it boosts connection match rate by 3x.`,
      cta: "Edit profile",
      href: "/me/edit",
      priority: 8,
    });
  }

  return suggestions.sort((a, b) => b.priority - a.priority);
}

function buildGreeting(profile: ProfileRow | null): { title: string; subtitle: string } {
  const firstName = profile?.display_name?.split(/\s+/)[0] ?? "there";
  const primaryStyle = pickPrimaryStyle(profile);
  const city = profile?.city?.trim() || "";
  const isTeacher = isTeacherLike(profile?.roles ?? null);
  const isBeginner = isBeginnerLevel(getLevel(profile, primaryStyle));

  if (isTeacher) {
    return {
      title: `Welcome, ${firstName} ✨`,
      subtitle: city
        ? `Let's set up your teacher presence in ${city} and start accepting students.`
        : "Let's set up your teacher presence and start accepting students.",
    };
  }

  if (isBeginner && primaryStyle) {
    return {
      title: `Welcome to the floor, ${firstName} 💫`,
      subtitle: city
        ? `Here's how to find ${primaryStyle} partners and events in ${city}.`
        : `Here's how to start your ${primaryStyle} journey.`,
    };
  }

  if (primaryStyle && city) {
    return {
      title: `Welcome, ${firstName} 🪩`,
      subtitle: `Here's a few ways to dive into the ${primaryStyle} scene in ${city}.`,
    };
  }

  return {
    title: `Welcome, ${firstName} 🪩`,
    subtitle: "Here are a few personalized ways to get started.",
  };
}

export default function OnboardingWelcomePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (cancelled) return;
      const userId = authData.user?.id ?? null;
      if (!userId) {
        router.replace("/auth");
        return;
      }
      const res = await supabase
        .from("profiles")
        .select("user_id,display_name,city,country,roles,dance_skills,dance_styles,avatar_path,bio")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (res.error || !res.data) {
        // Fallback: still show generic welcome
        setProfile(null);
      } else {
        setProfile(res.data as unknown as ProfileRow);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const suggestions = useMemo(() => buildSuggestions(profile), [profile]);
  const greeting = useMemo(() => buildGreeting(profile), [profile]);

  return (
    <div className="min-h-screen bg-[#05070c] text-white">
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-12 sm:pt-20">
        {/* Header with subtle gradient halo */}
        <div className="relative">
          <div className="pointer-events-none absolute -inset-x-12 -top-10 -bottom-4 -z-10 rounded-[40px] bg-gradient-to-br from-cyan-500/10 via-fuchsia-500/8 to-transparent blur-3xl" />
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-300/80">
            <span className="material-symbols-outlined align-middle text-[14px]">auto_awesome</span>{" "}
            Personalized for you
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
            {loading ? <span className="block h-9 w-72 animate-pulse rounded-lg bg-white/[0.06]" /> : greeting.title}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-400">
            {loading ? (
              <span className="block h-5 w-full max-w-md animate-pulse rounded-lg bg-white/[0.04]" />
            ) : (
              greeting.subtitle
            )}
          </p>
        </div>

        {/* Suggestions */}
        <div className="mt-8 space-y-2.5">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-start gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <div className="h-12 w-12 shrink-0 animate-pulse rounded-2xl bg-white/[0.06]" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                    <div className="h-3 w-full animate-pulse rounded bg-white/[0.04]" />
                  </div>
                </div>
              ))
            : suggestions.map((s, index) => (
                <Link
                  key={s.id}
                  href={s.href}
                  className={cx(
                    "group flex items-start gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-white/15 hover:bg-white/[0.05]",
                    index === 0 ? "border-cyan-400/25 bg-cyan-400/[0.04]" : ""
                  )}
                >
                  <div
                    className={cx(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border transition group-hover:scale-[1.04]",
                      s.iconBg
                    )}
                  >
                    <span className={cx("material-symbols-outlined text-[22px]", s.iconColor)}>{s.icon}</span>
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-[15px] font-bold leading-snug text-white">{s.title}</p>
                    <p className="mt-1 text-[13px] leading-snug text-slate-400">{s.body}</p>
                    <p className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-cyan-300 transition group-hover:gap-2">
                      {s.cta}
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </p>
                  </div>
                </Link>
              ))}
        </div>

        {/* Skip to feed */}
        <div className="mt-10 flex items-center justify-center gap-4 text-center">
          <Link
            href="/connections"
            className="rounded-full bg-white/[0.04] px-5 py-2.5 text-[13px] font-semibold text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
          >
            Skip — take me to the feed
            <span className="material-symbols-outlined align-middle ml-1 text-[15px]">arrow_forward</span>
          </Link>
        </div>

        {/* Trust hint */}
        <p className="mt-8 text-center text-[11px] text-slate-600">
          Suggestions are personalized based on your role, style, and location.
        </p>
      </main>
    </div>
  );
}
