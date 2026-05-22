"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCachedCitiesOfCountry,
  getCachedCountriesAll,
  getCitiesOfCountry,
  getCountriesAll,
  type CountryEntry,
} from "@/lib/country-city-client";
import { INTEREST_OPTIONS, normalizeInterestLabel, type ProfileInterest } from "@/lib/interests";
import { readOnboardingDraft } from "@/lib/onboardingDraft";

const ROLE_PREFS = ["Leader", "Follower", "Switch"] as const;
type RolePref = (typeof ROLE_PREFS)[number];

const ROLES = [
  "Social Dancer",
  "Student",
  "Organizer",
  "Studio Owner",
  "Promoter",
  "DJ",
  "Artist",
  "Teacher",
] as const;

type Role = (typeof ROLES)[number];

type Interest = ProfileInterest;

const AVAILABILITY = [
  "Weekdays",
  "Weekends",
  "DayTime",
  "Evenings",
  "Travel for Events",
  "I'd rather not say",
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
  cities: string[];
  rolePref?: RolePref;
  roles: Role[];
  verifiedOnly: boolean;
  languages: Language[];
  interest?: Interest;
  availability: Availability[];
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
  const normalizedInterest = isString(v.interest) ? normalizeInterestLabel(v.interest) : null;
  const merged = {
    ...DEFAULT_FILTERS,
    ...v,
    roles: Array.isArray(v.roles) ? v.roles.filter(isRole) : [],
    languages: Array.isArray(v.languages) ? v.languages.filter(isLanguage) : [],
    availability: Array.isArray(v.availability) ? v.availability.filter(isAvailability) : [],
    interest:
      normalizedInterest && INTEREST_OPTIONS.includes(normalizedInterest as ProfileInterest)
        ? (normalizedInterest as Interest)
        : undefined,
    styles: { ...DEFAULT_STYLES, ...(v.styles ?? {}) } as ConnectionsFilters["styles"],
  };
  for (const s of STYLES) {
    merged.styles[s] = normalizeStyleEntry(s, merged.styles[s]);
  }
  return merged;
}

// ── Searchable combobox ────────────────────────────────────────────────────────
function SearchCombobox({
  options,
  value,
  placeholder,
  disabled,
  onSelect,
}: {
  options: string[];
  value: string;
  placeholder: string;
  disabled?: boolean;
  onSelect: (v: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // keep display in sync when value changes externally
  useEffect(() => { setQuery(value); }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 60);
    return options.filter((o) => o.toLowerCase().includes(q)).slice(0, 60);
  }, [options, query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="relative flex items-center">
        <span className="material-symbols-outlined absolute left-3 text-[16px] text-white/30 pointer-events-none">search</span>
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="w-full min-h-[48px] rounded-xl border border-white/10 bg-[#121212] pl-9 pr-4 py-3 text-sm text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 disabled:opacity-40 placeholder:text-white/30"
        />
        {query && (
          <button
            type="button"
            className="absolute right-3 text-white/30 hover:text-white/70"
            onClick={() => { setQuery(""); onSelect(""); setOpen(false); }}
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        )}
      </div>
      {open && !disabled && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-white/10 bg-[#141414] shadow-xl">
          {filtered.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                className="w-full px-4 py-3 text-left text-sm text-white/80 hover:bg-white/[0.06] hover:text-white active:bg-white/10"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onSelect(opt); setQuery(opt); setOpen(false); }}
              >
                {opt}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
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
  const [countriesAll, setCountriesAll] = useState<CountryEntry[]>(() => getCachedCountriesAll());
  const [cityNames, setCityNames] = useState<string[]>([]);

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

  useEffect(() => {
    setLocal(normalizeFilters(value));
  }, [value]);

  const countryNames = useMemo(() => countriesAll.map((c) => c.name), [countriesAll]);
  const iso = useMemo(() => countriesAll.find((c) => c.name === local.country)?.isoCode ?? "", [countriesAll, local.country]);

  useEffect(() => {
    let cancelled = false;
    if (!open || countriesAll.length > 0) return () => { cancelled = true; };
    void getCountriesAll().then((countries) => {
      if (cancelled) return;
      setCountriesAll(countries);
    }).catch(() => { if (cancelled) return; setCountriesAll([]); });
    return () => { cancelled = true; };
  }, [countriesAll.length, open]);

  useEffect(() => {
    let cancelled = false;
    if (!open || !iso) { setCityNames([]); return () => { cancelled = true; }; }
    const cached = getCachedCitiesOfCountry(iso);
    if (cached.length > 0) { setCityNames(cached); return () => { cancelled = true; }; }
    void getCitiesOfCountry(iso).then((cities) => {
      if (cancelled) return;
      setCityNames(cities);
    }).catch(() => { if (cancelled) return; setCityNames([]); });
    return () => { cancelled = true; };
  }, [iso, open]);

  function commit(next: ConnectionsFilters) {
    setLocal(next);
    onChange(next);
  }

  if (!open) return null;

  const availableCities = cityNames.filter((c) => !local.cities.includes(c));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:justify-end">
      <button
        aria-label="Close filters"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        type="button"
      />
      {/* Sheet: bottom sheet on mobile, side panel on sm+ */}
      <div className="relative w-full max-h-[92dvh] rounded-t-3xl sm:rounded-none sm:rounded-l-3xl sm:h-full sm:max-h-full sm:max-w-md border-t sm:border-t-0 sm:border-l border-white/10 bg-[#0A0A0A] shadow-2xl flex flex-col">
        {/* Drag handle (mobile only) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Filter Connections</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-white/60 hover:text-white hover:bg-white/5 transition"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7 pb-32">

          {/* Verified toggle */}
          <button
            type="button"
            onClick={() => commit({ ...local, verifiedOnly: !local.verifiedOnly })}
            className="w-full flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3.5"
          >
            <div className="text-left">
              <div className="text-sm font-semibold text-white/90">Verified only</div>
              <div className="text-xs text-white/35 mt-0.5">Only show verified members</div>
            </div>
            <span className={["inline-flex h-6 w-11 items-center rounded-full p-1 transition", local.verifiedOnly ? "bg-[#00F5FF]" : "bg-white/10"].join(" ")}>
              <span className={["h-4 w-4 rounded-full bg-white transition", local.verifiedOnly ? "translate-x-5" : "translate-x-0"].join(" ")} />
            </span>
          </button>

          {/* Location */}
          <section className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#00F5FF]/70">Location</h3>

            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium mb-2 block text-white/70">Country</span>
                <SearchCombobox
                  options={countryNames}
                  value={local.country}
                  placeholder="Search country…"
                  onSelect={(v) => commit({ ...local, country: v, cities: [] })}
                />
              </label>

              <label className="block">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-white/70">Cities (max 3)</span>
                  <span className="text-[10px] bg-[#00F5FF]/15 text-[#00F5FF] px-2 py-0.5 rounded-full font-bold">{local.cities.length}/3</span>
                </div>
                <SearchCombobox
                  options={availableCities}
                  value=""
                  placeholder={!local.country ? "Select a country first" : local.cities.length >= 3 ? "Max 3 cities reached" : "Search city…"}
                  disabled={!local.country || local.cities.length >= 3}
                  onSelect={(v) => {
                    if (!v || local.cities.length >= 3) return;
                    commit({ ...local, cities: [...local.cities, v] });
                  }}
                />
                {local.cities.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {local.cities.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => commit({ ...local, cities: local.cities.filter((x) => x !== c) })}
                        className="flex items-center gap-1.5 rounded-full border border-[#00F5FF]/30 bg-[#00F5FF]/10 px-3 py-2 text-sm font-medium text-[#00F5FF]"
                      >
                        {c} <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    ))}
                  </div>
                )}
              </label>
            </div>
          </section>

          {/* Role preference */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#00F5FF]/70">Role preference</h3>
            <div className="grid grid-cols-3 gap-2">
              {ROLE_PREFS.map((r) => {
                const active = local.rolePref === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => commit({ ...local, rolePref: active ? undefined : r })}
                    className={["py-3 rounded-2xl text-sm font-semibold transition border", active ? "border-[#00F5FF] bg-[#00F5FF]/10 text-[#00F5FF]" : "border-white/10 bg-white/[0.03] text-white/55 hover:text-white"].join(" ")}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Roles */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#00F5FF]/70">Roles</h3>
            <div className="grid grid-cols-2 gap-2">
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
                    className={["py-3 px-3 rounded-2xl border text-sm font-medium transition text-left", active ? "border-[#00F5FF] bg-[#00F5FF]/10 text-[#00F5FF]" : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white"].join(" ")}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Dance styles */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#00F5FF]/70">Dance styles & level</h3>
            <div className="space-y-3">
              {STYLES.map((s) => {
                const enabled = local.styles[s]?.enabled;
                return (
                  <div key={s} className={["rounded-2xl border transition overflow-hidden", enabled ? "border-white/15 bg-white/[0.03]" : "border-white/10"].join(" ")}>
                    <button
                      type="button"
                      onClick={() => {
                        const nextStyles = { ...local.styles };
                        if (enabled) {
                          nextStyles[s] = s === "Other" ? { enabled: false, otherText: "" } : { enabled: false, levels: [] };
                        } else if (s === "Other") {
                          nextStyles.Other = { enabled: true, otherText: local.styles.Other.otherText ?? "" };
                        } else {
                          const levels = Array.isArray(local.styles[s].levels) ? local.styles[s].levels!.filter(isLevel) : [];
                          nextStyles[s] = { enabled: true, levels };
                        }
                        commit({ ...local, styles: nextStyles });
                      }}
                      className="w-full flex items-center justify-between px-4 py-3.5"
                    >
                      <span className="text-sm font-semibold text-white/90">{s}</span>
                      <span className={["inline-flex h-6 w-6 items-center justify-center rounded-lg border text-[13px] font-bold", enabled ? "border-[#00F5FF] bg-[#00F5FF]/15 text-[#00F5FF]" : "border-white/20 text-white/20"].join(" ")}>
                        {enabled ? "✓" : ""}
                      </span>
                    </button>

                    {enabled && s !== "Other" && (
                      <div className="px-4 pb-4 space-y-2">
                        <div className="flex flex-wrap gap-2">
                          {LEVEL_CHIPS.map((lvl) => {
                            const selected = (local.styles[s].levels ?? []).includes(lvl.value);
                            return (
                              <button
                                key={lvl.value}
                                type="button"
                                onClick={() => {
                                  const current = local.styles[s].levels ?? [];
                                  const nextLevels = selected ? current.filter((x) => x !== lvl.value) : [...current, lvl.value];
                                  commit({ ...local, styles: { ...local.styles, [s]: { ...local.styles[s], levels: nextLevels } } });
                                }}
                                className={["px-3 py-2 rounded-full border text-xs font-semibold transition", selected ? "border-[#00F5FF] bg-[#00F5FF]/10 text-[#00F5FF]" : "border-white/10 text-white/55 hover:border-white/20"].join(" ")}
                              >
                                {lvl.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {enabled && s === "Other" && (
                      <div className="px-4 pb-4">
                        <input
                          value={local.styles.Other.otherText ?? ""}
                          onChange={(e) => commit({ ...local, styles: { ...local.styles, Other: { enabled: true, otherText: e.target.value.slice(0, 24) } } })}
                          placeholder="Style name (max 24 chars)"
                          className="w-full min-h-[48px] rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Interest */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#00F5FF]/70">Interest</h3>
            <div className="grid grid-cols-2 gap-2">
              {INTEREST_OPTIONS.map((i) => {
                const active = local.interest === i;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => commit({ ...local, interest: active ? undefined : (i as Interest) })}
                    className={["py-3 px-3 rounded-2xl border text-sm font-medium transition text-left", active ? "border-[#00F5FF] bg-[#00F5FF]/10 text-[#00F5FF]" : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white"].join(" ")}
                  >
                    {i}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Availability */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#00F5FF]/70">Availability</h3>
            <div className="grid grid-cols-2 gap-2">
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
                    className={["py-3 px-3 rounded-2xl border text-sm font-medium transition text-left", active ? "border-[#00F5FF] bg-[#00F5FF]/10 text-[#00F5FF]" : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white"].join(" ")}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Languages */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#00F5FF]/70">Languages</h3>
              <span className="text-[10px] bg-[#00F5FF]/15 text-[#00F5FF] px-2 py-0.5 rounded-full font-bold">{local.languages.length}/3</span>
            </div>
            <SearchCombobox
              options={LANGUAGES.filter((l) => !local.languages.includes(l)) as unknown as string[]}
              value=""
              placeholder={local.languages.length >= 3 ? "Max 3 languages" : "Search language…"}
              disabled={local.languages.length >= 3}
              onSelect={(v) => {
                if (!v || local.languages.length >= 3) return;
                commit({ ...local, languages: [...local.languages, v as Language] });
              }}
            />
            {local.languages.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {local.languages.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => commit({ ...local, languages: local.languages.filter((x) => x !== l) })}
                    className="flex items-center gap-1.5 rounded-full border border-[#00F5FF]/30 bg-[#00F5FF]/10 px-3 py-2 text-sm font-medium text-[#00F5FF]"
                  >
                    {l} <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Sticky footer */}
        <div className="absolute bottom-0 left-0 w-full px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] bg-[#0A0A0A] border-t border-white/10 flex items-center gap-4">
          <button
            type="button"
            onClick={() => { onClear(); onClose(); }}
            className="text-sm font-bold text-white/40 hover:text-white transition underline underline-offset-4 shrink-0"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={() => { onApply(); onClose(); }}
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
