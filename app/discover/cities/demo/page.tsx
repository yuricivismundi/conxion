"use client";

// ─────────────────────────────────────────────────────────────────────────────
// DEMO PAGE — /discover/cities/demo
// Design preview using real app styles. All data is hardcoded.
// Delete the entire app/discover/cities/demo/ folder when done reviewing.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ─── DUMMY DATA ───────────────────────────────────────────────────────────────

const MEMBERS = [
  { id: "1", name: "Maria K.", photo: "https://i.pravatar.cc/300?img=47", city: "Tallinn", country: "Estonia", role: "Teacher", danceSkills: ["Bachata", "Salsa"], langs: ["ES", "EN"], isHost: true, refs: 12, verified: true },
  { id: "2", name: "Andres V.", photo: "https://i.pravatar.cc/300?img=12", city: "Tallinn", country: "Estonia", role: "Social Dancer", danceSkills: ["Kizomba"], langs: ["EN", "ET"], isHost: false, refs: 4, verified: false },
  { id: "3", name: "Elena S.", photo: "https://i.pravatar.cc/300?img=25", city: "Tallinn", country: "Estonia", role: "Organizer", danceSkills: ["Bachata", "Zouk"], langs: ["RU", "EN"], isHost: true, refs: 8, verified: true },
  { id: "4", name: "Taavi M.", photo: "https://i.pravatar.cc/300?img=33", city: "Tallinn", country: "Estonia", role: "Social Dancer", danceSkills: ["Salsa"], langs: ["ET"], isHost: false, refs: 2, verified: false },
  { id: "5", name: "Liisa P.", photo: "https://i.pravatar.cc/300?img=56", city: "Tallinn", country: "Estonia", role: "Student", danceSkills: ["Zouk", "Kizomba"], langs: ["EN", "FI"], isHost: false, refs: 1, verified: false },
  { id: "6", name: "Risto H.", photo: "https://i.pravatar.cc/300?img=68", city: "Tallinn", country: "Estonia", role: "Teacher", danceSkills: ["Bachata"], langs: ["ET", "EN"], isHost: true, refs: 19, verified: true },
];

const TRAVELERS = [
  { id: "t1", name: "Carlos R.", photo: "https://i.pravatar.cc/300?img=15", from: "Madrid", country: "Spain", arrival: "Jun 20", departure: "Jun 27", danceSkills: ["Bachata", "Salsa"], langs: ["ES", "EN"], purpose: "Dancing" },
  { id: "t2", name: "Sophie L.", photo: "https://i.pravatar.cc/300?img=44", from: "Paris", country: "France", arrival: "Jun 22", departure: "Jun 30", danceSkills: ["Zouk"], langs: ["FR", "EN"], purpose: "Travelling" },
  { id: "t3", name: "Diego M.", photo: "https://i.pravatar.cc/300?img=8", from: "Buenos Aires", country: "Argentina", arrival: "Jul 1", departure: "Jul 10", danceSkills: ["Tango", "Salsa"], langs: ["ES"], purpose: "Dancing" },
  { id: "t4", name: "Yuki T.", photo: "https://i.pravatar.cc/300?img=29", from: "Tokyo", country: "Japan", arrival: "Jul 3", departure: "Jul 7", danceSkills: ["Bachata"], langs: ["JA", "EN"], purpose: "Travelling" },
];

const EVENTS = [
  { id: "e1", title: "Tallinn Bachata Night", weekday: "FRI", month: "JUN", day: "20", time: "Fri, Jun 20 · 9:00 PM – 2:00 AM", venue: "Tallinn · Club Tuur", styles: ["Bachata", "Salsa"], image: "https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=600&h=240&fit=crop", attendees: 34, timeline: "Upcoming" },
  { id: "e2", title: "Social Salsa Sunday", weekday: "SUN", month: "JUN", day: "22", time: "Sun, Jun 22 · 7:00 PM – 11:00 PM", venue: "Tallinn · Dance Factory", styles: ["Salsa"], image: "https://images.unsplash.com/photo-1545959570-a94084071b5d?w=600&h=240&fit=crop", attendees: 21, timeline: "Upcoming" },
  { id: "e3", title: "Zouk & Kizomba Festival", weekday: "SAT", month: "JUN", day: "28", time: "Sat, Jun 28 · 8:00 PM – 4:00 AM", venue: "Tallinn · Kultuurikatel", styles: ["Zouk", "Kizomba"], image: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&h=240&fit=crop", attendees: 89, timeline: "This weekend" },
  { id: "e4", title: "Beginner Bachata Workshop", weekday: "WED", month: "JUL", day: "2", time: "Wed, Jul 2 · 6:30 PM – 8:30 PM", venue: "Tallinn · Move Studio", styles: ["Bachata"], image: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&h=240&fit=crop", attendees: 12, timeline: "Upcoming" },
];

const TEACHERS = [
  { id: "tc1", name: "Maria K.", photo: "https://i.pravatar.cc/300?img=47", styles: ["Bachata", "Salsa"], tagline: "Sensual Bachata · 8 years teaching · Private & group classes", rating: 4.9, reviews: 34, verified: true, city: "Tallinn" },
  { id: "tc2", name: "Elena S.", photo: "https://i.pravatar.cc/300?img=25", styles: ["Bachata", "Zouk"], tagline: "Zouk & Bachata fusion specialist · Online & in-person", rating: 4.7, reviews: 18, verified: true, city: "Tallinn" },
  { id: "tc3", name: "Risto H.", photo: "https://i.pravatar.cc/300?img=68", styles: ["Bachata"], tagline: "Urban Bachata · Group & private classes available", rating: 4.8, reviews: 22, verified: false, city: "Tallinn" },
];

const HERO_IMG = "https://images.unsplash.com/photo-1587789202069-44b8cf1b1998?w=1400&h=500&fit=crop";

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Tab = "members" | "travelers" | "events" | "teachers";
type MemberFilter = "all" | "hosts";

// ─── PAGE ─────────────────────────────────────────────────────────────────────
export default function CityDemoPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("members");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");

  const filtered = memberFilter === "hosts" ? MEMBERS.filter((m) => m.isHost) : MEMBERS;

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">

      {/* ── DEMO BANNER ── */}
      <div className="sticky top-0 z-[70] flex items-center justify-between border-b border-amber-400/20 bg-amber-500/10 px-4 py-2 backdrop-blur-md">
        <span className="text-[11px] font-semibold text-amber-300">⚠ Design preview — dummy data, not connected to DB</span>
        <Link href="/discover" className="text-[11px] text-amber-300 underline underline-offset-2">← Exit preview</Link>
      </div>

      {/* ── STICKY BACK HEADER ── */}
      <header className="sticky top-[33px] z-50 flex h-14 items-center gap-3 border-b border-white/[0.06] bg-[#0A0A0A]/95 px-4 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] transition hover:bg-white/[0.08]"
        >
          <span className="material-symbols-outlined text-[20px] text-white/70">arrow_back</span>
        </button>
        <div className="flex-1 min-w-0">
          <p className="truncate text-[15px] font-bold text-white">Tallinn</p>
          <p className="text-[11px] text-white/45">Estonia</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/55">
            <span className="material-symbols-outlined text-[13px] text-[#00F5FF]">group</span>
            {MEMBERS.length} members
          </span>
        </div>
      </header>

      {/* ── HERO ── */}
      <div className="relative h-52 overflow-hidden md:h-64">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={HERO_IMG} alt="Tallinn" className="h-full w-full object-cover brightness-75" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/30 to-transparent" />
        <div className="absolute bottom-0 left-0 p-4 md:p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#c1fffe]">🇪🇪 Estonia</p>
          <h1 className="mt-1 text-[38px] font-black leading-none tracking-tight text-white drop-shadow-2xl">Tallinn</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[10px] font-semibold text-white/80 backdrop-blur-xl">
              <span className="material-symbols-outlined text-[12px] text-[#00F5FF]">group</span>
              {MEMBERS.length} members
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[10px] font-semibold text-white/80 backdrop-blur-xl">
              <span className="material-symbols-outlined text-[12px] text-[#ff51fa]">flight</span>
              {TRAVELERS.length} travelers
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[10px] font-semibold text-white/80 backdrop-blur-xl">
              <span className="material-symbols-outlined text-[12px] text-[#00F5FF]">calendar_month</span>
              {EVENTS.length} upcoming events
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[10px] font-semibold text-white/80 backdrop-blur-xl">
              <span className="material-symbols-outlined text-[12px] text-[#00F5FF]">school</span>
              {TEACHERS.length} teachers
            </span>
          </div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="sticky top-[47px] z-40 flex border-b border-white/[0.06] bg-[#0A0A0A]/95 backdrop-blur-md">
        {(["members", "travelers", "events", "teachers"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3.5 text-[12px] font-semibold capitalize tracking-wide transition ${
              tab === t
                ? "border-b-2 border-[#00F5FF] text-[#00F5FF]"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── CONTENT ── */}
      <div className="mx-auto max-w-5xl px-4 pb-32 pt-5">

        {/* ════════ MEMBERS ════════ */}
        {tab === "members" && (
          <div>
            {/* filter row */}
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-[13px] text-white/45">
                <span className="font-semibold text-white">{filtered.length}</span> members in Tallinn
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMemberFilter("all")}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${memberFilter === "all" ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-300" : "border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  All
                </button>
                <button
                  onClick={() => setMemberFilter("hosts")}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${memberFilter === "hosts" ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-300" : "border-white/10 text-white/40 hover:text-white/70"}`}
                >
                  <span className="material-symbols-outlined text-[13px]">home</span>
                  Hosts only
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((m) => (
                <div
                  key={m.id}
                  className="connections-card relative overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#121212] transition-all duration-200 will-change-transform hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(13,242,242,0.14),0_16px_42px_rgba(0,245,255,0.06)]"
                >
                  {m.isHost && (
                    <div className="absolute right-2.5 top-2.5 z-20 flex items-center gap-1 rounded-full border border-[#00F5FF]/30 bg-[#00F5FF]/10 px-2 py-0.5">
                      <span className="material-symbols-outlined text-[11px] text-[#00F5FF]">home</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-[#00F5FF]">Host</span>
                    </div>
                  )}
                  <div className="flex min-h-[210px]">
                    {/* photo */}
                    <div className="relative w-[42%] shrink-0 border-r border-white/10">
                      <div
                        className="h-full w-full bg-cover bg-center"
                        style={{ backgroundImage: `url(${m.photo})` }}
                      />
                    </div>
                    {/* info */}
                    <div className="flex min-w-0 flex-1 flex-col justify-between p-3">
                      <div className="space-y-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="truncate text-[17px] font-semibold tracking-tight text-white">{m.name}</h3>
                            {m.verified && (
                              <span className="material-symbols-outlined text-[16px] text-[#00F5FF]">verified</span>
                            )}
                          </div>
                          <p className="text-[13px] font-medium text-[#00F5FF]">
                            {m.city}<span className="text-white/50">, {m.country}</span>
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-white/55">
                          <span className="inline-flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px] text-[#00F5FF]">workspace_premium</span>
                            <span className="text-white/80">{m.refs}</span> refs
                          </span>
                        </div>
                        {m.role && (
                          <div className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[13px] text-[#00F5FF]">badge</span>
                            <span className="text-[11px] font-medium text-white/75">{m.role}</span>
                          </div>
                        )}
                        <div>
                          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
                            <span className="material-symbols-outlined text-[14px] text-[#00F5FF]">person_play</span>
                            Dance styles
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {m.danceSkills.map((s) => (
                              <span key={s} className="text-[11px] font-medium text-white/60">{s}</span>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[14px] text-[#00F5FF]">public</span>
                          <div className="flex gap-1">
                            {m.langs.map((l) => (
                              <div key={l} className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-white/10 bg-white/5 text-[9px] font-bold text-white/70">{l}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Link href={`/profile/${m.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-white/10 px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-widest transition hover:bg-white/5">
                          View
                        </Link>
                        <button
                          className="min-h-[44px] items-center justify-center rounded-full px-2 py-2.5 text-[10px] font-extrabold uppercase tracking-tight text-[#0A0A0A]"
                          style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#ff00ff)" }}
                        >
                          Connect
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════ TRAVELERS ════════ */}
        {tab === "travelers" && (
          <div>
            <p className="mb-4 text-[13px] text-white/45">
              <span className="font-semibold text-white">{TRAVELERS.length}</span> dancers visiting Tallinn soon
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TRAVELERS.map((t) => (
                <div
                  key={t.id}
                  className="connections-card group relative h-[330px] overflow-hidden rounded-[1.25rem] border border-white/10 transition-all duration-700 hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(13,242,242,0.14),0_16px_42px_rgba(0,245,255,0.06)]"
                >
                  {/* city bg image */}
                  <div className="absolute inset-0 bg-gradient-to-br from-[#0d1f2d] to-[#1a0a2e]" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://source.unsplash.com/600x400/?${t.from},city`}
                    alt={t.from}
                    className="absolute inset-0 h-full w-full object-cover brightness-[0.55] transition-transform duration-1000 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/15" />

                  {/* top: origin city */}
                  <div className="absolute inset-x-0 top-0 z-10 p-4">
                    <h2 className="text-[32px] font-black leading-[0.95] tracking-tighter text-white drop-shadow-2xl">
                      {t.from}
                    </h2>
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.28em] text-[#c1fffe]">{t.country}</p>
                    <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 shadow-lg backdrop-blur-xl">
                      <span className="material-symbols-outlined text-[13px] text-[#ff51fa]">calendar_today</span>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white">
                        {t.arrival} – {t.departure}
                      </span>
                    </div>
                  </div>

                  {/* bottom glassmorphism footer */}
                  <div
                    className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3 border-t border-white/10 px-4 py-3"
                    style={{ background: "rgba(14,14,14,0.55)", backdropFilter: "blur(24px)" }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="relative shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={t.photo} alt={t.name} className="h-11 w-11 rounded-full object-cover ring-2 ring-[#c1fffe]/35" />
                      </div>
                      <div className="min-w-0 flex flex-col gap-[3px]">
                        <p className="truncate text-sm font-bold leading-tight text-white">{t.name}</p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">{t.purpose}</span>
                          {t.langs.map((l) => (
                            <span key={l} className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/10 text-[7px] font-bold text-white/60">{l}</span>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          {t.danceSkills.map((s) => (
                            <span key={s} className="text-[11px] font-medium text-white/60">{s}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="grid w-full grid-cols-2 gap-2">
                      <button className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2 text-[9px] font-bold uppercase tracking-widest text-white transition-all hover:bg-white/10">
                        <span className="material-symbols-outlined text-[14px]">home</span>
                        Offer Hosting
                      </button>
                      <button
                        className="flex h-10 items-center justify-center gap-1.5 rounded-full px-2 text-[9px] font-extrabold uppercase tracking-widest text-[#040a0f]"
                        style={{ backgroundImage: "linear-gradient(90deg,#0df2f2,#7c3aff,#ff00ff)" }}
                      >
                        <span className="material-symbols-outlined text-[14px]">bolt</span>
                        Join Trip
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════ EVENTS ════════ */}
        {tab === "events" && (
          <div>
            <p className="mb-4 text-[13px] text-white/45">
              <span className="font-semibold text-white">{EVENTS.length}</span> upcoming events in Tallinn
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {EVENTS.map((e) => (
                <article
                  key={e.id}
                  className="relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#121212] shadow-[0_6px_20px_rgba(0,0,0,0.3)] transition hover:-translate-y-0.5 hover:border-cyan-300/30"
                  style={{ height: 336 }}
                >
                  {/* hero image */}
                  <div className="relative h-[120px]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={e.image} alt={e.title} className="h-full w-full object-cover transition duration-700 hover:scale-105" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-transparent to-transparent" />
                  </div>

                  <div className="relative flex flex-1 flex-col p-2">
                    {/* date badge */}
                    <div className="pointer-events-none absolute right-2 top-1 z-10">
                      <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/14 px-2 py-1 text-center shadow-[0_8px_20px_rgba(34,211,238,0.12)]">
                        <p className="text-[10px] font-semibold tracking-wide text-cyan-100">{e.weekday}</p>
                        <p className="text-[10px] font-semibold tracking-wide text-cyan-100">{e.month}</p>
                        <p className="text-[22px] font-extrabold leading-none text-white">{e.day}</p>
                      </div>
                    </div>

                    <div className="mb-0.5">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                        {e.timeline}
                        <span className="ml-1.5 text-white/30">·</span>
                        <span className="ml-1.5 text-white/45">Social</span>
                      </p>
                      <h2 className="line-clamp-2 min-h-[34px] pr-[98px] text-[15px] font-bold leading-tight text-white">{e.title}</h2>
                      <p className="mt-0.5 truncate text-[11px] font-semibold text-cyan-200/90">{e.time}</p>
                    </div>

                    <div>
                      <p className="mt-0.5 flex items-center gap-1 text-[13px] text-slate-300">
                        <span className="material-symbols-outlined text-[16px] text-cyan-200">location_on</span>
                        <span className="truncate">{e.venue}</span>
                        {e.styles.length ? (
                          <>
                            <span className="text-white/40">,</span>
                            <span className="truncate text-cyan-100/85">{e.styles.join(", ")}</span>
                          </>
                        ) : null}
                      </p>
                      <div className="mt-1 min-h-[20px]">
                        <p className="text-[11px] text-slate-500">{e.attendees} going</p>
                      </div>
                    </div>

                    <div className="mt-auto flex items-center gap-1.5 border-t border-white/10 pt-1">
                      <button
                        className="flex h-[42px] w-full items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] text-[12px] font-semibold text-white/70 transition hover:bg-white/[0.08]"
                      >
                        <span className="material-symbols-outlined text-[18px]">star</span>
                        Interested
                      </button>
                      <Link
                        href="/events"
                        className="flex h-[42px] w-full items-center justify-center gap-1 rounded-xl text-[12px] font-semibold text-[#0A0A0A] transition hover:brightness-110"
                        style={{ backgroundImage: "linear-gradient(90deg,#00F5FF,#FF00FF)" }}
                      >
                        View event
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            {/* See all CTA */}
            <Link
              href="/events"
              className="mt-5 flex items-center justify-center gap-2 w-full rounded-full border border-[#00F5FF]/30 bg-[#00F5FF]/10 py-3.5 text-sm font-bold text-[#00F5FF] transition hover:bg-[#00F5FF]/15"
            >
              <span className="material-symbols-outlined text-[18px]">open_in_new</span>
              See all events in Tallinn
            </Link>
          </div>
        )}

        {/* ════════ TEACHERS ════════ */}
        {tab === "teachers" && (
          <div>
            <p className="mb-4 text-[13px] text-white/45">
              <span className="font-semibold text-white">{TEACHERS.length}</span> dance teachers in Tallinn
            </p>
            <div className="space-y-3">
              {TEACHERS.map((t) => (
                <article
                  key={t.id}
                  className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#121212] shadow-[0_6px_20px_rgba(0,0,0,0.3)] transition hover:-translate-y-0.5 hover:border-cyan-300/30"
                >
                  <div className="flex gap-4 p-4">
                    <div className="relative shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.photo} alt={t.name} className="h-20 w-20 rounded-2xl object-cover" />
                      {t.verified && (
                        <span className="absolute -right-1 -top-1">
                          <span className="material-symbols-outlined text-[18px] text-[#00F5FF] drop-shadow-lg">verified</span>
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-[16px] font-bold text-white">{t.name}</h3>
                          <p className="text-[12px] text-[#00F5FF]">{t.city}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[13px] font-bold text-yellow-400">★ {t.rating}</p>
                          <p className="text-[10px] text-white/40">{t.reviews} reviews</p>
                        </div>
                      </div>
                      <p className="mt-1.5 text-[12px] leading-relaxed text-white/55">{t.tagline}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {t.styles.map((s) => (
                          <span key={s} className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">{s}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 border-t border-white/[0.06] px-4 py-3">
                    <Link
                      href={`/profile/${t.id}`}
                      className="inline-flex h-10 items-center justify-center rounded-full border border-white/10 text-[11px] font-semibold uppercase tracking-widest text-white/70 transition hover:bg-white/5"
                    >
                      View profile
                    </Link>
                    <button
                      className="inline-flex h-10 items-center justify-center rounded-full text-[11px] font-extrabold uppercase tracking-tight text-[#0A0A0A] transition hover:brightness-110"
                      style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#d93bff)" }}
                    >
                      Book a class
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
