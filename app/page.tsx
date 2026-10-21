import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { BLOG_ENABLED } from "@/content/blog/posts";
import { isEventDiscoverable } from "@/lib/events/access";
import { mapEventRows, pickEventHeroUrl, type EventRecord } from "@/lib/events/model";
import { absolutePublicAppUrl, readPublicAppUrl } from "@/lib/public-app-url";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getT, isSupportedLocale, resolveLocale, type Locale } from "@/lib/i18n/landing";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { EARLY_ACCESS_ENABLED } from "@/lib/billing/early-access";

export const dynamic = "force-dynamic";

const appUrl = readPublicAppUrl();
const logoUrl = absolutePublicAppUrl("/branding/CONXION-2-tight.png?v=14");
const supabaseProjectRef = (() => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return "";
    return new URL(url).hostname.split(".")[0] ?? "";
  } catch {
    return "";
  }
})();
const authStorageKeys = [supabaseProjectRef ? `sb-${supabaseProjectRef}-auth-token` : "", "supabase.auth.token"].filter(Boolean);
const landingRedirectScript = `
(() => {
  const keys = ${JSON.stringify(authStorageKeys)};
  const hasSession = (storage) => {
    if (!storage) return false;
    return keys.some((key) => {
      const raw = storage.getItem(key);
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.some((entry) => entry && typeof entry === "object" && (entry.access_token || entry.refresh_token));
        }
        if (parsed && typeof parsed === "object") {
          return Boolean(
            parsed.access_token ||
            parsed.refresh_token ||
            parsed.currentSession?.access_token ||
            parsed.session?.access_token ||
            parsed.user?.id
          );
        }
      } catch {}
      return raw.length > 16;
    });
  };

  try {
    if (hasSession(window.localStorage) || hasSession(window.sessionStorage)) {
      document.documentElement.dataset.cxLandingRedirecting = "1";
      window.location.replace("/connections");
      return;
    }
  } catch {}

  document.documentElement.dataset.cxLandingReady = "1";
})();

// Failsafe: ensure landing page is visible after 500ms even if the script above fails
setTimeout(() => {
  if (!document.documentElement.dataset.cxLandingReady && !document.documentElement.dataset.cxLandingRedirecting) {
    document.documentElement.dataset.cxLandingReady = "1";
  }
}, 500);
`;

export const metadata: Metadata = {
  title: "ConXion | Global Dance Community Platform",
  description:
    "Discover dancers, coordinate trips, and grow your dance journey through trusted global community connections.",
  openGraph: {
    title: "ConXion | Global Dance Community Platform",
    description:
      "Discover dancers, coordinate trips, and grow your dance journey through trusted global community connections.",
    url: appUrl,
    type: "website",
    images: [
      {
        url: logoUrl,
        width: 1200,
        height: 600,
        alt: "ConXion logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ConXion | Global Dance Community Platform",
    description:
      "Discover dancers, coordinate trips, and grow your dance journey through trusted global community connections.",
    images: [logoUrl],
  },
};

// Hero mosaic: ConXion's own images (public/images/blog). First one is the mobile background.
const HERO_PHOTOS = [
  { src: "/images/blog/blog-02-find-partners-clean.jpg", position: "center" },
  { src: "/images/blog/blog-01-conxion-intro-clean.jpg", position: "center" },
  { src: "/images/blog/blog-03-teachers-guide-clean.jpg", position: "center 30%" },
  { src: "/images/blog/blog-04-dance-travel-clean.jpg", position: "center" },
];

type LandingEventCard = {
  id: string;
  title: string;
  city: string;
  country: string;
  eventType: string;
  accessType: EventRecord["accessType"];
  startsAt: string;
  heroUrl: string;
  attendeeCount: number;
};

function landingEventTypeBadge(eventType: string) {
  switch (eventType.toLowerCase()) {
    case "festival":
      return "border-cyan-300/35 bg-cyan-300/15 text-cyan-100";
    case "workshop":
    case "masterclass":
      return "border-emerald-300/35 bg-emerald-400/15 text-emerald-100";
    case "competition":
      return "border-amber-300/35 bg-amber-400/15 text-amber-100";
    case "social":
    default:
      return "border-fuchsia-300/35 bg-fuchsia-400/15 text-fuchsia-100";
  }
}

function formatLandingEventDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Date TBD";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

async function loadLandingEvents(): Promise<LandingEventCard[]> {
  try {
    const service = getSupabaseServiceClient();
    const nowIso = new Date().toISOString();

    const eventsRes = await service
      .from("events")
      .select("*")
      .eq("status", "published")
      .gte("ends_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(24);

    if (eventsRes.error) return [];

    const events = mapEventRows((eventsRes.data ?? []) as unknown[])
      .filter((event) => isEventDiscoverable(event.accessType) && !event.hiddenByAdmin)
      .slice(0, 4);

    if (!events.length) return [];

    const eventIds = events.map((event) => event.id);
    const membersRes = await service
      .from("event_members")
      .select("event_id,status")
      .in("event_id", eventIds)
      .in("status", ["host", "going", "waitlist"]);

    const attendeeCountByEventId: Record<string, number> = {};
    for (const eventId of eventIds) attendeeCountByEventId[eventId] = 0;

    if (!membersRes.error) {
      for (const raw of (membersRes.data ?? []) as Array<{ event_id?: string | null }>) {
        const eventId = typeof raw.event_id === "string" ? raw.event_id : "";
        if (!eventId) continue;
        attendeeCountByEventId[eventId] = (attendeeCountByEventId[eventId] ?? 0) + 1;
      }
    }

    return events.map((event) => ({
      id: event.id,
      title: event.title,
      city: event.city,
      country: event.country,
      eventType: event.eventType,
      accessType: event.accessType,
      startsAt: event.startsAt,
      heroUrl: pickEventHeroUrl(event),
      attendeeCount: attendeeCountByEventId[event.id] ?? 0,
    }));
  } catch {
    return [];
  }
}

type PageProps = {
  searchParams?: Promise<{ lang?: string | string[] }>;
};

export default async function LandingPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const hdrs = await headers();
  const cookieLang = (() => {
    const cookie = hdrs.get("cookie") ?? "";
    const match = /(?:^|;\s*)cx_lang=([^;]+)/.exec(cookie);
    return match ? decodeURIComponent(match[1]) : null;
  })();
  const langParam = Array.isArray(sp.lang) ? sp.lang[0] : sp.lang;
  const locale: Locale = isSupportedLocale(langParam)
    ? langParam
    : isSupportedLocale(cookieLang)
      ? cookieLang
      : resolveLocale(undefined, hdrs.get("accept-language"));
  const t = getT(locale);
  const landingEvents = await loadLandingEvents();
  return (
    <div className="landing-root bg-[#0A0A0A] text-[#E0E0E0]">
      <Script id="landing-auth-redirect" strategy="beforeInteractive">
        {landingRedirectScript}
      </Script>
      <noscript>
        <style>{`.landing-root{opacity:1!important}`}</style>
      </noscript>
      <style>{`
        .landing-root {
          opacity: 1;
          transition: opacity 120ms ease-out;
        }

        html[data-cx-landing-redirecting="1"] .landing-root {
          opacity: 0;
        }

        html[data-cx-landing-ready="1"] .landing-root {
          opacity: 1;
        }

        @keyframes conxionGlow {
          0%, 100% { box-shadow: 0 0 15px -2px rgba(0, 245, 255, 0.35); }
          50% { box-shadow: 0 0 25px 2px rgba(255, 0, 255, 0.35); }
        }

        @keyframes heroCardIn {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes heroFloatA {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }

        @keyframes heroFloatB {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }

        @keyframes heroFloatC {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }

        @keyframes heroGlowPulse {
          0%, 100% {
            box-shadow: 0 0 18px rgba(0, 245, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.1);
          }
          50% {
            box-shadow: 0 0 26px rgba(255, 0, 255, 0.14);
            border-color: rgba(255, 255, 255, 0.16);
          }
        }

        .animate-conxion-glow {
          animation: conxionGlow 4s ease-in-out infinite;
        }

        .glass-card {
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .card-glow {
          box-shadow: 0 0 20px rgba(0, 245, 255, 0.08);
          transition: all 0.28s ease;
        }

        .card-glow:hover {
          box-shadow: 0 0 30px rgba(255, 0, 255, 0.15);
          border-color: rgba(255, 255, 255, 0.2);
        }

        .hero-card-motion-a {
          animation: heroCardIn 560ms cubic-bezier(0.2, 0.9, 0.2, 1) both, heroFloatA 7.5s ease-in-out 700ms infinite, heroGlowPulse 8s ease-in-out 700ms infinite;
          will-change: transform;
        }

        .hero-card-motion-b {
          animation: heroCardIn 620ms cubic-bezier(0.2, 0.9, 0.2, 1) 90ms both, heroFloatB 8.5s ease-in-out 800ms infinite, heroGlowPulse 9s ease-in-out 800ms infinite;
          will-change: transform;
        }

        .hero-card-motion-c {
          animation: heroCardIn 680ms cubic-bezier(0.2, 0.9, 0.2, 1) 140ms both, heroFloatC 9s ease-in-out 900ms infinite, heroGlowPulse 9.5s ease-in-out 900ms infinite;
          will-change: transform;
        }

        @media (prefers-reduced-motion: reduce) {
          .hero-card-motion-a,
          .hero-card-motion-b,
          .hero-card-motion-c,
          .animate-conxion-glow {
            animation: none !important;
          }
        }
      `}</style>

      <header className="absolute inset-x-0 top-0 z-50">
        <nav className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center" aria-label="ConXion landing">
            <div className="relative h-10 w-40 sm:h-12 sm:w-48">
              <Image src="/branding/CONXION-3-tight.png" alt="ConXion" fill className="object-contain object-left" priority />
            </div>
          </Link>

          <div className="flex items-center gap-4">
            {BLOG_ENABLED ? (
              <Link className="hidden text-sm font-semibold text-white/80 transition hover:text-white md:inline" href="/blog">
                {t.nav_blog}
              </Link>
            ) : null}
            <Link
              href="/auth?mode=login"
              className="rounded-full border border-white/80 bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-white/90"
            >
              {t.nav_login}
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* ── Hero: one message, one action ─────────────────────────────── */}
        <section className="relative flex min-h-[100svh] items-center justify-center overflow-hidden px-4 sm:px-6" id="hero">
          {/* Photo mosaic */}
          <div className="absolute inset-0 grid grid-cols-1 sm:grid-cols-2" aria-hidden="true">
            {HERO_PHOTOS.map((photo, index) => (
              <div key={photo.src} className={`relative ${index > 0 ? "hidden sm:block" : ""}`}>
                <Image
                  src={photo.src}
                  alt=""
                  fill
                  priority={index < 2}
                  // portrait phones crop a landscape photo, so request a wider image than the viewport
                  sizes="(min-width: 640px) 50vw, 220vw"
                  quality={85}
                  className="object-cover"
                  style={{ objectPosition: photo.position }}
                />
              </div>
            ))}
          </div>
          <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-[#0A0A0A]" aria-hidden="true" />

          <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center pt-20 text-center">
            {EARLY_ACCESS_ENABLED ? (
              <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white/90 backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-[#00F5FF]" />
                {t.hero_early_access}
              </p>
            ) : null}
            <h1 className="text-5xl font-extrabold leading-[1.02] tracking-tight text-white drop-shadow-[0_4px_30px_rgba(0,0,0,0.5)] sm:text-7xl lg:text-8xl">
              {t.hero_h1_top}
              <br />
              <span className="bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] bg-clip-text text-transparent">{t.hero_h1_accent}</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-white/85 sm:text-xl">{t.hero_sub}</p>
            <Link
              href="/auth"
              className="animate-conxion-glow mt-10 inline-flex w-full max-w-xs items-center justify-center rounded-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] px-10 py-4 text-lg font-extrabold text-black transition hover:scale-[1.03] sm:w-auto sm:px-14 sm:text-xl"
            >
              {t.hero_cta_join}
            </Link>
            <p className="mt-4 text-sm text-white/60">{t.hero_micro}</p>
          </div>
        </section>

        {/* ── Three reasons, nothing more ───────────────────────────────── */}
        <section className="bg-[#0A0A0A] px-4 py-20 sm:px-6" id="why">
          <div className="mx-auto grid w-full max-w-6xl gap-5 md:grid-cols-3">
            {[
              { icon: "auto_awesome", title: t.why_page_t, body: t.why_page_d, color: "text-[#ff51fa]" },
              { icon: "flight_takeoff", title: t.why_travel_t, body: t.why_travel_d, color: "text-[#00F5FF]" },
              { icon: "home", title: t.why_host_t, body: t.why_host_d, color: "text-[#c1fffe]" },
            ].map((item) => (
              <div key={item.title} className="rounded-3xl border border-white/10 bg-white/[0.03] p-7">
                <span className={`material-symbols-outlined text-3xl ${item.color}`}>{item.icon}</span>
                <h2 className="mt-4 text-xl font-bold text-white">{item.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {landingEvents.length > 0 ? (
        <section className="border-b border-white/5 bg-[#121212] px-4 py-20 sm:px-6">
          <div className="mx-auto w-full max-w-7xl">
            <div className="text-center">
              <h2 className="text-4xl font-extrabold text-white md:text-5xl">{t.events_h2}</h2>
              <p className="mx-auto mt-4 max-w-2xl text-white/55">
                {t.events_sub}
              </p>
            </div>

            {landingEvents.length > 0 ? (
              <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                {landingEvents.map((event) => (
                  <Link
                    key={event.id}
                    href={`/events/${event.id}`}
                    className="group overflow-hidden rounded-2xl border border-white/10 bg-[#121212] transition hover:border-cyan-300/35"
                  >
                    <div className="relative h-44 overflow-hidden">
                      <img
                        src={event.heroUrl}
                        alt={event.title}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                      <div className="absolute bottom-3 left-3 right-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase ${landingEventTypeBadge(event.eventType)}`}>
                            {event.eventType}
                          </span>
                          <span className="rounded-full border border-white/15 bg-black/35 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white/80">
                            {event.accessType === "request" ? "Request" : "Public"}
                          </span>
                        </div>
                        <p className="mt-2 text-lg font-bold text-white">{event.title}</p>
                        <p className="text-xs text-white/70">
                          {event.city}, {event.country}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2 p-4">
                      <div className="flex items-center justify-between text-xs text-white/70">
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px] text-cyan-300">calendar_month</span>
                          {formatLandingEventDate(event.startsAt)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px] text-cyan-300">group</span>
                          {event.attendeeCount} {t.events_attending}
                        </span>
                      </div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-200/90">
                        {t.events_best_of} {event.city}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="mt-12 rounded-2xl border border-white/10 bg-black/25 px-6 py-10 text-center">
                <p className="text-base font-semibold text-white">{t.events_empty_title}</p>
                <p className="mt-2 text-sm text-white/55">{t.events_empty_sub}</p>
              </div>
            )}

            <div className="mt-8 flex justify-center">
              <Link
                href="/events"
                className="rounded-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] px-7 py-3 text-sm font-extrabold text-black shadow-[0_0_30px_rgba(0,245,255,0.2)] transition hover:opacity-90"
              >
                {t.events_cta}
              </Link>
            </div>
          </div>
        </section>
        ) : null}

        <section className="relative overflow-hidden border-t border-white/5 border-b border-white/5 px-4 py-24 text-center sm:px-6">
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#00F5FF]/15 to-[#FF00FF]/15 blur-[130px]" />
          <div className="relative z-10 mx-auto w-full max-w-4xl">
            <h2 className="text-4xl font-extrabold leading-tight text-white sm:text-6xl">{t.final_h2}</h2>
            <Link
              href="/auth"
              className="mt-12 inline-flex rounded-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] px-16 py-5 text-2xl font-extrabold text-black shadow-[0_0_60px_-10px_rgba(0,245,255,0.4)] transition hover:scale-105"
            >
              {t.final_cta}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 bg-[#0A0A0A] px-4 pb-10 pt-16 sm:px-6">
        <div className="mx-auto w-full max-w-7xl">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:grid-cols-5">
            <div className="col-span-2 lg:col-span-1">
              <Link href="/" className="mb-5 inline-flex items-center" aria-label="ConXion landing">
                <div className="relative h-10 w-40">
                  <Image src="/branding/CONXION-3-tight.png" alt="ConXion" fill className="object-contain object-left" />
                </div>
              </Link>
              <p className="max-w-[220px] text-sm leading-relaxed text-white/45">
                {t.footer_tagline}
              </p>
            </div>

            <div>
              <h5 className="mb-5 font-bold text-white">{t.footer_company}</h5>
              <ul className="space-y-3 text-sm text-white/55">
                <li>
                  <Link href="/about" className="transition hover:text-[#00F5FF]">
                    About
                  </Link>
                </li>
                <li>
                  <Link href="/careers" className="transition hover:text-[#00F5FF]">
                    Careers
                  </Link>
                </li>
                <li>
                  <Link href="/blog" className="transition hover:text-[#00F5FF]">
                    Blog
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h5 className="mb-5 font-bold text-white">{t.footer_trust}</h5>
              <ul className="space-y-3 text-sm text-white/55">
                <li>
                  <Link href="/safety-center" className="transition hover:text-[#00F5FF]">
                    Safety
                  </Link>
                </li>
                <li>
                  <Link href="/safety-center" className="transition hover:text-[#00F5FF]">
                    Community Rules
                  </Link>
                </li>
                <li>
                  <Link href="/safety-center" className="transition hover:text-[#00F5FF]">
                    Verification
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h5 className="mb-5 font-bold text-white">{t.footer_help}</h5>
              <ul className="space-y-3 text-sm text-white/55">
                <li>
                  <Link href="/support" className="transition hover:text-[#00F5FF]">
                    Support
                  </Link>
                </li>
                {BLOG_ENABLED ? (
                  <li>
                    <Link href="/blog" className="transition hover:text-[#00F5FF]">
                      Blog
                    </Link>
                  </li>
                ) : null}
                <li>
                  <Link href="/support" className="transition hover:text-[#00F5FF]">
                    Contact
                  </Link>
                </li>
                <li>
                  <Link href="/support" className="transition hover:text-[#00F5FF]">
                    FAQ
                  </Link>
                </li>
                <li>
                  <Link href="/shop" className="transition hover:text-[#00F5FF]">
                    Shop
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h5 className="mb-5 font-bold text-white">{t.footer_social}</h5>
              <div className="flex items-center gap-3">
                <span
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/40"
                  aria-hidden="true"
                >
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                  </svg>
                </span>
                <LanguageSwitcher current={locale} />
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-4 border-t border-white/5 pt-7 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 ConXion. All rights reserved.</p>
            <div className="flex items-center gap-5">
              <Link href="/privacy" className="transition hover:text-white">
                Privacy Policy
              </Link>
              <Link href="/terms" className="transition hover:text-white">
                Terms of Service
              </Link>
              <Link href="/cookie-settings" className="transition hover:text-white">
                Cookies
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
