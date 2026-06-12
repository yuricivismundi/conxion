"use client";

import { useState } from "react";
import Link from "next/link";

// ─── DUMMY DATA ────────────────────────────────────────────────────────────────

const CITY = { name: "Tallinn", country: "Estonia", emoji: "🇪🇪" };
const STATS = { members: 24, travelers: 6, events: 8, teachers: 3 };

const MEMBERS = [
  { id: "1", name: "Maria K.", avatar: "https://i.pravatar.cc/80?img=47", city: "Tallinn", roles: ["Bachata", "Salsa"], isHost: true, active: true },
  { id: "2", name: "Andres V.", avatar: "https://i.pravatar.cc/80?img=12", city: "Tallinn", roles: ["Kizomba"], isHost: false, active: true },
  { id: "3", name: "Elena S.", avatar: "https://i.pravatar.cc/80?img=25", city: "Tallinn", roles: ["Bachata", "Zouk"], isHost: true, active: false },
  { id: "4", name: "Taavi M.", avatar: "https://i.pravatar.cc/80?img=33", city: "Tallinn", roles: ["Salsa"], isHost: false, active: true },
  { id: "5", name: "Liisa P.", avatar: "https://i.pravatar.cc/80?img=56", city: "Tallinn", roles: ["Zouk", "Kizomba"], isHost: false, active: false },
  { id: "6", name: "Risto H.", avatar: "https://i.pravatar.cc/80?img=68", city: "Tallinn", roles: ["Bachata"], isHost: true, active: true },
];

const TRAVELERS = [
  { id: "t1", name: "Carlos R.", avatar: "https://i.pravatar.cc/80?img=15", from: "Madrid, Spain", arrival: "Jun 20", departure: "Jun 27", roles: ["Bachata", "Salsa"] },
  { id: "t2", name: "Sophie L.", avatar: "https://i.pravatar.cc/80?img=44", from: "Paris, France", arrival: "Jun 22", departure: "Jun 30", roles: ["Zouk"] },
  { id: "t3", name: "Diego M.", avatar: "https://i.pravatar.cc/80?img=8", from: "Buenos Aires", arrival: "Jul 1", departure: "Jul 10", roles: ["Tango", "Salsa"] },
  { id: "t4", name: "Yuki T.", avatar: "https://i.pravatar.cc/80?img=29", from: "Tokyo, Japan", arrival: "Jul 3", departure: "Jul 7", roles: ["Bachata"] },
];

const EVENTS = [
  { id: "e1", title: "Tallinn Bachata Night", date: "Fri, Jun 20 · 9:00 PM", venue: "Club Tuur", image: "https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=400&h=220&fit=crop", attendees: 34 },
  { id: "e2", title: "Social Salsa Sunday", date: "Sun, Jun 22 · 7:00 PM", venue: "Dance Factory", image: "https://images.unsplash.com/photo-1545959570-a94084071b5d?w=400&h=220&fit=crop", attendees: 21 },
  { id: "e3", title: "Zouk & Kizomba Festival", date: "Sat, Jun 28 · 8:00 PM", venue: "Kultuurikatel", image: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=400&h=220&fit=crop", attendees: 89 },
  { id: "e4", title: "Beginner Bachata Workshop", date: "Wed, Jul 2 · 6:30 PM", venue: "Move Studio", image: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=400&h=220&fit=crop", attendees: 12 },
];

const TEACHERS = [
  { id: "tc1", name: "Maria K.", avatar: "https://i.pravatar.cc/80?img=47", styles: ["Bachata", "Salsa"], tagline: "Sensual Bachata · 8 years teaching", rating: 4.9, reviews: 34, verified: true },
  { id: "tc2", name: "Elena S.", avatar: "https://i.pravatar.cc/80?img=25", styles: ["Bachata", "Zouk"], tagline: "Zouk & Bachata fusion specialist", rating: 4.7, reviews: 18, verified: true },
  { id: "tc3", name: "Risto H.", avatar: "https://i.pravatar.cc/80?img=68", styles: ["Bachata"], tagline: "Urban Bachata · Group & private classes", rating: 4.8, reviews: 22, verified: false },
];

// ─── TAB TYPE ──────────────────────────────────────────────────────────────────
type Tab = "members" | "travelers" | "events" | "teachers";

// ─── MEMBER FILTER ─────────────────────────────────────────────────────────────
type MemberFilter = "all" | "hosts" | "active";

// ─── PAGE ──────────────────────────────────────────────────────────────────────
export default function CityDemoPage() {
  const [tab, setTab] = useState<Tab>("members");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");

  const filteredMembers = MEMBERS.filter((m) => {
    if (memberFilter === "hosts") return m.isHost;
    if (memberFilter === "active") return m.active;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#080a0e] text-white">

      {/* ── DEMO BANNER ── */}
      <div className="sticky top-0 z-50 flex items-center justify-between bg-amber-500/20 border-b border-amber-400/30 px-4 py-2">
        <span className="text-xs text-amber-300 font-medium">Design preview — dummy data only</span>
        <Link href="/discover" className="text-xs text-amber-300 underline">← Back to Discover</Link>
      </div>

      {/* ── HERO ── */}
      <div className="relative h-52 overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1587789202069-44b8cf1b1998?w=1200&h=400&fit=crop"
          alt="Tallinn"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#080a0e] via-[#080a0e]/50 to-transparent" />
        <div className="absolute bottom-0 left-0 p-4">
          <p className="text-xs text-slate-400 mb-0.5">{CITY.emoji} Estonia</p>
          <h1 className="text-3xl font-bold tracking-tight">{CITY.name}</h1>
        </div>
      </div>

      {/* ── STATS STRIP ── */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-white/[0.06] overflow-x-auto">
        <StatPill icon="👥" label="Members" value={STATS.members} onClick={() => setTab("members")} active={tab === "members"} />
        <StatPill icon="✈️" label="Travelers" value={STATS.travelers} onClick={() => setTab("travelers")} active={tab === "travelers"} />
        <StatPill icon="🎉" label="Events" value={STATS.events} onClick={() => setTab("events")} active={tab === "events"} />
        <StatPill icon="🎓" label="Teachers" value={STATS.teachers} onClick={() => setTab("teachers")} active={tab === "teachers"} />
      </div>

      {/* ── TABS ── */}
      <div className="flex border-b border-white/[0.06]">
        {(["members", "travelers", "events", "teachers"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium capitalize transition ${
              tab === t
                ? "text-cyan-300 border-b-2 border-cyan-400"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── CONTENT ── */}
      <div className="px-4 pb-24 pt-4 max-w-2xl mx-auto">

        {/* MEMBERS */}
        {tab === "members" && (
          <div>
            {/* filter chips */}
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
              {(["all", "hosts", "active"] as MemberFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setMemberFilter(f)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                    memberFilter === f
                      ? "bg-cyan-400/20 text-cyan-300 border border-cyan-400/40"
                      : "bg-white/[0.06] text-slate-400 border border-white/10 hover:text-white"
                  }`}
                >
                  {f === "all" ? "All members" : f === "hosts" ? "🏠 Hosts" : "⚡ Active recently"}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {filteredMembers.map((m) => (
                <div key={m.id} className="rounded-2xl bg-white/[0.04] border border-white/[0.07] p-3 flex flex-col items-center text-center gap-2">
                  <div className="relative">
                    <img src={m.avatar} alt={m.name} className="w-14 h-14 rounded-full object-cover" />
                    {m.isHost && (
                      <span className="absolute -bottom-1 -right-1 text-[10px] bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 rounded-full px-1.5 py-0.5">Host</span>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{m.name}</p>
                    <p className="text-[11px] text-slate-400">{m.roles.join(" · ")}</p>
                  </div>
                  <button className="w-full rounded-full bg-white/[0.07] border border-white/10 py-1 text-xs text-slate-300 hover:bg-white/[0.12] transition">
                    Connect
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-xs text-slate-500">{STATS.members} members in {CITY.name}</p>
          </div>
        )}

        {/* TRAVELERS */}
        {tab === "travelers" && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 mb-3">Dancers visiting {CITY.name} soon</p>
            {TRAVELERS.map((t) => (
              <div key={t.id} className="rounded-2xl bg-white/[0.04] border border-white/[0.07] p-4 flex items-center gap-3">
                <img src={t.avatar} alt={t.name} className="w-12 h-12 rounded-full object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{t.name}</p>
                  <p className="text-[11px] text-slate-400 truncate">From {t.from}</p>
                  <p className="text-[11px] text-cyan-400 mt-0.5">✈️ {t.arrival} → {t.departure}</p>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {t.roles.map((r) => (
                      <span key={r} className="text-[10px] bg-white/[0.06] border border-white/10 rounded-full px-2 py-0.5 text-slate-300">{r}</span>
                    ))}
                  </div>
                </div>
                <button className="shrink-0 rounded-full bg-white/[0.07] border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.12] transition">
                  Connect
                </button>
              </div>
            ))}
          </div>
        )}

        {/* EVENTS */}
        {tab === "events" && (
          <div>
            <p className="text-xs text-slate-500 mb-3">Upcoming events in {CITY.name}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {EVENTS.map((e) => (
                <div key={e.id} className="rounded-2xl overflow-hidden border border-white/[0.07] bg-white/[0.04]">
                  <div className="relative h-36">
                    <img src={e.image} alt={e.title} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                    <div className="absolute bottom-0 left-0 p-3">
                      <p className="text-xs text-cyan-300">{e.date}</p>
                      <p className="text-sm font-semibold leading-tight">{e.title}</p>
                    </div>
                  </div>
                  <div className="px-3 py-2 flex items-center justify-between">
                    <p className="text-[11px] text-slate-400">📍 {e.venue}</p>
                    <p className="text-[11px] text-slate-400">👥 {e.attendees}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* See all CTA */}
            <Link
              href="/events"
              className="mt-4 flex items-center justify-center gap-2 w-full rounded-full border border-cyan-400/30 bg-cyan-400/10 py-3 text-sm text-cyan-300 font-medium hover:bg-cyan-400/20 transition"
            >
              See all events in {CITY.name} →
            </Link>
          </div>
        )}

        {/* TEACHERS */}
        {tab === "teachers" && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 mb-3">Dance teachers based in {CITY.name}</p>
            {TEACHERS.map((t) => (
              <div key={t.id} className="rounded-2xl bg-white/[0.04] border border-white/[0.07] p-4 flex gap-4">
                <div className="relative shrink-0">
                  <img src={t.avatar} alt={t.name} className="w-16 h-16 rounded-2xl object-cover" />
                  {t.verified && (
                    <span className="absolute -top-1 -right-1 text-sm">✅</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <p className="text-sm font-semibold">{t.name}</p>
                    <span className="text-xs text-yellow-400">★ {t.rating} <span className="text-slate-500">({t.reviews})</span></span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">{t.tagline}</p>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {t.styles.map((s) => (
                      <span key={s} className="text-[10px] bg-cyan-400/10 border border-cyan-400/20 rounded-full px-2 py-0.5 text-cyan-300">{s}</span>
                    ))}
                  </div>
                  <button className="mt-2 rounded-full bg-[linear-gradient(135deg,#0df2f2,#d93bff)] text-[#041316] px-4 py-1.5 text-xs font-semibold hover:brightness-110 transition">
                    Book a class
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

// ─── STAT PILL ─────────────────────────────────────────────────────────────────
function StatPill({ icon, label, value, onClick, active }: {
  icon: string; label: string; value: number; onClick: () => void; active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition border ${
        active
          ? "bg-cyan-400/15 border-cyan-400/40 text-cyan-300"
          : "bg-white/[0.05] border-white/10 text-slate-400 hover:text-white"
      }`}
    >
      <span>{icon}</span>
      <span className="font-bold text-white">{value}</span>
      <span>{label}</span>
    </button>
  );
}
