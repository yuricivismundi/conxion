// PART 1/5
// /app/discover/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import Link from "next/link";
import Image from "next/image";
import Nav from "@/components/Nav";
import VerifiedBadge from "@/components/VerifiedBadge";
import { useRouter } from "next/navigation";
import { Country, City } from "country-state-city";
import Avatar from "@/components/Avatar";
import ConnectReasonModal from "@/components/ConnectReasonModal";
import { getReasonsForRoles, getAllReasons, type ConnectContext, type ReasonItem } from "@/lib/connectReasons";
import DiscoverProfileCard from "@/components/DiscoverProfileCard";


// -----------------------------
// Types
// -----------------------------
type DanceSkill = { level?: string; verified?: boolean };

type Profile = {
  user_id: string;
  display_name: string;
  city: string;
  country: string | null;

  roles: string[];
  languages: string[];
  interests: string[];
  availability: string[];

  connections_count: number;
  dance_skills: Record<string, DanceSkill>;

  avatar_url: string | null;

  verified: boolean;
  verified_label: string | null;

  created_at?: string | null;
};

type ConnectionStatus = "pending" | "accepted" | "blocked";

type ConnectionRow = {
  id: string;
  requester_id: string;
  target_id: string;
  status: ConnectionStatus;
  blocked_by: string | null;
};

type Scope = "country" | "anywhere";

type TripPurpose = "Holiday Trip" | "Dance Festival";
type TripStatus = "active" | "inactive";

type Trip = {
  id: string;
  user_id: string;

  status: TripStatus;

  destination_country: string;
  destination_city: string;

  start_date: string; // ISO date
  end_date: string; // ISO date

  purpose: TripPurpose;

  display_name: string;
  roles: string[];
  languages: string[];
  interests: string[];
  availability: string[];

  avatar_url: string | null;
  verified: boolean;
  verified_label: string | null;

  created_at?: string | null;
};

type StoredFilters = {
  activeTab: "members" | "travellers";

  // APPLIED filters (what actually affects results)
  roles: string[];
  locationPairs: Array<{ country: string; city: string }>; // max 3
  styles: string[];
  levelByStyle: Record<string, string>;

  languages: string[];
  availability: string[];
  interests: string[];
  tripDateFrom?: string; // ISO date (YYYY-MM-DD)
  tripDateTo?: string;   // ISO date (YYYY-MM-DD)

  sort: "same_city" | "styles_match" | "newest";
};

// -----------------------------
// Constants
// -----------------------------
const LEVELS = [
  "Beginner (0–3 months)",
  "Improver (3–9 months)",
  "Intermediate (9–24 months)",
  "Advanced (2+ years)",
  "Master (teacher/competitor - 3+ years)",
] as const;

const STYLES = ["bachata", "salsa", "kizomba", "tango", "zouk"] as const;

const ROLES = [
  "Social dancer / Student",
  "Organizer",
  "Studio Owner",
  "Promoter",
  "DJ",
  "Artist",
  "Teacher",
] as const;

const LANGUAGES = [
  "Afrikaans",
  "Albanian",
  "Amharic",
  "Arabic",
  "Armenian",
  "Azerbaijani",
  "Basque",
  "Belarusian",
  "Bengali",
  "Bosnian",
  "Bulgarian",
  "Burmese",
  "Catalan",
  "Cebuano",
  "Chinese (Cantonese)",
  "Chinese (Mandarin)",
  "Corsican",
  "Croatian",
  "Czech",
  "Danish",
  "Dutch",
  "English",
  "Esperanto",
  "Estonian",
  "Filipino",
  "Finnish",
  "French",
  "Frisian",
  "Galician",
  "Georgian",
  "German",
  "Greek",
  "Gujarati",
  "Haitian Creole",
  "Hausa",
  "Hawaiian",
  "Hebrew",
  "Hindi",
  "Hmong",
  "Hungarian",
  "Icelandic",
  "Igbo",
  "Indonesian",
  "Irish",
  "Italian",
  "Japanese",
  "Javanese",
  "Kannada",
  "Kazakh",
  "Khmer",
  "Kinyarwanda",
  "Korean",
  "Kurdish",
  "Kyrgyz",
  "Lao",
  "Latin",
  "Latvian",
  "Lithuanian",
  "Luxembourgish",
  "Macedonian",
  "Malagasy",
  "Malay",
  "Malayalam",
  "Maltese",
  "Maori",
  "Marathi",
  "Mongolian",
  "Nepali",
  "Norwegian",
  "Nyanja",
  "Odia",
  "Pashto",
  "Persian",
  "Polish",
  "Portuguese",
  "Punjabi",
  "Romanian",
  "Russian",
  "Samoan",
  "Scots Gaelic",
  "Serbian",
  "Sesotho",
  "Shona",
  "Sindhi",
  "Sinhala",
  "Slovak",
  "Slovenian",
  "Somali",
  "Spanish",
  "Sundanese",
  "Swahili",
  "Swedish",
  "Tajik",
  "Tamil",
  "Tatar",
  "Telugu",
  "Thai",
  "Turkish",
  "Turkmen",
  "Ukrainian",
  "Urdu",
  "Uyghur",
  "Uzbek",
  "Vietnamese",
  "Welsh",
  "Xhosa",
  "Yiddish",
  "Yoruba",
  "Zulu",
] as const;

const INTERESTS = [
  "Practice / Dance Partner",
  "Video Collabs",
  "Social Dance Party",
  "Festival Travel Buddy",
  "Private Lessons",
  "Group lessons",
] as const;

const AVAILABILITY = ["Week Days", "Weekends", "Evenings", "Day Time"] as const;

const LS_KEY = "discover_filters_v8";
// -----------------------------
// Small helpers
// -----------------------------
function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function toIsoDate(d: string | Date) {
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return "";
  return x.toISOString().slice(0, 10);
}

function formatDateShort(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map((p) => parseInt(p, 10));
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

// -----------------------------
// Quality guards (Discover)
// -----------------------------
function hasGoodText(v: unknown, min = 2) {
  return typeof v === "string" && v.trim().length >= min;
}

function isQualityProfile(p: Profile) {
  // Enforce: must have photo + display name + city
  return !!p.avatar_url && hasGoodText(p.display_name) && hasGoodText(p.city, 1);
}

function isQualityTrip(t: Trip) {
  // Enforce: must have photo + display name + destination
  // Note: in Discover we only show ACTIVE trips (inactive trips still count toward the user's 4 total trips)
  return (
    t.status === "active" &&
    !!t.avatar_url &&
    hasGoodText(t.display_name) &&
    hasGoodText(t.destination_city, 1) &&
    hasGoodText(t.destination_country, 2)
  );
}

// -----------------------------
// UI bits
// -----------------------------
function DiscreteTabs({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (v: string) => void;
  items: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="inline-flex items-center rounded-xl border border-zinc-200 bg-white p-1">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => onChange(it.value)}
            className={cx(
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
              active ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-50"
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function SearchCheckList({
  title,
  options,
  values,
  onChange,
  max,
  placeholderSearch,
}: {
  title: string;
  options: string[];
  values: string[];
  onChange: (next: string[]) => void;
  max?: number;
  placeholderSearch?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
  const canSearch = (placeholderSearch ?? "").length > 0;
  if (!canSearch) return options;

  const query = q.trim().toLowerCase();
  if (!query) return options;
  return options.filter((o) => o.toLowerCase().includes(query));
}, [options, q, placeholderSearch]);

  const atMax = typeof max === "number" && values.length >= max;

  function toggle(v: string) {
    if (values.includes(v)) return onChange(values.filter((x) => x !== v));
    if (typeof max === "number" && values.length >= max) return;
    onChange([...values, v]);
  }

  return (
<div className="rounded-xl border border-zinc-200 bg-white p-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold tracking-wide text-zinc-700 uppercase">{title}</div>        {!!values.length && (
          <button type="button" onClick={() => onChange([])} className="text-[11px] text-red-700 hover:text-red-800">
            Clear
          </button>
        )}
      </div>

      {(placeholderSearch ?? "").length > 0 && (
  <input
    value={q}
    onChange={(e) => setQ(e.target.value)}
    placeholder={placeholderSearch}
className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-red-500"  />
)}  

      <div className="mt-2 max-h-48 overflow-auto pr-1">
        {filtered.map((opt) => {
          const checked = values.includes(opt);
          const disabled = !checked && atMax;
          return (
            <label
              key={opt}
              className={cx(
                "flex items-center gap-2 rounded-lg px-2 py-1 cursor-pointer hover:bg-zinc-50",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <input type="checkbox" className="h-4 w-4" checked={checked} disabled={disabled} onChange={() => toggle(opt)} />
              <span className="text-[11px] text-zinc-800">{opt}</span>
            </label>
          );
        })}
        {filtered.length === 0 && <div className="px-2 py-2 text-xs text-zinc-500">No matches</div>}
      </div>

      {typeof max === "number" && (
        <div className="mt-2 text-[11px] text-zinc-500">
          {values.length}/{max} selected
        </div>
      )}
    </div>
  );
}
// PART 2/5
function LocationPairs({
  countriesAll,
  pairs,
  onChange,
  maxPairs = 3,
}: {
  countriesAll: ReturnType<typeof Country.getAllCountries>;
  pairs: Array<{ country: string; city: string }>;
  onChange: (next: Array<{ country: string; city: string }>) => void;
  maxPairs?: number;
}) {
  const countryNames = useMemo(() => countriesAll.map((c) => c.name), [countriesAll]);

  function updatePair(i: number, next: { country: string; city: string }) {
    const copy = [...pairs];
    copy[i] = next;
    onChange(copy);
  }

  function addPair() {
    if (pairs.length >= maxPairs) return;
    onChange([...pairs, { country: "", city: "" }]);
  }

  function removePair(i: number) {
    onChange(pairs.filter((_, idx) => idx !== i));
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold tracking-wide text-zinc-700 uppercase">LOCATION</div>
        <div className="flex items-center gap-3">
          <div className="text-[11px] text-zinc-500">
            {pairs.length}/{maxPairs}
          </div>
          <button
            type="button"
            onClick={addPair}
            disabled={pairs.length >= maxPairs}
            className={cx(
              "text-[11px] font-semibold",
              pairs.length >= maxPairs ? "text-zinc-400" : "text-red-700 hover:text-red-800"
            )}
          >
            + Add
          </button>
        </div>
      </div>

      <div className="mt-2 space-y-2">
        {pairs.map((p, i) => {
          const iso = countriesAll.find((x) => x.name === p.country)?.isoCode ?? "";
          const cities = iso ? City.getCitiesOfCountry(iso) ?? [] : [];
          const cityNames = cities.map((c) => c.name);

          return (
           <div key={`pair-${i}`} className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:gap-2 items-end">
  <div className="sm:col-span-5">
    <label className="text-[11px] text-zinc-600">Country</label>
    <datalist id={`countries-${i}`}>
      {countryNames.map((name, idx) => (
        <option key={`${name}-${idx}`} value={name} />
      ))}
    </datalist>
    <input
      list={`countries-${i}`}
      value={p.country}
      onChange={(e) => updatePair(i, { country: e.target.value, city: "" })}
className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-red-500"      placeholder="Type country…"
    />
  </div>

  <div className="sm:col-span-6">
    <label className="text-[11px] text-zinc-600">City</label>
    <datalist id={`cities-${i}`}>
      {cityNames.map((name, idx) => (
        <option key={`${name}-${idx}`} value={name} />
      ))}
    </datalist>
    <input
      list={`cities-${i}`}
      value={p.city}
      onChange={(e) => updatePair(i, { country: p.country, city: e.target.value })}
      disabled={!p.country}
className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-red-500 disabled:bg-zinc-100"      placeholder={!p.country ? "Select country first" : "Type city…"}
    />
  </div>

  <div className="sm:col-span-1 flex sm:justify-end">
    <button
      type="button"
      onClick={() => removePair(i)}
className="mt-1 sm:mt-0 h-[34px] w-[34px] rounded-lg border border-zinc-200 text-[11px] text-zinc-700 hover:bg-zinc-50"      aria-label="Remove"
      title="Remove"
    >
      ✕
    </button>
  </div>
</div>
          );
        })}

        {pairs.length === 0 && <div className="mt-1 text-xs text-zinc-500">Add up to {maxPairs} locations.</div>}
      </div>
    </div>
  );
}

function DanceStylePicker({
  styles,
  selected,
  levelByStyle,
  onChangeSelected,
  onChangeLevelByStyle,
}: {
  styles: string[];
  selected: string[];
  levelByStyle: Record<string, string>;
  onChangeSelected: (next: string[]) => void;
  onChangeLevelByStyle: (next: Record<string, string>) => void;
}) {

  const filtered = styles;

  function toggleStyle(s: string) {
    if (selected.includes(s)) {
      const nextSel = selected.filter((x) => x !== s);
      onChangeSelected(nextSel);

      const copy = { ...levelByStyle };
      delete copy[s];
      onChangeLevelByStyle(copy);
      return;
    }
    onChangeSelected([...selected, s]);
    onChangeLevelByStyle({ ...levelByStyle, [s]: levelByStyle[s] ?? "" });
  }

  function setLevel(s: string, lvl: string) {
    onChangeLevelByStyle({ ...levelByStyle, [s]: lvl });
  }

  return (
<div className="rounded-xl border border-zinc-200 bg-white p-2">
        <div className="flex items-center justify-between">
<div className="text-[10px] font-semibold tracking-wide text-zinc-700 uppercase">Dance styles</div>
        {!!selected.length && (
          <button
            type="button"
            onClick={() => {
              onChangeSelected([]);
              onChangeLevelByStyle({});
            }}
            className="text-[11px] text-red-700 hover:text-red-800"
          >
            Clear
          </button>
        )}
      </div>

      

      <div className="mt-2 space-y-2">
        {filtered.map((s) => {
          const checked = selected.includes(s);
          return (
            <div key={s} className="flex items-center gap-2">
<label className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-zinc-50 cursor-pointer flex-1">                <input type="checkbox" className="h-4 w-4" checked={checked} onChange={() => toggleStyle(s)} />
                <span className="text-xs text-zinc-800">{s}</span>
              </label>

              {checked && (
                <select
                  value={levelByStyle[s] ?? ""}
                  onChange={(e) => setLevel(s, e.target.value)}
className="w-40 max-w-[52%] rounded-lg border border-zinc-300 px-2 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-red-500 bg-white"                >
                  <option value="">Any</option>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="px-2 py-2 text-xs text-zinc-500">No matches</div>}
      </div>
    </div>
  );
}

function Pill({
  children,
  tone = "neutral",
  className = "",
  title,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "red" | "dark";
  className?: string;
  title?: string;
}) {
  const base =
    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] leading-none whitespace-nowrap";
  const toneCls =
    tone === "dark"
      ? "border-zinc-800 bg-zinc-900 text-white"
      : tone === "red"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-zinc-200 bg-zinc-50 text-zinc-700";

  return (
    <span title={title} className={cx(base, toneCls, className)}>
      {children}
    </span>
  );
}

function clampList(list: string[], max: number) {
  const clean = (list ?? []).map((x) => (x ?? "").trim()).filter(Boolean);
  const shown = clean.slice(0, max);
  const rest = clean.length - shown.length;
  return { shown, rest };
}

function MemberCard({
  p,
  commonCount,
  busy,
  disabled,
  onZoom,
  onView,
  onConnect,
}: {
  p: Profile;
  commonCount: number;
  busy: boolean;
  disabled: boolean;
  onZoom: () => void;
  onView: () => void;
  onConnect: () => void;
}) {
  const skillEntries = Object.entries(p.dance_skills ?? {}).filter(([k]) => !!k);
  const shownSkills = skillEntries.slice(0, 6);

  return (
    <div className="relative rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm hover:shadow-md transition">
      {/* IMAGE — top left */}
      <button
        type="button"
        onClick={onZoom}
        className="absolute top-4 left-4"
        title={p.avatar_url ? "Click to enlarge" : ""}
      >
        <div className="h-[96px] w-[96px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
          <Avatar
            src={p.avatar_url}
            alt="Avatar"
            size={96}
            className="h-full w-full object-cover"
          />
        </div>
      </button>

      {/* CONTENT */}
      <div className="pl-[116px] min-h-[96px]">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-[15px] font-semibold text-zinc-900">
                {p.display_name}
              </div>
              {p.verified && <VerifiedBadge size={16} />}
            </div>

            <div className="mt-0.5 text-xs text-zinc-600 truncate">
              {p.city}
              {p.country ? `, ${p.country}` : ""}
            </div>
          </div>
        </div>

        {/* Meta */}
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="text-[11px] text-zinc-600">
            🤝 <b>{p.connections_count ?? 0}</b> connections
          </span>
          <span className="text-[11px] text-zinc-600">
            🎵 <b>{commonCount}</b> styles in common
          </span>
        </div>

        {/* Roles */}
        {p.roles?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {p.roles.slice(0, 2).map((r) => (
              <span
                key={r}
                className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-800"
              >
                {r}
              </span>
            ))}
            {p.roles.length > 2 && (
              <span className="text-[11px] text-zinc-500">
                +{p.roles.length - 2} more
              </span>
            )}
          </div>
        )}

        {/* Dance styles */}
        <div className="mt-3 flex flex-wrap gap-2">
          {shownSkills.map(([style, info]) => (
            <span
              key={style}
              title={info?.level ?? ""}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px]"
            >
              <span className="font-semibold text-zinc-900">{style}</span>
              {info?.verified && <VerifiedBadge size={12} />}
            </span>
          ))}
        </div>
      </div>

      {/* FOOTER ACTIONS */}
      <div className="mt-4 flex items-center justify-between">
        {/* LEFT */}
        <button
          type="button"
          onClick={onView}
          className="text-sm font-semibold text-red-700 hover:text-red-800"
        >
          View
        </button>

        {/* RIGHT */}
        <button
          type="button"
          onClick={onConnect}
          disabled={busy || disabled}
          className={cx(
            "rounded-xl px-4 py-2 text-sm font-semibold",
            busy || disabled
              ? "bg-zinc-200 text-zinc-600 cursor-not-allowed"
              : "bg-red-700 text-white hover:bg-red-800"
          )}
        >
          {busy ? "Sending…" : "Connect"}
        </button>
      </div>
    </div>
  );
}

function TravellerCard({
  t,
  busy,
  disabled,
  onZoom,
  onView,
  onConnect,
}: {
  t: Trip;
  busy: boolean;
  disabled: boolean;
  onZoom: () => void;
  onView: () => void;
  onConnect: () => void;
}) {
  const { shown: rolesShown, rest: rolesRest } = clampList(t.roles ?? [], 2);
  const { shown: langsShown, rest: langsRest } = clampList(t.languages ?? [], 2);
  const { shown: intsShown, rest: intsRest } = clampList(t.interests ?? [], 2);

  const destLabel = `${t.destination_city}${t.destination_country ? `, ${t.destination_country}` : ""}`;
  const dateLabel = `${formatDateShort(t.start_date)} → ${formatDateShort(t.end_date)}`;

  return (
    <div className="relative rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm hover:shadow-md transition">
      {/* IMAGE — top left */}
      <button
        type="button"
        onClick={onZoom}
        className="absolute top-4 left-4"
        title={t.avatar_url ? "Click to enlarge" : ""}
      >
        <div className="h-[96px] w-[96px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
          <Avatar src={t.avatar_url} alt="Avatar" size={96} className="h-full w-full object-cover" />
        </div>
      </button>

      {/* CONTENT */}
      <div className="pl-[116px] min-h-[96px]">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-[15px] font-semibold text-zinc-900">{t.display_name}</div>
              {t.verified ? <VerifiedBadge size={16} /> : null}
            </div>

            <div className="mt-0.5 text-xs text-zinc-600 truncate">
              <span className="mr-2">🗺️ {destLabel}</span>
              <span className="text-zinc-500">•</span>
              <span className="ml-2">📅 {dateLabel}</span>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-semibold text-zinc-800">
                ✈️ {t.purpose}
              </span>
              <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-800">
                Trip
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onConnect}
            disabled={busy || disabled}
            className={cx(
              "shrink-0 rounded-xl px-4 py-2 text-sm font-semibold",
              busy || disabled
                ? "bg-zinc-200 text-zinc-600 cursor-not-allowed"
                : "bg-red-700 text-white hover:bg-red-800"
            )}
            title={disabled ? "Already interacted" : ""}
          >
            {busy ? "Sending…" : "Connect"}
          </button>
        </div>

        {/* Pills */}
        <div className="mt-3 flex flex-wrap gap-2">
          {rolesShown.map((r) => (
            <span key={r} className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-800">
              {r}
            </span>
          ))}
          {rolesRest > 0 ? (
            <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-800">
              +{rolesRest} roles
            </span>
          ) : null}

          {langsShown.map((l) => (
            <span key={l} className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-700">
              🌍 {l}
            </span>
          ))}
          {langsRest > 0 ? (
            <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-700">
              +{langsRest} langs
            </span>
          ) : null}

          {intsShown.map((x) => (
            <span key={x} className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-700">
              ✨ {x}
            </span>
          ))}
          {intsRest > 0 ? (
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-700">
              +{intsRest} interests
            </span>
          ) : null}
        </div>
      </div>

      {/* FOOTER ACTIONS */}
      <div className="mt-4 flex items-center justify-between">
        <button type="button" onClick={onView} className="text-sm font-semibold text-red-700 hover:text-red-800">
          View
        </button>
        <div className="text-[11px] text-zinc-500">{t.start_date && t.end_date ? "Trip dates included" : ""}</div>
      </div>
    </div>
  );
}


export default function DiscoverPage() {
  const router = useRouter();
const [filtersOpenMobile, setFiltersOpenMobile] = useState(false);
  const [activeTab, setActiveTab] = useState<StoredFilters["activeTab"]>("members");

  // Connect modal
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectTarget, setConnectTarget] = useState<Profile | null>(null);
  const [connectContext, setConnectContext] = useState<ConnectContext>("member");
  const [connectTripId, setConnectTripId] = useState<string | null>(null);
  const reasonsForTarget = useMemo(() => {
    if (!connectTarget) return [];

    // Travellers: ALWAYS show 3 reasons
    if (connectContext === "traveller") {
      const items: ReasonItem[] = [
        { key: "holiday", label: "Holidays", role: "trip", context: "traveller" },
        { key: "dance_festival", label: "Dance Festival / Congress", role: "trip", context: "traveller" },
        { key: "event_collab", label: "Event / Collab", role: "trip", context: "traveller" },
      ];
      return items;
    }

    // Members: role-based reasons
    return getReasonsForRoles(connectTarget.roles ?? [], connectContext);
  }, [connectTarget, connectContext]);

const allReasonLabels = useMemo(() => {
  return getAllReasons("member").map((r) => r.label).filter(Boolean);
}, []);



  // Data
  const [me, setMe] = useState<Profile | null>(null);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [allTrips, setAllTrips] = useState<Trip[]>([]);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [scope, setScope] = useState<Scope>("country");
  const [connectionStatusByUserId, setConnectionStatusByUserId] = useState<Record<string, ConnectionStatus>>({});

  // image zoom
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  // Countries
  const countriesAll = useMemo(() => Country.getAllCountries(), []);

  // -------------------------
  // APPLIED filters (affect results)
  // -------------------------
  const [filterRoles, setFilterRoles] = useState<string[]>([]);
  const [locationPairs, setLocationPairs] = useState<Array<{ country: string; city: string }>>([]);
  const [filterStyles, setFilterStyles] = useState<string[]>([]);
  const [levelByStyle, setLevelByStyle] = useState<Record<string, string>>({});

  const [tripDateFrom, setTripDateFrom] = useState<string>("");
  const [tripDateTo, setTripDateTo] = useState<string>("");

  const [filterLanguages, setFilterLanguages] = useState<string[]>([]);
  const [filterAvailability, setFilterAvailability] = useState<string[]>([]);
  const [filterInterests, setFilterInterests] = useState<string[]>([]);

  const [sortMode, setSortMode] = useState<StoredFilters["sort"]>("same_city");

  // -------------------------
  // DRAFT filters (what user is editing in the Filters panel)
  // “Search” applies draft -> applied
  // -------------------------
  const [draftRoles, setDraftRoles] = useState<string[]>([]);
  const [draftLocationPairs, setDraftLocationPairs] = useState<Array<{ country: string; city: string }>>([]);
  const [draftStyles, setDraftStyles] = useState<string[]>([]);
  const [draftLevelByStyle, setDraftLevelByStyle] = useState<Record<string, string>>({});

  const [draftTripDateFrom, setDraftTripDateFrom] = useState<string>("");
const [draftTripDateTo, setDraftTripDateTo] = useState<string>("");

  const [draftLanguages, setDraftLanguages] = useState<string[]>([]);
  const [draftAvailability, setDraftAvailability] = useState<string[]>([]);
  const [draftInterests, setDraftInterests] = useState<string[]>([]);
const [interestOptions, setInterestOptions] = useState<string[]>([]);

  // Load from LS -> applied + draft
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredFilters;

      setActiveTab(parsed.activeTab ?? "members");

      const roles = Array.isArray(parsed.roles) ? parsed.roles : [];
      const pairs = Array.isArray(parsed.locationPairs) ? parsed.locationPairs.slice(0, 3) : [];
      const styles = Array.isArray(parsed.styles) ? parsed.styles : [];
      const lvl = parsed.levelByStyle && typeof parsed.levelByStyle === "object" ? parsed.levelByStyle : {};

      const langs = Array.isArray(parsed.languages) ? parsed.languages : [];
      const avail = Array.isArray(parsed.availability) ? parsed.availability : [];
      const ints = Array.isArray(parsed.interests) ? parsed.interests : [];
      const sort = parsed.sort ?? "same_city";

      const tFrom = typeof (parsed as any).tripDateFrom === "string" ? (parsed as any).tripDateFrom : "";
      const tTo = typeof (parsed as any).tripDateTo === "string" ? (parsed as any).tripDateTo : "";

      // applied
      setFilterRoles(roles);
      setLocationPairs(pairs);
      setFilterStyles(styles);
      setLevelByStyle(lvl);
      setFilterLanguages(langs);
      setFilterAvailability(avail);
      setFilterInterests(ints);
      setTripDateFrom(tFrom);
      setTripDateTo(tTo);
      setSortMode(sort);
      

      // draft
      setDraftRoles(roles);
      setDraftLocationPairs(pairs);
      setDraftStyles(styles);
      setDraftLevelByStyle(lvl);
      setDraftLanguages(langs);
      setDraftAvailability(avail);
      setDraftInterests(ints);
      setDraftTripDateFrom(tFrom);
      setDraftTripDateTo(tTo);
    } catch {}
  }, []);

  // Save APPLIED to LS
  useEffect(() => {
    try {
      const payload: StoredFilters = {
        activeTab,
        roles: filterRoles,
        locationPairs: locationPairs.slice(0, 3),
        styles: filterStyles,
        levelByStyle,
        languages: filterLanguages,
        availability: filterAvailability,
        interests: filterInterests,
        tripDateFrom,
        tripDateTo,
        sort: sortMode,
      };
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {}
  }, [activeTab, filterRoles, locationPairs, filterStyles, levelByStyle, filterLanguages, filterAvailability, filterInterests,tripDateFrom, tripDateTo, sortMode]);


  // Default draft location from user profile (if draft is empty)
  useEffect(() => {
    if (!me) return;
    const hasAny = (draftLocationPairs ?? []).some((p) => (p.country ?? "").trim() && (p.city ?? "").trim());
    if (!hasAny && me.country && me.city) {
      setDraftLocationPairs([{ country: me.country, city: me.city }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.user_id]);

  function applyDraftFilters() {
    setFilterRoles(draftRoles);
    setLocationPairs(draftLocationPairs.slice(0, 3));
    setFilterStyles(draftStyles);
    setLevelByStyle(draftLevelByStyle);

    setFilterLanguages(draftLanguages);
    setFilterAvailability(draftAvailability);
    setFilterInterests(draftInterests);
    setTripDateFrom(draftTripDateFrom);
    setTripDateTo(draftTripDateTo);
  }

  function clearSelection() {
    const fallbackLoc = me?.country && me?.city ? [{ country: me.country, city: me.city }] : [];

    // draft
    setDraftRoles([]);
    setDraftLocationPairs(fallbackLoc);
    setDraftStyles([]);
    setDraftLevelByStyle({});
    setDraftLanguages([]);
    setDraftAvailability([]);
    setDraftInterests([]);
    setDraftTripDateFrom("");
    setDraftTripDateTo("");

    // applied
    setFilterRoles([]);
    setLocationPairs(fallbackLoc);
    setFilterStyles([]);
    setLevelByStyle({});
    setFilterLanguages([]);
    setFilterAvailability([]);
    setFilterInterests([]);
    setSortMode("same_city");
    setTripDateFrom("");
setTripDateTo("");
  }
  // PART 4/5
  // -------------------------
  // Fetch (members + traveller trips)
  // -------------------------
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) {
        router.replace("/auth");
        return;
      }

      const { data: myProfile, error: myErr } = await supabase
        .from("profiles")
        .select(
          [
            "user_id",
            "display_name",
            "city",
            "country",
            "roles",
            "languages",
            "interests",
            "availability",
            "connections_count",
            "dance_skills",
            "avatar_url",
            "verified",
            "verified_label",
            "created_at",
          ].join(",")
        )
        .eq("user_id", userId)
        .maybeSingle();

      if (myErr || !myProfile) {
        router.replace("/onboarding");
        return;
      }

      const meProfile = {
        ...(myProfile as any),
        roles: Array.isArray((myProfile as any).roles) ? (myProfile as any).roles : [],
        languages: Array.isArray((myProfile as any).languages) ? (myProfile as any).languages : [],
        interests: Array.isArray((myProfile as any).interests) ? (myProfile as any).interests : [],
        availability: Array.isArray((myProfile as any).availability) ? (myProfile as any).availability : [],
        dance_skills: ((myProfile as any).dance_skills ?? {}) as Record<string, DanceSkill>,
        verified: !!(myProfile as any).verified,
      } as Profile;

      setMe(meProfile);

      const rank = (s: ConnectionStatus) => (s === "accepted" ? 3 : s === "blocked" ? 2 : 1);

      function mergeConnMap(
        base: Record<string, ConnectionStatus>,
        out: ConnectionRow[] | null,
        inc: ConnectionRow[] | null
      ) {
        const map = { ...base };
        function setWithPriority(otherUserId: string, status: ConnectionStatus) {
          const current = map[otherUserId];
          if (!current || rank(status) > rank(current)) map[otherUserId] = status;
        }
        (out ?? []).forEach((c) => setWithPriority(c.target_id, c.status));
        (inc ?? []).forEach((c) => setWithPriority(c.requester_id, c.status));
        return map;
      }

      async function fetchConnMapForIds(otherIds: string[], base: Record<string, ConnectionStatus>) {
        if (otherIds.length === 0) return base;

        const [{ data: out, error: outErr }, { data: inc, error: incErr }] = await Promise.all([
          supabase.from("connections").select("id,requester_id,target_id,status,blocked_by").eq("requester_id", userId).in("target_id", otherIds),
          supabase.from("connections").select("id,requester_id,target_id,status,blocked_by").eq("target_id", userId).in("requester_id", otherIds),
        ]);

        if (outErr) throw new Error(outErr.message);
        if (incErr) throw new Error(incErr.message);

        return mergeConnMap(base, (out ?? []) as ConnectionRow[], (inc ?? []) as ConnectionRow[]);
      }

      async function fetchCountryCandidates() {
        let q = supabase
          .from("profiles")
          .select(
            [
              "user_id",
              "display_name",
              "city",
              "country",
              "roles",
              "languages",
              "interests",
              "availability",
              "connections_count",
              "dance_skills",
              "avatar_url",
              "verified",
              "verified_label",
              "created_at",
            ].join(",")
          )
          .neq("user_id", userId)
          .not("avatar_url", "is", null)
          .neq("display_name", "")
          .limit(250);

        if (meProfile.country) q = q.eq("country", meProfile.country);

        const { data, error } = await q;
        if (error) throw new Error(error.message);

        return (data ?? [])
          .map((row: any) => ({
            ...row,
            roles: Array.isArray(row.roles) ? row.roles : [],
            languages: Array.isArray(row.languages) ? row.languages : [],
            interests: Array.isArray(row.interests) ? row.interests : [],
            availability: Array.isArray(row.availability) ? row.availability : [],
            dance_skills: (row.dance_skills ?? {}) as Record<string, DanceSkill>,
            verified: !!row.verified,
          }))
          .filter(isQualityProfile) as Profile[];
      }

      async function fetchAnywhereCandidates(exclude: Set<string>) {
        const { data, error } = await supabase
          .from("profiles")
          .select(
            [
              "user_id",
              "display_name",
              "city",
              "country",
              "roles",
              "languages",
              "interests",
              "availability",
              "connections_count",
              "dance_skills",
              "avatar_url",
              "verified",
              "verified_label",
              "created_at",
            ].join(",")
          )
          .neq("user_id", userId)
          .not("avatar_url", "is", null)
          .neq("display_name", "")
          .limit(350);

        if (error) throw new Error(error.message);

        const list = (data ?? [])
          .map((row: any) => ({
            ...row,
            roles: Array.isArray(row.roles) ? row.roles : [],
            languages: Array.isArray(row.languages) ? row.languages : [],
            interests: Array.isArray(row.interests) ? row.interests : [],
            availability: Array.isArray(row.availability) ? row.availability : [],
            dance_skills: (row.dance_skills ?? {}) as Record<string, DanceSkill>,
            verified: !!row.verified,
          }))
          .filter(isQualityProfile) as Profile[];

        return list.filter((p) => !exclude.has(p.user_id));
      }

      async function fetchTravellerTrips(): Promise<Trip[]> {
        try {
          const { data, error } = await supabase
            .from("trips")
            .select(["id", "user_id", "status", "destination_country", "destination_city", "start_date", "end_date", "purpose", "created_at"].join(","))
            .neq("user_id", userId)
            .limit(200);

          if (error) throw new Error(error.message);

          const tripRows = (data ?? []) as any[];
          const ids = Array.from(new Set(tripRows.map((t) => t.user_id)));
          if (!ids.length) return [];

          const { data: profs, error: profErr } = await supabase
            .from("profiles")
            .select(["user_id", "display_name", "roles", "languages", "interests", "availability", "avatar_url", "verified", "verified_label"].join(","))
            .in("user_id", ids);

          if (profErr) throw new Error(profErr.message);

          const byId: Record<string, any> = {};
          (profs ?? []).forEach((p: any) => (byId[p.user_id] = p));

          return tripRows
            .map((t) => {
              const p = byId[t.user_id] ?? {};
              return {
                id: t.id,
                user_id: t.user_id,

                status: (t.status ?? "active") as TripStatus,

                destination_country: t.destination_country,
                destination_city: t.destination_city,
                start_date: toIsoDate(t.start_date),
                end_date: toIsoDate(t.end_date),
                purpose: (t.purpose ?? "Holiday Trip") as TripPurpose,
                created_at: t.created_at ?? null,

                display_name: p.display_name ?? "—",
                roles: Array.isArray(p.roles) ? p.roles : [],
                languages: Array.isArray(p.languages) ? p.languages : [],
                interests: Array.isArray(p.interests) ? p.interests : [],
                availability: Array.isArray(p.availability) ? p.availability : [],
                avatar_url: p.avatar_url ?? null,
                verified: !!p.verified,
                verified_label: p.verified_label ?? null,
              } as Trip;
            })
            .filter(isQualityTrip);
        } catch {
          return [];
        }
      }

      try {
        let combinedConnMap: Record<string, ConnectionStatus> = {};
        const exclude = new Set<string>();

        const countryCandidates = await fetchCountryCandidates();
        countryCandidates.forEach((p) => exclude.add(p.user_id));

        combinedConnMap = await fetchConnMapForIds(countryCandidates.map((p) => p.user_id), combinedConnMap);

        let visible = countryCandidates.filter((p) => !combinedConnMap[p.user_id]);
        let finalScope: Scope = "country";

        if (visible.length < 5) {
          const anyCandidates = await fetchAnywhereCandidates(exclude);

          combinedConnMap = await fetchConnMapForIds(anyCandidates.map((p) => p.user_id), combinedConnMap);

          const anyVisible = anyCandidates.filter((p) => !combinedConnMap[p.user_id]);
          visible = [...visible, ...anyVisible];
          finalScope = "anywhere";
        }

        setConnectionStatusByUserId(combinedConnMap);
        const visibleProfiles = visible.slice(0, 180);
setAllProfiles(visibleProfiles);
setScope(finalScope);

const trips = await fetchTravellerTrips();
setAllTrips(trips);

// Build interest options from DB data (profiles + trips) + keep defaults
const collected = new Set<string>(allReasonLabels);

for (const p of visibleProfiles) {
  for (const it of (p.interests ?? [])) {
    const v = (it ?? "").trim();
    if (v) collected.add(v);
  }
}

for (const t of trips) {
  for (const it of (t.interests ?? [])) {
    const v = (it ?? "").trim();
    if (v) collected.add(v);
  }
}

setInterestOptions(Array.from(collected).sort((a, b) => a.localeCompare(b)));

      } catch (e: any) {
        setError(e?.message ?? "Failed to load discover.");
        setAllProfiles([]);
        setAllTrips([]);
        setConnectionStatusByUserId({});
        setScope("country");
      }

      setLoading(false);
    })();
  }, [router]);

  function stylesInCommonCount(p: Profile) {
    const meStyles = new Set(Object.keys(me?.dance_skills ?? {}).map((s) => s.toLowerCase()));
    const other = Object.keys(p.dance_skills ?? {}).map((s) => s.toLowerCase());
    let count = 0;
    for (const s of other) if (meStyles.has(s)) count++;
    return count;
  }

  function safeTime(obj: { created_at?: string | null }) {
    const t = obj.created_at ? Date.parse(obj.created_at) : NaN;
    return Number.isFinite(t) ? t : 0;
  }

  // Applied filter chips (based on APPLIED filters)
  const appliedChips = useMemo(() => {
    const chips: Array<{ k: string; label: string; onRemove: () => void }> = [];

    filterRoles.forEach((r) =>
      chips.push({
        k: `role-${r}`,
        label: `Role: ${r}`,
        onRemove: () => setFilterRoles(filterRoles.filter((x) => x !== r)),
      })
    );

    locationPairs.forEach((p, idx) => {
      if (!p.country && !p.city) return;
      chips.push({
        k: `loc-${idx}-${p.country}-${p.city}`,
        label: `Loc: ${p.city || "—"}, ${p.country || "—"}`,
        onRemove: () => setLocationPairs(locationPairs.filter((_, i) => i !== idx)),
      });
    });

    filterStyles.forEach((s) => {
      const lvl = (levelByStyle[s] ?? "").trim();
      chips.push({
        k: `style-${s}`,
        label: lvl ? `Style: ${s} • ${lvl}` : `Style: ${s}`,
        onRemove: () => {
          setFilterStyles(filterStyles.filter((x) => x !== s));
          const copy = { ...levelByStyle };
          delete copy[s];
          setLevelByStyle(copy);
        },
      });
    });
filterLanguages.forEach((l) =>
  chips.push({
    k: `lang-${l}`,
    label: `Lang: ${l}`,
    onRemove: () => setFilterLanguages(filterLanguages.filter((x) => x !== l)),
  })
);

filterAvailability.forEach((a) =>
  chips.push({
    k: `av-${a}`,
    label: `Avail: ${a}`,
    onRemove: () => setFilterAvailability(filterAvailability.filter((x) => x !== a)),
  })
);

filterInterests.forEach((x) =>
  chips.push({
    k: `int-${x}`,
    label: `Interest: ${x}`,
    onRemove: () => setFilterInterests(filterInterests.filter((v) => v !== x)),
  })
);

if ((tripDateFrom ?? "").trim() || (tripDateTo ?? "").trim()) {
  const label = `Trip dates: ${tripDateFrom ? formatDateShort(tripDateFrom) : "Any"} → ${
    tripDateTo ? formatDateShort(tripDateTo) : "Any"
  }`;

  chips.push({
    k: `tripdates-${tripDateFrom}-${tripDateTo}`,
    label,
    onRemove: () => {
      setTripDateFrom("");
      setTripDateTo("");
    },
  });
}
    return chips;
  }, [
    filterRoles,
    locationPairs,
    filterStyles,
    levelByStyle,
    filterLanguages,
    filterAvailability,
    filterInterests,
    tripDateFrom,
    tripDateTo,
  ]);
  // Filtering logic (Members) using APPLIED filters
  const filteredMembers = useMemo(() => {
    if (!me) return [];
    let list = [...allProfiles];

    if (filterRoles.length) {
      const set = new Set(filterRoles);
      list = list.filter((p) => (p.roles ?? []).some((r) => set.has(r)));
    }

    const cleanPairs = locationPairs
      .map((p) => ({ country: (p.country ?? "").trim(), city: (p.city ?? "").trim() }))
      .filter((p) => p.country && p.city);

    if (cleanPairs.length) {
      list = list.filter((p) => cleanPairs.some((pair) => (p.country ?? "") === pair.country && p.city === pair.city));
    }

    if (filterStyles.length) {
      const stylesSet = new Set(filterStyles);
      list = list.filter((p) => Object.keys(p.dance_skills ?? {}).some((s) => stylesSet.has(s)));

      const activeLevelStyles = filterStyles.filter((s) => (levelByStyle[s] ?? "").trim().length > 0);
      if (activeLevelStyles.length) {
        list = list.filter((p) =>
          activeLevelStyles.some((s) => ((p.dance_skills ?? {})[s]?.level ?? "") === (levelByStyle[s] ?? ""))
        );
      }
    }

    if (filterLanguages.length) {
      const set = new Set(filterLanguages);
      list = list.filter((p) => (p.languages ?? []).some((l) => set.has(l)));
    }

    if (filterAvailability.length) {
      const set = new Set(filterAvailability);
      list = list.filter((p) => (p.availability ?? []).some((a) => set.has(a)));
    }

    if (filterInterests.length) {
      const set = new Set(filterInterests);
      list = list.filter((p) => (p.interests ?? []).some((x) => set.has(x)));
    }

    const meCity = me.city;

    if (sortMode === "same_city") {
      list.sort((a, b) => {
        const aSame = a.city === meCity ? 1 : 0;
        const bSame = b.city === meCity ? 1 : 0;
        if (bSame !== aSame) return bSame - aSame;

        const v = (b.verified ? 1 : 0) - (a.verified ? 1 : 0);
        if (v !== 0) return v;

        return stylesInCommonCount(b) - stylesInCommonCount(a);
      });
    } else if (sortMode === "styles_match") {
      list.sort((a, b) => {
        const diff = stylesInCommonCount(b) - stylesInCommonCount(a);
        if (diff !== 0) return diff;

        const v = (b.verified ? 1 : 0) - (a.verified ? 1 : 0);
        if (v !== 0) return v;

        const aSame = a.city === meCity ? 1 : 0;
        const bSame = b.city === meCity ? 1 : 0;
        return bSame - aSame;
      });
    } else if (sortMode === "newest") {
      list.sort((a, b) => {
        const v = (b.verified ? 1 : 0) - (a.verified ? 1 : 0);
        if (v !== 0) return v;
        return safeTime(b) - safeTime(a);
      });
    }

    return list.slice(0, 60);
  }, [me, allProfiles, filterRoles, locationPairs, filterStyles, levelByStyle, filterLanguages, filterAvailability, filterInterests, sortMode]);

  // Filtering logic (Travellers) using APPLIED filters
  const filteredTravellers = useMemo(() => {
    if (!me) return [];
    let list = [...allTrips];

    if (filterRoles.length) {
      const set = new Set(filterRoles);
      list = list.filter((t) => (t.roles ?? []).some((r) => set.has(r)));
    }

    const cleanPairs = locationPairs
      .map((p) => ({ country: (p.country ?? "").trim(), city: (p.city ?? "").trim() }))
      .filter((p) => p.country && p.city);

    if (cleanPairs.length) {
      list = list.filter((t) => cleanPairs.some((pair) => t.destination_country === pair.country && t.destination_city === pair.city));
    }

    // Trip date range filter (overlap)
const from = (tripDateFrom ?? "").trim();
const to = (tripDateTo ?? "").trim();

if (from || to) {
  const fromT = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  const toT = to ? Date.parse(to) : Number.POSITIVE_INFINITY;

  list = list.filter((t) => {
    const s = t.start_date ? Date.parse(t.start_date) : NaN;
    const e = t.end_date ? Date.parse(t.end_date) : NaN;
    if (!Number.isFinite(s) || !Number.isFinite(e)) return false;

    // overlap: tripStart <= filterTo AND tripEnd >= filterFrom
    return s <= toT && e >= fromT;
  });
}

    if (filterLanguages.length) {
      const set = new Set(filterLanguages);
      list = list.filter((t) => (t.languages ?? []).some((l) => set.has(l)));
    }

    if (filterAvailability.length) {
      const set = new Set(filterAvailability);
      list = list.filter((t) => (t.availability ?? []).some((a) => set.has(a)));
    }

    if (filterInterests.length) {
      const set = new Set(filterInterests);
      list = list.filter((t) => (t.interests ?? []).some((x) => set.has(x)));
    }

    if (sortMode === "newest") {
      list.sort((a, b) => {
        const v = (b.verified ? 1 : 0) - (a.verified ? 1 : 0);
        if (v !== 0) return v;
        return safeTime(b) - safeTime(a);
      });
    }

    return list.slice(0, 60);
  }, [me, allTrips, filterRoles, locationPairs, filterLanguages, filterAvailability, filterInterests, tripDateFrom, tripDateTo, sortMode]);
  // PART 5/5
  // -------------------------
  // Connection insert (with reason)
  // -------------------------
  async function requestConnectWithReason(args: {
    targetId: string;
    reasonKey: string;
    context: ConnectContext;
    reasonRole: string;
    note?: string | null;
    tripId?: string | null;
  }) {
    setError(null);
    setBusyId(args.targetId);

    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;

    if (!userId) {
      setBusyId(null);
      window.location.assign("/auth");
      return;
    }

    const res = await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requesterId: userId,
        targetId: args.targetId,
        payload: {
          connect_context: args.context,
          connect_reason: args.reasonKey,
          connect_reason_role: args.reasonRole || null,
          connect_note: (args.note ?? "").trim() || null,
          trip_id: args.tripId ?? null,
        },
      }),
    });

let json: { ok?: boolean; error?: string } = {};
try {
  const text = await res.text();
  json = text ? (JSON.parse(text) as any) : {};
} catch {
  json = {};
}
    setBusyId(null);

    if (!res.ok) {
  setError(json?.error ?? `Failed to connect (${res.status})`);
  return;
}

   // Remove card from UI
if (args.context === "member") {
  setAllProfiles((prev) => prev.filter((p) => p.user_id !== args.targetId));
}
if (args.context === "traveller" && args.tripId) {
  setAllTrips((prev) => prev.filter((t) => t.id !== args.tripId));
}

setConnectionStatusByUserId((prev) => ({ ...prev, [args.targetId]: "pending" }));
  }

  const showingCount = activeTab === "members" ? filteredMembers.length : filteredTravellers.length;

  if (loading)
    return (
      <div className="min-h-screen bg-zinc-50 p-6">
        <div className="mx-auto max-w-6xl">
          <Nav />

          {/* Skeleton header aligned with the real header */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-56 rounded-xl bg-zinc-200 animate-pulse" />
              <div className="h-4 w-28 rounded bg-zinc-200 animate-pulse" />
            </div>

            <div className="flex items-center gap-2">
              <div className="h-4 w-10 rounded bg-zinc-200 animate-pulse" />
              <div className="h-9 w-40 rounded-lg bg-zinc-200 animate-pulse" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Filters skeleton */}
            <aside className="lg:col-span-4">
              <div className="rounded-2xl border border-zinc-200 bg-zinc-100 p-2 sm:p-3">
                <div className="flex items-center justify-between">
                  <div className="h-4 w-24 rounded bg-zinc-200 animate-pulse" />
                  <div className="h-4 w-28 rounded bg-zinc-200 animate-pulse" />
                </div>

                <div className="mt-3 space-y-2">
                  <div className="h-28 rounded-xl bg-white border border-zinc-200 p-3">
                    <div className="h-3 w-28 rounded bg-zinc-200 animate-pulse" />
                    <div className="mt-3 h-8 rounded-lg bg-zinc-200 animate-pulse" />
                    <div className="mt-2 h-8 rounded-lg bg-zinc-200 animate-pulse" />
                  </div>

                  <div className="h-36 rounded-xl bg-white border border-zinc-200 p-3">
                    <div className="h-3 w-20 rounded bg-zinc-200 animate-pulse" />
                    <div className="mt-3 space-y-2">
                      <div className="h-6 rounded bg-zinc-200 animate-pulse" />
                      <div className="h-6 rounded bg-zinc-200 animate-pulse" />
                      <div className="h-6 rounded bg-zinc-200 animate-pulse" />
                    </div>
                  </div>

                  <div className="h-44 rounded-xl bg-white border border-zinc-200 p-3">
                    <div className="h-3 w-28 rounded bg-zinc-200 animate-pulse" />
                    <div className="mt-3 space-y-2">
                      <div className="h-6 rounded bg-zinc-200 animate-pulse" />
                      <div className="h-6 rounded bg-zinc-200 animate-pulse" />
                      <div className="h-6 rounded bg-zinc-200 animate-pulse" />
                      <div className="h-6 rounded bg-zinc-200 animate-pulse" />
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="h-9 rounded-xl bg-zinc-200 animate-pulse" />
                    <div className="h-9 rounded-xl bg-zinc-200 animate-pulse" />
                  </div>
                </div>
              </div>
            </aside>

            {/* Results skeleton */}
            <section className="lg:col-span-8">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="h-4 w-56 rounded bg-zinc-200 animate-pulse" />
                  <div className="h-8 w-44 rounded-full bg-zinc-200 animate-pulse" />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <div className="flex items-start gap-3">
                        <div className="h-20 w-20 rounded-xl bg-zinc-200 animate-pulse" />
                        <div className="flex-1">
                          <div className="h-4 w-32 rounded bg-zinc-200 animate-pulse" />
                          <div className="mt-2 h-3 w-24 rounded bg-zinc-200 animate-pulse" />
                          <div className="mt-3 flex gap-2">
                            <div className="h-6 w-16 rounded-full bg-zinc-200 animate-pulse" />
                            <div className="h-6 w-16 rounded-full bg-zinc-200 animate-pulse" />
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between">
                        <div className="h-4 w-12 rounded bg-zinc-200 animate-pulse" />
                        <div className="h-9 w-28 rounded-xl bg-zinc-200 animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-6xl">
        <Nav />

        {/* Top header */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <DiscreteTabs
              value={activeTab}
              onChange={(v) => setActiveTab(v as any)}
              items={[
                { value: "members", label: "Members" },
                { value: "travellers", label: "Travellers" },
              ]}
            />
<div className="text-xs text-zinc-500">{scope === "anywhere" ? "" : "In your country"}</div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-[11px] text-zinc-600">Sort</div>
            <select
              className="rounded-lg border border-zinc-300 px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-red-500 bg-white"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as StoredFilters["sort"])}
            >
              <option value="same_city">Same city first</option>
              <option value="styles_match">Most styles in common</option>
              <option value="newest">Newest</option>
            </select>
          </div>
        </div>

        {/* Two sections: Filters (grey) + Results (white) */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Filters */}
          <aside className="lg:col-span-4">
<div className="rounded-2xl border border-zinc-200 bg-zinc-100 p-2 sm:p-3">
                <div className="flex items-center justify-between">
                <div className="text-xs font-semibold tracking-wide text-zinc-700 uppercase">Filters</div>
                <button type="button" onClick={clearSelection} className="text-xs font-semibold text-red-700 hover:text-red-800">
                  Clear selection
                </button>
              </div>

              {/* Main filters (always visible) */}
                <div className="mt-2 space-y-2">             
                  <LocationPairs
                    countriesAll={countriesAll}
                    pairs={draftLocationPairs}
                    onChange={(next) => setDraftLocationPairs(next.slice(0, 3))}
                    maxPairs={3}
                  />
                  {activeTab === "travellers" && (
                    <div className="rounded-xl border border-zinc-200 bg-white p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] font-semibold tracking-wide text-zinc-700 uppercase">Trip dates</div>
                        {(draftTripDateFrom || draftTripDateTo) && (
                          <button
                            type="button"
                            onClick={() => {
                              setDraftTripDateFrom("");
                              setDraftTripDateTo("");
                            }}
                            className="text-[11px] text-red-700 hover:text-red-800"
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <label className="text-[11px] text-zinc-600">From</label>
                          <input
                            type="date"
                            value={draftTripDateFrom}
                            onChange={(e) => setDraftTripDateFrom(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </div>

                        <div>
                          <label className="text-[11px] text-zinc-600">To</label>
                          <input
                            type="date"
                            value={draftTripDateTo}
                            onChange={(e) => setDraftTripDateTo(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </div>
                      </div>

                      <div className="mt-2 text-[11px] text-zinc-500">Filters trips that overlap the selected range.</div>
                    </div>
                  )}
                  <SearchCheckList
                    title="Roles"
                    options={[...ROLES]}
                    values={draftRoles}
                    onChange={setDraftRoles}
                  />
                <DanceStylePicker
                  styles={[...STYLES]}
                  selected={draftStyles}
                  levelByStyle={draftLevelByStyle}
                  onChangeSelected={setDraftStyles}
                  onChangeLevelByStyle={setDraftLevelByStyle}
                />

                {/* Optional extra filters (collapsed, but still present) */}
                <details className="rounded-xl border border-zinc-200 bg-white">
                  <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-zinc-700">
                    More filters
                    <span className="ml-2 text-[11px] font-normal text-zinc-500">(languages, availability, interests)</span>
                  </summary>

                  <div className="p-3 pt-0">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <SearchCheckList
                        title="Languages"
                        options={[...LANGUAGES]}
                        values={draftLanguages}
                        onChange={setDraftLanguages}
                        max={3}
                        placeholderSearch="Search language…"
                      />

                      <SearchCheckList
                        title="Availability"
                        options={[...AVAILABILITY]}
                        values={draftAvailability}
                        onChange={setDraftAvailability}
                      />
                      <div className="sm:col-span-2">
                        <SearchCheckList
                          title="Interests"
                          options={interestOptions}
                          values={draftInterests}
                          onChange={setDraftInterests}
                        />
                      </div>
                    </div>
                  </div>
                </details>

                {/* Action buttons: Search / Clear */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  
                </div>

               
              </div>
              <div className="mt-3 border-t border-zinc-200 pt-3">
  <div className="grid grid-cols-2 gap-2">
    <button
      type="button"
      onClick={clearSelection}
      className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
    >
      Clear
    </button>

    <button
      type="button"
      onClick={() => {
        applyDraftFilters();
        setFiltersOpenMobile(false);
      }}
      className="rounded-xl bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-800"
    >
      Search
    </button>
  </div>
</div>
            </div>
          </aside>

          {/* Results */}
          <section className="lg:col-span-8">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-zinc-700">
                  Showing <span className="font-semibold text-zinc-900">{showingCount}</span> {activeTab === "members" ? "members" : "travellers"}
                </div>

                {/* Applied chips */}
                {appliedChips.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {appliedChips.map((c) => (
                      <button
                        key={c.k}
                        type="button"
                        onClick={c.onRemove}
                        className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
                        title="Remove"
                      >
                        {c.label}
                        <span className="text-zinc-400">✕</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {error && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>}

              {activeTab === "members" ? (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {filteredMembers.map((p) => {
                    const common = stylesInCommonCount(p);
                    const skillEntries = Object.entries(p.dance_skills ?? {}).filter(([k]) => !!k);

                    return (
  <DiscoverProfileCard
    key={p.user_id}
    p={{
      user_id: p.user_id,
      display_name: p.display_name,
      city: p.city,
      country: p.country,
      roles: p.roles ?? [],
      languages: p.languages ?? [],
      connections_count: p.connections_count ?? 0,
      dance_skills: p.dance_skills ?? {},
      avatar_url: p.avatar_url,
      verified: !!p.verified,
    }}
    commonStylesCount={stylesInCommonCount(p)}
    busy={busyId === p.user_id}
    disabled={!!connectionStatusByUserId[p.user_id]}
    onZoom={() => p.avatar_url && setZoomUrl(p.avatar_url)}
    onConnect={() => {
      setConnectTarget(p);
      setConnectContext("member");
      setConnectTripId(null);
      setConnectOpen(true);
    }}
  />

                    );
                  })}

                  {filteredMembers.length === 0 && <div className="text-zinc-600">No results with these filters. Try clearing some filters.</div>}
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {filteredTravellers.map((t) => {
                    const tripLabel = `${t.destination_city}, ${t.destination_country} • ${formatDateShort(t.start_date)} → ${formatDateShort(t.end_date)}`;

                    return (
                      <TravellerCard
      key={t.id}
      t={t}
      busy={busyId === t.user_id}
      disabled={!!connectionStatusByUserId[t.user_id]}
      onZoom={() => t.avatar_url && setZoomUrl(t.avatar_url)}
      onView={() => router.push(`/profile/${t.user_id}`)}
      onConnect={() => {
        const pseudoProfile: Profile = {
          user_id: t.user_id,
          display_name: t.display_name,
          city: "",
          country: null,
          roles: t.roles ?? [],
          languages: t.languages ?? [],
          interests: t.interests ?? [],
          availability: t.availability ?? [],
          connections_count: 0,
          dance_skills: {},
          avatar_url: t.avatar_url,
          verified: t.verified,
          verified_label: t.verified_label,
          created_at: t.created_at ?? null,
        };
        setConnectTarget(pseudoProfile);
setConnectContext("traveller");
setConnectTripId(t.id);
setConnectOpen(true); 
      }}
    />
                    );
                  })}

                  {filteredTravellers.length === 0 && <div className="text-zinc-600">No travellers with these filters. Try clearing some filters.</div>}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Image zoom modal */}
        {zoomUrl && (
          <button type="button" className="fixed inset-0 bg-black/60 flex items-center justify-center p-6 z-50" onClick={() => setZoomUrl(null)} aria-label="Close image">
            <div className="relative w-full max-w-xl aspect-square bg-white rounded-2xl overflow-hidden">
              <Image src={zoomUrl} alt="Avatar enlarged" fill className="object-cover" sizes="600px" />
            </div>
          </button>
        )}

    <ConnectReasonModal
  open={connectOpen}
  onClose={() => {
    if (busyId) return;
    setConnectOpen(false);
    setConnectTarget(null);
    setConnectTripId(null);
  }}
  targetName={connectTarget?.display_name ?? "—"}
  targetRoles={connectTarget?.roles ?? []}
  context={connectContext}
  reasons={reasonsForTarget}
  loading={!!busyId && busyId === connectTarget?.user_id}
  onConfirm={(reasonKey: string) => {
  const target = connectTarget;
  if (!target) return;

  const reasonRole =
    connectContext === "traveller" ? "trip" : (target.roles?.[0] ?? "member").toString();

  requestConnectWithReason({
    targetId: target.user_id,
    reasonKey,
    context: connectContext,
    reasonRole,
    note: null,
    tripId: connectContext === "traveller" ? connectTripId : null,
  });

  setConnectOpen(false);
  setConnectTarget(null);
  setConnectTripId(null);
}}
/>
      </div>
    </div>
  );
}