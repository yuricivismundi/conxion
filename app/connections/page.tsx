"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Country, City } from "country-state-city";
import { supabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

type Tab = "members" | "travellers";

type Level = "Beginner" | "Improver" | "Intermediate" | "Advanced" | "Teacher/Competitor";

const ROLES = [
  "Social dancer / Student",
  "Organizer",
  "Studio Owner",
  "Promoter",
  "DJ",
  "Artist",
  "Teacher",
] as const;

const STYLES = ["Bachata", "Salsa", "Kizomba", "Zouk"] as const;

const LEVELS: Level[] = ["Beginner", "Improver", "Intermediate", "Advanced", "Teacher/Competitor"];

const LANGUAGES = [
  "English",
  "Spanish",
  "Italian",
  "Estonian",
  "French",
  "German",
  "Portuguese",
  "Russian",
  "Ukrainian",
  "Polish",
  "Swedish",
  "Finnish",
] as const;

const INTERESTS = [
  "Practice Partner",
  "Social Dancing",
  "Improve Technique",
  "Congress Buddy",
  "Find Teachers",
  "Travel to Events",
  "Language Exchange",
  "Meet Groups",
] as const;

const AVAILABILITY = [
  "Weekdays",
  "Weekends",
  "DayTime",
  "Evenings",
  "Travel for Events",
  "I’d rather not say",
] as const;

function langLabelToCode(label: string): string {
  const map: Record<string, string> = {
    English: "EN",
    Spanish: "ES",
    Italian: "IT",
    Estonian: "ET",
    French: "FR",
    German: "DE",
    Portuguese: "PT",
    Russian: "RU",
    Ukrainian: "UK",
    Polish: "PL",
    Swedish: "SV",
    Finnish: "FI",
  };
  return map[label] ?? label.toUpperCase().slice(0, 2);
}

type MemberCard = {
  id: string;
  name: string;
  city: string;
  country: string;
  verified?: boolean;
  roles: string[];
  danceSkills: Partial<Record<(typeof STYLES)[number], Level>>;
  otherStyle?: boolean;
  langs?: string[]; // stored as codes in cards (EN/ES/...)
  interest?: string;
  availability?: string;
  photoUrl?: string;
};

// 10 demo members
const DEMO_MEMBERS: MemberCard[] = [
  {
    id: "1",
    name: "Alex Rivera",
    city: "Berlin",
    country: "Germany",
    verified: true,
    roles: ["Teacher", "Social dancer / Student"],
    danceSkills: { Bachata: "Advanced", Salsa: "Intermediate", Kizomba: "Improver" },
    langs: ["ES", "EN"],
    interest: "Find Teachers",
    availability: "Weekdays",
    photoUrl: "https://images.unsplash.com/photo-1520975916090-3105956dac38?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "2",
    name: "Sofia Chen",
    city: "Barcelona",
    country: "Spain",
    verified: true,
    roles: ["Artist", "Promoter"],
    danceSkills: { Zouk: "Improver", Salsa: "Beginner" },
    langs: ["ES", "EN"],
    interest: "Travel to Events",
    availability: "Weekends",
    photoUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "3",
    name: "Maya Patel",
    city: "Lisbon",
    country: "Portugal",
    verified: false,
    roles: ["Social dancer / Student"],
    danceSkills: { Bachata: "Intermediate" },
    otherStyle: true,
    langs: ["EN", "PT"],
    interest: "Practice Partner",
    availability: "Evenings",
    photoUrl: "https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "4",
    name: "Elena Rossi",
    city: "Rome",
    country: "Italy",
    verified: true,
    roles: ["Organizer"],
    danceSkills: { Salsa: "Advanced", Bachata: "Improver" },
    langs: ["IT", "EN"],
    interest: "Meet Groups",
    availability: "Weekdays",
    photoUrl: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "5",
    name: "Marcus Thorne",
    city: "London",
    country: "United Kingdom",
    verified: false,
    roles: ["DJ"],
    danceSkills: { Kizomba: "Intermediate" },
    langs: ["EN"],
    interest: "Social Dancing",
    availability: "Travel for Events",
    photoUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "6",
    name: "Julian Vane",
    city: "Paris",
    country: "France",
    verified: true,
    roles: ["Teacher"],
    danceSkills: { Zouk: "Advanced", Bachata: "Intermediate" },
    langs: ["FR", "EN"],
    interest: "Improve Technique",
    availability: "DayTime",
    photoUrl: "https://images.unsplash.com/photo-1548142813-c348350df52b?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "7",
    name: "Nina Kask",
    city: "Tallinn",
    country: "Estonia",
    verified: false,
    roles: ["Studio Owner"],
    danceSkills: { Salsa: "Intermediate" },
    langs: ["ET", "EN"],
    interest: "Find Teachers",
    availability: "Weekdays",
    photoUrl: "https://images.unsplash.com/photo-1547425260-76bcadfb4f2c?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "8",
    name: "Diego Alvarez",
    city: "Madrid",
    country: "Spain",
    verified: true,
    roles: ["Promoter"],
    danceSkills: { Bachata: "Improver", Salsa: "Improver" },
    langs: ["ES", "EN"],
    interest: "Travel to Events",
    availability: "Weekends",
    photoUrl: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "9",
    name: "Hanna Virtanen",
    city: "Helsinki",
    country: "Finland",
    verified: false,
    roles: ["Social dancer / Student"],
    danceSkills: { Zouk: "Beginner" },
    langs: ["FI", "EN"],
    interest: "Language Exchange",
    availability: "Evenings",
    photoUrl: "https://images.unsplash.com/photo-1525134479668-1bee5c7c6845?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "10",
    name: "Katarina Nowak",
    city: "Warsaw",
    country: "Poland",
    verified: true,
    roles: ["Organizer", "Artist"],
    danceSkills: { Kizomba: "Advanced" },
    langs: ["PL", "EN"],
    interest: "Congress Buddy",
    availability: "Travel for Events",
    photoUrl: "https://images.unsplash.com/photo-1520962917960-14d3a4a0d2b0?auto=format&fit=crop&w=1200&q=80",
  },
];

function Pill({ children, active }: { children: ReactNode; active?: boolean }) {
      return (
    <span
      className={[
        "text-[10px] px-2 py-0.5 rounded-full border",
        active ? "bg-[#00F5FF]/15 text-[#00F5FF] border-[#00F5FF]/25" : "bg-white/5 text-white/60 border-white/10",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function SignOutButton({ onError }: { onError: (msg: string) => void }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          const { error } = await supabase.auth.signOut();
          if (error) throw error;
          router.replace("/auth");
        } catch {
          onError(
            "Sign out failed (Failed to fetch). Verify NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local and restart dev server. Also check VPN/adblock."
          );
        }
      }}
      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-bold text-white/70 hover:text-white hover:border-white/20 transition"
      title="Sign out"
    >
      Sign out
    </button>
  );
}

type FiltersState = {
  country?: string;
  cities: string[]; // max 3
  roles: (typeof ROLES)[number][];
  styleLevels: Partial<Record<(typeof STYLES)[number], Level>>;
  otherStyle: boolean;
  langs: string[]; // labels
  interest?: (typeof INTERESTS)[number]; // single
  availability?: (typeof AVAILABILITY)[number]; // single
  verifiedOnly: boolean;
};

const EMPTY_FILTERS: FiltersState = {
  country: undefined,
  cities: [],
  roles: [],
  styleLevels: {},
  otherStyle: false,
  langs: [],
  interest: undefined,
  availability: undefined,
  verifiedOnly: false,
};

export default function ConnectionsPage() {
  const [tab, setTab] = useState<Tab>("members");
  const [myCityOnly, setMyCityOnly] = useState(false);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<FiltersState>(EMPTY_FILTERS);

  const [uiError, setUiError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { error } = await supabase.auth.getSession();
        if (error) throw error;
      } catch {
        setUiError(
          "Supabase auth fetch failed. Verify NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local and restart dev server."
        );
      }
    })();
  }, []);

  // Country + City library (same as onboarding)
  const countriesAll = useMemo(() => Country.getAllCountries(), []);
  const countryNames = useMemo(() => countriesAll.map((c) => c.name), [countriesAll]);

  const countryIso = useMemo(() => {
    if (!filters.country) return "";
    return countriesAll.find((c) => c.name === filters.country)?.isoCode ?? "";
  }, [countriesAll, filters.country]);

  const cityNames = useMemo(() => {
    if (!countryIso) return [] as string[];
    return (City.getCitiesOfCountry(countryIso) ?? []).map((c) => c.name);
  }, [countryIso]);

  const members = useMemo(() => {
    let list = DEMO_MEMBERS.slice();

    if (myCityOnly) list = list.slice(0, 3);

    if (filters.country) list = list.filter((m) => m.country === filters.country);
    if (filters.cities.length) list = list.filter((m) => filters.cities.includes(m.city));

    if (filters.roles.length) {
      list = list.filter((m) => m.roles.some((r) => filters.roles.includes(r as any)));
    }

    const entries = Object.entries(filters.styleLevels) as Array<[(typeof STYLES)[number], Level]>;
    if (entries.length) {
      list = list.filter((m) => entries.every(([style, lvl]) => (m.danceSkills?.[style] ?? null) === lvl));
    }

    if (filters.otherStyle) list = list.filter((m) => !!m.otherStyle);

    if (filters.langs.length) {
      const codes = filters.langs.map(langLabelToCode);
      list = list.filter((m) => (m.langs ?? []).some((l) => codes.includes(l)));
    }

    if (filters.interest) list = list.filter((m) => (m.interest ?? "") === filters.interest);
    if (filters.availability) list = list.filter((m) => (m.availability ?? "") === filters.availability);
    if (filters.verifiedOnly) list = list.filter((m) => !!m.verified);

    return list;
  }, [myCityOnly, filters]);

  const activeFiltersCount = useMemo(() => {
    let n = 0;
    if (filters.country) n += 1;
    if (filters.cities.length) n += 1;
    if (filters.roles.length) n += 1;
    if (Object.keys(filters.styleLevels).length) n += 1;
    if (filters.otherStyle) n += 1;
    if (filters.langs.length) n += 1;
    if (filters.interest) n += 1;
    if (filters.availability) n += 1;
    if (filters.verifiedOnly) n += 1;
    return n;
  }, [filters]);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0A0A0A]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-10">
            <div className="flex items-center gap-3">
              <div className="relative h-7 w-7">
                <Image src="/branding/conxion-short-logo.png" alt="ConXion" fill className="object-contain" />
              </div>
            </div>

            <nav className="hidden md:flex items-center gap-8 text-sm">
              <Link className="text-[#00F5FF] font-semibold border-b-2 border-[#00F5FF] pb-1" href="/connections">
                Connections
              </Link>
              <Link className="text-white/50 hover:text-white transition" href="/trips">
                Trips
              </Link>
              <Link className="text-white/50 hover:text-white transition" href="/events">
                Events
              </Link>
              <Link className="text-white/50 hover:text-white transition" href="/messages">
                Messages
              </Link>
              <Link className="text-white/50 hover:text-white transition" href="/me">
                My Space
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <SignOutButton onError={(msg) => setUiError(msg)} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-6 py-8">
        {uiError ? (
          <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {uiError}
          </div>
        ) : null}

        <div className="flex justify-center">
          <div className="flex h-12 w-full max-w-md items-center justify-center rounded-full bg-white/5 p-1 border border-white/10">
            <button
              onClick={() => setTab("members")}
              className={[
                "h-full flex-1 rounded-full px-4 text-sm font-bold transition",
                tab === "members" ? "bg-white/10 text-[#00F5FF]" : "text-white/50 hover:text-white",
              ].join(" ")}
            >
              Members
            </button>
            <button
              onClick={() => setTab("travellers")}
              className={[
                "h-full flex-1 rounded-full px-4 text-sm font-bold transition",
                tab === "travellers" ? "bg-white/10 text-[#00F5FF]" : "text-white/50 hover:text-white",
              ].join(" ")}
            >
              Travellers
            </button>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <p className="text-white/50 text-sm">
              Showing <span className="text-white font-semibold">{tab === "members" ? members.length : 0}</span>{" "}
              {tab === "members" ? "members" : "trips"}
            </p>

            <div className="flex items-center gap-4 border-l border-white/10 pl-6">
              <button className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition">
                <span className="text-xl">≡</span>
                <span>Sort</span>
                <span className="text-sm">▾</span>
              </button>

              <label className="flex items-center gap-3 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={myCityOnly}
                  onChange={(e) => setMyCityOnly(e.target.checked)}
                  className="h-5 w-9 accent-[#00F5FF]"
                />
                My City
              </label>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="rounded-full bg-[#00F5FF] px-6 py-2.5 text-sm font-bold text-[#0A0A0A] hover:opacity-90 transition"
          >
            Filters{activeFiltersCount ? ` (${activeFiltersCount})` : ""}
          </button>
        </div>

        {tab === "members" ? (
          <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
            {members.map((m) => (
              <div key={m.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 hover:scale-[1.01] transition">
                <div className="flex flex-col md:flex-row md:h-64">
                  <div className="relative h-48 w-full md:h-full md:w-1/2 bg-white/5">
                    {m.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.photoUrl} alt={m.name} className="h-full w-full object-cover" />
                    ) : null}
                  </div>

                  <div className="flex w-full flex-col justify-between p-5 md:w-1/2">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-lg font-bold">{m.name}</div>
                        {m.verified ? <span className="text-[#FF00FF] text-sm">●</span> : null}
                      </div>

                      <div className="mt-1 text-xs text-white/50">
                        {m.city}, {m.country}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {m.roles.map((r) => (
                          <Pill key={r} active={r === "Teacher" || r === "Organizer" || r === "Promoter" || r === "Studio Owner"}>
                            {r}
                          </Pill>
                        ))}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {Object.entries(m.danceSkills ?? {}).map(([style, lvl]) => (
                          <span
                            key={style}
                            className="text-[10px] rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-white/70"
                          >
                            {style} · {lvl}
                          </span>
                        ))}
                        {m.otherStyle ? (
                          <span className="text-[10px] rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-white/70">
                            Other
                          </span>
                        ) : null}
                      </div>

                      {m.langs?.length ? (
                        <div className="mt-3 flex gap-2 text-[9px] uppercase font-bold text-white/35">
                          {m.langs.map((l) => (
                            <span key={l}>{l}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button className="flex-1 rounded-full border border-white/20 py-2 text-xs font-bold hover:bg-white/5 transition">
                        View
                      </button>
                      <button
                        className="flex-[1.5] rounded-full py-2 text-xs font-bold text-[#0A0A0A]"
                        style={{ backgroundImage: "linear-gradient(90deg, #00F5FF 0%, #FF00FF 100%)" }}
                      >
                        Connect
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {!members.length ? (
              <div className="xl:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-6 text-white/60">
                No matches with these filters.
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6 text-white/60">
            Travellers feed (trip cards) — next step.
          </div>
        )}
      </main>

      {filtersOpen ? (
        <div className="fixed inset-0 z-[60]">
          <button
            aria-label="Close filters"
            className="absolute inset-0 bg-black/60"
            onClick={() => setFiltersOpen(false)}
            type="button"
          />

          <aside className="absolute right-0 top-0 h-full w-full max-w-md border-l border-white/10 bg-[#0A0A0A] p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xl font-extrabold">Filter Connections</div>
                <div className="mt-1 text-xs text-white/40">Applies to {tab === "members" ? "Members" : "Travellers"}.</div>
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white/70 hover:text-white hover:border-white/20"
              >
                ✕
              </button>
            </div>

            <div className="mt-6 space-y-6 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 160px)" }}>
              {/* Location */}
              <section>
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50">Location</div>

                <div className="mt-3">
                  <label className="text-[11px] text-white/40">Country</label>
                  <select
                    value={filters.country ?? ""}
                    onChange={(e) =>
                      setFilters((p) => ({
                        ...p,
                        country: e.target.value ? e.target.value : undefined,
                        cities: [], // reset cities when country changes
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-white/80 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                  >
                    <option value="">Any country</option>
                    {countryNames.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-white/40">Cities (max 3)</label>
                    <span className="text-[10px] text-white/35">{filters.cities.length}/3</span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {filters.cities.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setFilters((p) => ({ ...p, cities: p.cities.filter((x) => x !== c) }))}
                        className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/80 hover:bg-white/15"
                        title="Remove"
                      >
                        {c} <span className="ml-1 text-white/50">×</span>
                      </button>
                    ))}
                  </div>

                  <select
                    value=""
                    disabled={!filters.country}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      setFilters((p) => {
                        if (p.cities.includes(v)) return p;
                        if (p.cities.length >= 3) return p;
                        return { ...p, cities: [...p.cities, v] };
                      });
                    }}
                    className="mt-3 w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-white/80 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 disabled:opacity-50"
                  >
                    <option value="">{filters.country ? "Add a city…" : "Select a country first"}</option>
                    {cityNames.filter((c) => !filters.cities.includes(c)).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              {/* Roles */}
              <section>
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50">Roles</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {ROLES.map((r) => {
                    const on = filters.roles.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() =>
                          setFilters((p) =>
                            on ? { ...p, roles: p.roles.filter((x) => x !== r) } : { ...p, roles: [...p.roles, r] }
                          )
                        }
                        className={[
                          "rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider transition border",
                          on ? "border-[#00F5FF] text-[#00F5FF] bg-black/25" : "border-white/10 text-white/40 bg-black/20 hover:border-white/20",
                        ].join(" ")}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Dance styles & level */}
              <section>
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50">Dance styles & level</div>
                <div className="mt-3 space-y-3">
                  {STYLES.map((s) => {
                    const current = filters.styleLevels[s];
                    const on = !!current;
                    return (
                      <div key={s} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() =>
                              setFilters((p) => {
                                const next = { ...p.styleLevels };
                                if (next[s]) delete next[s];
                                else next[s] = "Beginner";
                                return { ...p, styleLevels: next };
                              })
                            }
                            className={on ? "text-sm font-extrabold text-[#00F5FF]" : "text-sm font-bold text-white/70 hover:text-white"}
                          >
                            {s}
                          </button>
                          <span className="text-[10px] text-white/35">{on ? "Pick level" : "Off"}</span>
                        </div>

                        {on ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {LEVELS.map((lvl) => {
                              const active = current === lvl;
                              return (
                                <button
                                  key={lvl}
                                  type="button"
                                  onClick={() => setFilters((p) => ({ ...p, styleLevels: { ...p.styleLevels, [s]: lvl } }))}
                                  className={
                                    active
                                      ? "rounded-full border border-[#00F5FF] bg-black/25 px-3 py-2 text-[11px] font-bold text-[#00F5FF]"
                                      : "rounded-full border border-white/10 bg-black/20 px-3 py-2 text-[11px] font-bold text-white/40 hover:border-white/20"
                                  }
                                >
                                  {lvl}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setFilters((p) => ({ ...p, otherStyle: !p.otherStyle }))}
                    className={
                      filters.otherStyle
                        ? "w-full rounded-2xl border border-[#FF00FF] bg-black/25 px-4 py-3 text-left text-sm font-bold text-[#FF00FF]"
                        : "w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm font-bold text-white/50 hover:border-white/20"
                    }
                  >
                    Other (no level)
                  </button>
                </div>
              </section>

              {/* Languages */}
              <section>
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50">Languages</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {LANGUAGES.map((l) => {
                    const on = filters.langs.includes(l);
                    return (
                      <button
                        key={l}
                        type="button"
                        onClick={() =>
                          setFilters((p) => (on
  ? { ...p, langs: p.langs.filter((x) => x !== l) }
  : { ...p, langs: [...p.langs, l].slice(0, 3) }))
                        }
                        className={[
                          "rounded-full px-3 py-2 text-[11px] font-extrabold uppercase tracking-wider transition border",
                          on ? "border-[#00F5FF] text-[#00F5FF] bg-black/25" : "border-white/10 text-white/40 bg-black/20 hover:border-white/20",
                        ].join(" ")}
                      >
                        {l}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Interest (single) */}
              <section>
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50">Interest</div>
                <select
                  value={filters.interest ?? ""}
                  onChange={(e) => setFilters((p) => ({ ...p, interest: e.target.value ? (e.target.value as any) : undefined }))}
                  className="mt-3 w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-white/80 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                >
                  <option value="">Any interest</option>
                  {INTERESTS.map((it) => (
                    <option key={it} value={it}>
                      {it}
                    </option>
                  ))}
                </select>
              </section>

              {/* Availability (single) */}
              <section>
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50">Availability</div>
                <select
                  value={filters.availability ?? ""}
                  onChange={(e) => setFilters((p) => ({ ...p, availability: e.target.value ? (e.target.value as any) : undefined }))}
                  className="mt-3 w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-white/80 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                >
                  <option value="">Any availability</option>
                  {AVAILABILITY.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </section>

              {/* Verified */}
              <section>
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50">Trust</div>
                <label className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                  <span className="text-sm text-white/70">Verified only</span>
                  <input
                    type="checkbox"
                    checked={filters.verifiedOnly}
                    onChange={(e) => setFilters((p) => ({ ...p, verifiedOnly: e.target.checked }))}
                    className="h-5 w-5 accent-[#00F5FF]"
                  />
                </label>
              </section>
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-5">
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="text-sm font-bold text-white/40 hover:text-white/70 underline underline-offset-4"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="rounded-2xl px-8 py-3 font-black uppercase tracking-wide text-[#0A0A0A]"
                style={{ backgroundImage: "linear-gradient(90deg, #00F5FF 0%, #FF00FF 100%)" }}
              >
                Show Connections
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}