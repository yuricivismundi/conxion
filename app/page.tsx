import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { absolutePublicAppUrl, readPublicAppUrl } from "@/lib/public-app-url";

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
      window.location.replace("/connections");
      return;
    }
  } catch {}

  document.documentElement.dataset.cxLandingReady = "1";
})();
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

const pillarCards = [
  {
    icon: "person_search",
    title: "Discover",
    body: "Find your perfect dance partner or local instructor with intelligent matching.",
  },
  {
    icon: "explore",
    title: "Travel",
    body: "Coordinate trips and never dance alone in a new city with community hosts.",
  },
  {
    icon: "auto_graph",
    title: "Grow",
    body: "Level up your skills with verified community feedback and global recognition.",
  },
];

const eventShowcase = [
  {
    city: "Barcelona",
    country: "Spain",
    title: "Barcelona Bachata Festival",
    date: "Nov 14, 2026",
    type: "Bachata Festival",
    attendees: 160,
    cover: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=1200&auto=format&fit=crop",
  },
  {
    city: "Paris",
    country: "France",
    title: "Paris Bachata Festival",
    date: "Nov 22, 2026",
    type: "Bachata Festival",
    attendees: 220,
    cover: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?q=80&w=1200&auto=format&fit=crop",
  },
  {
    city: "Berlin",
    country: "Germany",
    title: "Berlin Bachata Local Party",
    date: "Oct 05, 2026",
    type: "Bachata Local Party",
    attendees: 95,
    cover: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?q=80&w=1200&auto=format&fit=crop",
  },
  {
    city: "Rome",
    country: "Italy",
    title: "Rome Bachata Local Party",
    date: "Dec 01, 2026",
    type: "Bachata Local Party",
    attendees: 74,
    cover: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?q=80&w=1200&auto=format&fit=crop",
  },
  {
    city: "London",
    country: "United Kingdom",
    title: "London Bachata Festival",
    date: "Nov 08, 2026",
    type: "Bachata Festival",
    attendees: 130,
    cover: "https://images.unsplash.com/photo-1571266028243-d220c9c3b8f5?q=80&w=1200&auto=format&fit=crop",
  },
] as const;

export default function LandingPage() {
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

      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-[#0A0A0A]/80 backdrop-blur-md">
        <nav className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center" aria-label="ConXion landing">
            <div className="relative h-10 w-40 sm:h-12 sm:w-48">
              <Image src="/branding/CONXION-3-tight.png" alt="ConXion" fill className="object-contain object-left" priority />
            </div>
          </Link>

          <div className="hidden items-center gap-3 md:flex">
            <Link className="text-sm font-medium text-white/65 transition hover:text-white" href="/auth">
              Log in
            </Link>
            <Link
              href="/auth"
              className="animate-conxion-glow rounded-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] px-5 py-2.5 text-sm font-bold text-black transition hover:scale-105"
            >
              Join ConXion
            </Link>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <Link
              href="/auth"
              className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/85 transition hover:border-white/30 hover:text-white"
            >
              Log in
            </Link>
            <Link
              href="/auth"
              className="rounded-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] px-4 py-2 text-xs font-bold text-black"
            >
              Join
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-white/5 px-4 pb-16 pt-28 sm:px-6 lg:pb-20 lg:pt-32" id="hero">
          <div className="pointer-events-none absolute right-[-120px] top-20 h-[360px] w-[360px] rounded-full bg-[#00F5FF]/15 blur-[120px]" />
          <div className="pointer-events-none absolute bottom-[-120px] left-[-120px] h-[360px] w-[360px] rounded-full bg-[#FF00FF]/10 blur-[130px]" />

          <div className="mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-2">
            <div>
              <h1 className="text-4xl font-extrabold leading-[1.08] text-white sm:text-5xl lg:text-7xl">
                Connect with
                <br />
                <span className="bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] bg-clip-text text-transparent">dancers worldwide</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg lg:text-xl">
                Discover dancers, travel together, and grow your dance journey.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/auth"
                  className="rounded-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] px-9 py-4 text-center text-base font-extrabold text-black shadow-[0_0_30px_rgba(0,245,255,0.2)] transition hover:opacity-90"
                >
                  Join ConXion
                </Link>
                <Link
                  href="/events"
                  className="rounded-full border border-[#00F5FF]/60 px-9 py-4 text-center text-base font-bold text-[#00F5FF] transition hover:bg-[#00F5FF]/10"
                >
                  Explore events
                </Link>
              </div>
            </div>

            <div className="relative mx-auto h-[380px] w-full max-w-[560px] sm:h-[420px] lg:h-[500px]">
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-[340px] w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00F5FF]/10 blur-[110px]" />

              <article className="connections-card card-glow hero-card-motion-a absolute right-0 top-0 z-30 w-[250px] overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#121212] sm:w-[285px]">
                <div
                  className="h-28 bg-cover bg-center"
                  style={{
                    backgroundImage:
                      "url(https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?q=80&w=1200&auto=format&fit=crop)",
                  }}
                />
                <div className="space-y-2.5 p-4">
                  <div className="flex items-center gap-2">
                    <p className="text-base font-semibold tracking-tight text-white">Elena Rodriguez</p>
                    <span className="material-symbols-outlined text-[15px] text-[#00F5FF]">verified</span>
                  </div>
                  <p className="text-[12px] font-medium text-[#00F5FF]">Madrid, Spain</p>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-[3px] text-[9px] font-medium uppercase tracking-wider text-white/75">
                      Teacher
                    </span>
                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-[3px] text-[9px] font-medium uppercase tracking-wider text-white/75">
                      Salsa
                    </span>
                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-[3px] text-[9px] font-medium uppercase tracking-wider text-white/75">
                      Bachata
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-white/65">
                    <span className="inline-flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px] text-[#00F5FF]">group</span> 18
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px] text-[#00F5FF]">event_available</span> 31 refs
                    </span>
                  </div>
                </div>
              </article>

              <article className="connections-card card-glow hero-card-motion-b absolute left-0 top-[150px] z-20 w-[265px] overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#121212] sm:w-[315px]">
                <div className="relative h-24 overflow-hidden">
                  <img
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuA7QaOcwlmb9s0A6r3VZJyzfFwIDa9zH6EfYf8fzf_nIQYkRlv_o-0ZNm2o6X8UYZ_fy4G7WvJG6KMtr2OyJEFAk1NLK6nPy_l-E1eOkzpDEawDrehWO87SlIoCnbJvj1KIy9FQGimbagXNJ9YwsNLl6HbuE3aQDpudMrmyFuTNOXrEjtwRDIrHgii6MGKFbHTVF80v2GA_anJhEBR3mVZgEZ3SrR1B7fG1NBII2IMYxQNGOuQZ5Jr5TBgvCGxNdrsGOzTWg34wxAmw"
                    alt="London Bachata Tour"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent" />
                  <span className="absolute left-3 top-3 rounded bg-[#FF00FF]/20 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#FF00FF]">
                    Traveling
                  </span>
                </div>
                <div className="space-y-2.5 p-4">
                  <p className="text-base font-semibold text-white">London Bachata Tour</p>
                  <div className="text-[11px] text-white/65">Oct 12 - Oct 18 • Bachata parties + socials</div>
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                    <span className="text-xs font-semibold text-white/85">15 dancers attending</span>
                    <span className="material-symbols-outlined text-[16px] text-[#00F5FF]">flight_takeoff</span>
                  </div>
                </div>
              </article>

              <article className="connections-card card-glow hero-card-motion-c absolute bottom-0 right-8 z-10 w-[235px] overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#121212] sm:w-[270px]">
                <div className="relative h-32 overflow-hidden">
                  <img
                    src="https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?q=80&w=1200&auto=format&fit=crop"
                    alt="Paris Bachata Festival"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 to-transparent" />
                  <div className="absolute left-3 top-3 rounded-full border border-cyan-300/35 bg-cyan-300/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-cyan-100">
                    Bachata Festival
                  </div>
                  <div className="absolute bottom-3 left-3 right-3">
                    <p className="text-sm font-bold text-white">Paris Bachata Festival</p>
                    <p className="text-[10px] text-white/70">Paris, France</p>
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-3 text-[11px]">
                  <span className="inline-flex items-center gap-1 text-white/70">
                    <span className="material-symbols-outlined text-[14px] text-cyan-300">calendar_month</span>
                    Nov 22-25, 2026
                  </span>
                  <span className="inline-flex items-center gap-1 text-cyan-100">
                    <span className="material-symbols-outlined text-[14px] text-cyan-300">group</span>
                    220
                  </span>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="border-b border-white/5 bg-[#0A0A0A] px-4 py-14 sm:px-6" id="how-it-works">
          <div className="mx-auto grid w-full max-w-7xl gap-5 md:grid-cols-3 md:gap-6">
            {pillarCards.map((pillar) => (
              <article
                key={pillar.title}
                className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 transition hover:border-white/15 hover:bg-white/[0.06]"
              >
                <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#00F5FF]/10 text-[#00F5FF]">
                  <span className="material-symbols-outlined">{pillar.icon}</span>
                </div>
                <h3 className="text-2xl font-bold text-white">{pillar.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-white/60">{pillar.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-b border-white/5 bg-[#121212] px-4 py-20 sm:px-6">
          <div className="mx-auto w-full max-w-7xl">
            <div className="text-center">
              <h2 className="text-4xl font-extrabold text-white md:text-5xl">Built for the global dance community</h2>
              <p className="mx-auto mt-4 max-w-2xl text-white/55">
                Explore curated event samples from top dance cities.
              </p>
            </div>

            <div className="mt-12 overflow-x-auto pb-2 no-scrollbar">
              <div className="flex min-w-max gap-5">
                {eventShowcase.map((event) => (
                  <article
                    key={`${event.city}-${event.title}`}
                    className="group w-[300px] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[#121212] transition hover:border-cyan-300/35"
                  >
                    <div className="relative h-44 overflow-hidden">
                      <img
                        src={event.cover}
                        alt={event.title}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                      <div className="absolute bottom-3 left-3 right-3">
                        <span
                          className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                            event.type.includes("Festival")
                              ? "border-cyan-300/35 bg-cyan-300/15 text-cyan-100"
                              : event.type.includes("Party")
                                ? "border-fuchsia-300/35 bg-fuchsia-400/15 text-fuchsia-100"
                                : event.type.includes("Workshop")
                                ? "border-emerald-300/35 bg-emerald-400/15 text-emerald-100"
                                : "border-fuchsia-300/35 bg-fuchsia-400/15 text-fuchsia-100"
                          }`}
                        >
                          {event.type}
                        </span>
                        <p className="mt-2 text-lg font-bold text-white">{event.title}</p>
                        <p className="text-xs text-white/70">{event.city}, {event.country}</p>
                      </div>
                    </div>
                    <div className="space-y-2 p-4">
                      <div className="flex items-center justify-between text-xs text-white/70">
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px] text-cyan-300">calendar_month</span>
                          {event.date}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px] text-cyan-300">group</span>
                          {event.attendees} attending
                        </span>
                      </div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-200/90">
                        Best of {event.city}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#0A0A0A] px-4 py-20 sm:px-6" id="safety">
          <div className="mx-auto w-full max-w-7xl">
            <div className="glass-card relative overflow-hidden rounded-[2rem] p-8 text-center sm:p-12">
              <div className="pointer-events-none absolute -left-20 -top-20 h-52 w-52 rounded-full bg-[#00F5FF]/10 blur-[70px]" />
              <h2 className="text-3xl font-extrabold text-white sm:text-4xl">Confidence through community.</h2>
              <p className="mx-auto mt-4 max-w-2xl text-white/55">
                We&apos;ve built ConXion with safety at its core, centered on mutual respect.
              </p>

              <div className="mx-auto mt-10 grid max-w-4xl grid-cols-2 gap-6 lg:grid-cols-4">
                {[
                  ["verified_user", "Reference system"],
                  ["badge", "Verified profiles"],
                  ["gavel", "Safety guidelines"],
                  ["report", "Reporting tools"],
                ].map(([icon, label]) => (
                  <div key={label} className="flex flex-col items-center gap-2">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5 text-[#00F5FF]">
                      <span className="material-symbols-outlined">{icon}</span>
                    </div>
                    <span className="text-xs font-semibold text-white/80">{label}</span>
                  </div>
                ))}
              </div>

              <div className="mx-auto mt-10 max-w-2xl border-t border-white/10 pt-7">
                <p className="text-lg italic text-white/75">
                  &quot;ConXion allowed me to travel to Rome and immediately feel safe finding local socials.&quot;
                </p>
                <p className="mt-2 text-sm font-bold text-[#00F5FF]">— Maria S., Bachatera</p>
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden border-t border-white/5 border-b border-white/5 px-4 py-24 text-center sm:px-6">
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#00F5FF]/15 to-[#FF00FF]/15 blur-[130px]" />
          <div className="relative z-10 mx-auto w-full max-w-4xl">
            <h2 className="text-4xl font-extrabold leading-tight text-white sm:text-6xl">Ready to build your dance network?</h2>
            <Link
              href="/auth"
              className="mt-12 inline-flex rounded-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] px-16 py-5 text-2xl font-extrabold text-black shadow-[0_0_60px_-10px_rgba(0,245,255,0.4)] transition hover:scale-105"
            >
              Join ConXion
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
                Connecting the world&apos;s dance community through trust and movement.
              </p>
            </div>

            <div>
              <h5 className="mb-5 font-bold text-white">Company</h5>
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
              <h5 className="mb-5 font-bold text-white">Trust</h5>
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
              <h5 className="mb-5 font-bold text-white">Help</h5>
              <ul className="space-y-3 text-sm text-white/55">
                <li>
                  <Link href="/support" className="transition hover:text-[#00F5FF]">
                    Support
                  </Link>
                </li>
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
              <h5 className="mb-5 font-bold text-white">Social</h5>
              <span
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/40"
                aria-hidden="true"
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                </svg>
              </span>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-4 border-t border-white/5 pt-7 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between">
            <p>© 2024 ConXion Community Platform. All rights reserved.</p>
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
