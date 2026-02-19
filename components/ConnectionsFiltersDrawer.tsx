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

// Compact labels for chips (UX improvement)
const LEVEL_CHIPS = [
  { value: "Beginner (0–3 months)", label: "Beginner" },
  { value: "Improver (3–9 months)", label: "Improver" },
  { value: "Intermediate (9–24 months)", label: "Intermediate" },
  { value: "Advanced (2+ years)", label: "Advanced" },
  { value: "Teacher/Competitor (3+ years)", label: "Teacher" },
] as const;

type Level = (typeof LEVEL_CHIPS)[number]["value"];
const LEVEL_VALUES = LEVEL_CHIPS.map((item) => item.value);

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

  // Multi-select levels per style
  styles: Record<Style, { enabled: boolean; levels?: Level[]; otherText?: string }>;
};

const DEFAULT_STYLES: ConnectionsFilters["styles"] = {
  Bachata: { enabled: false, levels: [] },
  Salsa: { enabled: false, levels: [] },
  Kizomba: { enabled: false, levels: [] },
  Zouk: { enabled: false, levels: [] },
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

const isString = (value: unknown): value is string => typeof value === "string";
const isRole = (value: unknown): value is Role => isString(value) && ROLES.includes(value as Role);
const isAvailability = (value: unknown): value is Availability =>
  isString(value) && AVAILABILITY.includes(value as Availability);
const isLanguage = (value: unknown): value is Language => isString(value) && LANGUAGES.includes(value as Language);
const isLevel = (value: unknown): value is Level => isString(value) && LEVEL_VALUES.includes(value as Level);

function normalizeStyleEntry(style: Style, entry: unknown): ConnectionsFilters["styles"][Style] {
  const enabled = Boolean((entry as { enabled?: boolean } | null)?.enabled);

  if (style === "Other") {
    const otherText = isString((entry as { otherText?: unknown } | null)?.otherText)
      ? ((entry as { otherText?: string }).otherText ?? "")
      : "";
    return { enabled, otherText };
  }

  const rawLevels = (entry as { levels?: unknown } | null)?.levels;
  const legacyLevel = (entry as { level?: unknown } | null)?.level;
  const levels = Array.isArray(rawLevels)
    ? rawLevels.filter(isLevel)
    : legacyLevel && isLevel(legacyLevel)
    ? [legacyLevel]
    : [];

  return { enabled, levels };
}

function normalizeFilters(v: Partial<ConnectionsFilters>): ConnectionsFilters {
  // Merge with defaults to avoid runtime errors if parent passes older shape.
  // Also: migrate old `level` field (if it exists) into `levels`.
  const merged = {
    ...DEFAULT_FILTERS,
    ...v,
    roles: Array.isArray(v.roles) ? v.roles.filter(isRole) : [],
    languages: Array.isArray(v.languages) ? v.languages.filter(isLanguage) : [],
    availability: Array.isArray(v.availability) ? v.availability.filter(isAvailability) : [],
    styles: { ...DEFAULT_STYLES, ...(v.styles ?? {}) } as ConnectionsFilters["styles"],
  };

  for (const s of STYLES) {
    merged.styles[s] = normalizeStyleEntry(s, merged.styles[s]);
  }

  return merged;
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
      const prev = normalizeFilters(prevRaw);
      return {
        ...prev,
        country: prev.country || (d.country ?? ""),
        cities: prev.cities.length ? prev.cities : d.city ? [d.city] : [],
      };
    });
  }, [open]);

  // keep local synced when parent changes
  useEffect(() => {
    setLocal(normalizeFilters(value));
  }, [value]);

  const citiesCount = useMemo(() => `${local.cities.length}/3`, [local.cities.length]);

  const countriesAll = useMemo(() => Country.getAllCountries(), []);
  const countryNames = useMemo(() => countriesAll.map((c) => c.name), [countriesAll]);

  const iso = countriesAll.find((c) => c.name === local.country)?.isoCode ?? "";
  const cityNames = useMemo(() => {
    if (!iso) return [];
    return (City.getCitiesOfCountry(iso) ?? []).map((c) => c.name);
  }, [iso]);

  const [cityPick, setCityPick] = useState<string>("");
  const [languagePick, setLanguagePick] = useState<string>("");

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
          {/* Verified (top, smaller) */}
          <button
            type="button"
            onClick={() => commit({ ...local, verifiedOnly: !local.verifiedOnly })}
            className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
          >
            <div className="text-left">
              <div className="text-[11px] font-bold text-white/80">Verified only</div>
              <div className="text-[10px] text-white/35">Only show verified members</div>
            </div>

            <span
              className={[
                "inline-flex h-5 w-10 items-center rounded-full p-1 transition",
                local.verifiedOnly ? "bg-[#00F5FF]" : "bg-white/10",
              ].join(" ")}
            >
              <span
                className={[
                  "h-3.5 w-3.5 rounded-full bg-white transition",
                  local.verifiedOnly ? "translate-x-5" : "translate-x-0",
                ].join(" ")}
              />
            </span>
          </button>

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
                      "px-2.5 py-1 rounded-full border text-[11px] font-medium transition",
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
                          const nextStyles = { ...local.styles };

                          if (enabled) {
                            nextStyles[s] =
                              s === "Other" ? { enabled: false, otherText: "" } : { enabled: false, levels: [] };
                          } else if (s === "Other") {
                            nextStyles.Other = { enabled: true, otherText: local.styles.Other.otherText ?? "" };
                          } else {
                            const levels = Array.isArray(local.styles[s].levels)
                              ? local.styles[s].levels.filter(isLevel)
                              : [];
                            nextStyles[s] = { enabled: true, levels };
                          }

                          commit({ ...local, styles: nextStyles });
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

                      {enabled && s !== "Other" ? (
                        <span className="text-[10px] text-white/35">
                          {(local.styles[s].levels ?? []).length ? `${(local.styles[s].levels ?? []).length} selected` : "Select levels"}
                        </span>
                      ) : null}
                    </div>

                    {enabled ? (
                      <div className="mt-3 space-y-3">
                        {s !== "Other" ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="text-[11px] text-white/50">Select one or more levels</div>

                              <button
                                type="button"
                                onClick={() =>
                                  commit({
                                    ...local,
                                    styles: {
                                      ...local.styles,
                                      [s]: { ...local.styles[s], levels: [] },
                                    },
                                  })
                                }
                                className="text-[11px] font-bold text-white/35 hover:text-white/60 underline underline-offset-4"
                              >
                                Clear
                              </button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {LEVEL_CHIPS.map((lvl) => {
                                const selected = (local.styles[s].levels ?? []).includes(lvl.value);

                                return (
                                  <button
                                    key={lvl.value}
                                    type="button"
                                    onClick={() => {
                                      const current = local.styles[s].levels ?? [];
                                      const nextLevels = selected
                                        ? current.filter((x) => x !== lvl.value)
                                        : [...current, lvl.value];

                                      commit({
                                        ...local,
                                        styles: {
                                          ...local.styles,
                                          [s]: { ...local.styles[s], levels: nextLevels },
                                        },
                                      });
                                    }}
                                    className={[
                                      "px-3 py-1.5 rounded-full border text-[11px] font-semibold transition",
                                      selected
                                        ? "border-[#00F5FF] bg-[#00F5FF]/10 text-[#00F5FF]"
                                        : "border-white/10 text-white/60 hover:border-white/20",
                                    ].join(" ")}
                                  >
                                    {lvl.label}
                                  </button>
                                );
                              })}
                            </div>

                            <div className="text-[10px] text-white/35">Tip: select multiple to widen matches.</div>
                          </div>
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
              <div className="mt-2 text-[11px] text-white/35">Pick one (all interests across roles).</div>
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
                        const next = active ? local.availability.filter((x) => x !== a) : [...local.availability, a];
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

            {/* Languages (dropdown + add, max 3) */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium block text-white/80">Languages</div>
                <div className="text-[10px] bg-[#00F5FF]/15 text-[#00F5FF] px-2 py-0.5 rounded-full font-bold">
                  {local.languages.length}/3
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <select
                  value={languagePick}
                  onChange={(e) => setLanguagePick(e.target.value)}
                  disabled={local.languages.length >= 3}
                  className="w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 disabled:opacity-50"
                >
                  <option value="">{local.languages.length >= 3 ? "Max 3 languages" : "Select a language…"}</option>
                  {LANGUAGES.filter((l) => !local.languages.includes(l)).map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={!languagePick || local.languages.length >= 3}
                  onClick={() => {
                    if (!languagePick) return;
                    if (local.languages.length >= 3) return;
                    commit({ ...local, languages: [...local.languages, languagePick as Language] });
                    setLanguagePick("");
                  }}
                  className={
                    !languagePick || local.languages.length >= 3
                      ? "w-full sm:w-auto rounded-xl px-4 py-3 text-xs font-bold bg-white/10 text-white/40 cursor-not-allowed"
                      : "w-full sm:w-auto rounded-xl px-4 py-3 text-xs font-bold border border-white/10 text-white/70 hover:text-white hover:border-white/20"
                  }
                >
                  Add
                </button>
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                {local.languages.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => commit({ ...local, languages: local.languages.filter((x) => x !== l) })}
                    className="flex items-center gap-2 rounded-full border border-[#00F5FF]/30 bg-[#00F5FF]/10 px-3 py-1.5 text-sm font-medium text-[#00F5FF]"
                    title="Remove"
                  >
                    {l} <span className="text-white/70">×</span>
                  </button>
                ))}
              </div>

              <div className="mt-2 text-[11px] text-white/35">Max 3.</div>
            </div>
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
