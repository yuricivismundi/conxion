"use client";

import { useEffect, useMemo, useState } from "react";
import { Country, City } from "country-state-city";
import { readOnboardingDraft } from "@/lib/onboardingDraft";

const ROLE_PREFS = ["Leader", "Follower", "Switch"] as const;
type RolePref = (typeof ROLE_PREFS)[number];

const ROLES = [
  "Social dancer / Student",
  "Organizer",
  "Studio Owner",
  "Promoter",
  "DJ",
  "Artist",
  "Teacher",
] as const;

type Role = (typeof ROLES)[number];

const INTERESTS = [
  "Dance at local socials and events",
  "Find practice partners",
  "Get tips on the local dance scene",
  "Collaborate on video projects",
  "Find buddies for workshops, socials, accommodations, or rides",
  "Collaborate with artists/teachers for events/festivals",
  "Organize recurring local events",
  "Secure sponsorships and org collabs",
  "Offer volunteer roles for events",
  "Recruit guest dancers",
  "Promote special workshops and events",
  "Organize classes and schedules",
  "Collaborate with other studio owners",
  "Secure sponsorships and hire talent",
  "Partner to promote festivals",
  "Refer artists, DJs, and teachers",
  "Co-promote local parties/socials",
  "Exchange guest lists and shoutouts",
  "Share promo materials and audiences",
  "Produce new songs and tracks",
  "Collaborate on tracks or live sets",
  "Network for festival gigs",
  "DJ international and local events",
  "Feature in promo videos/socials",
  "Offer private/group lessons",
  "Teach regular classes",
  "Lead festival workshops",
  "Co-teach sessions",
  "Exchange tips, curricula, and student referrals",
] as const;

type Interest = (typeof INTERESTS)[number];

const AVAILABILITY = [
  "Weekdays",
  "Weekends",
  "DayTime",
  "Evenings",
  "Travel for Events",
  "I’d rather not say",
] as const;

type Availability = (typeof AVAILABILITY)[number];

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

type Language = (typeof LANGUAGES)[number];

const STYLE_LEVELS = [
  "Beginner (0–3 months)",
  "Improver (3–9 months)",
  "Intermediate (9–24 months)",
  "Advanced (2+ years)",
  "Teacher/Competitor (3+ years)",
] as const;

type Level = (typeof STYLE_LEVELS)[number];

const STYLES = ["Bachata", "Salsa", "Kizomba", "Zouk", "Other"] as const;
type Style = (typeof STYLES)[number];

export type ConnectionsFilters = {
  country: string;
  cities: string[]; // max 3

  // dance role preference (Leader/Follower/Switch)
  rolePref?: RolePref;

  // Step-1 roles (Teacher, Organizer, etc.)
  roles: Role[];

  verifiedOnly: boolean;

  // max 3
  languages: Language[];

  // single select
  interest?: Interest;

  availability: Availability[];

  styles: Record<Style, { enabled: boolean; level?: Level; otherText?: string }>;
};

const DEFAULT_STYLES: ConnectionsFilters["styles"] = {
  Bachata: { enabled: false },
  Salsa: { enabled: false },
  Kizomba: { enabled: false },
  Zouk: { enabled: false },
  Other: { enabled: false, otherText: "" },
};

const DEFAULT_FILTERS: ConnectionsFilters = {
  country: "",
  cities: [],
  rolePref: undefined,
  roles: [],
  verifiedOnly: false,
  languages: [],
  interest: undefined,
  availability: [],
  styles: DEFAULT_STYLES,
};

function normalizeFilters(v: ConnectionsFilters): ConnectionsFilters {
  // Merge with defaults to avoid runtime errors if parent passes older shape.
  return {
    ...DEFAULT_FILTERS,
    ...v,
    roles: Array.isArray((v as any).roles) ? ((v as any).roles as Role[]) : [],
    languages: Array.isArray(v.languages) ? v.languages : [],
    availability: Array.isArray((v as any).availability) ? ((v as any).availability as Availability[]) : [],
    styles: { ...DEFAULT_STYLES, ...(v.styles ?? {}) },
  };
}

export default function ConnectionsFiltersDrawer({
  open,
  onClose,
  value,
  onChange,
  onApply,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  value: ConnectionsFilters;
  onChange: (next: ConnectionsFilters) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const [local, setLocal] = useState<ConnectionsFilters>(() => normalizeFilters(value));

  // Prefill from onboarding draft once (country/city as defaults)
  useEffect(() => {
    if (!open) return;

    const d = readOnboardingDraft();
    setLocal((prevRaw) => {
      const prev = normalizeFilters(prevRaw as any);
      return {
        ...prev,
        country: prev.country || (d.country ?? ""),
        cities: prev.cities.length ? prev.cities : d.city ? [d.city] : [],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // keep local synced when parent changes
  useEffect(() => setLocal(normalizeFilters(value)), [value]);

  const citiesCount = useMemo(() => `${local.cities.length}/3`, [local.cities.length]);

  const countriesAll = useMemo(() => Country.getAllCountries(), []);
  const countryNames = useMemo(() => countriesAll.map((c) => c.name), [countriesAll]);

  const iso = countriesAll.find((c) => c.name === local.country)?.isoCode ?? "";
  const cityNames = useMemo(() => {
    if (!iso) return [];
    return (City.getCitiesOfCountry(iso) ?? []).map((c) => c.name);
  }, [iso]);

  const [cityPick, setCityPick] = useState<string>("");

  function commit(next: ConnectionsFilters) {
    setLocal(next);
    onChange(next);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="Close filters"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        type="button"
      />
      <div className="relative h-full w-full max-w-md border-l border-white/10 bg-[#0A0A0A] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="text-xl font-bold text-white">Filter Connections</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-white/60 hover:text-white hover:bg-white/5 transition"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-32">
          {/* Location */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-[#00F5FF]">📍</span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white/50">Location</h3>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium mb-1.5 block text-white/80">Country</span>
                <select
                  value={local.country}
                  onChange={(e) => {
                    // reset cities when country changes
                    commit({ ...local, country: e.target.value, cities: [] });
                    setCityPick("");
                  }}
                  className="w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                >
                  <option value="" disabled>
                    Select country…
                  </option>
                  {countryNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-sm font-medium text-white/80">Cities (Max 3)</span>
                  <span className="text-[10px] bg-[#00F5FF]/15 text-[#00F5FF] px-2 py-0.5 rounded-full font-bold">
                    {citiesCount}
                  </span>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <select
                    value={cityPick}
                    onChange={(e) => setCityPick(e.target.value)}
                    disabled={!local.country || cityNames.length === 0 || local.cities.length >= 3}
                    className="w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 disabled:opacity-50"
                  >
                    <option value="">
                      {!local.country
                        ? "Select country first"
                        : local.cities.length >= 3
                        ? "Max 3 cities"
                        : cityNames.length === 0
                        ? "No cities found"
                        : "Select a city…"}
                    </option>
                    {cityNames
                      .filter((c) => !local.cities.includes(c))
                      .map((c, idx) => (
                        <option key={`${c}-${idx}`} value={c}>
                          {c}
                        </option>
                      ))}
                  </select>

                  <button
                    type="button"
                    disabled={!cityPick || local.cities.length >= 3}
                    onClick={() => {
                      if (!cityPick) return;
                      if (local.cities.length >= 3) return;
                      commit({ ...local, cities: [...local.cities, cityPick] });
                      setCityPick("");
                    }}
                    className={
                      !cityPick || local.cities.length >= 3
                        ? "w-full sm:w-auto rounded-xl px-4 py-3 text-xs font-bold bg-white/10 text-white/40 cursor-not-allowed"
                        : "w-full sm:w-auto rounded-xl px-4 py-3 text-xs font-bold border border-white/10 text-white/70 hover:text-white hover:border-white/20"
                    }
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {local.cities.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => commit({ ...local, cities: local.cities.filter((x) => x !== c) })}
                      className="flex items-center gap-2 rounded-full border border-[#00F5FF]/30 bg-[#00F5FF]/10 px-3 py-1.5 text-sm font-medium text-[#00F5FF]"
                      title="Remove"
                    >
                      {c} <span className="text-white/70">×</span>
                    </button>
                  ))}
                </div>
              </label>
            </div>
          </section>

          {/* Role preference */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-[#00F5FF]">⇄</span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white/50">Role preference</h3>
            </div>

            <div className="flex p-1 bg-white/[0.04] rounded-2xl border border-white/10">
              {ROLE_PREFS.map((r) => {
                const active = local.rolePref === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => commit({ ...local, rolePref: active ? undefined : r })}
                    className={[
                      "flex-1 py-2.5 text-sm font-semibold rounded-xl transition",
                      active ? "bg-white/[0.08] text-white" : "text-white/50 hover:text-white",
                    ].join(" ")}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Roles */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-[#00F5FF]">👤</span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white/50">Roles</h3>
            </div>

            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => {
                const active = local.roles.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      const next = active ? local.roles.filter((x) => x !== r) : [...local.roles, r];
                      commit({ ...local, roles: next });
                    }}
                    className={[
                      "px-3 py-1.5 rounded-full border text-xs font-medium transition",
                      active
                        ? "border-[#00F5FF] bg-[#00F5FF]/10 text-[#00F5FF]"
                        : "border-white/10 text-white/60 hover:border-white/20",
                    ].join(" ")}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Dance styles + level */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-[#00F5FF]">🎵</span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white/50">Dance styles & level</h3>
            </div>

            <div className="space-y-4">
              {STYLES.map((s) => {
                const enabled = local.styles[s]?.enabled;
                return (
                  <div
                    key={s}
                    className={[
                      "rounded-2xl border p-4 transition",
                      enabled ? "border-white/10 bg-white/[0.03]" : "border-white/10 bg-transparent",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          const next = {
                            ...local,
                            styles: {
                              ...local.styles,
                              [s]: { ...local.styles[s], enabled: !enabled },
                            },
                          };
                          // if disabling, clear level
                          if (enabled) next.styles[s] = { enabled: false };
                          commit(next);
                        }}
                        className="flex items-center gap-2 text-sm font-semibold text-white/85"
                      >
                        <span
                          className={[
                            "inline-flex h-5 w-5 items-center justify-center rounded-md border",
                            enabled ? "border-[#00F5FF] bg-[#00F5FF]/15 text-[#00F5FF]" : "border-white/20 text-white/30",
                          ].join(" ")}
                        >
                          {enabled ? "✓" : ""}
                        </span>
                        {s}
                      </button>
                    </div>

                    {enabled ? (
                      <div className="mt-3 space-y-3">
                        {s !== "Other" ? (
                          <select
                            value={local.styles[s].level ?? ""}
                            onChange={(e) =>
                              commit({
                                ...local,
                                styles: {
                                  ...local.styles,
                                  [s]: { ...local.styles[s], level: (e.target.value as Level) || undefined },
                                },
                              })
                            }
                            className="w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                          >
                            <option value="">Select level…</option>
                            {STYLE_LEVELS.map((lvl) => (
                              <option key={lvl} value={lvl}>
                                {lvl}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={local.styles.Other.otherText ?? ""}
                            onChange={(e) =>
                              commit({
                                ...local,
                                styles: {
                                  ...local.styles,
                                  Other: {
                                    enabled: true,
                                    otherText: e.target.value.slice(0, 24),
                                  },
                                },
                              })
                            }
                            placeholder="Other style (max 24 chars)"
                            className="w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                          />
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          {/* More filters */}
          <section className="border-t border-white/10 pt-6 space-y-6">
            <div className="flex items-center gap-2">
              <span className="text-[#00F5FF]">＋</span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white/50">More filters</h3>
            </div>

            {/* Interest (single select) */}
            <div>
              <div className="text-sm font-medium mb-3 block text-white/80">Interest</div>
              <select
                value={local.interest ?? ""}
                onChange={(e) => commit({ ...local, interest: (e.target.value as Interest) || undefined })}
                className="w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
              >
                <option value="">Any interest</option>
                {INTERESTS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
              <div className="mt-2 text-[11px] text-white/35">Pick one.</div>
            </div>

            {/* Availability */}
            <div>
              <div className="text-sm font-medium mb-3 block text-white/80">Availability</div>
              <div className="flex flex-wrap gap-2">
                {AVAILABILITY.map((a) => {
                  const active = local.availability.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => {
                        const next = active
                          ? local.availability.filter((x) => x !== a)
                          : [...local.availability, a];
                        commit({ ...local, availability: next });
                      }}
                      className={[
                        "px-3 py-1.5 rounded-full border text-xs font-medium transition",
                        active
                          ? "border-[#00F5FF] bg-[#00F5FF]/10 text-[#00F5FF]"
                          : "border-white/10 text-white/60 hover:border-white/20",
                      ].join(" ")}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Languages */}
            <div>
              <div className="text-sm font-medium mb-3 block text-white/80">Languages</div>
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map((l) => {
                  const active = local.languages.includes(l);
                  return (
                    <button
                      key={l}
                      type="button"
                      onClick={() => {
                        const next = active
                          ? local.languages.filter((x) => x !== l)
                          : [...local.languages, l].slice(0, 3);
                        commit({ ...local, languages: next });
                      }}
                      className={[
                        "px-3 py-1.5 rounded-full border text-xs font-medium transition",
                        active
                          ? "border-[#00F5FF] bg-[#00F5FF]/10 text-[#00F5FF]"
                          : "border-white/10 text-white/60 hover:border-white/20",
                      ].join(" ")}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 text-[11px] text-white/35">Max 3.</div>
            </div>

            {/* Verified */}
            <button
              type="button"
              onClick={() => commit({ ...local, verifiedOnly: !local.verifiedOnly })}
              className="w-full flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="text-left">
                <div className="text-sm font-bold text-white">Verified only</div>
                <div className="text-[10px] text-white/40">Only show verified members</div>
              </div>
              <span
                className={[
                  "inline-flex h-6 w-12 items-center rounded-full p-1 transition",
                  local.verifiedOnly ? "bg-[#00F5FF]" : "bg-white/10",
                ].join(" ")}
              >
                <span
                  className={[
                    "h-4 w-4 rounded-full bg-white transition",
                    local.verifiedOnly ? "translate-x-6" : "translate-x-0",
                  ].join(" ")}
                />
              </span>
            </button>
          </section>
        </div>

        {/* Sticky footer */}
        <div className="absolute bottom-0 left-0 w-full p-6 bg-[#0A0A0A] border-t border-white/10 flex items-center gap-6">
          <button
            type="button"
            onClick={() => {
              onClear();
              onClose();
            }}
            className="text-sm font-bold text-white/40 hover:text-white transition underline underline-offset-4"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={() => {
              onApply();
              onClose();
            }}
            className="flex-1 rounded-2xl py-4 font-black uppercase tracking-wide text-[#0A0A0A] shadow-[0_0_28px_rgba(0,245,255,0.22)]"
            style={{ backgroundImage: "linear-gradient(90deg, #00F5FF 0%, #FF00FF 100%)" }}
          >
            Show Connections
          </button>
        </div>
      </div>
    </div>
  );
}
