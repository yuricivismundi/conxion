"use client";

// DEMO PAGE — /discover/cities/demo — delete folder when done reviewing

import { useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";

const CITY = "Tallinn";
const COUNTRY = "Estonia";

const POPULAR_CITIES = [
  { name: "Tallinn", country: "Estonia", members: 24 },
  { name: "Barcelona", country: "Spain", members: 187 },
  { name: "Berlin", country: "Germany", members: 143 },
  { name: "Paris", country: "France", members: 210 },
  { name: "Medellín", country: "Colombia", members: 98 },
  { name: "Lisbon", country: "Portugal", members: 76 },
  { name: "Amsterdam", country: "Netherlands", members: 64 },
  { name: "Buenos Aires", country: "Argentina", members: 112 },
];

const MEMBERS = [
  { id: "1", name: "Maria K.", photo: "https://i.pravatar.cc/400?img=47", displayRole: "Teacher", styles: ["Bachata", "Salsa"], langs: ["EN", "ES"], refs: 12, verified: true, isHost: true },
  { id: "2", name: "Andres V.", photo: "https://i.pravatar.cc/400?img=12", displayRole: "Social Dancer", styles: ["Kizomba"], langs: ["EN", "ET"], refs: 4, verified: false, isHost: false },
  { id: "3", name: "Elena S.", photo: "https://i.pravatar.cc/400?img=25", displayRole: "Organizer", styles: ["Bachata", "Zouk"], langs: ["RU", "EN"], refs: 8, verified: true, isHost: true },
  { id: "4", name: "Taavi M.", photo: "https://i.pravatar.cc/400?img=33", displayRole: "Social Dancer", styles: ["Salsa"], langs: ["ET"], refs: 2, verified: false, isHost: false },
  { id: "5", name: "Liisa P.", photo: "https://i.pravatar.cc/400?img=56", displayRole: "Student", styles: ["Zouk", "Kizomba"], langs: ["EN", "FI"], refs: 1, verified: false, isHost: false },
  { id: "6", name: "Risto H.", photo: "https://i.pravatar.cc/400?img=68", displayRole: "Teacher", styles: ["Bachata"], langs: ["ET", "EN"], refs: 19, verified: true, isHost: true },
];

const TRAVELERS = [
  { id: "t1", name: "Carlos R.", photo: "https://i.pravatar.cc/400?img=15", from: "Madrid · Spain", arrival: "Jun 20", departure: "Jun 27", styles: ["Bachata", "Salsa"], purpose: "Dancing" },
  { id: "t2", name: "Sophie L.", photo: "https://i.pravatar.cc/400?img=44", from: "Paris · France", arrival: "Jun 22", departure: "Jun 30", styles: ["Zouk"], purpose: "Travelling" },
  { id: "t3", name: "Diego M.", photo: "https://i.pravatar.cc/400?img=8", from: "Buenos Aires · Argentina", arrival: "Jul 1", departure: "Jul 10", styles: ["Tango", "Salsa"], purpose: "Dancing" },
  { id: "t4", name: "Yuki T.", photo: "https://i.pravatar.cc/400?img=29", from: "Tokyo · Japan", arrival: "Jul 3", departure: "Jul 7", styles: ["Bachata"], purpose: "Travelling" },
];

const EVENTS = [
  { id: "e1", title: "Tallinn Bachata Night", weekday: "FRI", month: "JUN", day: "20", time: "Fri Jun 20 · 9 PM", venue: "Club Tuur", styles: ["Bachata", "Salsa"], image: "https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=600&h=240&fit=crop", attendees: 34 },
  { id: "e2", title: "Social Salsa Sunday", weekday: "SUN", month: "JUN", day: "22", time: "Sun Jun 22 · 7 PM", venue: "Dance Factory", styles: ["Salsa"], image: "https://images.unsplash.com/photo-1545959570-a94084071b5d?w=600&h=240&fit=crop", attendees: 21 },
  { id: "e3", title: "Zouk & Kizomba Festival", weekday: "SAT", month: "JUN", day: "28", time: "Sat Jun 28 · 8 PM", venue: "Kultuurikatel", styles: ["Zouk", "Kizomba"], image: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&h=240&fit=crop", attendees: 89 },
  { id: "e4", title: "Beginner Bachata Workshop", weekday: "WED", month: "JUL", day: "2", time: "Wed Jul 2 · 6:30 PM", venue: "Move Studio", styles: ["Bachata"], image: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&h=240&fit=crop", attendees: 12 },
];

const TEACHERS = [
  { id: "tc1", name: "Maria K.", photo: "https://i.pravatar.cc/400?img=47", styles: ["Bachata", "Salsa"], tagline: "Sensual Bachata · 8 years teaching", rating: 4.9, reviews: 34, verified: true },
  { id: "tc2", name: "Elena S.", photo: "https://i.pravatar.cc/400?img=25", styles: ["Bachata", "Zouk"], tagline: "Zouk & Bachata fusion specialist", rating: 4.7, reviews: 18, verified: true },
  { id: "tc3", name: "Risto H.", photo: "https://i.pravatar.cc/400?img=68", styles: ["Bachata"], tagline: "Urban Bachata · Private & group classes", rating: 4.8, reviews: 22, verified: false },
];

type Tab = "members" | "travelers" | "events" | "teachers";

export default function CityDemoPage() {
  const [tab, setTab] = useState<Tab>("members");
  const [citySearch, setCitySearch] = useState("");
  const [hostsOnly, setHostsOnly] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");

  const filteredMembers = MEMBERS.filter((m) => {
    if (hostsOnly && !m.isHost) return false;
    if (memberSearch && !m.name.toLowerCase().includes(memberSearch.toLowerCase())) return false;
    return true;
  });

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "members", label: "Members", icon: "person" },
    { id: "travelers", label: "Travelers", icon: "flight" },
    { id: "events", label: "Events", icon: "celebration" },
    { id: "teachers", label: "Teachers", icon: "school" },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />

      {/* demo badge */}
      <div className="flex items-center justify-between border-b border-amber-400/20 bg-amber-500/10 px-4 py-2">
        <span className="text-[11px] font-semibold text-amber-300">⚠ Design preview — dummy data only</span>
        <Link href="/discover" className="text-[11px] text-amber-300 underline underline-offset-2">← Exit</Link>
      </div>

      {/* ── CITY SEARCH ─────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-2xl px-6 pt-10 pb-2">
        <p className="mb-6 text-center text-[28px] font-bold tracking-tight text-white">Discover your next city</p>
        <label className="relative block">
          <span className="material-symbols-outlined pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[20px] text-white/25">search</span>
          <input
            type="search"
            value={citySearch}
            onChange={(e) => setCitySearch(e.target.value)}
            placeholder="Search a city…"
            className="h-14 w-full rounded-2xl border border-white/[0.08] bg-white/[0.04] pl-12 pr-5 text-[15px] text-white outline-none placeholder:text-white/25 transition focus:border-white/20 focus:bg-white/[0.06]"
          />
        </label>
      </div>

      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <div className="relative flex flex-col items-center justify-center gap-3 py-8 text-center md:py-10">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A] via-[#0d1117] to-[#0A0A0A]" />
        <div className="relative flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-white/50">{COUNTRY}</p>
            <span className="rounded-full bg-[#00F5FF]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#00F5FF]/80">Your city</span>
          </div>
          <h1 className="text-[56px] font-black leading-none tracking-tight text-white md:text-[72px]">{CITY}</h1>
        </div>
      </div>

      {/* ── TABS ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#0A0A0A]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-3 px-6 py-4">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded-2xl px-5 py-2.5 text-[13px] font-semibold tracking-wide transition-all duration-200 ${
                  active
                    ? "border border-[#00F5FF]/40 bg-[#00F5FF]/[0.07] text-[#00F5FF] shadow-[0_0_16px_0_rgba(0,245,255,0.15)]"
                    : "text-white/35 hover:text-white/60"
                }`}
              >
                <span className={`material-symbols-outlined text-[17px] ${active ? "text-[#00F5FF]" : "text-white/30"}`}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── CONTENT ─────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-5xl px-4 pb-32 pt-8 md:px-8">

        {/* ══ MEMBERS ══ */}
        {tab === "members" && (
          <div>
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-white/35">{filteredMembers.length} members</span>
                <button
                  onClick={() => setHostsOnly((v) => !v)}
                  className={`rounded-full border px-3 py-1 text-[12px] transition ${hostsOnly ? "border-white/20 text-white" : "border-white/[0.08] text-white/35 hover:text-white/60"}`}
                >
                  Hosts only
                </button>
              </div>
              <label className="relative">
                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-white/25">search</span>
                <input
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Search by name"
                  className="h-9 w-48 rounded-full border border-white/[0.08] bg-white/[0.03] pl-9 pr-3 text-[12px] text-white outline-none placeholder:text-white/25 focus:border-white/20"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {filteredMembers.map((m) => (
                <div
                  key={m.id}
                  className="group overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111318] transition hover:border-white/[0.14]"
                >
                  <div className="flex h-52">
                    {/* photo placeholder */}
                    <div className="relative w-[45%] shrink-0 overflow-hidden bg-gradient-to-br from-white/[0.06] to-white/[0.02] flex items-center justify-center">
                      <span className="text-[40px] font-black text-white/10 select-none">{m.name.charAt(0)}</span>
                      {m.isHost && (
                        <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/70 backdrop-blur-sm">Host</span>
                      )}
                    </div>
                    {/* info */}
                    <div className="flex flex-1 flex-col justify-between px-4 py-4">
                      <div>
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="text-[17px] font-semibold text-white">
                              {m.name}
                              {m.verified && <span className="material-symbols-outlined ml-1.5 align-middle text-[15px] text-[#00F5FF]">verified</span>}
                            </h3>
                            <p className="mt-0.5 text-[12px] text-white/40">{m.displayRole}</p>
                          </div>
                          <span className="text-[11px] text-white/25">{m.refs} refs</span>
                        </div>
                        <div className="mt-3 space-y-1.5">
                          <p className="text-[12px] text-white/50">{m.styles.join(" · ")}</p>
                          <div className="flex gap-1.5">
                            {m.langs.map((l) => (
                              <span key={l} className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] font-semibold text-white/40">{l}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Link href={`/profile/${m.id}`} className="flex h-9 flex-1 items-center justify-center rounded-full border border-white/[0.08] text-[11px] font-semibold text-white/50 transition hover:border-white/20 hover:text-white/80">
                          View
                        </Link>
                        <button className="flex h-9 flex-[1.4] items-center justify-center rounded-full text-[11px] font-bold text-[#0A0A0A]" style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#ff00ff)" }}>
                          + Connect
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ TRAVELERS ══ */}
        {tab === "travelers" && (
          <div>
            <p className="mb-6 text-[13px] text-white/35">{TRAVELERS.length} dancers visiting {CITY}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TRAVELERS.map((t) => (
                <div key={t.id} className="group relative h-72 overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-white/[0.05] to-white/[0.01] flex items-center justify-center">
                  <span className="text-[80px] font-black text-white/[0.05] select-none">{t.name.charAt(0)}</span>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">{t.from}</p>
                    <h3 className="mt-0.5 text-[22px] font-bold text-white">{t.name}</h3>
                    <p className="mt-0.5 text-[12px] text-[#00F5FF]/80">{t.arrival} → {t.departure}</p>
                    <p className="mt-0.5 text-[12px] text-white/40">{t.styles.join(" · ")}</p>
                    <div className="mt-3 flex gap-2">
                      <button className="flex h-9 flex-1 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[11px] font-semibold text-white/70 backdrop-blur-sm transition hover:bg-white/10">
                        Offer Hosting
                      </button>
                      <button className="flex h-9 flex-1 items-center justify-center rounded-full text-[11px] font-bold text-[#040a0f]" style={{ backgroundImage: "linear-gradient(90deg,#0df2f2,#ff00ff)" }}>
                        Join Trip
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ EVENTS ══ */}
        {tab === "events" && (
          <div>
            <p className="mb-6 text-[13px] text-white/35">{EVENTS.length} upcoming events in {CITY}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {EVENTS.map((e) => (
                <article key={e.id} className="group overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111318] transition hover:border-white/[0.14]">
                  <div className="relative h-36 overflow-hidden bg-gradient-to-br from-[#0d1520] to-[#111318] flex items-center justify-center">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/[0.08] text-center px-4">{e.styles.join(" · ")}</span>
                    <div className="absolute inset-0 bg-gradient-to-t from-[#111318] to-transparent" />
                    <div className="absolute right-3 top-3 rounded-xl border border-white/10 bg-black/60 px-2.5 py-1.5 text-center backdrop-blur-sm">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-white/50">{e.weekday} {e.month}</p>
                      <p className="text-[20px] font-black leading-none text-white">{e.day}</p>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <h3 className="text-[15px] font-semibold text-white">{e.title}</h3>
                    <p className="mt-0.5 text-[12px] text-white/40">{e.time} · {e.venue}</p>
                    <p className="mt-0.5 text-[12px] text-white/30">{e.styles.join(" · ")} · {e.attendees} going</p>
                    <div className="mt-3 flex gap-2">
                      <button className="flex h-9 flex-1 items-center justify-center rounded-full border border-white/[0.08] text-[11px] font-semibold text-white/50 transition hover:border-white/20 hover:text-white/80">
                        Interested
                      </button>
                      <Link href="/events" className="flex h-9 flex-1 items-center justify-center rounded-full text-[11px] font-bold text-[#0A0A0A]" style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#ff00ff)" }}>
                        View event
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <Link href="/events" className="mt-5 flex items-center justify-center gap-2 rounded-full border border-white/[0.08] py-3 text-[13px] font-semibold text-white/40 transition hover:border-white/20 hover:text-white/70">
              See all events in {CITY} →
            </Link>
          </div>
        )}

        {/* ══ TEACHERS ══ */}
        {tab === "teachers" && (
          <div>
            <p className="mb-6 text-[13px] text-white/35">{TEACHERS.length} teachers in {CITY}</p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {TEACHERS.map((t) => (
                <div key={t.id} className="group overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111318] transition hover:border-white/[0.14]">
                  <div className="flex h-52">
                    <div className="relative w-[40%] shrink-0 overflow-hidden bg-gradient-to-br from-white/[0.06] to-white/[0.02] flex items-center justify-center">
                      <span className="text-[40px] font-black text-white/10 select-none">{t.name.charAt(0)}</span>
                    </div>
                    <div className="flex flex-1 flex-col justify-between px-4 py-4">
                      <div>
                        <div className="flex items-start justify-between">
                          <h3 className="text-[17px] font-semibold text-white">
                            {t.name}
                            {t.verified && <span className="material-symbols-outlined ml-1.5 align-middle text-[15px] text-[#00F5FF]">verified</span>}
                          </h3>
                          <span className="text-[12px] font-bold text-yellow-400/90">★ {t.rating}</span>
                        </div>
                        <p className="mt-0.5 text-[12px] text-white/40">{t.tagline}</p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {t.styles.map((s) => (
                            <span key={s} className="rounded-full border border-[#00F5FF]/20 px-2.5 py-0.5 text-[11px] text-[#00F5FF]/70">{s}</span>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] text-white/25">{t.reviews} reviews</p>
                      </div>
                      <div className="flex gap-2">
                        <Link href={`/profile/${t.id}`} className="flex h-9 flex-1 items-center justify-center rounded-full border border-white/[0.08] text-[11px] font-semibold text-white/50 transition hover:border-white/20 hover:text-white/80">
                          Profile
                        </Link>
                        <button className="flex h-9 flex-[1.4] items-center justify-center rounded-full text-[11px] font-bold text-[#0A0A0A]" style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#d93bff)" }}>
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
