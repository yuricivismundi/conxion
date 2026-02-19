"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { City, Country } from "country-state-city";
import { supabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import {
  FALLBACK_GRADIENT,
  getTripHeroFallbackUrl,
  getTripHeroStorageFolderUrl,
  getTripHeroStorageUrl,
} from "@/lib/city-hero-images";

type Tab = "members" | "travellers";

type Level = "Beginner" | "Improver" | "Intermediate" | "Advanced" | "Teacher/Competitor";
type Role = "Social Dancer / Student" | "Organizer" | "Studio Owner" | "Promoter" | "DJ" | "Artist" | "Teacher";
type Style = "Bachata" | "Salsa" | "Kizomba" | "Zouk";
const STYLE_OPTIONS: Style[] = ["Bachata", "Salsa", "Kizomba", "Zouk"];
const ROLE_OPTIONS: Role[] = ["Social Dancer / Student", "Organizer", "Studio Owner", "Promoter", "DJ", "Artist", "Teacher"];

type ConnectReason = {
  id: string;
  label: string;
  role: string;
  sort_order?: number;
};

type ConnectModalState = {
  open: boolean;
  targetUserId: string | null;
  targetName?: string;
  targetPhotoUrl?: string;
  targetRoles: string[];
  connectContext: "member" | "traveller";
  tripId: string | null;
};

const EMPTY_CONNECT_MODAL: ConnectModalState = {
  open: false,
  targetUserId: null,
  targetRoles: [],
  connectContext: "member",
  tripId: null,
};

const LEVELS: Level[] = ["Beginner", "Improver", "Intermediate", "Advanced", "Teacher/Competitor"];
const LANGUAGE_CODES = [
  "af", "am", "ar", "az", "be", "bg", "bn", "bo", "bs", "ca", "cs", "cy", "da", "de", "el", "en",
  "eo", "es", "et", "eu", "fa", "fi", "fil", "fo", "fr", "ga", "gd", "gl", "gu", "ha", "he", "hi",
  "hr", "hu", "hy", "id", "ig", "is", "it", "ja", "ka", "kk", "km", "kn", "ko", "ku", "ky", "lb",
  "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my", "nb", "ne", "nl", "nn",
  "no", "om", "or", "pa", "pl", "ps", "pt", "qu", "ro", "ru", "rw", "sd", "si", "sk", "sl", "so",
  "sq", "sr", "sv", "sw", "ta", "te", "th", "ti", "tk", "tl", "tr", "tt", "ug", "uk", "ur", "uz",
  "vi", "xh", "yi", "yo", "zh", "zu",
] as const;
const COMMON_LANGUAGES = [
  "English",
  "Spanish",
  "Portuguese",
  "French",
  "Italian",
  "German",
] as const;
const LEVEL_SHORT_LABEL: Record<Level, string> = {
  Beginner: "Beg",
  Improver: "Imp",
  Intermediate: "Int",
  Advanced: "Adv",
  "Teacher/Competitor": "Pro",
};

type Interest =
  | "Dance at local socials and events"
  | "Find practice partners"
  | "Get tips on the local dance scene"
  | "Collaborate on video projects"
  | "Find buddies for workshops, socials, accommodations, or rides"
  | "Collaborate with artists/teachers for events/festivals"
  | "Organize recurring local events"
  | "Secure sponsorships and org collabs"
  | "Offer volunteer roles for events"
  | "Recruit guest dancers"
  | "Promote special workshops and events"
  | "Organize classes and schedules"
  | "Collaborate with other studio owners"
  | "Secure sponsorships and hire talent"
  | "Partner to promote festivals"
  | "Refer artists, DJs, and teachers"
  | "Co-promote local parties/socials"
  | "Exchange guest lists and shoutouts"
  | "Share promo materials and audiences"
  | "Produce new songs and tracks"
  | "Collaborate on tracks or live sets"
  | "Network for festival gigs"
  | "DJ international and local events"
  | "Feature in promo videos/socials"
  | "Offer private/group lessons"
  | "Teach regular classes"
  | "Lead festival workshops"
  | "Co-teach sessions"
  | "Exchange tips, curricula, and student referrals";

type Availability = "Weekdays" | "Weekends" | "DayTime" | "Evenings" | "Travel for Events" | "I’d rather not say";
const TRIP_PURPOSES = ["Holiday Trip", "Dance Festival", "Social Dancing", "Training / Workshops"] as const;

const PURPOSE_META: Record<string, { icon: string; text: string; bg: string; border: string }> = {
  "Holiday Trip": {
    icon: "luggage",
    text: "text-[#00F5FF]",
    bg: "bg-[#00F5FF]/12",
    border: "border-[#00F5FF]/35",
  },
  "Dance Festival": {
    icon: "festival",
    text: "text-[#FF00FF]",
    bg: "bg-[#FF00FF]/12",
    border: "border-[#FF00FF]/35",
  },
  "Social Dancing": {
    icon: "groups",
    text: "text-[#67E8F9]",
    bg: "bg-[#67E8F9]/12",
    border: "border-[#67E8F9]/35",
  },
  "Training / Workshops": {
    icon: "school",
    text: "text-[#C084FC]",
    bg: "bg-[#C084FC]/12",
    border: "border-[#C084FC]/35",
  },
};

const getPurposeMeta = (purpose?: string | null) =>
  PURPOSE_META[purpose ?? ""] ?? {
    icon: "event",
    text: "text-[#0dccf2]",
    bg: "bg-[#0dccf2]/10",
    border: "border-[#0dccf2]/30",
  };

function langLabelToCode(label: string): string {
  const raw = String(label ?? "").trim();
  if (!raw) return "";

  // If DB already stores ISO-like codes (e.g., "EN", "ES"), keep them.
  if (raw.length === 2) return raw.toUpperCase();

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
    Norwegian: "NO",
    Chinese: "ZH",
    Japanese: "JA",
    Korean: "KO",
    Arabic: "AR",
    Turkish: "TR",
  };

  return map[raw] ?? raw.toUpperCase().slice(0, 2);
}

type MemberCard = {
  id: string;
  name: string;
  city: string;
  country: string;
  verified?: boolean;
  roles: string[];
  danceSkills: Partial<Record<Style, Level>>;
  otherStyle?: boolean;
  langs?: string[]; // stored as codes in cards (EN/ES/...)
  interest?: string;
  availability?: string;
  photoUrl?: string;

  connectionsCount?: number;

  // references (all sentiments)
  refTotalAll?: number;
  refMemberAll?: number;
  refTripAll?: number;
  refEventAll?: number;

  // sentiment totals (for details page later)
  refTotalPositive?: number;
  refTotalNeutral?: number;
  refTotalNegative?: number;
};

type TripStatus = "active" | "inactive";
type SortMode = "recommended" | "newest" | "connections_desc" | "references_desc" | "name_az" | "city_az";
type TripCard = {
  id: string;
  user_id: string;
  destination_country: string;
  destination_city: string;
  start_date: string;
  end_date: string;
  purpose: string;
  reason?: string | null;
  status?: TripStatus | null;
  created_at?: string | null;
  display_name: string;
  avatar_url: string | null;
  roles: string[];
  languages?: string[];
  refMemberAll?: number;
  refTripAll?: number;
  refEventAll?: number;
};

type ProfileFeedRow = {
  id?: string;
  user_id?: string;
  display_name?: string | null;
  city?: string | null;
  country?: string | null;
  roles?: unknown;
  languages?: unknown;
  avatar_url?: string | null;
  verified?: boolean | null;
  dance_skills?: unknown;
  has_other_style?: boolean | null;
  connections_count?: number | null;
  interests?: unknown;
  availability?: unknown;
  ref_total_all?: number | null;
  ref_member_all?: number | null;
  ref_trip_all?: number | null;
  ref_event_all?: number | null;
  ref_total_positive?: number | null;
  ref_total_neutral?: number | null;
  ref_total_negative?: number | null;
  is_test?: boolean | null;
};

type TripRow = {
  id?: string;
  user_id?: string;
  status?: string | null;
  destination_country?: string | null;
  destination_city?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  purpose?: string | null;
  created_at?: string | null;
};

type ProfileFeedLiteRow = {
  id?: string;
  user_id?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  roles?: unknown;
  languages?: unknown;
  ref_member_all?: number | null;
  ref_trip_all?: number | null;
  ref_event_all?: number | null;
};

const isString = (value: unknown): value is string => typeof value === "string";

function errorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e) {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim().length > 0) return msg;
  }
  return fallback;
}

function normalizeStyleKeyToUi(styleKey: string): Style | null {
  const k = (styleKey || "").trim().toLowerCase();
  const map: Record<string, Style> = {
    bachata: "Bachata",
    salsa: "Salsa",
    kizomba: "Kizomba",
    zouk: "Zouk",
  };
  return map[k] ?? null;
}

function safeParseJson<T>(v: unknown): T | null {
  if (!v) return null;
  if (typeof v === "object") return v as T;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeLevelToUi(v: unknown): Level | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const lower = s.toLowerCase();

  // Supports your long onboarding labels, e.g. "Intermediate (9–24 months)"
  if (lower.startsWith("beginner")) return "Beginner";
  if (lower.startsWith("improver")) return "Improver";
  if (lower.startsWith("intermediate")) return "Intermediate";
  if (lower.startsWith("advanced")) return "Advanced";
  if (lower.startsWith("teacher")) return "Teacher/Competitor";

  // Supports already-normalized short labels
  if ((LEVELS as readonly string[]).includes(s)) return s as Level;

  return null;
}

function formatDateCompact(iso: string) {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  const d = new Date(parsed.y, parsed.m - 1, parsed.d);
  return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(d).replace(" ", "-");
}

function pad2(v: number) {
  return v.toString().padStart(2, "0");
}

function toIsoDateParts(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function parseIsoDate(v: string) {
  const [y, m, d] = v.split("-").map((p) => parseInt(p, 10));
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function getTodayIsoInTz(tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  if (!y || !m || !d) return "";
  return `${y}-${m}-${d}`;
}

function addMonths(y: number, m: number, delta: number) {
  const next = new Date(y, m - 1 + delta, 1);
  return { y: next.getFullYear(), m: next.getMonth() + 1 };
}

function addDaysIso(iso: string, delta: number) {
  const parsed = parseIsoDate(iso);
  if (!parsed) return "";
  const next = new Date(parsed.y, parsed.m - 1, parsed.d + delta);
  return toIsoDateParts(next.getFullYear(), next.getMonth() + 1, next.getDate());
}

function diffDays(aIso: string, bIso: string) {
  const a = parseIsoDate(aIso);
  const b = parseIsoDate(bIso);
  if (!a || !b) return 0;
  const aT = Date.UTC(a.y, a.m - 1, a.d);
  const bT = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((bT - aT) / 86400000);
}

function formatShortDate(iso: string) {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  const d = new Date(parsed.y, parsed.m - 1, parsed.d);
  return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(d);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

type FiltersState = {
  country?: string;
  cities: string[]; // max 3
  roles: Role[];
  styleLevels: Partial<Record<Style, Level[]>>;
  otherStyle: boolean;
  langs: string[]; // labels
  interest?: Interest; // single
  availability?: Availability; // single
  verifiedOnly: boolean;
  tripPurpose?: (typeof TRIP_PURPOSES)[number];
  tripDateFrom?: string;
  tripDateTo?: string;
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
  tripPurpose: undefined,
  tripDateFrom: undefined,
  tripDateTo: undefined,
};

export default function ConnectionsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("members");
  const [myCityOnly, setMyCityOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("recommended");
  const [myCity, setMyCity] = useState<string | null>(null);
  const [myCountry, setMyCountry] = useState<string | null>(null);
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [myLangCodes, setMyLangCodes] = useState<string[]>([]);
  const [myStyleLevels, setMyStyleLevels] = useState<Partial<Record<Style, Level>>>({});

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<FiltersState>(EMPTY_FILTERS);
  const [cityQuery, setCityQuery] = useState("");
  const [languageQuery, setLanguageQuery] = useState("");
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(true);

  const [uiError, setUiError] = useState<string | null>(null);

  const [connectModal, setConnectModal] =
  useState<ConnectModalState>(EMPTY_CONNECT_MODAL);

const [connectReasons, setConnectReasons] = useState<ConnectReason[]>([]);
const [selectedRole, setSelectedRole] = useState<string | null>(null);
const [selectedReason, setSelectedReason] = useState<string | null>(null);
const [sendingRequest, setSendingRequest] = useState(false);
const openConnect = useCallback(
  (params: {
    targetUserId: string;
    targetName?: string;
    targetPhotoUrl?: string | null;
    targetRoles?: string[];
    connectContext?: "member" | "traveller";
    tripId?: string | null;
  }) => {
    const safeRoles = (params.targetRoles ?? []).filter(isNonEmptyString);
    setSelectedReason(null);
    setSelectedRole(null);
    setConnectReasons([]);
    setConnectModal({
      open: true,
      targetUserId: params.targetUserId,
      targetName: params.targetName ?? "Member",
      targetPhotoUrl: params.targetPhotoUrl ?? undefined,
      targetRoles: safeRoles.length ? safeRoles : ["Social Dancer / Student"],
      connectContext: params.connectContext ?? "member",
      tripId: params.tripId ?? null,
    });
  },
  []
);

  const reasonsByRole = useMemo(() => {
    const map = new Map<string, ConnectReason[]>();
    for (const r of connectReasons) {
      const role = String(r.role ?? "");
      if (!role) continue;
      const prev = map.get(role) ?? [];
      prev.push(r);
      map.set(role, prev);
    }
    return map;
  }, [connectReasons]);

  const selectedReasonObj = useMemo(() => {
    if (!selectedReason) return null;
    return connectReasons.find((r) => r.id === selectedReason) ?? null;
  }, [selectedReason, connectReasons]);

  const [dbMembers, setDbMembers] = useState<MemberCard[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [tripCards, setTripCards] = useState<TripCard[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [tripsError, setTripsError] = useState<string | null>(null);

  const [iconsReady, setIconsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Prevent Material Symbols "pop-in" by waiting for the font to be ready.
        // Fallback: allow render after a short timeout even if the API is unavailable.
        const fontsApi = document?.fonts;
        if (fontsApi?.load) {
          await fontsApi.load('16px "Material Symbols Outlined"');
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setIconsReady(true);
      }
    })();

    const t = window.setTimeout(() => {
      if (!cancelled) setIconsReady(true);
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("connections-tab") : null;
    if (stored === "members" || stored === "travellers") {
      setTab(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("connections-tab", tab);
    }
  }, [tab]);

  useEffect(() => {
    if (tab === "travellers" && (sortMode === "connections_desc" || sortMode === "references_desc")) {
      setSortMode("recommended");
    }
  }, [tab, sortMode]);

  useEffect(() => {
    if (!filtersOpen) {
      setCityQuery("");
      setLanguageQuery("");
    }
  }, [filtersOpen]);
  const MSIcon = ({
    name,
    className,
    title,
  }: {
    name: string;
    className?: string;
    title?: string;
  }) => (
    <span
      title={title}
      className={[
        "material-symbols-outlined",
        "transition-opacity duration-200",
        iconsReady ? "opacity-100" : "opacity-0",
        className ?? "",
      ].join(" ")}
    >
      {name}
    </span>
  );

  const ScrollRow = ({
    children,
    ariaLabelLeft,
    ariaLabelRight,
  }: {
    children: ReactNode;
    ariaLabelLeft: string;
    ariaLabelRight: string;
  }) => {
    const rowRef = useRef<HTMLDivElement | null>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    useEffect(() => {
      const el = rowRef.current;
      if (!el) return;

      const update = () => {
        const maxScroll = el.scrollWidth - el.clientWidth;
        setCanScrollLeft(el.scrollLeft > 0);
        setCanScrollRight(el.scrollLeft < maxScroll - 1);
      };

      update();
      const onScroll = () => update();
      el.addEventListener("scroll", onScroll, { passive: true });

      const ro = new ResizeObserver(update);
      ro.observe(el);
      window.addEventListener("resize", update);

      return () => {
        el.removeEventListener("scroll", onScroll);
        ro.disconnect();
        window.removeEventListener("resize", update);
      };
    }, []);

    return (
      <div className="relative flex-1 min-w-0">
        <button
          type="button"
          aria-label={ariaLabelLeft}
          onClick={(event) => {
            event.stopPropagation();
            rowRef.current?.scrollBy({ left: -140, behavior: "smooth" });
          }}
          className={`absolute -left-1 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/70 transition ${
            canScrollLeft ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <MSIcon name="chevron_left" className="text-[16px]" />
        </button>
        <div ref={rowRef} className="flex gap-1.5 overflow-x-auto no-scrollbar px-1">
          {children}
        </div>
        <button
          type="button"
          aria-label={ariaLabelRight}
          onClick={(event) => {
            event.stopPropagation();
            rowRef.current?.scrollBy({ left: 140, behavior: "smooth" });
          }}
          className={`absolute -right-1 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/70 transition ${
            canScrollRight ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <MSIcon name="chevron_right" className="text-[16px]" />
        </button>
      </div>
    );
  };

  const RangeDatePicker = ({
    start,
    end,
    onChangeStart,
    onChangeEnd,
  }: {
    start?: string;
    end?: string;
    onChangeStart: (v: string | undefined) => void;
    onChangeEnd: (v: string | undefined) => void;
  }) => {
    const [open, setOpen] = useState(false);
    const [viewYear, setViewYear] = useState<number>(() => new Date().getFullYear());
    const [viewMonth, setViewMonth] = useState<number>(() => new Date().getMonth() + 1);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const [shiftLeft, setShiftLeft] = useState(false);
    const [draftStart, setDraftStart] = useState<string | undefined>(start);
    const [draftEnd, setDraftEnd] = useState<string | undefined>(end);
    const tz = "Europe/London";
    const todayIso = getTodayIsoInTz(tz);
    const maxRangeDays = 30;

    useEffect(() => {
      if (!open) return;
      setDraftStart(start);
      setDraftEnd(end);
      const parsed = (start ?? "") ? parseIsoDate(start ?? "") : null;
      if (parsed) {
        setViewYear(parsed.y);
        setViewMonth(parsed.m);
      } else {
        const now = new Date();
        setViewYear(now.getFullYear());
        setViewMonth(now.getMonth() + 1);
      }
    }, [open, start, end]);

    useEffect(() => {
      function onDocClick(e: MouseEvent) {
        if (!open) return;
        const target = e.target as Node | null;
        if (wrapRef.current && target && !wrapRef.current.contains(target)) {
          setOpen(false);
        }
      }
      document.addEventListener("mousedown", onDocClick);
      return () => document.removeEventListener("mousedown", onDocClick);
    }, [open]);

    useEffect(() => {
      if (!open) return;
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = window.innerWidth >= 768 ? 640 : 320;
      const overflowRight = rect.left + panelWidth > window.innerWidth - 16;
      setShiftLeft(overflowRight);
    }, [open]);

    function goMonth(delta: number) {
      const next = addMonths(viewYear, viewMonth, delta);
      setViewYear(next.y);
      setViewMonth(next.m);
    }

    function isDisabled(iso: string) {
      if (!iso) return true;
      if (todayIso && iso < todayIso) return true;
      if (draftStart && !draftEnd) {
        const maxEnd = addDaysIso(draftStart, maxRangeDays - 1);
        if (maxEnd && iso > maxEnd) return true;
      }
      return false;
    }

    function handlePick(iso: string) {
      if (isDisabled(iso)) return;

      if (!draftStart || (draftStart && draftEnd)) {
        setDraftStart(iso);
        setDraftEnd(undefined);
        return;
      }

      if (draftStart && !draftEnd) {
        if (iso < draftStart) {
          setDraftStart(iso);
          setDraftEnd(undefined);
          return;
        }

        const days = diffDays(draftStart, iso) + 1;
        if (days > maxRangeDays) {
          setDraftEnd(addDaysIso(draftStart, maxRangeDays - 1));
          return;
        }
        setDraftEnd(iso);
      }
    }

    function renderMonth(y: number, m: number) {
      const monthLabel = `${MONTHS[m - 1]} ${y}`;
      const daysInMonth = new Date(y, m, 0).getDate();
      const startDay = new Date(y, m - 1, 1).getDay();

      return (
        <div className="w-full">
          <div className="text-sm font-semibold text-white/80 text-center">{monthLabel}</div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-[10px] text-white/35">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center">{d}</div>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1">
            {Array.from({ length: startDay }).map((_, i) => (
              <div key={`sp-${y}-${m}-${i}`} className="h-9" />
            ))}

            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const iso = toIsoDateParts(y, m, day);
              const isStart = draftStart === iso;
              const isEnd = draftEnd === iso;
              const inRange =
                draftStart && draftEnd && iso > draftStart && iso < draftEnd;
              const isToday = iso === todayIso;
              const disabled = isDisabled(iso);

              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => handlePick(iso)}
                  disabled={disabled}
                  className={[
                    "h-9 rounded-lg text-xs font-semibold transition",
                    disabled ? "text-white/15 cursor-not-allowed" : "text-white/75 hover:bg-white/10",
                    inRange ? "bg-white/10" : "",
                    isStart || isEnd ? "bg-[#00F5FF] text-[#0A0A0A]" : "",
                    isToday && !isStart && !isEnd ? "border border-[#00F5FF]/40" : "",
                  ].join(" ")}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-stretch gap-3 rounded-2xl border border-white/10 bg-[#171717] px-3 py-2 text-[11px] text-white/80 outline-none hover:border-white/20"
        >
          <div className="flex items-center gap-3">
            <div className="flex flex-col border-r border-white/10 pr-4">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/45">Arrive</div>
              <div className="text-[13px] font-semibold text-white/90">
                {draftStart ? formatShortDate(draftStart) : "Select"}
              </div>
            </div>
            <div className="flex flex-col">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/45">Depart</div>
              <div className="text-[13px] font-semibold text-white/90">
                {draftEnd ? formatShortDate(draftEnd) : "Select"}
              </div>
            </div>
          </div>
          <div className="ml-1 flex items-center gap-2 text-white/40">
            <div className="text-[10px] font-semibold">
              {draftStart && draftEnd ? `${diffDays(draftStart, draftEnd) + 1} days` : ""}
            </div>
            <MSIcon name="calendar_month" className="text-[18px] text-[#00F5FF]" />
          </div>
        </button>

        {open ? (
          <div
            className={[
              "absolute z-50 mt-2 w-[320px] max-w-[92vw] rounded-2xl border border-white/10 bg-[#0F0F0F] p-5 shadow-2xl md:w-[640px]",
              shiftLeft ? "right-0" : "left-0",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => goMonth(-1)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-white/70 hover:text-white"
              >
                <MSIcon name="chevron_left" className="text-[18px]" />
              </button>
              <div className="text-[11px] text-white/45 text-center leading-tight">
                {draftStart ? "Select end date" : "Select start date"}
                <div className="text-[10px] text-white/35">Max {maxRangeDays} days</div>
              </div>
              <button
                type="button"
                onClick={() => goMonth(1)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-white/70 hover:text-white"
              >
                <MSIcon name="chevron_right" className="text-[18px]" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="w-full">{renderMonth(viewYear, viewMonth)}</div>
              <div className="hidden md:block w-full">
                {renderMonth(addMonths(viewYear, viewMonth, 1).y, addMonths(viewYear, viewMonth, 1).m)}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setDraftStart(undefined);
                  setDraftEnd(undefined);
                }}
                className="text-[11px] text-white/50 hover:text-white"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  onChangeStart(draftStart);
                  onChangeEnd(draftEnd);
                  setOpen(false);
                }}
                className="text-[11px] font-semibold text-[#00F5FF]"
              >
                Apply
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  useEffect(() => {
    // Fallback (dev safety): ensure Material Symbols CSS is present even if layout.tsx was not updated yet.
    const href =
      "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap";

    const has = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((l) =>
      (l as HTMLLinkElement).href.includes("fonts.googleapis.com/css2?family=Material+Symbols+Outlined")
    );

    if (!has) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    if (!connectModal.open || !connectModal.targetRoles.length) return;

    setSelectedReason(null);
    setSelectedRole(connectModal.targetRoles?.[0] ?? null);

    (async () => {
      try {
        const contexts =
          connectModal.connectContext === "traveller"
            ? (["traveller", "trip", "member"] as const)
            : (["member"] as const);
        const { data, error } = await supabase
          .from("connect_reasons")
          .select("id,label,role,sort_order")
          .eq("active", true)
          .in("context", [...contexts])
          .in("role", connectModal.targetRoles)
          .order("sort_order");

        if (!error) setConnectReasons(data ?? []);
      } catch {
        setConnectReasons([]);
      }
    })();
  }, [connectModal.open, connectModal.targetRoles, connectModal.connectContext]);

  useEffect(() => {
    (async () => {
      // 1) Auth sanity check
      try {
        const { error } = await supabase.auth.getSession();
        if (error) throw error;
      } catch {
        setUiError(
          "Supabase auth fetch failed. Verify NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local and restart dev server."
        );
      }

      let meId: string | null = null;
      try {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (user) {
          meId = user.id;
          const { data: myProfile } = await supabase
            .from("profiles")
            .select("city,country,roles,languages,dance_skills")
            .eq("user_id", user.id)
            .maybeSingle();
          const city = isNonEmptyString((myProfile as { city?: string | null } | null)?.city)
            ? ((myProfile as { city?: string | null }).city ?? "").trim()
            : null;
          const country = isNonEmptyString((myProfile as { country?: string | null } | null)?.country)
            ? ((myProfile as { country?: string | null }).country ?? "").trim()
            : null;
          const myRolesRaw = Array.isArray((myProfile as { roles?: unknown } | null)?.roles)
            ? (((myProfile as { roles?: unknown }).roles as unknown[]) ?? [])
            : [];
          const myRoleList = myRolesRaw.filter(isNonEmptyString);
          const myLangsRaw = Array.isArray((myProfile as { languages?: unknown } | null)?.languages)
            ? (((myProfile as { languages?: unknown }).languages as unknown[]) ?? [])
            : [];
          const myLangList = myLangsRaw.filter(isNonEmptyString).map(langLabelToCode);
          const myDs = safeParseJson<Record<string, unknown>>((myProfile as { dance_skills?: unknown } | null)?.dance_skills);
          const myStyles: Partial<Record<Style, Level>> = {};
          if (myDs && typeof myDs === "object") {
            for (const [styleKey, payload] of Object.entries(myDs)) {
              const uiStyle = normalizeStyleKeyToUi(styleKey);
              if (!uiStyle) continue;
              const payloadObj = payload as { level?: unknown };
              const lvlRaw = typeof payload === "string" ? payload : payloadObj?.level;
              const uiLvl = normalizeLevelToUi(lvlRaw);
              if (uiLvl) myStyles[uiStyle] = uiLvl;
            }
          }
          setMyCity(city);
          setMyCountry(country);
          setMyRoles(myRoleList);
          setMyLangCodes(myLangList);
          setMyStyleLevels(myStyles);
        }
      } catch {}

      // 2) Load members from DB (profiles_feed with profiles fallback)
      try {
        setLoadingMembers(true);
        setMembersError(null);

        const feedSelect = [
          "id",
          "display_name",
          "city",
          "country",
          "roles",
          "languages",
          "avatar_url",
          "verified",
          "dance_skills",
          "has_other_style",
          "connections_count",
          "interests",
          "availability",
          "ref_total_all",
          "ref_member_all",
          "ref_trip_all",
          "ref_event_all",
          "ref_total_positive",
          "ref_total_neutral",
          "ref_total_negative",
          "is_test",
        ].join(",");

        let rawRows: ProfileFeedRow[] = [];
        let loadedRows = false;
        let lastLoadError: unknown = null;

        let membersQuery = supabase.from("profiles_feed").select(feedSelect).limit(200);
        if (meId) membersQuery = membersQuery.neq("id", meId);
        const { data: feedData, error: feedError } = await membersQuery;
        if (!feedError) {
          rawRows = (feedData ?? []) as ProfileFeedRow[];
          loadedRows = true;
        } else {
          lastLoadError = feedError;
        }

        if (!loadedRows) {
          let fallbackQuery = supabase
            .from("profiles")
            .select(
              [
                "user_id",
                "display_name",
                "city",
                "country",
                "roles",
                "languages",
                "avatar_url",
                "verified",
                "dance_skills",
                "has_other_style",
                "connections_count",
                "interests",
                "availability",
              ].join(",")
            )
            .limit(200);
          if (meId) fallbackQuery = fallbackQuery.neq("user_id", meId);
          const { data: fallbackData, error: fallbackError } = await fallbackQuery;
          if (!fallbackError) {
            rawRows = (fallbackData ?? []).map((row) => {
              const raw = row as ProfileFeedRow;
              return {
                ...raw,
                id: raw.id ?? raw.user_id ?? "",
              };
            });
            loadedRows = true;
          } else {
            lastLoadError = fallbackError;
          }
        }

        if (!loadedRows) {
          let fallbackQueryLite = supabase
            .from("profiles")
            .select(
              [
                "user_id",
                "display_name",
                "city",
                "country",
                "roles",
                "languages",
                "avatar_url",
                "verified",
                "dance_skills",
                "has_other_style",
              ].join(",")
            )
            .limit(200);
          if (meId) fallbackQueryLite = fallbackQueryLite.neq("user_id", meId);
          const { data: fallbackDataLite, error: fallbackErrorLite } = await fallbackQueryLite;
          if (!fallbackErrorLite) {
            rawRows = (fallbackDataLite ?? []).map((row) => {
              const raw = row as ProfileFeedRow;
              return {
                ...raw,
                id: raw.id ?? raw.user_id ?? "",
              };
            });
            loadedRows = true;
          } else {
            lastLoadError = fallbackErrorLite;
          }
        }

        if (!loadedRows) {
          let fallbackQueryMinimal = supabase
            .from("profiles")
            .select("user_id,display_name,city,country,avatar_url,verified")
            .limit(200);
          if (meId) fallbackQueryMinimal = fallbackQueryMinimal.neq("user_id", meId);
          const { data: fallbackDataMinimal, error: fallbackErrorMinimal } = await fallbackQueryMinimal;
          if (!fallbackErrorMinimal) {
            rawRows = (fallbackDataMinimal ?? []).map((row) => {
              const raw = row as ProfileFeedRow;
              return {
                ...raw,
                id: raw.id ?? raw.user_id ?? "",
              };
            });
            loadedRows = true;
          } else {
            lastLoadError = fallbackErrorMinimal;
          }
        }

        if (!loadedRows) throw (lastLoadError ?? new Error("members_source_unavailable"));

        const mapped: MemberCard[] = rawRows
          .filter((row) => row.is_test !== true)
          .filter((row) => String(row.id ?? row.user_id ?? "") !== (meId ?? ""))
          .map((row) => {
          const raw = row as ProfileFeedRow;
          const rawId = String(raw.id ?? raw.user_id ?? "");
          const name = isNonEmptyString(raw.display_name) ? raw.display_name : "";
          const city = isNonEmptyString(raw.city) ? raw.city : "";
          const country = isNonEmptyString(raw.country) ? raw.country : "";

          const roles = Array.isArray(raw.roles) ? raw.roles.filter(isNonEmptyString) : [];
          const rawLangs = Array.isArray(raw.languages) ? raw.languages.filter(isNonEmptyString) : [];
          const langsCodes = rawLangs.map(langLabelToCode);

          const verified = Boolean(raw.verified);
          const photoUrl = isNonEmptyString(raw.avatar_url) ? raw.avatar_url : undefined;

          // dance_skills from DB is JSON or JSON string; keys lowercased (e.g. "salsa")
          const danceSkills: Partial<Record<Style, Level>> = {};
          const ds = safeParseJson<Record<string, unknown>>(raw.dance_skills);
          if (ds && typeof ds === "object") {
            for (const [styleKey, payload] of Object.entries(ds)) {
              const uiStyle = normalizeStyleKeyToUi(styleKey);
              if (!uiStyle) continue;
              const payloadObj = payload as { level?: unknown };
              const lvlRaw = typeof payload === "string" ? payload : payloadObj?.level;
              const uiLvl = normalizeLevelToUi(lvlRaw);
              if (uiLvl) danceSkills[uiStyle] = uiLvl;
            }
          }

          const otherStyle = Boolean(raw.has_other_style);

          const interestList = Array.isArray(raw.interests) ? raw.interests.filter(isNonEmptyString) : [];
          const interest = interestList[0];

            const availability =
              Array.isArray(raw.availability) && isNonEmptyString(raw.availability?.[0]) ? raw.availability[0] : undefined;

            return {
              id: rawId,
              name,
              city,
              country,
              verified,
              roles,
              danceSkills,
              otherStyle,
              langs: langsCodes,
              interest,
              availability,
              photoUrl,

              connectionsCount: typeof raw.connections_count === "number" ? raw.connections_count : undefined,

              refTotalAll: typeof raw.ref_total_all === "number" ? raw.ref_total_all : 0,
              refMemberAll: typeof raw.ref_member_all === "number" ? raw.ref_member_all : 0,
              refTripAll: typeof raw.ref_trip_all === "number" ? raw.ref_trip_all : 0,
              refEventAll: typeof raw.ref_event_all === "number" ? raw.ref_event_all : 0,

              refTotalPositive: typeof raw.ref_total_positive === "number" ? raw.ref_total_positive : 0,
              refTotalNeutral: typeof raw.ref_total_neutral === "number" ? raw.ref_total_neutral : 0,
              refTotalNegative: typeof raw.ref_total_negative === "number" ? raw.ref_total_negative : 0,
            };
          });

        setDbMembers(mapped);
      } catch (e: unknown) {
        setMembersError(errorMessage(e, "Failed to load members from database."));
        setDbMembers([]);
      } finally {
        setLoadingMembers(false);
      }

      // 3) Load trips for Travellers tab
      try {
        setLoadingTrips(true);
        setTripsError(null);

        const today = new Date();
        const todayIso = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString().slice(0, 10);
        let trips: TripRow[] = [];
        let loadedTrips = false;
        let lastTripsError: unknown = null;

        const tripsQuery = supabase
          .from("trips")
          .select("id,user_id,status,destination_country,destination_city,start_date,end_date,purpose,created_at")
          .neq("user_id", meId ?? "")
          .eq("status", "active")
          .gte("end_date", todayIso)
          .limit(200);
        const { data: tripRows, error: tripErr } = await tripsQuery;
        if (!tripErr) {
          trips = (tripRows ?? []) as TripRow[];
          loadedTrips = true;
        } else {
          lastTripsError = tripErr;
        }

        if (!loadedTrips) {
          const tripsQueryFallback = supabase
            .from("trips")
            .select("id,user_id,status,destination_country,destination_city,start_date,end_date,purpose,created_at")
            .neq("user_id", meId ?? "")
            .limit(200);
          const { data: fallbackRows, error: fallbackErr } = await tripsQueryFallback;
          if (!fallbackErr) {
            trips = (fallbackRows ?? []) as TripRow[];
            loadedTrips = true;
          } else {
            lastTripsError = fallbackErr;
          }
        }

        if (!loadedTrips) {
          const tripsQueryLite = supabase
            .from("trips")
            .select("id,user_id,destination_country,destination_city,start_date,end_date,purpose,created_at")
            .neq("user_id", meId ?? "")
            .limit(200);
          const { data: fallbackRowsLite, error: fallbackErrLite } = await tripsQueryLite;
          if (!fallbackErrLite) {
            trips = (fallbackRowsLite ?? []) as TripRow[];
            loadedTrips = true;
          } else {
            lastTripsError = fallbackErrLite;
          }
        }

        if (!loadedTrips) {
          const travelPlansQuery = supabase
            .from("travel_plans")
            .select("id,user_id,destination_country,destination_city,start_date,end_date,purpose,created_at")
            .neq("user_id", meId ?? "")
            .limit(200);
          const { data: planRows, error: planErr } = await travelPlansQuery;
          if (!planErr) {
            trips = (planRows ?? []) as TripRow[];
            loadedTrips = true;
          } else {
            lastTripsError = planErr;
          }
        }

        if (!loadedTrips) throw (lastTripsError ?? new Error("trips_source_unavailable"));

        trips = trips.filter((trip) => {
          const status = String(trip.status ?? "active").toLowerCase();
          if (trip.status && status !== "active") return false;
          if (!trip.end_date) return true;
          return trip.end_date >= todayIso;
        });

        const ids = Array.from(new Set(trips.map((t) => t.user_id).filter(isString)));

        let profilesById: Record<string, ProfileFeedLiteRow> = {};
        if (ids.length) {
          let profileRows: ProfileFeedLiteRow[] = [];
          let loadedProfiles = false;
          let lastProfilesError: unknown = null;

          const { data: feedProfs, error: feedProfErr } = await supabase
            .from("profiles_feed")
            .select("id,display_name,avatar_url,roles,languages,ref_member_all,ref_trip_all,ref_event_all")
            .in("id", ids);
          if (!feedProfErr) {
            profileRows = (feedProfs ?? []) as ProfileFeedLiteRow[];
            loadedProfiles = true;
          } else {
            lastProfilesError = feedProfErr;
          }

          if (!loadedProfiles) {
            const { data: feedProfsLite, error: feedProfErrLite } = await supabase
              .from("profiles_feed")
              .select("id,display_name,avatar_url,roles,languages")
              .in("id", ids);
            if (!feedProfErrLite) {
              profileRows = (feedProfsLite ?? []) as ProfileFeedLiteRow[];
              loadedProfiles = true;
            } else {
              lastProfilesError = feedProfErrLite;
            }
          }

          if (!loadedProfiles) {
            const { data: fallbackProfs, error: fallbackProfErr } = await supabase
              .from("profiles")
              .select("user_id,display_name,avatar_url,roles,languages,ref_member_all,ref_trip_all,ref_event_all")
              .in("user_id", ids);
            if (!fallbackProfErr) {
              profileRows = (fallbackProfs ?? []).map((row) => {
                const p = row as ProfileFeedLiteRow;
                return { ...p, id: p.id ?? p.user_id ?? "" };
              });
              loadedProfiles = true;
            } else {
              lastProfilesError = fallbackProfErr;
            }
          }

          if (!loadedProfiles) {
            const { data: fallbackProfsLite, error: fallbackProfErrLite } = await supabase
              .from("profiles")
              .select("user_id,display_name,avatar_url,roles,languages")
              .in("user_id", ids);
            if (!fallbackProfErrLite) {
              profileRows = (fallbackProfsLite ?? []).map((row) => {
                const p = row as ProfileFeedLiteRow;
                return { ...p, id: p.id ?? p.user_id ?? "" };
              });
              loadedProfiles = true;
            } else {
              lastProfilesError = fallbackProfErrLite;
            }
          }

          if (!loadedProfiles) throw (lastProfilesError ?? new Error("trip_profiles_source_unavailable"));

          profilesById = Object.fromEntries(
            profileRows.map((row) => {
              const id = row.id ?? row.user_id ?? "";
              return [id, { ...row, id }];
            })
          );
        }

        const mappedTrips: TripCard[] = trips.map((t) => {
          const p = profilesById[t.user_id ?? ""] ?? {};
          return {
            id: t.id ?? "",
            user_id: t.user_id ?? "",
            status: (t.status ?? "active") as TripStatus,
            destination_country: t.destination_country ?? "",
            destination_city: t.destination_city ?? "",
            start_date: t.start_date ?? "",
            end_date: t.end_date ?? "",
            purpose: t.purpose ?? "Trip",
            reason: t.purpose ?? null,
            created_at: t.created_at ?? null,
            display_name: p.display_name ?? "Unknown",
            avatar_url: p.avatar_url ?? null,
            roles: Array.isArray(p.roles) ? p.roles.filter(isNonEmptyString) : [],
            languages: Array.isArray(p.languages) ? p.languages.filter(isNonEmptyString) : [],
            refMemberAll: typeof p.ref_member_all === "number" ? p.ref_member_all : 0,
            refTripAll: typeof p.ref_trip_all === "number" ? p.ref_trip_all : 0,
            refEventAll: typeof p.ref_event_all === "number" ? p.ref_event_all : 0,
          };
        });

        setTripCards(mappedTrips);
      } catch (e: unknown) {
        setTripsError(errorMessage(e, "Failed to load trips."));
        setTripCards([]);
      } finally {
        setLoadingTrips(false);
      }
    })();
  }, []);

  // Country + City library (same as onboarding)
  const countriesAll = useMemo(() => Country.getAllCountries(), []);
  const countryNames = useMemo(() => countriesAll.map((c) => c.name), [countriesAll]);
  const countryIsoByName = useMemo(() => {
    const map = new Map<string, string>();
    countriesAll.forEach((c) => {
      if (c.name && c.isoCode) map.set(c.name, c.isoCode);
    });
    return map;
  }, [countriesAll]);
  const availableCities = useMemo(() => {
    if (!filters.country) return [];
    const iso = countryIsoByName.get(filters.country);
    if (!iso) return [];
    const cities = (City.getCitiesOfCountry(iso) ?? [])
      .map((c) => c.name?.trim())
      .filter((name): name is string => !!name);
    return Array.from(new Set(cities)).sort((a, b) => a.localeCompare(b));
  }, [filters.country, countryIsoByName]);
  const citySuggestions = useMemo(() => {
    const q = cityQuery.trim().toLowerCase();
    return availableCities
      .filter((city) => !filters.cities.includes(city))
      .filter((city) => (q ? city.toLowerCase().includes(q) : true))
      .slice(0, 18);
  }, [availableCities, filters.cities, cityQuery]);
  const allLanguages = useMemo(() => {
    const display = new Intl.DisplayNames(["en"], { type: "language" });
    const items = LANGUAGE_CODES.map((code) => {
      const label = display.of(code) ?? code.toUpperCase();
      return { code: code.toUpperCase(), label };
    });
    const labels = items
      .filter((item) => item.label && item.label.toLowerCase() !== item.code.toLowerCase())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((item) => item.label);
    return Array.from(new Set(labels));
  }, []);

  const languageSuggestions = useMemo(() => {
    const q = languageQuery.trim().toLowerCase();
    const available = allLanguages
      .filter((lang) => !filters.langs.includes(lang))
      .filter((lang) => (q ? lang.toLowerCase().includes(q) : true));

    if (q) return available.slice(0, 24);

    const commonSet = new Set(COMMON_LANGUAGES);
    const common = available.filter((lang) => commonSet.has(lang as (typeof COMMON_LANGUAGES)[number]));
    const rest = available.filter((lang) => !commonSet.has(lang as (typeof COMMON_LANGUAGES)[number]));
    return [...common, ...rest].slice(0, 24);
  }, [languageQuery, allLanguages, filters.langs]);

  const getMemberRecommendationMeta = useCallback((m: MemberCard) => {
    let score = 0;
    const hints: string[] = [];
    if (myCountry && m.country && m.country.toLowerCase() === myCountry.toLowerCase()) {
      score += 14;
      hints.push("Same country");
    }
    if (myCity && m.city && m.city.toLowerCase() === myCity.toLowerCase()) {
      score += 26;
      hints.unshift("Same city");
    }

    const roleOverlap = m.roles.filter((r) => myRoles.includes(r)).length;
    score += Math.min(roleOverlap, 3) * 8;
    if (roleOverlap > 0) hints.push(`${roleOverlap} shared role${roleOverlap > 1 ? "s" : ""}`);

    const langOverlap = (m.langs ?? []).filter((l) => myLangCodes.includes(l)).length;
    score += Math.min(langOverlap, 3) * 6;
    if (langOverlap > 0) hints.push(`${langOverlap} shared language${langOverlap > 1 ? "s" : ""}`);

    let styleOverlap = 0;
    for (const [style, myLevel] of Object.entries(myStyleLevels) as Array<[Style, Level]>) {
      const memberLevel = m.danceSkills?.[style];
      if (!memberLevel) continue;
      styleOverlap += 1;
      score += 6;
      if (memberLevel === myLevel) score += 3;
    }
    if (styleOverlap > 0) hints.push(`${styleOverlap} shared style${styleOverlap > 1 ? "s" : ""}`);

    score += Math.min(Number(m.connectionsCount ?? 0), 20) * 0.25;
    score += Math.min(Number(m.refTotalAll ?? 0), 40) * 0.2;
    return { score, hints: hints.slice(0, 2) };
  }, [myCity, myCountry, myRoles, myLangCodes, myStyleLevels]);

  const getTripRecommendationMeta = useCallback((t: TripCard) => {
    let score = 0;
    const hints: string[] = [];
    if (myCountry && t.destination_country && t.destination_country.toLowerCase() === myCountry.toLowerCase()) {
      score += 20;
      hints.push("Same country");
    }
    if (myCity && t.destination_city && t.destination_city.toLowerCase() === myCity.toLowerCase()) {
      score += 18;
      hints.unshift("Same city");
    }

    const roleOverlap = (t.roles ?? []).filter((r) => myRoles.includes(r)).length;
    score += Math.min(roleOverlap, 3) * 6;
    if (roleOverlap > 0) hints.push(`${roleOverlap} shared role${roleOverlap > 1 ? "s" : ""}`);

    const langOverlap = (t.languages ?? []).map(langLabelToCode).filter((l) => myLangCodes.includes(l)).length;
    score += Math.min(langOverlap, 3) * 5;
    if (langOverlap > 0) hints.push(`${langOverlap} shared language${langOverlap > 1 ? "s" : ""}`);

    score += Math.min(Number((t.refMemberAll ?? 0) + (t.refTripAll ?? 0) + (t.refEventAll ?? 0)), 30) * 0.2;
    return { score, hints: hints.slice(0, 2) };
  }, [myCity, myCountry, myRoles, myLangCodes]);

  const members = useMemo(() => {
    let list = dbMembers.slice();

    if (myCityOnly) {
      if (!myCity) return [];
      const cityLower = myCity.toLowerCase();
      const countryLower = (myCountry ?? "").toLowerCase();
      list = list.filter((m) => {
        const sameCity = (m.city ?? "").toLowerCase() === cityLower;
        if (!sameCity) return false;
        if (!countryLower) return true;
        return (m.country ?? "").toLowerCase() === countryLower;
      });
    }

    if (filters.country) list = list.filter((m) => m.country === filters.country);
    if (filters.cities.length) list = list.filter((m) => filters.cities.includes(m.city));

    if (filters.roles.length) {
      list = list.filter((m) => m.roles.some((r) => filters.roles.includes(r as Role)));
    }

    const entries = Object.entries(filters.styleLevels) as Array<[Style, Level[]]>;
    if (entries.length) {
      list = list.filter((m) =>
        entries.every(([style, lvls]) => {
          const memberLvl = (m.danceSkills?.[style] ?? null) as Level | null;
          if (!memberLvl) return false;
          if (!lvls || lvls.length === 0) return true;
          return lvls.includes(memberLvl);
        })
      );
    }

    if (filters.otherStyle) list = list.filter((m) => !!m.otherStyle);

    if (filters.langs.length) {
      const codes = filters.langs.map(langLabelToCode);
      list = list.filter((m) => (m.langs ?? []).some((l) => codes.includes(l)));
    }

    if (filters.interest) list = list.filter((m) => (m.interest ?? "") === filters.interest);
    if (filters.availability) list = list.filter((m) => (m.availability ?? "") === filters.availability);
    if (filters.verifiedOnly) list = list.filter((m) => !!m.verified);

    const byNewest = (a: MemberCard, b: MemberCard) => {
      const ar = Number(a.refTotalAll ?? 0);
      const br = Number(b.refTotalAll ?? 0);
      if (br !== ar) return br - ar;
      return a.name.localeCompare(b.name);
    };
    const byConnections = (a: MemberCard, b: MemberCard) =>
      Number(b.connectionsCount ?? 0) - Number(a.connectionsCount ?? 0) || a.name.localeCompare(b.name);
    const byReferences = (a: MemberCard, b: MemberCard) =>
      Number(b.refTotalAll ?? 0) - Number(a.refTotalAll ?? 0) || a.name.localeCompare(b.name);
    const byName = (a: MemberCard, b: MemberCard) => a.name.localeCompare(b.name);
    const byCity = (a: MemberCard, b: MemberCard) =>
      `${a.city},${a.country}`.localeCompare(`${b.city},${b.country}`) || a.name.localeCompare(b.name);
    if (sortMode === "recommended") {
      list = list
        .slice()
        .sort((a, b) => getMemberRecommendationMeta(b).score - getMemberRecommendationMeta(a).score || byReferences(a, b));
    } else if (sortMode === "newest") list = list.slice().sort(byNewest);
    else if (sortMode === "connections_desc") list = list.slice().sort(byConnections);
    else if (sortMode === "references_desc") list = list.slice().sort(byReferences);
    else if (sortMode === "name_az") list = list.slice().sort(byName);
    else if (sortMode === "city_az") list = list.slice().sort(byCity);

    return list;
  }, [myCityOnly, myCity, myCountry, filters, dbMembers, sortMode, getMemberRecommendationMeta]);

  const filteredTrips = useMemo(() => {
    let list = tripCards.slice();

    if (filters.country) list = list.filter((t) => t.destination_country === filters.country);
    if (filters.cities.length) list = list.filter((t) => filters.cities.includes(t.destination_city));

    if (filters.roles.length) {
      list = list.filter((t) => (t.roles ?? []).some((r) => filters.roles.includes(r as Role)));
    }

    if (filters.langs.length) {
      const wanted = filters.langs.map(langLabelToCode);
      list = list.filter((t) =>
        (t.languages ?? [])
          .map(langLabelToCode)
          .some((code) => wanted.includes(code))
      );
    }

    if (filters.tripPurpose) list = list.filter((t) => (t.purpose ?? "") === filters.tripPurpose);

    const from = (filters.tripDateFrom ?? "").trim();
    const to = (filters.tripDateTo ?? "").trim();
    if (from && to) {
      const fromT = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
      const toT = to ? Date.parse(to) : Number.POSITIVE_INFINITY;

      list = list.filter((t) => {
        const s = t.start_date ? Date.parse(t.start_date) : NaN;
        const e = t.end_date ? Date.parse(t.end_date) : NaN;
        if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
        return s <= toT && e >= fromT;
      });
    }

    const byNewest = (a: TripCard, b: TripCard) =>
      Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "") || a.display_name.localeCompare(b.display_name);
    const byName = (a: TripCard, b: TripCard) => a.display_name.localeCompare(b.display_name);
    const byCity = (a: TripCard, b: TripCard) =>
      `${a.destination_city},${a.destination_country}`.localeCompare(`${b.destination_city},${b.destination_country}`) ||
      a.display_name.localeCompare(b.display_name);
    if (sortMode === "recommended") {
      list = list.slice().sort((a, b) => getTripRecommendationMeta(b).score - getTripRecommendationMeta(a).score || byNewest(a, b));
    } else if (sortMode === "newest") list = list.slice().sort(byNewest);
    else if (sortMode === "name_az") list = list.slice().sort(byName);
    else if (sortMode === "city_az") list = list.slice().sort(byCity);

    return list;
  }, [filters, tripCards, sortMode, getTripRecommendationMeta]);

  const activeFiltersCount = useMemo(() => {
    let n = 0;
    if (filters.country) n += 1;
    if (filters.cities.length) n += 1;
    if (filters.roles.length) n += 1;
    if (tab === "members") {
      if (Object.keys(filters.styleLevels).length) n += 1;
      if (filters.otherStyle) n += 1;
      if (filters.langs.length) n += 1;
      if (filters.interest) n += 1;
      if (filters.availability) n += 1;
      if (filters.verifiedOnly) n += 1;
    } else {
      if (filters.tripPurpose) n += 1;
      if ((filters.tripDateFrom ?? "").trim() || (filters.tripDateTo ?? "").trim()) n += 1;
    }
    return n;
  }, [filters, tab]);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />

      <main className="mx-auto max-w-[1200px] px-6 py-8">
        {uiError ? (
          <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {uiError}
          </div>
        ) : null}

        {membersError ? (
          <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {membersError}
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
              Showing <span className="text-white font-semibold">{tab === "members" ? members.length : filteredTrips.length}</span>{" "}
              {tab === "members" ? "members" : "trips"}
            </p>

            <div className="flex items-center gap-4 border-l border-white/10 pl-6">
              <button className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition">
                <span className="text-xl">≡</span>
                <span>Sort</span>
              </button>
              <div className="relative">
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="appearance-none rounded-full border border-white/10 bg-white/5 px-4 py-2 pr-9 text-sm text-white/80 outline-none transition hover:border-white/25 focus:border-[#00F5FF]/50"
                >
                  <option value="recommended">Recommended</option>
                  <option value="newest">Newest</option>
                  <option value="name_az">Name A-Z</option>
                  <option value="city_az">City A-Z</option>
                  {tab === "members" ? <option value="connections_desc">Most Connections</option> : null}
                  {tab === "members" ? <option value="references_desc">Most References</option> : null}
                </select>
                <MSIcon name="expand_more" className="pointer-events-none absolute right-3 top-2.5 text-[16px] text-white/45" />
              </div>

              {tab === "members" ? (
                <label className={`flex items-center gap-3 text-sm ${myCity ? "text-white/70" : "text-white/35"}`}>
                  <input
                    type="checkbox"
                    checked={myCityOnly}
                    onChange={(e) => setMyCityOnly(e.target.checked)}
                    disabled={!myCity}
                    className="h-5 w-9 accent-[#00F5FF]"
                  />
                  {myCity ? `My City (${myCity})` : "My City (set your city in profile)"}
                </label>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {tab === "travellers" ? (
              <RangeDatePicker
                start={filters.tripDateFrom}
                end={filters.tripDateTo}
                onChangeStart={(v) => setFilters((p) => ({ ...p, tripDateFrom: v }))}
                onChangeEnd={(v) => setFilters((p) => ({ ...p, tripDateTo: v }))}
              />
            ) : null}
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="rounded-full bg-[#00F5FF] px-6 py-2.5 text-sm font-bold text-[#0A0A0A] hover:opacity-90 transition"
            >
              Filters{activeFiltersCount ? ` (${activeFiltersCount})` : ""}
            </button>
          </div>
        </div>

        {tab === "members" ? (
          <div className="relative mt-8">
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              {loadingMembers ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={`sk-${i}`}
                    className="connections-card border border-white/10 rounded-[1.25rem] bg-[#121212] overflow-hidden flex flex-col md:flex-row h-[420px] md:h-64 animate-pulse"
                  >
                    <div className="w-full md:w-1/2 h-44 md:h-full bg-white/5" />
                    <div className="w-full md:w-1/2 p-4 flex flex-col h-full justify-between">
                      <div className="min-h-0">
                        <div className="h-5 w-40 rounded bg-white/10" />
                        <div className="mt-3 h-4 w-44 rounded bg-white/10" />
                        <div className="mt-4 h-3 w-52 rounded bg-white/10" />

                        <div className="mt-4 flex items-center gap-2">
                          <div className="h-3 w-8 rounded bg-white/10" />
                          <div className="h-3 w-14 rounded bg-white/10" />
                          <div className="h-3 w-10 rounded bg-white/10" />
                        </div>

                        <div className="mt-4 flex items-center gap-2">
                          <div className="h-5 w-10 rounded bg-white/10" />
                          <div className="h-5 w-16 rounded bg-white/10" />
                          <div className="h-5 w-14 rounded bg-white/10" />
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          <div className="h-5 w-14 rounded bg-white/10" />
                          <div className="h-5 w-12 rounded bg-white/10" />
                        </div>
                      </div>

                      <div className="pt-3 flex flex-col gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-9 rounded-full bg-white/10" />
                          <div className="flex-[1.5] h-9 rounded-full bg-white/10" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                members.map((m) => {
                const refMember = Number(m.refMemberAll ?? 0);
                const refTrip = Number(m.refTripAll ?? 0);
                const refEvent = Number(m.refEventAll ?? 0);
                const refTotal = Number(m.refTotalAll ?? 0) || refMember + refTrip + refEvent;
                const connectionsCount = Number(m.connectionsCount ?? 0);

                return (
                  <div
                    key={m.id}
                    className="connections-card border border-white/10 rounded-[1.25rem] bg-[#121212] overflow-hidden flex flex-col md:flex-row h-[420px] md:h-64 transition-all duration-200 will-change-transform hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(13,242,242,0.14),0_16px_42px_rgba(0,245,255,0.06)]"
                  >
                    <div
                      className="w-full md:w-1/2 h-44 md:h-full bg-cover bg-center"
                      style={
                        m.photoUrl
                          ? { backgroundImage: `url(${m.photoUrl})` }
                          : { backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))" }
                      }
                    />

                    <div className="w-full md:w-1/2 p-4 flex flex-col h-full justify-between">
                      <div className="min-h-0">
                        <div className="relative">
                          {connectionsCount > 0 ? (
                            <div className="absolute top-0 right-0 flex items-center gap-1 text-[12px] text-white/40 font-semibold">
                              <MSIcon name="group" className="icon-sm text-[#00F5FF]" />
                              <span>{connectionsCount}</span>
                            </div>
                          ) : null}

                          <div className="flex items-center gap-1.5 mb-2">
                            <h3 className="text-[20px] font-normal tracking-tight">{m.name}</h3>
                            {m.verified ? (
                              <MSIcon name="verified" className="fill-1 verified-icon" title="Verified" />
                            ) : null}
                          </div>

                          <div className="mb-3 flex items-baseline gap-2">
                            <span className="text-[15px] font-medium leading-none text-[#00F5FF]">{m.city}</span>
                            <span className="text-[15px] font-medium leading-none text-white/65">, {m.country}</span>
                          </div>

                          {(refMember + refTrip + refEvent) > 0 ? (
                            <div className="mb-3 flex items-center gap-3 text-[11px] text-white/45 font-medium">
                              <span className="whitespace-nowrap">{refTotal} References:</span>

                              {refMember > 0 ? (
                                <div className="flex items-center gap-1.5">
                                  <MSIcon name="person" className="icon-xs text-[#00F5FF]" />
                                  <span className="text-white/70 font-medium">{refMember}</span>
                                </div>
                              ) : null}

                              {refTrip > 0 ? (
                                <div className="flex items-center gap-1.5">
                                  <MSIcon name="flight" className="icon-xs text-[#00F5FF]" />
                                  <span className="text-white/70 font-medium">{refTrip}</span>
                                </div>
                              ) : null}

                              {refEvent > 0 ? (
                                <div className="flex items-center gap-1.5">
                                  <MSIcon name="event_available" className="icon-xs text-[#00F5FF]" />
                                  <span className="text-white/70 font-medium">{refEvent}</span>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          <div className="flex items-center gap-2 mb-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                            <MSIcon name="badge" className="icon-sm text-[#00F5FF]" />
                            <div className="flex gap-1.5">
                              {m.roles.map((r) => (
                                <span
                                  key={r}
                                  className="bg-white/5 text-white/70 text-[9px] font-medium px-2 py-[3px] rounded-md border border-white/10 whitespace-nowrap"
                                >
                                  {r}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mb-3">
                            <MSIcon name="person_play" className="icon-sm text-[#00F5FF]" />
                            <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                              {Object.entries(m.danceSkills ?? {}).map(([style, lvl]) => {
                                return (
                                  <span
                                    key={style}
                                    title={`Level: ${lvl}`}
                                    className="text-[9px] px-2 py-[3px] rounded-md border border-white/10 bg-white/5 text-white/55 font-medium uppercase tracking-wider whitespace-nowrap"
                                  >
                                    {style}
                                  </span>
                                );
                              })}

                              {m.otherStyle ? (
                                <span
                                  className="text-[9px] px-2 py-[3px] rounded-md border border-white/10 bg-white/5 text-white/55 font-medium uppercase tracking-wider whitespace-nowrap"
                                  title="Other style"
                                >
                                  Other
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="pt-3 flex flex-col gap-0">
                        {m.langs?.length ? (
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <MSIcon name="public" className="icon-sm text-[#00F5FF]" />
                              <div className="flex flex-wrap gap-1.5">
                                {m.langs.slice(0, 3).map((l) => (
                                  <div
                                    key={l}
                                    className="size-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[7px] font-bold text-white/70"
                                    title={l}
                                  >
                                    {l}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : null}

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => router.push(`/profile/${m.id}`)}
                            className="flex-1 text-[10px] font-semibold py-2 px-4 rounded-full border border-white/10 hover:bg-white/5 transition-colors uppercase tracking-widest"
                          >
                            View
                          </button>
                          <button
  className="flex-[1.5] text-[10px] font-semibold py-2 px-4 rounded-full
             text-[#0A0A0A] flex items-center justify-center gap-2
             uppercase tracking-widest"
  style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#ff00ff)" }}
  onClick={() => {
    openConnect({
      targetUserId: m.id,
      targetName: m.name,
      targetPhotoUrl: m.photoUrl ?? null,
      targetRoles: m.roles,
      connectContext: "member",
      tripId: null,
    });
  }}
>
  <span className="text-[12px] font-black leading-none">+</span>
  Connect
</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
              )}

              {!members.length ? (
                <div className="xl:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-6 text-white/60">
                  No matches with these filters.
                </div>
              ) : null}
            </div>

            {/* Vanish / fade effect at bottom while scrolling */}
          </div>
        ) : (
          <div className="relative mt-8">
            {tripsError ? (
              <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                {tripsError}
              </div>
            ) : null}

            {loadingTrips ? (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={`trip-sk-${i}`}
                    className="border border-white/10 rounded-[1.25rem] bg-[#121212] p-4 animate-pulse"
                  >
                    <div className="h-6 w-40 rounded bg-white/10" />
                    <div className="mt-3 h-4 w-56 rounded bg-white/10" />
                    <div className="mt-5 h-10 w-full rounded-full bg-white/10" />
                  </div>
                ))}
              </div>
            ) : filteredTrips.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/60">
                No trips match these filters.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                {filteredTrips.map((t) => {
                  const heroUrl = getTripHeroStorageUrl(t.destination_country);
                  const heroStorageFallback = getTripHeroStorageFolderUrl(t.destination_country);
                  const heroFallback = getTripHeroFallbackUrl(t.destination_city, t.destination_country);
                  const purposeMeta = getPurposeMeta(t.purpose);

                  return (
                    <div
                      key={t.id}
                      className="connections-card relative border border-white/10 rounded-3xl bg-[#121212] overflow-hidden flex flex-col md:flex-row h-auto md:h-[228px] transition-all duration-200 will-change-transform hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(13,242,242,0.14),0_16px_42px_rgba(0,245,255,0.06)]"
                    >
                      <div className="relative w-full md:w-1/2 h-36 md:h-full overflow-hidden flex items-center justify-center text-center">
                        <div className="absolute inset-0" style={{ backgroundImage: FALLBACK_GRADIENT }} />
                        {(heroUrl || heroStorageFallback || heroFallback) ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={heroUrl || heroStorageFallback || heroFallback}
                              alt={`${t.destination_city ?? "Trip"} hero`}
                              className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              crossOrigin="anonymous"
                              data-fallback-storage={heroStorageFallback || ""}
                              data-fallback={heroFallback || ""}
                              onError={(event) => {
                                const target = event.currentTarget;
                                const fallbackStorage = target.dataset.fallbackStorage;
                                const fallback = target.dataset.fallback;
                                if (fallbackStorage && target.src !== fallbackStorage) {
                                  target.src = fallbackStorage;
                                  return;
                                }
                                if (fallback && target.src !== fallback) {
                                  target.src = fallback;
                                }
                              }}
                            />
                          </>
                        ) : null}
                        <div className="absolute inset-0 bg-black/40 md:bg-black/30" />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A]/60 via-transparent to-transparent" />
                        <div className="relative z-10 flex flex-col items-center gap-3 px-4">
                          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 shadow-lg">
                            <MSIcon name="calendar_month" className="text-[#0dccf2] text-[14px]" />
                            <span className="text-white text-[11px] font-bold tracking-wide uppercase">
                              {formatDateCompact(t.start_date)} – {formatDateCompact(t.end_date)}
                            </span>
                          </div>
                          <div className="flex flex-col items-center rounded-2xl bg-black/50 backdrop-blur-md border border-white/10 px-3 py-2">
                            <div className="text-3xl md:text-[32px] font-extrabold text-[#0dccf2] tracking-tight drop-shadow-[0_0_10px_rgba(13,204,242,0.3)]">
                              {t.destination_city}
                            </div>
                            <div className="text-white/70 text-[11px] font-light tracking-[0.2em] uppercase mt-1">
                              {t.destination_country}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col w-full md:w-1/2 px-3 pt-3 pb-1 md:px-4 md:pt-3 md:pb-1 bg-[#121212] relative z-10 gap-1.5">
                        <div className="flex items-center gap-3 mb-0">
                          <div className={`p-2 rounded-lg border ${purposeMeta.bg} ${purposeMeta.border}`}>
                            <MSIcon name={purposeMeta.icon} className={`${purposeMeta.text} text-[18px]`} />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs text-white/40 font-bold uppercase tracking-wider">
                              Trip Purpose
                            </span>
                            <span className={`text-base font-semibold ${purposeMeta.text}`}>
                              {t.purpose ?? "Trip"}
                            </span>
                          </div>
                        </div>

                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => router.push(`/profile/${t.user_id}?fromTrip=${t.id}`)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              router.push(`/profile/${t.user_id}?fromTrip=${t.id}`);
                            }
                          }}
                          className="w-full p-0.5 transition-all hover:opacity-90 text-left"
                        >
                          <div className="flex items-start gap-3">
                            <div className="relative shrink-0">
                              <div className="absolute -inset-2 bg-[#d946ef]/20 rounded-[14px] blur-md" />
                              <div
                                className="relative h-20 w-20 rounded-[14px] bg-cover bg-center ring-1 ring-white/10"
                                style={{
                                  backgroundImage: t.avatar_url
                                    ? `url(${t.avatar_url})`
                                    : "linear-gradient(135deg, rgba(13,204,242,0.35), rgba(217,70,239,0.35))",
                                }}
                              />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-white text-base font-bold tracking-tight truncate">
                                {t.display_name}
                              </span>
                              <span className="text-[#0dccf2] text-[11px] font-bold flex items-center gap-1">
                                View profile
                                <MSIcon name="arrow_forward" className="text-[12px]" />
                              </span>
                              {t.languages?.length ? (
                                <div className="mt-1 flex items-center gap-0.5 min-w-0">
                                  <MSIcon name="public" className="icon-xs text-[#00F5FF]" />
                                  <ScrollRow ariaLabelLeft="Scroll languages left" ariaLabelRight="Scroll languages right">
                                    {t.languages.map((l) => {
                                      const code = langLabelToCode(l);
                                      return (
                                        <span
                                          key={l}
                                          className="flex items-center justify-center size-5 shrink-0 rounded-full bg-white/5 border border-white/10 text-white/70 text-[7px] font-bold"
                                          title={l}
                                        >
                                          {code}
                                        </span>
                                      );
                                    })}
                                  </ScrollRow>
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-2 space-y-0">
                            <div className="flex items-center gap-0.5 min-w-0">
                              <MSIcon name="badge" className="icon-sm text-[#00F5FF]" />
                              <ScrollRow ariaLabelLeft="Scroll roles left" ariaLabelRight="Scroll roles right">
                                {(t.roles?.length ? t.roles : ["Traveller"]).map((role) => (
                                  <span
                                    key={role}
                                    className="shrink-0 px-2 py-[3px] text-[9px] font-medium text-white/70 uppercase tracking-widest whitespace-nowrap"
                                  >
                                    {role}
                                  </span>
                                ))}
                              </ScrollRow>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            openConnect({
                              targetUserId: t.user_id,
                              targetName: t.display_name,
                              targetPhotoUrl: t.avatar_url ?? null,
                              targetRoles: t.roles,
                              connectContext: "traveller",
                              tripId: t.id,
                            })
                          }
                          className="mt-0 flex items-center justify-center gap-2 w-full text-[10px] font-semibold py-2 px-4 rounded-full text-[#0A0A0A] uppercase tracking-widest"
                          style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#ff00ff)" }}
                        >
                          <span className="text-[12px] font-black leading-none">+</span>
                          Connect for this trip
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {filtersOpen ? (
        <div className="fixed inset-0 z-[60]">
          <button aria-label="Close filters" className="absolute inset-0 bg-black/60" onClick={() => setFiltersOpen(false)} type="button" />

          <aside className="absolute right-0 top-0 h-full w-full max-w-md border-l border-white/10 bg-[#0A0A0A] shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <h2 className="text-2xl font-bold tracking-tight text-white">
                {tab === "travellers" ? "Filter Travellers" : "Filter Connections"}
              </h2>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="rounded-full p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
                aria-label="Close filters"
              >
                <MSIcon name="close" className="text-[22px]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 pb-36 space-y-7">
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-[#00F5FF]">
                  <MSIcon name="location_on" className="text-[20px]" />
                  <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Location</h3>
                </div>

                <div>
                  <label className="text-sm font-semibold text-white/90">Country</label>
                  <div className="relative mt-2">
                    <select
                      value={filters.country ?? ""}
                      onChange={(e) =>
                        setFilters((p) => ({
                          ...p,
                          country: e.target.value ? e.target.value : undefined,
                          cities: [],
                        }))
                      }
                      className="w-full appearance-none rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/90 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                    >
                      <option value="">Any country</option>
                      {countryNames.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <MSIcon name="expand_more" className="pointer-events-none absolute right-3 top-3 text-[20px] text-white/40" />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-white/90">Cities (Max 3)</label>
                    <span className="rounded-full bg-[#00F5FF]/15 px-2 py-0.5 text-xs font-bold text-[#00F5FF]">
                      {filters.cities.length}/3
                    </span>
                  </div>
                  <input
                    value={cityQuery}
                    onChange={(e) => setCityQuery(e.target.value)}
                    disabled={!filters.country}
                    placeholder={filters.country ? "Search cities..." : "Select country first"}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/85 outline-none placeholder:text-white/35 focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {!filters.country ? (
                    <p className="mt-2 text-[11px] text-white/45">
                      Choose a country to load city options.
                    </p>
                  ) : null}
                  {filters.cities.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {filters.cities.map((city) => (
                        <button
                          key={`selected-${city}`}
                          type="button"
                          onClick={() =>
                            setFilters((p) => ({ ...p, cities: p.cities.filter((c) => c !== city) }))
                          }
                          className="flex items-center gap-1 rounded-full border border-[#00F5FF]/40 bg-[#00F5FF]/10 px-3 py-1 text-xs font-semibold text-[#00F5FF]"
                        >
                          {city}
                          <MSIcon name="cancel" className="text-[14px]" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {filters.country && citySuggestions.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {citySuggestions.map((city) => (
                        <button
                          key={`suggestion-${city}`}
                          type="button"
                          disabled={filters.cities.length >= 3}
                          onClick={() =>
                            setFilters((p) =>
                              p.cities.length >= 3 ? p : { ...p, cities: [...p.cities, city] }
                            )
                          }
                          className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-semibold text-white/70 transition hover:border-[#00F5FF]/50 hover:text-[#00F5FF] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {city}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center gap-2 text-[#00F5FF]">
                  <MSIcon name="swap_horiz" className="text-[20px]" />
                  <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Role Preference</h3>
                </div>
                <p className="text-[11px] text-white/45">Tap one or multiple roles to filter.</p>
                <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-2">
                  {ROLE_OPTIONS.map((role) => (
                    (() => {
                      const selected = filters.roles.includes(role);
                      return (
                        <button
                          key={role}
                          type="button"
                          onClick={() =>
                            setFilters((p) => ({
                              ...p,
                              roles: selected ? p.roles.filter((r) => r !== role) : [...p.roles, role],
                            }))
                          }
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                            selected
                              ? "border-[#00F5FF]/60 bg-[#00F5FF]/15 text-[#00F5FF]"
                              : "border-white/10 bg-white/[0.01] text-white/60 hover:border-white/30 hover:text-white"
                          }`}
                        >
                          <span
                            className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                              selected ? "border-[#00F5FF]/70 bg-[#00F5FF] text-[#0A0A0A]" : "border-white/20"
                            }`}
                          >
                            {selected ? <MSIcon name="check" className="text-[12px]" /> : null}
                          </span>
                          <span>{role}</span>
                        </button>
                      );
                    })()
                  ))}
                </div>
              </section>

              {tab === "members" ? (
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-[#00F5FF]">
                    <MSIcon name="rebase_edit" className="text-[20px]" />
                    <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Dance Styles &amp; Level</h3>
                  </div>

                  <div className="space-y-3">
                    {STYLE_OPTIONS.map((style) => {
                      const levelsForStyle = filters.styleLevels[style] ?? [];
                      const enabled = Object.prototype.hasOwnProperty.call(filters.styleLevels, style);
                      const selectedLevel = levelsForStyle[0] ?? null;
                      return (
                        <div
                          key={style}
                          className={`rounded-xl border p-4 ${
                            enabled ? "border-white/15 bg-white/[0.03]" : "border-white/10 bg-transparent"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setFilters((p) => {
                                const next = { ...p.styleLevels };
                                if (Object.prototype.hasOwnProperty.call(next, style)) delete next[style];
                                else next[style] = [];
                                return { ...p, styleLevels: next };
                              })
                            }
                            className="flex w-full items-center gap-3 text-left"
                          >
                            <span
                              className={`flex h-6 w-6 items-center justify-center rounded-md border ${
                                enabled ? "border-[#00F5FF] bg-[#00F5FF]" : "border-white/20 bg-transparent"
                              }`}
                            >
                              {enabled ? <MSIcon name="check" className="text-[16px] text-[#0A0A0A]" /> : null}
                            </span>
                            <span className={`text-sm font-semibold ${enabled ? "text-white" : "text-white/55"}`}>{style}</span>
                          </button>

                          {enabled ? (
                            <div className="mt-3 grid grid-cols-3 gap-2">
                              {LEVELS.map((level) => (
                                <button
                                  key={`${style}-${level}`}
                                  type="button"
                                  onClick={() =>
                                    setFilters((p) => {
                                      const next = { ...p.styleLevels };
                                      const current = next[style] ?? [];
                                      next[style] = current[0] === level ? [] : [level];
                                      return { ...p, styleLevels: next };
                                    })
                                  }
                                  className={`rounded-lg border py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
                                    selectedLevel === level
                                      ? "border-[#00F5FF] bg-[#00F5FF] text-[#0A0A0A]"
                                      : "border-white/15 text-white/55 hover:border-white/30"
                                  }`}
                                >
                                  {LEVEL_SHORT_LABEL[level]}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {tab === "travellers" ? (
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-[#00F5FF]">
                    <MSIcon name="travel_explore" className="text-[20px]" />
                    <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Trip Reason</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {TRIP_PURPOSES.map((purpose) => (
                      <button
                        key={purpose}
                        type="button"
                        onClick={() =>
                          setFilters((p) => ({
                            ...p,
                            tripPurpose: p.tripPurpose === purpose ? undefined : purpose,
                          }))
                        }
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                          filters.tripPurpose === purpose
                            ? "border-[#00F5FF] bg-[#00F5FF]/15 text-[#00F5FF]"
                            : "border-white/10 bg-white/5 text-white/60 hover:border-white/30"
                        }`}
                      >
                        {purpose}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {tab === "travellers" ? (
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-[#00F5FF]">
                    <MSIcon name="public" className="text-[20px]" />
                    <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Languages</h3>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-white/90">Search languages</label>
                    <span className="rounded-full bg-[#00F5FF]/15 px-2 py-0.5 text-xs font-bold text-[#00F5FF]">
                      {filters.langs.length}
                    </span>
                  </div>
                  <input
                    value={languageQuery}
                    onChange={(e) => setLanguageQuery(e.target.value)}
                    placeholder="Search languages..."
                    className="w-full rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/85 outline-none placeholder:text-white/35 focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                  />
                  {filters.langs.length ? (
                    <div className="flex flex-wrap gap-2">
                      {filters.langs.map((lang) => (
                        <button
                          key={`selected-lang-trip-${lang}`}
                          type="button"
                          onClick={() =>
                            setFilters((p) => ({ ...p, langs: p.langs.filter((l) => l !== lang) }))
                          }
                          className="flex items-center gap-1 rounded-full border border-[#00F5FF]/40 bg-[#00F5FF]/10 px-3 py-1 text-xs font-semibold text-[#00F5FF]"
                        >
                          {lang}
                          <MSIcon name="cancel" className="text-[14px]" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {languageSuggestions.length ? (
                    <div className="flex flex-wrap gap-2">
                      {languageSuggestions.map((lang, idx) => (
                        <button
                          key={`suggestion-lang-trip-${lang}-${idx}`}
                          type="button"
                          onClick={() =>
                            setFilters((p) => ({ ...p, langs: [...p.langs, lang] }))
                          }
                          className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-semibold text-white/70 transition hover:border-[#00F5FF]/50 hover:text-[#00F5FF]"
                        >
                          {lang}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {tab === "members" ? (
              <section className="border-t border-white/10 pt-6">
                <button
                  type="button"
                  onClick={() => setMoreFiltersOpen((v) => !v)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.12em] text-white/80">
                    <MSIcon name="add_circle" className="text-[18px] text-[#00F5FF]" />
                    More Filters
                  </span>
                  <MSIcon
                    name="expand_more"
                    className={`text-[18px] text-white/50 transition-transform ${moreFiltersOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {moreFiltersOpen ? (
                  <div className="mt-4 space-y-4">
                    {tab === "members" ? (
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="text-xs font-semibold uppercase tracking-wider text-white/50">Languages</div>
                        <div className="mt-3 flex items-center justify-between">
                          <label className="text-sm font-semibold text-white/90">Search languages</label>
                          <span className="rounded-full bg-[#00F5FF]/15 px-2 py-0.5 text-xs font-bold text-[#00F5FF]">
                            {filters.langs.length}
                          </span>
                        </div>
                        <input
                          value={languageQuery}
                          onChange={(e) => setLanguageQuery(e.target.value)}
                          placeholder="Search languages..."
                          className="mt-2 w-full rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/85 outline-none placeholder:text-white/35 focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                        />
                        {filters.langs.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {filters.langs.map((lang) => (
                              <button
                                key={`selected-lang-${lang}`}
                                type="button"
                                onClick={() =>
                                  setFilters((p) => ({ ...p, langs: p.langs.filter((l) => l !== lang) }))
                                }
                                className="flex items-center gap-1 rounded-full border border-[#00F5FF]/40 bg-[#00F5FF]/10 px-3 py-1 text-xs font-semibold text-[#00F5FF]"
                              >
                                {lang}
                                <MSIcon name="cancel" className="text-[14px]" />
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {languageSuggestions.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {languageSuggestions.map((lang, idx) => (
                              <button
                                key={`suggestion-lang-${lang}-${idx}`}
                                type="button"
                                onClick={() =>
                                  setFilters((p) => ({ ...p, langs: [...p.langs, lang] }))
                                }
                                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-semibold text-white/70 transition hover:border-[#00F5FF]/50 hover:text-[#00F5FF]"
                              >
                                {lang}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {tab === "members" ? (
                      <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-4">
                        <span>
                          <span className="block text-xs font-bold uppercase tracking-wider text-white/75">Verified only</span>
                          <span className="mt-0.5 block text-[11px] text-white/45">Only show verified members</span>
                        </span>
                        <input
                          type="checkbox"
                          checked={filters.verifiedOnly}
                          onChange={(e) => setFilters((p) => ({ ...p, verifiedOnly: e.target.checked }))}
                          className="h-5 w-5 rounded border-white/20 bg-transparent accent-[#00F5FF]"
                        />
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </section>
              ) : null}
            </div>

            <div className="absolute inset-x-0 bottom-0 flex items-center gap-4 border-t border-white/10 bg-[#0A0A0A]/95 px-6 py-4 backdrop-blur">
              <button
                type="button"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setCityQuery("");
                  setLanguageQuery("");
                }}
                className="text-sm font-bold text-white/50 underline underline-offset-4 decoration-2 hover:text-white"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-extrabold text-[#0A0A0A] shadow-[0_0_24px_rgba(13,245,255,0.25)] transition hover:scale-[1.01]"
                style={{ backgroundImage: "linear-gradient(90deg,#00F5FF 0%,#FF00FF 100%)" }}
              >
                <MSIcon name="search" className="text-[18px]" />
                {tab === "travellers" ? "Show Travellers" : "Show Connections"}
              </button>
            </div>
          </aside>
        </div>
      ) : null}
      {tab === "members" || tab === "travellers" ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 h-28 bg-gradient-to-b from-transparent to-[#0A0A0A]" />
      ) : null}

      {connectModal.open && (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-md px-4">
    <div className="relative w-full max-w-[540px] rounded-[28px] bg-[#102323] border border-white/10 shadow-2xl p-6 sm:p-8">
      {/* Close */}
      <button
        type="button"
        onClick={() => {
          setConnectModal(EMPTY_CONNECT_MODAL);
          setSelectedReason(null);
          setSelectedRole(null);
          setConnectReasons([]);
        }}
        className="absolute top-5 right-5 text-white/50 hover:text-white transition"
        aria-label="Close"
      >
        <MSIcon name="close" className="text-[22px]" />
      </button>

      {/* Header */}
      <div className="flex flex-col items-center text-center gap-3">
        <div className="relative">
          <div className="h-20 w-20 rounded-full border-2 border-[#00F5FF] p-1">
            <div
              className="h-full w-full rounded-full bg-center bg-cover"
              style={{
                backgroundImage: connectModal.targetPhotoUrl
                  ? `url(${connectModal.targetPhotoUrl})`
                  : "linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))",
              }}
            />
          </div>
          <div className="absolute bottom-0 right-0 rounded-full bg-[#00F5FF] p-[2px] border-2 border-[#102323]">
            <MSIcon name="check_circle" className="text-[#0A0A0A] text-[18px]" />
          </div>
        </div>

        <div>
          <h3 className="text-[22px] sm:text-2xl font-extrabold tracking-tight text-white">
            Connect with {connectModal.targetName}
          </h3>
          <p className="mt-1 text-sm text-white/50">Select a role, then choose one reason.</p>
        </div>
      </div>

      {/* Roles row (scrollable) */}
      <div className="mt-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-3">
          Connect as
        </div>

        <div className="-mx-2 px-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          <div className="flex gap-3 min-w-max pb-1">
            {connectModal.targetRoles.map((role) => {
              const active = selectedRole === role;

              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => {
                    setSelectedRole(role);
                    setSelectedReason(null);
                  }}
                  className={[
                    "relative flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 min-w-[170px] transition",
                    active
                      ? "border-[#00F5FF] bg-[#00F5FF]/10"
                      : "border-white/10 bg-white/[0.04] hover:border-white/20",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={[
                        "h-10 w-10 rounded-xl flex items-center justify-center border",
                        active ? "border-[#00F5FF]/40 bg-[#00F5FF]/10" : "border-white/10 bg-white/5",
                      ].join(" ")}
                    >
                      <MSIcon
                        name={
                          role === "Teacher"
                            ? "record_voice_over"
                            : role === "DJ"
                            ? "graphic_eq"
                            : role === "Organizer"
                            ? "event_available"
                            : role === "Studio Owner"
                            ? "store"
                            : role === "Promoter"
                            ? "campaign"
                            : role === "Artist"
                            ? "movie"
                            : role === "Social Dancer / Student"
                            ? "school"
                            : "badge"
                        }
                        className={active ? "text-[#00F5FF]" : "text-white/50"}
                      />
                    </div>

                    <div className="text-left">
                      <div className={active ? "text-white font-bold" : "text-white/70 font-semibold"}>
                        {role}
                      </div>
                      <div className="text-[11px] text-white/40">Pick a reason below</div>
                    </div>
                  </div>

                  <div
                    className={[
                      "h-5 w-5 rounded-full border flex items-center justify-center",
                      active ? "border-[#00F5FF]" : "border-white/20",
                    ].join(" ")}
                  >
                    {active ? <div className="h-2.5 w-2.5 rounded-full bg-[#00F5FF]" /> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dropdown appears cleanly below role row */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">
              Select a reason
            </div>
            <div className="text-[11px] text-white/40">{selectedRole ?? ""}</div>
          </div>

          <select
            value={selectedReason ?? ""}
            disabled={!selectedRole}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              setSelectedReason(v);
            }}
            className="w-full rounded-xl border border-white/10 bg-[#0F1F1F] px-4 py-3 text-sm text-white/80 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 disabled:opacity-60"
          >
            <option value="">Select a reason…</option>
            {(selectedRole ? reasonsByRole.get(selectedRole) ?? [] : [])
              .slice()
              .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
          </select>

          {/* Strong selected confirmation */}
          <div className="mt-4 rounded-xl border border-[#00F5FF]/25 bg-[#00F5FF]/10 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-white/70">Selected reason</div>
            {selectedReasonObj ? (
              <div className="mt-1 text-sm font-semibold text-white">
                {selectedReasonObj.label}
                <span className="ml-2 text-[11px] font-medium text-white/60">({selectedReasonObj.role})</span>
              </div>
            ) : (
              <div className="mt-1 text-sm text-white/60">Choose one reason to enable “Send Request”.</div>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          disabled={!selectedReason || sendingRequest}
	          onClick={async () => {
	            const targetId = connectModal.targetUserId;
	            const reasonId = selectedReason;
	            const role = selectedRole;
	            const connectContext = connectModal.connectContext ?? "member";
	            const tripId = connectModal.tripId ?? null;
	            const requestsRedirect =
	              connectContext === "traveller"
	                ? "/connections/requests?tab=outgoing&kind=trips"
	                : "/connections/requests?tab=outgoing&kind=connections";

            if (!targetId || !reasonId || !role) return;

            try {
              setSendingRequest(true);
              setUiError(null);

              const {
                data: { user },
                error: authError,
              } = await supabase.auth.getUser();
              const { data: sessionData } = await supabase.auth.getSession();
              const accessToken = sessionData.session?.access_token ?? "";

              if (authError || !user) throw authError ?? new Error("Not authenticated");
              if (!accessToken) throw new Error("Missing auth session token");

              // 1) Check existing connection in either direction
              const { data: existing, error: existingErr } = await supabase
                .from("connections")
                .select("id,status,requester_id,target_id")
                .or(
                  `and(requester_id.eq.${user.id},target_id.eq.${targetId}),and(requester_id.eq.${targetId},target_id.eq.${user.id})`
                )
                .limit(1)
                .maybeSingle();

              if (existingErr) throw existingErr;

	              if (existing?.status === "accepted" || existing?.status === "pending") {
	                // Already connected/requested: route to the next valid screen.
	                setConnectModal(EMPTY_CONNECT_MODAL);
	                setSelectedReason(null);
	                setSelectedRole(null);
	                setConnectReasons([]);
	                if (existing.status === "accepted" && existing.id) {
	                  router.push(`/messages/${existing.id}`);
	                } else {
	                  router.push(requestsRedirect);
	                }
	                return;
	              }

              // 2) Create pending request through server endpoint (single validation path)
              const response = await fetch("/api/connect", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${accessToken}`,
                },
	                body: JSON.stringify({
	                  requesterId: user.id,
	                  targetId,
	                  payload: {
	                    connect_context: connectContext,
	                    connect_reason: reasonId,
	                    connect_reason_role: role,
	                    trip_id: tripId,
	                  },
	                }),
	              });
              const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
              if (!response.ok || !result?.ok) {
                throw new Error(result?.error || "Failed to create connection request");
              }

              // 3) Close + route
	              setConnectModal(EMPTY_CONNECT_MODAL);
	              setSelectedReason(null);
	              setSelectedRole(null);
	              setConnectReasons([]);
	              router.push(requestsRedirect);
	            } catch (e) {
              const message = e instanceof Error ? e.message : "Failed to send request.";
              setUiError(
                message.includes("Failed to fetch")
                  ? "Network issue while sending request. Check your connection and Supabase env values, then retry."
                  : message
              );
            } finally {
              setSendingRequest(false);
            }
          }}
          className="w-full h-14 rounded-full font-black uppercase tracking-wide text-[#0A0A0A] disabled:opacity-40"
          style={{ backgroundImage: "linear-gradient(90deg,#00F5FF 0%, #FF00FF 100%)" }}
        >
          {sendingRequest ? "Sending…" : "Send request"}
        </button>

        <button
          type="button"
          onClick={() => {
            setConnectModal(EMPTY_CONNECT_MODAL);
            setSelectedReason(null);
            setSelectedRole(null);
            setConnectReasons([]);
          }}
          className="w-full h-10 rounded-full text-white/60 text-sm font-semibold hover:text-white transition"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
)}
    </div>
  );
}
