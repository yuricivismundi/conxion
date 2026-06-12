"use client";

// ─────────────────────────────────────────────────────────────────────────────
// DEMO PAGE — /discover/cities/demo
// Design preview — reuses exact card layouts, filters, Nav and spacing from
// the real connections/events pages. All data is hardcoded dummy data.
// Delete the entire app/discover/cities/demo/ folder when done reviewing.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";

// ─── DUMMY DATA ───────────────────────────────────────────────────────────────

const CITY = "Tallinn";
const COUNTRY = "Estonia";

const MEMBERS = [
  { id: "1", name: "Maria K.", photo: "https://i.pravatar.cc/400?img=47", city: "Tallinn", country: "Estonia", displayRole: "Teacher", danceSkills: { bachata: "Advanced", salsa: "Intermediate" }, otherStyle: false, langs: ["EN", "ES"], refs: 12, verified: true, isHost: true, connectionsCount: 5 },
  { id: "2", name: "Andres V.", photo: "https://i.pravatar.cc/400?img=12", city: "Tallinn", country: "Estonia", displayRole: "Social Dancer", danceSkills: { kizomba: "Intermediate" }, otherStyle: false, langs: ["EN", "ET"], refs: 4, verified: false, isHost: false, connectionsCount: 0 },
  { id: "3", name: "Elena S.", photo: "https://i.pravatar.cc/400?img=25", city: "Tallinn", country: "Estonia", displayRole: "Organizer", danceSkills: { bachata: "Advanced", zouk: "Intermediate" }, otherStyle: false, langs: ["RU", "EN"], refs: 8, verified: true, isHost: true, connectionsCount: 3 },
  { id: "4", name: "Taavi M.", photo: "https://i.pravatar.cc/400?img=33", city: "Tallinn", country: "Estonia", displayRole: "Social Dancer", danceSkills: { salsa: "Beginner" }, otherStyle: true, langs: ["ET"], refs: 2, verified: false, isHost: false, connectionsCount: 0 },
  { id: "5", name: "Liisa P.", photo: "https://i.pravatar.cc/400?img=56", city: "Tallinn", country: "Estonia", displayRole: "Student", danceSkills: { zouk: "Beginner", kizomba: "Beginner" }, otherStyle: false, langs: ["EN", "FI"], refs: 1, verified: false, isHost: false, connectionsCount: 0 },
  { id: "6", name: "Risto H.", photo: "https://i.pravatar.cc/400?img=68", city: "Tallinn", country: "Estonia", displayRole: "Teacher", danceSkills: { bachata: "Teacher/Competitor" }, otherStyle: false, langs: ["ET", "EN"], refs: 19, verified: true, isHost: true, connectionsCount: 8 },
];

const TRAVELERS = [
  { id: "t1", name: "Carlos R.", photo: "https://i.pravatar.cc/400?img=15", city: "Madrid", country: "Spain", displayRole: "Social Dancer", arrival: "Jun 20", departure: "Jun 27", danceSkills: { bachata: "Advanced", salsa: "Intermediate" }, langs: ["ES", "EN"], purpose: "Dancing", refs: 7, verified: false },
  { id: "t2", name: "Sophie L.", photo: "https://i.pravatar.cc/400?img=44", city: "Paris", country: "France", displayRole: "Social Dancer", arrival: "Jun 22", departure: "Jun 30", danceSkills: { zouk: "Advanced" }, langs: ["FR", "EN"], purpose: "Travelling", refs: 3, verified: true },
  { id: "t3", name: "Diego M.", photo: "https://i.pravatar.cc/400?img=8", city: "Buenos Aires", country: "Argentina", displayRole: "Teacher", arrival: "Jul 1", departure: "Jul 10", danceSkills: { tango: "Teacher/Competitor", salsa: "Advanced" }, langs: ["ES"], purpose: "Dancing", refs: 14, verified: true },
  { id: "t4", name: "Yuki T.", photo: "https://i.pravatar.cc/400?img=29", city: "Tokyo", country: "Japan", displayRole: "Student", arrival: "Jul 3", departure: "Jul 7", danceSkills: { bachata: "Intermediate" }, langs: ["JA", "EN"], purpose: "Travelling", refs: 1, verified: false },
];

const EVENTS = [
  { id: "e1", title: "Tallinn Bachata Night", weekday: "FRI", month: "JUN", day: "20", timeRange: "Fri, Jun 20 · 9:00 PM – 2:00 AM", venue: "Tallinn · Club Tuur", styles: ["Bachata", "Salsa"], image: "https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=600&h=240&fit=crop", attendees: 34, timeline: "Upcoming", timelineClass: "text-emerald-400" },
  { id: "e2", title: "Social Salsa Sunday", weekday: "SUN", month: "JUN", day: "22", timeRange: "Sun, Jun 22 · 7:00 PM – 11:00 PM", venue: "Tallinn · Dance Factory", styles: ["Salsa"], image: "https://images.unsplash.com/photo-1545959570-a94084071b5d?w=600&h=240&fit=crop", attendees: 21, timeline: "Upcoming", timelineClass: "text-emerald-400" },
  { id: "e3", title: "Zouk & Kizomba Festival", weekday: "SAT", month: "JUN", day: "28", timeRange: "Sat, Jun 28 · 8:00 PM – 4:00 AM", venue: "Tallinn · Kultuurikatel", styles: ["Zouk", "Kizomba"], image: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&h=240&fit=crop", attendees: 89, timeline: "This weekend", timelineClass: "text-amber-400" },
  { id: "e4", title: "Beginner Bachata Workshop", weekday: "WED", month: "JUL", day: "2", timeRange: "Wed, Jul 2 · 6:30 PM – 8:30 PM", venue: "Tallinn · Move Studio", styles: ["Bachata"], image: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&h=240&fit=crop", attendees: 12, timeline: "Upcoming", timelineClass: "text-emerald-400" },
];

const TEACHERS = [
  { id: "tc1", name: "Maria K.", photo: "https://i.pravatar.cc/400?img=47", danceSkills: { bachata: "Teacher/Competitor", salsa: "Advanced" }, displayRole: "Teacher", tagline: "Sensual Bachata · 8 years teaching · Private & group classes", rating: 4.9, reviews: 34, verified: true, langs: ["EN", "ES"], refs: 12 },
  { id: "tc2", name: "Elena S.", photo: "https://i.pravatar.cc/400?img=25", danceSkills: { bachata: "Advanced", zouk: "Teacher/Competitor" }, displayRole: "Teacher", tagline: "Zouk & Bachata fusion · Online & in-person available", rating: 4.7, reviews: 18, verified: true, langs: ["RU", "EN"], refs: 8 },
  { id: "tc3", name: "Risto H.", photo: "https://i.pravatar.cc/400?img=68", danceSkills: { bachata: "Teacher/Competitor" }, displayRole: "Teacher", tagline: "Urban Bachata · Group & private classes", rating: 4.8, reviews: 22, verified: false, langs: ["ET", "EN"], refs: 19 },
];

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Tab = "members" | "travelers" | "events" | "teachers";

function MSIcon({ name, className }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className ?? ""}`}>{name}</span>;
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────
export default function CityDemoPage() {
  const [tab, setTab] = useState<Tab>("members");
  const [memberSearch, setMemberSearch] = useState("");
  const [hostsOnly, setHostsOnly] = useState(false);
  const [eventSearch, setEventSearch] = useState("");
  const [teacherSearch, setTeacherSearch] = useState("");

  const filteredMembers = MEMBERS.filter((m) => {
    if (hostsOnly && !m.isHost) return false;
    if (memberSearch && !m.name.toLowerCase().includes(memberSearch.toLowerCase())) return false;
    return true;
  });

  const filteredEvents = EVENTS.filter((e) =>
    !eventSearch || e.title.toLowerCase().includes(eventSearch.toLowerCase())
  );

  const filteredTeachers = TEACHERS.filter((t) =>
    !teacherSearch || t.name.toLowerCase().includes(teacherSearch.toLowerCase())
  );

  const tabClass = (t: Tab) =>
    [
      "group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-4 text-[13px] sm:shrink-0 sm:w-auto sm:gap-2.5 sm:px-5 sm:text-[16px] font-semibold tracking-tight transition-all duration-200 hover:-translate-y-px",
      tab === t
        ? "border border-[#00F5FF]/40 bg-[linear-gradient(135deg,rgba(0,255,255,0.14),rgba(255,255,255,0.06))] text-[#00F5FF] shadow-[0_0_16px_rgba(0,255,255,0.28)]"
        : "text-white/70 hover:text-white/95",
    ].join(" ");

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />

      {/* ── DEMO BANNER ── */}
      <div className="flex items-center justify-between border-b border-amber-400/20 bg-amber-500/10 px-4 py-2">
        <span className="text-[11px] font-semibold text-amber-300">⚠ Design preview — dummy data only, not connected to DB</span>
        <Link href="/discover" className="text-[11px] text-amber-300 underline underline-offset-2">← Exit preview</Link>
      </div>

      {/* ── CITY HERO STRIP ── */}
      <div className="relative h-48 overflow-hidden md:h-56">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://images.unsplash.com/photo-1587789202069-44b8cf1b1998?w=1400&h=400&fit=crop"
          alt={CITY}
          className="h-full w-full object-cover brightness-60"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/20 to-transparent" />
        <div className="absolute bottom-0 left-0 px-6 pb-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#c1fffe]">🇪🇪 {COUNTRY}</p>
          <h1 className="mt-0.5 text-[40px] font-black leading-none tracking-tight text-white drop-shadow-2xl">{CITY}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              { icon: "group", label: `${MEMBERS.length} members` },
              { icon: "flight", label: `${TRAVELERS.length} travelers` },
              { icon: "calendar_month", label: `${EVENTS.length} events` },
              { icon: "school", label: `${TEACHERS.length} teachers` },
            ].map(({ icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-2.5 py-1 text-[10px] font-semibold text-white/80 backdrop-blur-xl">
                <MSIcon name={icon} className="text-[12px] text-[#00F5FF]" />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── TAB BAR (exact connections page style) ── */}
      <section className="border-b border-white/[0.06] pb-3 pt-4 sm:pb-4">
        <div className="mx-auto grid w-full max-w-none grid-cols-4 gap-2 px-4 pb-1 sm:flex sm:max-w-[680px] sm:items-center sm:justify-center sm:gap-6 sm:overflow-visible sm:px-0 sm:pb-0">
          <button onClick={() => setTab("members")} className={tabClass("members")}>
            <MSIcon name="person" className="text-[18px]" />
            <span className="hidden sm:inline">Members</span>
            <span className="sm:hidden text-[11px]">Members</span>
          </button>
          <button onClick={() => setTab("travelers")} className={tabClass("travelers")}>
            <MSIcon name="flight" className="text-[18px]" />
            <span className="hidden sm:inline">Travelers</span>
            <span className="sm:hidden text-[11px]">Travelers</span>
          </button>
          <button onClick={() => setTab("events")} className={tabClass("events")}>
            <MSIcon name="calendar_month" className="text-[18px]" />
            <span className="hidden sm:inline">Events</span>
            <span className="sm:hidden text-[11px]">Events</span>
          </button>
          <button onClick={() => setTab("teachers")} className={tabClass("teachers")}>
            <MSIcon name="school" className="text-[18px]" />
            <span className="hidden sm:inline">Teachers</span>
            <span className="sm:hidden text-[11px]">Teachers</span>
          </button>
        </div>
      </section>

      {/* ── MAIN CONTENT ── */}
      <div className="mx-auto max-w-[1440px] px-4 pb-32 pt-5 md:px-8">

        {/* ════════ MEMBERS ════════ */}
        {tab === "members" && (
          <div>
            {/* filter row — exact copy of connections page */}
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <p className="text-[13px] text-white/50">
                  Showing <span className="font-semibold text-white">{filteredMembers.length}</span> members
                </p>
                <div className="h-4 w-px bg-white/10" />
                <button
                  onClick={() => setHostsOnly((v) => !v)}
                  className={[
                    "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                    hostsOnly ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-300" : "border-white/10 text-white/40 hover:text-white/70",
                  ].join(" ")}
                >
                  <MSIcon name="home" className="text-[13px]" />
                  Hosts only
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label className="relative">
                  <MSIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-white/35" />
                  <input
                    type="search"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search members by name"
                    className="h-10 w-[240px] rounded-full border border-white/10 bg-white/[0.05] pl-9 pr-3 text-[13px] text-white/90 outline-none placeholder:text-white/35 transition focus:border-[#00F5FF]/50 focus:ring-1 focus:ring-[#00F5FF]/25"
                  />
                </label>
                <button className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#00F5FF] px-5 text-sm font-bold text-[#0A0A0A] transition hover:opacity-90">
                  <MSIcon name="tune" className="text-[16px]" />
                  Filters
                </button>
              </div>
            </div>

            {/* cards grid — exact connections page layout */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {filteredMembers.map((m) => (
                <div
                  key={m.id}
                  className="connections-card relative overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#121212] transition-all duration-200 will-change-transform hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(13,242,242,0.14),0_16px_42px_rgba(0,245,255,0.06)]"
                >
                  {m.connectionsCount > 0 && (
                    <div className="absolute right-2.5 top-2.5 z-20 flex items-center gap-1">
                      <MSIcon name="group" className="text-[13px] text-[#00F5FF]" />
                      <span className="text-[10px] font-semibold text-white/70">{m.connectionsCount}</span>
                    </div>
                  )}

                  {/* ── Mobile layout ── */}
                  <div className="flex min-h-[210px] md:hidden">
                    <div className="relative w-[42%] shrink-0 border-r border-white/10">
                      <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${m.photo})` }} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-between p-3">
                      <div className="space-y-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="truncate text-[18px] font-semibold tracking-tight text-white">{m.name}</h3>
                            {m.verified && <MSIcon name="verified" className="text-[16px] text-[#00F5FF]" />}
                          </div>
                          <p className="mt-0.5 text-[13px] font-medium text-[#00F5FF]">{m.city}<span className="text-white/60">, {m.country}</span></p>
                        </div>
                        <div className="flex items-center gap-1.5 text-[12px] font-medium text-white/55">
                          <MSIcon name="workspace_premium" className="text-[14px] text-[#00F5FF]" />
                          <span className="text-white/80">{m.refs}</span> refs
                        </div>
                        {m.displayRole && (
                          <div className="flex items-center gap-1.5">
                            <MSIcon name="badge" className="text-[13px] text-[#00F5FF]" />
                            <span className="text-[11px] font-medium text-white/75">{m.displayRole}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <MSIcon name="person_play" className="text-[13px] text-[#00F5FF]" />
                          <div className="flex gap-2">
                            {Object.keys(m.danceSkills).map((s) => (
                              <span key={s} className="text-[11px] font-medium text-white/60 capitalize">{s}</span>
                            ))}
                            {m.otherStyle && <span className="text-[11px] font-medium text-white/60">Other</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MSIcon name="public" className="text-[13px] text-[#00F5FF]" />
                          <div className="flex gap-1.5">
                            {m.langs.map((l) => (
                              <div key={l} className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[9px] font-bold text-white/70">{l}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Link href={`/profile/${m.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-white/10 text-[11px] font-semibold uppercase tracking-widest transition hover:bg-white/5">View</Link>
                        <button className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-full text-[11px] font-semibold uppercase tracking-widest text-[#0A0A0A]" style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#ff00ff)" }}>
                          <span className="text-[13px] font-black leading-none">+</span> Connect
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ── Desktop layout (exact match) ── */}
                  <div className="hidden md:flex md:h-64 md:min-h-0 md:flex-row">
                    <div className="relative h-full w-1/2">
                      <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${m.photo})` }} />
                    </div>
                    <div className="flex h-full w-1/2 flex-col justify-between p-4">
                      <div className="min-h-0">
                        <div className="relative">
                          <div className="mb-2 flex items-center gap-1.5">
                            <h3 className="text-[20px] font-normal tracking-tight">{m.name}</h3>
                            {m.verified && <MSIcon name="verified" className="text-[18px] text-[#00F5FF]" />}
                          </div>
                          <div className="mb-3 flex items-baseline gap-2">
                            <span className="text-[15px] font-medium leading-none text-[#00F5FF]">{m.city}</span>
                            <span className="text-[15px] font-medium leading-none text-white/65">, {m.country}</span>
                          </div>
                          <div className="mb-1.5 flex items-center gap-3 text-[12px] font-medium text-white/45">
                            <div className="flex items-center gap-1.5 whitespace-nowrap">
                              <MSIcon name="workspace_premium" className="text-[14px] text-[#00F5FF]" />
                              <span className="font-medium text-white/70">{m.refs}</span>
                              <span>References</span>
                            </div>
                          </div>
                          <div className="mb-2.5 space-y-1.5">
                            {m.displayRole && (
                              <div className="flex items-center gap-1.5">
                                <MSIcon name="badge" className="text-[14px] text-[#00F5FF]" />
                                <span className="text-[11px] font-medium text-white/75">{m.displayRole}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <MSIcon name="person_play" className="text-[14px] text-[#00F5FF]" />
                              <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                                {Object.keys(m.danceSkills).map((s) => (
                                  <span key={s} className="whitespace-nowrap text-[11px] font-medium text-white/55 capitalize">{s}</span>
                                ))}
                                {m.otherStyle && <span className="whitespace-nowrap text-[11px] font-medium text-white/55">Other</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <MSIcon name="public" className="text-[14px] text-[#00F5FF]" />
                              <div className="flex flex-wrap gap-1.5">
                                {m.langs.map((l) => (
                                  <div key={l} className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[9px] font-bold text-white/70">{l}</div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="pt-3">
                        <div className="flex items-center gap-2">
                          <Link href={`/profile/${m.id}`} className="inline-flex min-h-[42px] flex-1 items-center justify-center rounded-full border border-white/10 text-[10px] font-semibold uppercase tracking-widest transition hover:bg-white/5">View</Link>
                          <button className="flex min-h-[42px] flex-[1.5] items-center justify-center gap-2 rounded-full text-[11px] font-semibold uppercase tracking-widest text-[#0A0A0A]" style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#ff00ff)" }}>
                            <span className="text-[12px] font-black leading-none">+</span> Connect
                          </button>
                        </div>
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
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-white/50">
                Showing <span className="font-semibold text-white">{TRAVELERS.length}</span> travelers coming to {CITY}
              </p>
              <button className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#00F5FF] px-5 text-sm font-bold text-[#0A0A0A] transition hover:opacity-90">
                <MSIcon name="tune" className="text-[16px]" />
                Filters
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {TRAVELERS.map((t) => (
                <div key={t.id} className="connections-card group relative h-[330px] overflow-hidden rounded-[1.25rem] border border-white/10 transition-all duration-700 hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(13,242,242,0.14),0_16px_42px_rgba(0,245,255,0.06)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`https://images.unsplash.com/photo-1467269204594-9661b134dd2b?w=600&h=400&fit=crop&sig=${t.id}`} alt={t.city} className="absolute inset-0 h-full w-full object-cover brightness-[0.55] transition-transform duration-1000 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/15" />
                  <div className="absolute inset-x-0 top-0 z-10 p-4 md:p-5">
                    <h2 className="max-w-full break-words text-[34px] font-black leading-[0.95] tracking-tighter text-white drop-shadow-2xl">{t.city}</h2>
                    <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-[0.28em] text-[#c1fffe]">{t.country}</p>
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 shadow-lg backdrop-blur-xl">
                      <MSIcon name="calendar_today" className="text-[14px] text-[#ff51fa]" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white">{t.arrival} – {t.departure}</span>
                    </div>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3 border-t border-white/10 px-4 py-3" style={{ background: "rgba(14,14,14,0.55)", backdropFilter: "blur(24px)" }}>
                    <div className="flex min-w-0 items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.photo} alt={t.name} className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-[#c1fffe]/35" />
                      <div className="min-w-0 flex flex-col gap-[3px]">
                        <p className="truncate text-sm font-bold leading-tight text-white">{t.name}</p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">{t.purpose}</span>
                          {t.langs.map((l) => (
                            <span key={l} className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/10 text-[7px] font-bold text-white/60">{l}</span>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          {Object.keys(t.danceSkills).map((s) => (
                            <span key={s} className="text-[11px] font-medium text-white/55 capitalize">{s}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="grid w-full grid-cols-2 gap-2">
                      <button className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2 text-[9px] font-bold uppercase tracking-widest text-white transition-all hover:bg-white/10">
                        <MSIcon name="home" className="text-[14px]" />
                        Offer Hosting
                      </button>
                      <button className="flex h-10 items-center justify-center gap-1.5 rounded-full px-2 text-[9px] font-extrabold uppercase tracking-widest text-[#040a0f]" style={{ backgroundImage: "linear-gradient(90deg,#0df2f2,#7c3aff,#ff00ff)" }}>
                        <MSIcon name="bolt" className="text-[14px]" />
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
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-white/50">
                Showing <span className="font-semibold text-white">{filteredEvents.length}</span> upcoming events in {CITY}
              </p>
              <div className="flex items-center gap-2">
                <label className="relative">
                  <MSIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-white/35" />
                  <input
                    type="search"
                    value={eventSearch}
                    onChange={(e) => setEventSearch(e.target.value)}
                    placeholder="Search events, venues..."
                    className="h-10 w-[240px] rounded-full border border-white/10 bg-white/[0.05] pl-9 pr-3 text-[13px] text-white/90 outline-none placeholder:text-white/35 transition focus:border-[#00F5FF]/50 focus:ring-1 focus:ring-[#00F5FF]/25"
                  />
                </label>
                <button className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#00F5FF] px-5 text-sm font-bold text-[#0A0A0A] transition hover:opacity-90">
                  <MSIcon name="tune" className="text-[16px]" />
                  Filters
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredEvents.map((e) => (
                <article key={e.id} className="relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#121212] shadow-[0_6px_20px_rgba(0,0,0,0.3)] transition hover:-translate-y-0.5 hover:border-cyan-300/30" style={{ height: 336 }}>
                  <div className="relative h-[120px]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={e.image} alt={e.title} className="h-full w-full object-cover transition duration-700 hover:scale-105" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-transparent to-transparent" />
                  </div>
                  <div className="relative flex flex-1 flex-col p-2">
                    <div className="pointer-events-none absolute right-2 top-1 z-10">
                      <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/14 px-2 py-1 text-center shadow-[0_8px_20px_rgba(34,211,238,0.12)]">
                        <p className="text-[10px] font-semibold tracking-wide text-cyan-100">{e.weekday}</p>
                        <p className="text-[10px] font-semibold tracking-wide text-cyan-100">{e.month}</p>
                        <p className="text-[22px] font-extrabold leading-none text-white">{e.day}</p>
                      </div>
                    </div>
                    <div className="mb-0.5">
                      <p className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wide ${e.timelineClass}`}>
                        {e.timeline}
                        <span className="ml-1.5 text-white/30">·</span>
                        <span className="ml-1.5 text-white/45">Social</span>
                      </p>
                      <h2 className="line-clamp-2 min-h-[34px] pr-[98px] text-[15px] font-bold leading-tight text-white">{e.title}</h2>
                      <p className="mt-0.5 truncate text-[11px] font-semibold text-cyan-200/90">{e.timeRange}</p>
                    </div>
                    <div>
                      <p className="mt-0.5 flex items-center gap-1 text-[13px] text-slate-300">
                        <MSIcon name="location_on" className="text-[16px] text-cyan-200" />
                        <span className="truncate">{e.venue}</span>
                        {e.styles.length ? (
                          <><span className="text-white/40">,</span><span className="truncate text-cyan-100/85">{e.styles.join(", ")}</span></>
                        ) : null}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">{e.attendees} going</p>
                    </div>
                    <div className="mt-auto flex items-center gap-1.5 border-t border-white/10 pt-1">
                      <button className="flex h-[42px] w-full items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] text-[12px] font-semibold text-white/70 transition hover:bg-white/[0.08]">
                        <MSIcon name="star" className="text-[18px]" />
                        Interested
                      </button>
                      <Link href="/events" className="flex h-[42px] w-full items-center justify-center gap-1 rounded-xl text-[12px] font-semibold text-[#0A0A0A] transition hover:brightness-110" style={{ backgroundImage: "linear-gradient(90deg,#00F5FF,#FF00FF)" }}>
                        View event
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <Link href="/events" className="mt-5 flex items-center justify-center gap-2 rounded-full border border-[#00F5FF]/30 bg-[#00F5FF]/10 py-3.5 text-sm font-bold text-[#00F5FF] transition hover:bg-[#00F5FF]/15">
              <MSIcon name="open_in_new" className="text-[18px]" />
              See all events in {CITY} on the Events page
            </Link>
          </div>
        )}

        {/* ════════ TEACHERS ════════ */}
        {tab === "teachers" && (
          <div>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-white/50">
                Showing <span className="font-semibold text-white">{filteredTeachers.length}</span> teachers in {CITY}
              </p>
              <div className="flex items-center gap-2">
                <label className="relative">
                  <MSIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-white/35" />
                  <input
                    type="search"
                    value={teacherSearch}
                    onChange={(e) => setTeacherSearch(e.target.value)}
                    placeholder="Search teachers by name"
                    className="h-10 w-[240px] rounded-full border border-white/10 bg-white/[0.05] pl-9 pr-3 text-[13px] text-white/90 outline-none placeholder:text-white/35 transition focus:border-[#00F5FF]/50 focus:ring-1 focus:ring-[#00F5FF]/25"
                  />
                </label>
                <button className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#00F5FF] px-5 text-sm font-bold text-[#0A0A0A] transition hover:opacity-90">
                  <MSIcon name="tune" className="text-[16px]" />
                  Filters
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {filteredTeachers.map((t) => (
                <div key={t.id} className="connections-card relative overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#121212] transition-all duration-200 will-change-transform hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(13,242,242,0.14),0_16px_42px_rgba(0,245,255,0.06)]">
                  <div className="flex min-h-[210px] md:h-64 md:min-h-0 md:flex-row">
                    <div className="relative w-[42%] shrink-0 border-r border-white/10 md:h-full md:w-1/2">
                      <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${t.photo})` }} />
                      {t.verified && (
                        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full border border-[#00F5FF]/30 bg-[#00F5FF]/10 px-2 py-0.5">
                          <MSIcon name="verified" className="text-[11px] text-[#00F5FF]" />
                          <span className="text-[9px] font-bold uppercase tracking-widest text-[#00F5FF]">Verified</span>
                        </div>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-between p-3 md:p-4">
                      <div>
                        <div className="mb-1.5 flex items-start justify-between">
                          <div>
                            <h3 className="text-[18px] font-semibold tracking-tight text-white md:text-[20px]">{t.name}</h3>
                            <p className="text-[13px] font-medium text-[#00F5FF]">{CITY}<span className="text-white/50">, {COUNTRY}</span></p>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                            <p className="text-[14px] font-bold text-yellow-400">★ {t.rating}</p>
                            <p className="text-[10px] text-white/40">{t.reviews} reviews</p>
                          </div>
                        </div>
                        <div className="mb-2 flex items-center gap-1.5 text-[12px] text-white/45">
                          <MSIcon name="workspace_premium" className="text-[14px] text-[#00F5FF]" />
                          <span className="text-white/70">{t.refs}</span> References
                        </div>
                        <p className="mb-2 text-[12px] leading-relaxed text-white/55">{t.tagline}</p>
                        <div className="flex items-center gap-2">
                          <MSIcon name="person_play" className="text-[14px] text-[#00F5FF]" />
                          <div className="flex gap-2">
                            {Object.keys(t.danceSkills).map((s) => (
                              <span key={s} className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300 capitalize">{s}</span>
                            ))}
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <MSIcon name="public" className="text-[14px] text-[#00F5FF]" />
                          <div className="flex gap-1.5">
                            {t.langs.map((l) => (
                              <div key={l} className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[9px] font-bold text-white/70">{l}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2 pt-2 md:pt-3">
                        <Link href={`/profile/${t.id}`} className="inline-flex min-h-[42px] flex-1 items-center justify-center rounded-full border border-white/10 text-[10px] font-semibold uppercase tracking-widest transition hover:bg-white/5">View</Link>
                        <button className="flex min-h-[42px] flex-[1.5] items-center justify-center gap-1.5 rounded-full text-[11px] font-extrabold uppercase tracking-tight text-[#0A0A0A]" style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#d93bff)" }}>
                          Book a class
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
