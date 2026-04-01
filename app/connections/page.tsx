"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  getCachedCitiesOfCountry,
  getCachedCountriesAll,
  getCitiesOfCountry,
  getCountriesAll,
  type CountryEntry,
} from "@/lib/country-city-client";
import { supabase } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import PaginationControls from "@/components/PaginationControls";
import { useAppLanguage } from "@/components/AppLanguageProvider";
import {
  FALLBACK_GRADIENT,
  getTripHeroFallbackUrl,
  getTripHeroStorageFolderUrl,
  getTripHeroStorageUrl,
} from "@/lib/city-hero-images";
import VerifiedBadge from "@/components/VerifiedBadge";
import VerificationRequiredDialog from "@/components/verification/VerificationRequiredDialog";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { clearVerificationResume, loadVerificationResume, type VerificationResumePayload } from "@/lib/verification-client";
import { VERIFICATION_SUCCESS_MESSAGE, VERIFIED_VIA_PAYMENT_LABEL, isPaymentVerified } from "@/lib/verification";
import { getPlanLimits } from "@/lib/billing/limits";

type Tab = "members" | "travellers";
type DiscoverMode = "dancers" | "travelers" | "hosts";

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

type HostingRequestType = "request_hosting" | "offer_to_host";

type HostingModalState = {
  open: boolean;
  targetUserId: string | null;
  targetName: string;
  targetPhotoUrl?: string;
  targetMaxGuests: number | null;
  tripId: string | null;
  requestType: HostingRequestType;
  arrivalDate: string;
  departureDate: string;
  arrivalFlexible: boolean;
  departureFlexible: boolean;
  travellersCount: number;
  maxTravellersAllowed: string;
  message: string;
};

const EMPTY_HOSTING_MODAL: HostingModalState = {
  open: false,
  targetUserId: null,
  targetName: "Member",
  targetPhotoUrl: undefined,
  targetMaxGuests: null,
  tripId: null,
  requestType: "request_hosting",
  arrivalDate: "",
  departureDate: "",
  arrivalFlexible: false,
  departureFlexible: false,
  travellersCount: 1,
  maxTravellersAllowed: "",
  message: "",
};

type TripJoinModalState = {
  open: boolean;
  targetUserId: string | null;
  targetName: string;
  targetPhotoUrl?: string;
  tripId: string | null;
  destinationCity: string;
  destinationCountry: string;
  startDate: string | null;
  endDate: string | null;
  note: string;
};

const EMPTY_TRIP_JOIN_MODAL: TripJoinModalState = {
  open: false,
  targetUserId: null,
  targetName: "Traveller",
  targetPhotoUrl: undefined,
  tripId: null,
  destinationCity: "",
  destinationCountry: "",
  startDate: null,
  endDate: null,
  note: "",
};

const SECURE_TEXT_PATTERNS = {
  links: /(https?:\/\/|www\.)/i,
  emails: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  handles: /[@#][A-Za-z0-9_]+/,
  phones: /(\+?\d[\d\s().-]{7,}\d)/,
};

function validateSecureFreeText(value: string) {
  const message = value.trim();
  if (!message) return null;
  if (message.length > 500) return "Message can be at most 500 characters.";
  if (SECURE_TEXT_PATTERNS.links.test(message)) return "Links are not allowed in hosting requests.";
  if (SECURE_TEXT_PATTERNS.emails.test(message)) return "Emails are not allowed in hosting requests.";
  if (SECURE_TEXT_PATTERNS.handles.test(message)) return "Social handles are not allowed in hosting requests.";
  if (SECURE_TEXT_PATTERNS.phones.test(message)) return "Phone numbers are not allowed in hosting requests.";
  return null;
}

function validateTripRequestText(value: string) {
  const message = value.trim();
  if (!message) return null;
  if (message.length > 500) return "Message can be at most 500 characters.";
  if (SECURE_TEXT_PATTERNS.links.test(message)) return "Links are not allowed in trip requests.";
  if (SECURE_TEXT_PATTERNS.emails.test(message)) return "Emails are not allowed in trip requests.";
  if (SECURE_TEXT_PATTERNS.handles.test(message)) return "Social handles are not allowed in trip requests.";
  if (SECURE_TEXT_PATTERNS.phones.test(message)) return "Phone numbers are not allowed in trip requests.";
  return null;
}

function getTripReferenceTotal(trip: Pick<TripCard, "refMemberAll" | "refTripAll" | "refEventAll">) {
  return Number(trip.refMemberAll ?? 0) + Number(trip.refTripAll ?? 0) + Number(trip.refEventAll ?? 0);
}

const HOST_OFFER_TEMPLATES = [
  {
    label: "Friendly host",
    text: "Hi! I can host you during these dates if you still need a place. Happy to coordinate details in chat.",
  },
  {
    label: "Space available",
    text: "I have space available for your trip dates. If it helps, I can host and we can confirm logistics here.",
  },
  {
    label: "Need details",
    text: "I can offer hosting for this trip window. Let me know your arrival plan and how many people are coming.",
  },
  {
    label: "Flexible stay",
    text: "If you still need accommodation, I can host during your stay. We can align on timing and expectations in chat.",
  },
  {
    label: "Quick intro",
    text: "I'm available to host for these dates. Send me your travel timing and we can see if it fits well.",
  },
] as const;

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
const DISCOVER_PAGE_SIZE = 25;
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

type Availability = "Weekdays" | "Weekends" | "DayTime" | "Evenings" | "Travel for Events" | "I'd rather not say";
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
    text: "text-[#00F5FF]",
    bg: "bg-[#00F5FF]/12",
    border: "border-[#00F5FF]/35",
  },
  "Social Dancing": {
    icon: "groups",
    text: "text-[#00F5FF]",
    bg: "bg-[#00F5FF]/12",
    border: "border-[#00F5FF]/35",
  },
  "Training / Workshops": {
    icon: "school",
    text: "text-[#00F5FF]",
    bg: "bg-[#00F5FF]/12",
    border: "border-[#00F5FF]/35",
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
  memberSince?: string | null;
  verified?: boolean;
  roles: string[];
  danceSkills: Partial<Record<Style, Level>>;
  otherStyle?: boolean;
  langs?: string[]; // stored as codes in cards (EN/ES/...)
  interest?: string;
  availability?: string;
  canHost?: boolean;
  hostingStatus?: string;
  maxGuests?: number | null;
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
  created_at?: string | null;
  city?: string | null;
  country?: string | null;
  roles?: unknown;
  languages?: unknown;
  avatar_url?: string | null;
  is_verified?: boolean | null;
  verification_type?: string | null;
  verified?: boolean | null;
  verified_label?: string | null;
  dance_skills?: unknown;
  has_other_style?: boolean | null;
  connections_count?: number | null;
  interests?: unknown;
  availability?: unknown;
  can_host?: boolean | null;
  hosting_status?: string | null;
  max_guests?: number | null;
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

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

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

function formatMemberSince(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(d);
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
  references?: "has" | "none";
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
  references: undefined,
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

function ConnectionsPageContent() {
  const { t } = useAppLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("members");
  const [discoverMode, setDiscoverMode] = useState<DiscoverMode>("dancers");
  const [myCityOnly, setMyCityOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("recommended");
  const [myCity, setMyCity] = useState<string | null>(null);
  const [myCountry, setMyCountry] = useState<string | null>(null);
  const [viewerVerified, setViewerVerified] = useState(false);
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [myLangCodes, setMyLangCodes] = useState<string[]>([]);
  const [myStyleLevels, setMyStyleLevels] = useState<Partial<Record<Style, Level>>>({});
  const [hiddenMemberIds, setHiddenMemberIds] = useState<string[]>([]);
  const [connectRequestsUsed, setConnectRequestsUsed] = useState<number | null>(null);
  const [connectRequestsLimit, setConnectRequestsLimit] = useState<number | null>(null);
  const [hostingOffersUsed, setHostingOffersUsed] = useState<number | null>(null);
  const [hostingOffersLimit, setHostingOffersLimit] = useState<number | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<FiltersState>(EMPTY_FILTERS);
  const [memberSearch, setMemberSearch] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [languageQuery, setLanguageQuery] = useState("");

  const [uiError, setUiError] = useState<string | null>(null);
  const [uiInfo, setUiInfo] = useState<string | null>(null);
  const [verificationModalOpen, setVerificationModalOpen] = useState(false);
  const [verificationResumePayload, setVerificationResumePayload] = useState<VerificationResumePayload | null>(null);

  const [connectModal, setConnectModal] = useState<ConnectModalState>(EMPTY_CONNECT_MODAL);
  const [connectReasons, setConnectReasons] = useState<ConnectReason[]>([]);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [connectReasonQuery, setConnectReasonQuery] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);
  const [pendingWarning, setPendingWarning] = useState<string | null>(null);
  const [connectModalError, setConnectModalError] = useState<string | null>(null);

  const [hostingModal, setHostingModal] = useState<HostingModalState>(EMPTY_HOSTING_MODAL);
  const [hostingSending, setHostingSending] = useState(false);
  const [hostingModalWarning, setHostingModalWarning] = useState<string | null>(null);
  const [hostingModalError, setHostingModalError] = useState<string | null>(null);
  const [tripJoinModal, setTripJoinModal] = useState<TripJoinModalState>(EMPTY_TRIP_JOIN_MODAL);
  const [tripRequestSending, setTripRequestSending] = useState(false);
  const [tripJoinWarning, setTripJoinWarning] = useState<string | null>(null);
  const [tripJoinError, setTripJoinError] = useState<string | null>(null);
  const [membersPage, setMembersPage] = useState(1);
  const [travellersPage, setTravellersPage] = useState(1);
  useBodyScrollLock(Boolean(filtersOpen || connectModal.open || hostingModal.open || tripJoinModal.open || verificationModalOpen));

  const closeConnectModal = useCallback(() => {
    setConnectModal(EMPTY_CONNECT_MODAL);
    setSelectedReason(null);
    setSelectedRole(null);
    setConnectReasonQuery("");
    setConnectReasons([]);
    setPendingWarning(null);
    setConnectModalError(null);
  }, []);

  const closeHostingModal = useCallback(() => {
    setHostingModal(EMPTY_HOSTING_MODAL);
    setHostingModalWarning(null);
    setHostingModalError(null);
  }, []);

  const closeTripJoinModal = useCallback(() => {
    setTripJoinModal(EMPTY_TRIP_JOIN_MODAL);
    setTripJoinWarning(null);
    setTripJoinError(null);
  }, []);

  const openTripJoinModal = useCallback((params: {
    targetUserId: string;
    targetName?: string;
    targetPhotoUrl?: string | null;
    tripId?: string | null;
    destinationCity?: string | null;
    destinationCountry?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  }) => {
    setTripJoinModal({
      open: true,
      targetUserId: params.targetUserId,
      targetName: params.targetName ?? "Traveller",
      targetPhotoUrl: params.targetPhotoUrl ?? undefined,
      tripId: params.tripId ?? null,
      destinationCity: params.destinationCity ?? "",
      destinationCountry: params.destinationCountry ?? "",
      startDate: params.startDate ?? null,
      endDate: params.endDate ?? null,
      note: "",
    });
  }, []);

  const openConnect = useCallback((params: {
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
    setConnectReasonQuery("");
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
  }, []);

  const openHostingRequest = useCallback((params: {
    targetUserId: string;
    targetName?: string;
    targetPhotoUrl?: string | null;
    targetMaxGuests?: number | null;
    requestType: HostingRequestType;
    tripId?: string | null;
    prefillArrivalDate?: string | null;
    prefillDepartureDate?: string | null;
  }) => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const arrivalPrefill =
      typeof params.prefillArrivalDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.prefillArrivalDate)
        ? params.prefillArrivalDate
        : addDaysIso(todayIso, 14);
    const departurePrefill =
      typeof params.prefillDepartureDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.prefillDepartureDate)
        ? params.prefillDepartureDate
        : addDaysIso(arrivalPrefill, 2);

    setHostingModal({
      open: true,
      targetUserId: params.targetUserId,
      targetName: params.targetName ?? "Member",
      targetPhotoUrl: params.targetPhotoUrl ?? undefined,
      targetMaxGuests: typeof params.targetMaxGuests === "number" ? params.targetMaxGuests : null,
      tripId: params.tripId ?? null,
      requestType: params.requestType,
      arrivalDate: arrivalPrefill,
      departureDate: departurePrefill,
      arrivalFlexible: false,
      departureFlexible: false,
      travellersCount: 1,
      maxTravellersAllowed: params.requestType === "offer_to_host"
        ? String(typeof params.targetMaxGuests === "number" && params.targetMaxGuests > 0 ? params.targetMaxGuests : 1)
        : "",
      message: "",
    });
  }, []);

  const requestHostingAccess = useCallback((params: {
    targetUserId: string;
    targetName?: string;
    targetPhotoUrl?: string | null;
    targetMaxGuests?: number | null;
    tripId?: string | null;
    prefillArrivalDate?: string | null;
    prefillDepartureDate?: string | null;
  }) => {
    if (viewerVerified) {
      openHostingRequest({
        ...params,
        requestType: "request_hosting",
      });
      return;
    }

    setVerificationResumePayload({
      kind: "request_hosting",
      targetUserId: params.targetUserId,
      targetName: params.targetName,
      targetPhotoUrl: params.targetPhotoUrl,
      targetMaxGuests: params.targetMaxGuests ?? null,
      tripId: params.tripId ?? null,
      prefillArrivalDate: params.prefillArrivalDate ?? null,
      prefillDepartureDate: params.prefillDepartureDate ?? null,
    });
    setVerificationModalOpen(true);
  }, [openHostingRequest, viewerVerified]);

  useEffect(() => {
    const verificationState = searchParams.get("verification");
    if (verificationState === "success") {
      setUiInfo(VERIFICATION_SUCCESS_MESSAGE);
      return;
    }
    if (verificationState === "cancelled") {
      clearVerificationResume();
    }
  }, [searchParams]);

  useEffect(() => {
    if (!viewerVerified || searchParams.get("verification") !== "success") return;

    const resume = loadVerificationResume();
    if (!resume || resume.kind !== "request_hosting") return;

    clearVerificationResume();
    openHostingRequest({
      targetUserId: resume.targetUserId,
      targetName: resume.targetName,
      targetPhotoUrl: resume.targetPhotoUrl,
      targetMaxGuests: resume.targetMaxGuests ?? null,
      requestType: "request_hosting",
      tripId: resume.tripId ?? null,
      prefillArrivalDate: resume.prefillArrivalDate ?? null,
      prefillDepartureDate: resume.prefillDepartureDate ?? null,
    });
  }, [openHostingRequest, searchParams, viewerVerified]);

  const selectedReasonObj = useMemo(() => {
    if (!selectedReason) return null;
    return connectReasons.find((r) => r.id === selectedReason) ?? null;
  }, [selectedReason, connectReasons]);

  const connectRoleOptions = useMemo(() => {
    return Array.from(new Set(connectReasons.map((reason) => reason.role).filter(isNonEmptyString))).sort((a, b) => a.localeCompare(b));
  }, [connectReasons]);

  const visibleConnectReasons = useMemo(() => {
    const queryText = connectReasonQuery.trim().toLowerCase();
    return connectReasons
      .filter((reason) => {
        if (selectedRole && reason.role !== selectedRole) return false;
        if (!queryText) return true;
        const haystack = `${reason.label} ${reason.role}`.toLowerCase();
        return haystack.includes(queryText);
      })
      .slice()
      .sort((a, b) => {
        const left = a.sort_order ?? 100;
        const right = b.sort_order ?? 100;
        if (left !== right) return left - right;
        return a.label.localeCompare(b.label);
      });
  }, [connectReasonQuery, connectReasons, selectedRole]);

  const [dbMembers, setDbMembers] = useState<MemberCard[]>([]);
  const [hostColumnsAvailable, setHostColumnsAvailable] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [tripCards, setTripCards] = useState<TripCard[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [tripsError, setTripsError] = useState<string | null>(null);

  const [iconsReady, setIconsReady] = useState(false);
  const autoRequestedHostRef = useRef<string | null>(null);

  const filtersTitle =
    tab === "travellers" ? "Filter Travellers" : discoverMode === "hosts" ? "Filter Hosts" : "Filter Dancers";
  const filtersApplyLabel =
    tab === "travellers" ? "Show Travellers" : discoverMode === "hosts" ? "Show Hosts" : "Show Dancers";

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
    const modeParam = (searchParams.get("mode") ?? "").toLowerCase();
    if (modeParam === "travelers") {
      setDiscoverMode("travelers");
      setTab("travellers");
      return;
    }
    if (modeParam === "hosts") {
      setDiscoverMode("hosts");
      setTab("members");
      return;
    }
    if (modeParam === "dancers") {
      setDiscoverMode("dancers");
      setTab("members");
      return;
    }
  }, [searchParams]);

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
    if (!connectModal.open) return;

    setSelectedReason(null);
    setSelectedRole(null);
    setConnectReasonQuery("");
    setPendingWarning(null);

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
          .order("sort_order");

        if (!error) setConnectReasons(data ?? []);
      } catch {
        setConnectReasons([]);
      }
    })();

    // Check for existing pending/accepted request
    (async () => {
      try {
        const { data: authUser } = await supabase.auth.getUser();
        const userId = authUser?.user?.id;
        const targetId = connectModal.targetUserId;
        if (!userId || !targetId) return;

        const { data: existing } = await supabase
          .from("connections")
          .select("id,status,requester_id")
          .or(
            `and(requester_id.eq.${userId},target_id.eq.${targetId}),and(requester_id.eq.${targetId},target_id.eq.${userId})`
          )
          .limit(1)
          .maybeSingle();

        if (existing?.status === "pending") {
          const direction = existing.requester_id === userId ? "You already sent" : "You received";
          setPendingWarning(`${direction} a pending connection request with this member.`);
        } else if (existing?.status === "accepted") {
          setPendingWarning("You are already connected with this member.");
        }
      } catch {}
    })();
  }, [connectModal.open, connectModal.connectContext, connectModal.targetUserId]);

  // Check for existing hosting requests when hosting modal opens
  useEffect(() => {
    if (!hostingModal.open || !hostingModal.targetUserId) return;
    setHostingModalWarning(null);
    setHostingModalError(null);

    (async () => {
      try {
        const { data: authUser } = await supabase.auth.getUser();
        const userId = authUser?.user?.id;
        if (!userId) return;

        const { data: existing } = await supabase
          .from("hosting_requests")
          .select("id,status,sender_user_id,request_type")
          .or(
            `and(sender_user_id.eq.${userId},recipient_user_id.eq.${hostingModal.targetUserId}),and(sender_user_id.eq.${hostingModal.targetUserId},recipient_user_id.eq.${userId})`
          )
          .in("status", ["pending", "accepted"])
          .limit(1)
          .maybeSingle();

        if (existing?.status === "pending") {
          const type = existing.request_type === "offer_to_host" ? "hosting offer" : "hosting request";
          const direction = existing.sender_user_id === userId ? "You already sent" : "You received";
          setHostingModalWarning(`${direction} a pending ${type} with this member.`);
        } else if (existing?.status === "accepted") {
          setHostingModalWarning("There is already an accepted hosting arrangement with this member.");
        }
      } catch {}
    })();
  }, [hostingModal.open, hostingModal.targetUserId]);

  // Check for existing trip requests when trip join modal opens
  useEffect(() => {
    if (!tripJoinModal.open || !tripJoinModal.tripId) return;
    setTripJoinWarning(null);
    setTripJoinError(null);

    (async () => {
      try {
        const { data: authUser } = await supabase.auth.getUser();
        const userId = authUser?.user?.id;
        if (!userId) return;

        const { data: existing } = await supabase
          .from("trip_requests")
          .select("id,status")
          .eq("trip_id", tripJoinModal.tripId)
          .eq("requester_id", userId)
          .in("status", ["pending", "accepted"])
          .limit(1)
          .maybeSingle();

        if (existing?.status === "pending") {
          setTripJoinWarning("You already sent a pending join request for this trip.");
        } else if (existing?.status === "accepted") {
          setTripJoinWarning("You are already part of this trip.");
        }
      } catch {}
    })();
  }, [tripJoinModal.open, tripJoinModal.tripId]);

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
        if (!user) {
          router.replace("/auth?next=%2Fdiscover%2Fdancers");
          setLoadingMembers(false);
          return;
        }
        if (user) {
          meId = user.id;
          const { data: myProfile } = await supabase
            .from("profiles")
            .select("city,country,roles,languages,dance_skills,verified,verified_label")
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
          setViewerVerified(isPaymentVerified((myProfile ?? null) as Record<string, unknown> | null));
          setMyRoles(myRoleList);
          setMyLangCodes(myLangList);
          setMyStyleLevels(myStyles);

          // Load plan limits + monthly connection request count
          try {
            const { data: authUser } = await supabase.auth.getUser();
            const meta = authUser?.user?.user_metadata ?? {};
            const isPro = meta.billing_plan === "pro" || meta.subscription_status === "active";
            const planId = isPro ? "pro" : "starter";
            const limits = getPlanLimits(planId);
            setConnectRequestsLimit(limits.connectionRequestsPerMonth);

            const monthStart = new Date();
            monthStart.setDate(1);
            monthStart.setHours(0, 0, 0, 0);
            const { count } = await supabase
              .from("connections")
              .select("id", { count: "exact", head: true })
              .eq("requester_id", user.id)
              .gte("created_at", monthStart.toISOString());
            setConnectRequestsUsed(count ?? 0);

            setHostingOffersLimit(limits.hostingOffersPerMonth);
            const { count: hostingCount } = await supabase
              .from("hosting_requests")
              .select("id", { count: "exact", head: true })
              .eq("sender_user_id", user.id)
              .eq("request_type", "offer_to_host")
              .gte("created_at", monthStart.toISOString());
            setHostingOffersUsed(hostingCount ?? 0);
          } catch {}


          const { data: connectionRows, error: connectionError } = await supabase
            .from("connections")
            .select("requester_id,target_id,status")
            .or(`requester_id.eq.${user.id},target_id.eq.${user.id}`)
            .in("status", ["pending", "accepted", "blocked"]);

          if (!connectionError) {
            const nextHiddenMemberIds = Array.from(
              new Set(
                (connectionRows ?? [])
                  .map((raw) => {
                    const row = raw as { requester_id?: string | null; target_id?: string | null };
                    if (row.requester_id === user.id) return row.target_id ?? "";
                    if (row.target_id === user.id) return row.requester_id ?? "";
                    return "";
                  })
                  .filter(isNonEmptyString)
              )
            );
            setHiddenMemberIds(nextHiddenMemberIds);
          } else {
            setHiddenMemberIds([]);
          }
        }
      } catch {}

      // 2) Load members from DB (profiles_feed with profiles fallback)
      try {
        setLoadingMembers(true);
        setMembersError(null);

        const hostFieldsSelect = ["can_host", "hosting_status", "max_guests"];

        const feedSelect = [
          "id",
          "display_name",
          "city",
          "country",
          "roles",
          "languages",
          "avatar_url",
          "verified",
          "verified_label",
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
          ...hostFieldsSelect,
        ].join(",");

        let rawRows: ProfileFeedRow[] = [];
        let loadedRows = false;
        let lastLoadError: unknown = null;
        let hostFieldsOnSource = false;

        let membersQuery = supabase.from("profiles_feed").select(feedSelect).limit(200);
        if (meId) membersQuery = membersQuery.neq("id", meId);
        const { data: feedData, error: feedError } = await membersQuery;
        if (!feedError) {
          rawRows = (feedData ?? []) as ProfileFeedRow[];
          loadedRows = true;
          hostFieldsOnSource = true;
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
                "created_at",
                "city",
                "country",
                "roles",
                "languages",
                "avatar_url",
                "verified",
                "verified_label",
                "dance_skills",
                "has_other_style",
                "connections_count",
                "interests",
                "availability",
                ...hostFieldsSelect,
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
            hostFieldsOnSource = true;
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
                "created_at",
                "city",
                "country",
                "roles",
                "languages",
                "avatar_url",
                "verified",
                "verified_label",
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
            hostFieldsOnSource = false;
          } else {
            lastLoadError = fallbackErrorLite;
          }
        }

        if (!loadedRows) {
          let fallbackQueryMinimal = supabase
            .from("profiles")
            .select("user_id,display_name,created_at,city,country,avatar_url,verified,verified_label")
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
            hostFieldsOnSource = false;
          } else {
            lastLoadError = fallbackErrorMinimal;
          }
        }

        if (!loadedRows) throw (lastLoadError ?? new Error("members_source_unavailable"));
        setHostColumnsAvailable(hostFieldsOnSource);

        const mapped: MemberCard[] = rawRows
          .filter((row) => row.is_test !== true)
          .filter((row) => String(row.id ?? row.user_id ?? "") !== (meId ?? ""))
          .reduce<MemberCard[]>((acc, row) => {
            const raw = row as ProfileFeedRow;
            const rawId = String(raw.id ?? raw.user_id ?? "");
            if (!rawId) return acc;

            const name = isNonEmptyString(raw.display_name) ? raw.display_name : "";
            const city = isNonEmptyString(raw.city) ? raw.city : "";
            const country = isNonEmptyString(raw.country) ? raw.country : "";

            const roles = Array.isArray(raw.roles) ? raw.roles.filter(isNonEmptyString) : [];
            const rawLangs = Array.isArray(raw.languages) ? raw.languages.filter(isNonEmptyString) : [];
            const langsCodes = rawLangs.map(langLabelToCode);

            const verified = raw.verified === true;
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
            const canHost = typeof raw.can_host === "boolean" ? raw.can_host : undefined;
            const hostingStatus = isNonEmptyString(raw.hosting_status) ? raw.hosting_status : undefined;
            const maxGuests = typeof raw.max_guests === "number" ? raw.max_guests : null;

            acc.push({
              id: rawId,
              name,
              city,
              country,
              memberSince: isNonEmptyString(raw.created_at) ? raw.created_at : null,
              verified,
              roles,
              danceSkills,
              otherStyle,
              langs: langsCodes,
              interest,
              availability,
              canHost,
              hostingStatus,
              maxGuests,
              photoUrl,

              connectionsCount: typeof raw.connections_count === "number" ? raw.connections_count : undefined,

              refTotalAll: typeof raw.ref_total_all === "number" ? raw.ref_total_all : 0,
              refMemberAll: typeof raw.ref_member_all === "number" ? raw.ref_member_all : 0,
              refTripAll: typeof raw.ref_trip_all === "number" ? raw.ref_trip_all : 0,
              refEventAll: typeof raw.ref_event_all === "number" ? raw.ref_event_all : 0,

              refTotalPositive: typeof raw.ref_total_positive === "number" ? raw.ref_total_positive : 0,
              refTotalNeutral: typeof raw.ref_total_neutral === "number" ? raw.ref_total_neutral : 0,
              refTotalNegative: typeof raw.ref_total_negative === "number" ? raw.ref_total_negative : 0,
            });

            return acc;
          }, []);

        const needsMemberSince = mapped.filter((row) => !row.memberSince).map((row) => row.id);
        if (needsMemberSince.length > 0) {
          const { data: createdRows, error: createdErr } = await supabase
            .from("profiles")
            .select("user_id,created_at")
            .in("user_id", needsMemberSince);
          if (!createdErr) {
            const createdAtByUserId: Record<string, string | null> = {};
            (createdRows ?? []).forEach((raw) => {
              const row = raw as { user_id?: string | null; created_at?: string | null };
              if (isNonEmptyString(row.user_id)) createdAtByUserId[row.user_id] = row.created_at ?? null;
            });
            mapped.forEach((row) => {
              if (!row.memberSince) row.memberSince = createdAtByUserId[row.id] ?? null;
            });
          }
        }

        setDbMembers(mapped);
      } catch (e: unknown) {
        setMembersError(errorMessage(e, "Failed to load members from database."));
        setDbMembers([]);
        setHostColumnsAvailable(false);
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
          .eq("status", "active")
          .gte("end_date", todayIso)
          .limit(200);
        const { data: tripRows, error: tripErr } = await tripsQuery;
        if (!tripErr) {
          const strictRows = (tripRows ?? []) as TripRow[];
          if (strictRows.length > 0) {
            trips = strictRows;
            loadedTrips = true;
          }
        } else {
          lastTripsError = tripErr;
        }

        if (!loadedTrips) {
          const tripsQueryFallback = supabase
            .from("trips")
            .select("id,user_id,status,destination_country,destination_city,start_date,end_date,purpose,created_at")
            .limit(200);
          const { data: fallbackRows, error: fallbackErr } = await tripsQueryFallback;
          if (!fallbackErr) {
            const broadRows = (fallbackRows ?? []) as TripRow[];
            if (broadRows.length > 0) {
              trips = broadRows;
              loadedTrips = true;
            }
          } else {
            lastTripsError = fallbackErr;
          }
        }

        if (!loadedTrips) {
          const tripsQueryLite = supabase
            .from("trips")
            .select("id,user_id,destination_country,destination_city,start_date,end_date,purpose,created_at")
            .limit(200);
          const { data: fallbackRowsLite, error: fallbackErrLite } = await tripsQueryLite;
          if (!fallbackErrLite) {
            const liteRows = (fallbackRowsLite ?? []) as TripRow[];
            if (liteRows.length > 0) {
              trips = liteRows;
              loadedTrips = true;
            }
          } else {
            lastTripsError = fallbackErrLite;
          }
        }

        if (!loadedTrips) {
          const travelPlansQuery = supabase
            .from("travel_plans")
            .select("id,user_id,destination_country,destination_city,start_date,end_date,purpose,created_at")
            .limit(200);
          const { data: planRows, error: planErr } = await travelPlansQuery;
          if (!planErr) {
            const planRowsSafe = (planRows ?? []) as TripRow[];
            if (planRowsSafe.length > 0) {
              trips = planRowsSafe;
              loadedTrips = true;
            }
          } else {
            lastTripsError = planErr;
          }
        }

        if (!loadedTrips) throw (lastTripsError ?? new Error("trips_source_unavailable"));

        const activeLikeStatuses = new Set(["active", "published", "open", "upcoming"]);
        trips = trips.filter((trip) => {
          const status = String(trip.status ?? "active").toLowerCase();
          if (trip.status && !activeLikeStatuses.has(status)) return false;
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
  }, [router]);

  // Country + City library (same as onboarding)
  const [countriesAll, setCountriesAll] = useState<CountryEntry[]>(() => getCachedCountriesAll());
  const [availableCities, setAvailableCities] = useState<string[]>([]);
  const countryNames = useMemo(() => countriesAll.map((c) => c.name), [countriesAll]);
  const countryIso = useMemo(() => countriesAll.find((c) => c.name === filters.country)?.isoCode ?? "", [countriesAll, filters.country]);
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

  useEffect(() => {
    let cancelled = false;

    if (countriesAll.length > 0) {
      return () => {
        cancelled = true;
      };
    }

    void getCountriesAll()
      .then((countries) => {
        if (cancelled) return;
        setCountriesAll(countries);
      })
      .catch(() => {
        if (cancelled) return;
        setCountriesAll([]);
      });

    return () => {
      cancelled = true;
    };
  }, [countriesAll.length]);

  useEffect(() => {
    let cancelled = false;

    if (!countryIso) {
      setAvailableCities([]);
      return () => {
        cancelled = true;
      };
    }

    const cachedCities = getCachedCitiesOfCountry(countryIso);
    if (cachedCities.length > 0) {
      setAvailableCities(cachedCities);
      return () => {
        cancelled = true;
      };
    }

    void getCitiesOfCountry(countryIso)
      .then((cities) => {
        if (cancelled) return;
        setAvailableCities(cities);
      })
      .catch(() => {
        if (cancelled) return;
        setAvailableCities([]);
      });

    return () => {
      cancelled = true;
    };
  }, [countryIso]);

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
    const memberSearchQuery = normalizeSearchText(memberSearch);

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
    if (hiddenMemberIds.length) list = list.filter((m) => !hiddenMemberIds.includes(m.id));

    if (filters.roles.length) {
      list = list.filter((m) => m.roles.some((r) => filters.roles.includes(r as Role)));
    }

    if (filters.references === "has") {
      list = list.filter((m) => Number(m.refTotalAll ?? 0) > 0);
    } else if (filters.references === "none") {
      list = list.filter((m) => Number(m.refTotalAll ?? 0) === 0);
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

    if (discoverMode === "hosts") {
      if (hostColumnsAvailable) {
        list = list.filter((m) => {
          if (!m.canHost) return false;
          if (m.maxGuests !== null && typeof m.maxGuests === "number" && m.maxGuests <= 0) return false;
          const status = (m.hostingStatus ?? "").trim().toLowerCase();
          if (!status) return true;
          return ["active", "available", "open", "enabled", "on"].includes(status);
        });
      } else {
        list = list.filter((m) => {
          const hasHostRole = m.roles.some((role) => ["Organizer", "Studio Owner", "Promoter"].includes(role));
          const availability = (m.availability ?? "").toLowerCase();
          const interest = (m.interest ?? "").toLowerCase();
          const hostSignal =
            availability.includes("travel") ||
            interest.includes("accommodation") ||
            interest.includes("organize") ||
            interest.includes("host");
          return hasHostRole || hostSignal;
        });
      }
    }

    if (memberSearchQuery) {
      const terms = memberSearchQuery.split(/\s+/).filter(Boolean);
      list = list.filter((m) => {
        const haystack = normalizeSearchText(m.name ?? "");
        return terms.every((term) => haystack.includes(term));
      });
    }

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
  }, [
    myCityOnly,
    myCity,
    myCountry,
    filters,
    dbMembers,
    hiddenMemberIds,
    sortMode,
    getMemberRecommendationMeta,
    discoverMode,
    hostColumnsAvailable,
    memberSearch,
  ]);

  useEffect(() => {
    const requestedHostId = (searchParams.get("request_host") ?? "").trim();
    if (!requestedHostId || loadingMembers) return;
    if (autoRequestedHostRef.current === requestedHostId) return;

    const host = dbMembers.find((member) => member.id === requestedHostId);
    if (!host) return;

    autoRequestedHostRef.current = requestedHostId;
    requestHostingAccess({
      targetUserId: host.id,
      targetName: host.name,
      targetPhotoUrl: host.photoUrl ?? null,
      targetMaxGuests: host.maxGuests ?? null,
      tripId: null,
    });
  }, [dbMembers, loadingMembers, requestHostingAccess, searchParams]);

  const filteredTrips = useMemo(() => {
    let list = tripCards.slice();

    if (myCityOnly) {
      if (!myCity) return [];
      const cityLower = myCity.toLowerCase();
      const countryLower = (myCountry ?? "").toLowerCase();
      list = list.filter((t) => {
        const sameCity = (t.destination_city ?? "").toLowerCase() === cityLower;
        if (!sameCity) return false;
        if (!countryLower) return true;
        return (t.destination_country ?? "").toLowerCase() === countryLower;
      });
    }

    if (filters.country) list = list.filter((t) => t.destination_country === filters.country);
    if (filters.cities.length) list = list.filter((t) => filters.cities.includes(t.destination_city));

    if (filters.roles.length) {
      list = list.filter((t) => (t.roles ?? []).some((r) => filters.roles.includes(r as Role)));
    }

    if (filters.references === "has") {
      list = list.filter((t) => getTripReferenceTotal(t) > 0);
    } else if (filters.references === "none") {
      list = list.filter((t) => getTripReferenceTotal(t) === 0);
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
    if (from || to) {
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
  }, [filters, tripCards, sortMode, getTripRecommendationMeta, myCityOnly, myCity, myCountry]);

  const totalMembersPages = Math.max(1, Math.ceil(members.length / DISCOVER_PAGE_SIZE));
  const totalTravellersPages = Math.max(1, Math.ceil(filteredTrips.length / DISCOVER_PAGE_SIZE));

  const paginatedMembers = useMemo(
    () => members.slice((membersPage - 1) * DISCOVER_PAGE_SIZE, membersPage * DISCOVER_PAGE_SIZE),
    [members, membersPage]
  );

  const paginatedTrips = useMemo(
    () => filteredTrips.slice((travellersPage - 1) * DISCOVER_PAGE_SIZE, travellersPage * DISCOVER_PAGE_SIZE),
    [filteredTrips, travellersPage]
  );

  const activeFiltersCount = useMemo(() => {
    let n = 0;
    if (filters.country) n += 1;
    if (filters.cities.length) n += 1;
    if (filters.roles.length) n += 1;
    if (filters.references) n += 1;
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

  useEffect(() => {
    setMembersPage(1);
  }, [
    tab,
    discoverMode,
    sortMode,
    myCityOnly,
    myCity,
    myCountry,
    filters.country,
    filters.cities,
    filters.roles,
    filters.references,
    filters.otherStyle,
    filters.interest,
    filters.availability,
    filters.verifiedOnly,
    filters.langs,
    filters.styleLevels,
    memberSearch,
    dbMembers.length,
  ]);

  useEffect(() => {
    setTravellersPage(1);
  }, [
    tab,
    sortMode,
    myCityOnly,
    myCity,
    myCountry,
    filters.country,
    filters.cities,
    filters.roles,
    filters.references,
    filters.tripPurpose,
    filters.tripDateFrom,
    filters.tripDateTo,
    filters.langs,
    tripCards.length,
  ]);

  useEffect(() => {
    if (membersPage > totalMembersPages) setMembersPage(totalMembersPages);
  }, [membersPage, totalMembersPages]);

  useEffect(() => {
    if (travellersPage > totalTravellersPages) setTravellersPage(totalTravellersPages);
  }, [travellersPage, totalTravellersPages]);

  const hostingMessageValidation = useMemo(
    () => validateSecureFreeText(hostingModal.message),
    [hostingModal.message]
  );
  const tripRequestMessageValidation = useMemo(
    () => validateTripRequestText(tripJoinModal.note),
    [tripJoinModal.note]
  );

  async function sendTripJoinRequest() {
    if (!tripJoinModal.tripId || !tripJoinModal.targetUserId) {
      setTripJoinError("Missing trip details.");
      return;
    }

    if (tripRequestMessageValidation) {
      setTripJoinError(tripRequestMessageValidation);
      return;
    }

    try {
      setTripRequestSending(true);
      setTripJoinError(null);

      const note = tripJoinModal.note.trim();
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token ?? "";
      if (!token) throw new Error("Missing auth session.");

      const response = await fetch("/api/trips/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tripId: tripJoinModal.tripId,
          note: note || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Failed to create trip request.");
      }

      closeTripJoinModal();
      setUiInfo("Trip request sent. Continue the request inside Messages.");
      router.replace("/messages?tab=requests");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to send trip request.";
      setTripJoinError(
        message.includes("Failed to fetch")
          ? "Network issue while sending request. Check your connection and retry."
          : message
      );
    } finally {
      setTripRequestSending(false);
    }
  }

  async function sendHostingRequest() {
    if (!hostingModal.targetUserId) {
      setHostingModalError("Missing target host/traveler.");
      return;
    }
    if (!hostingModal.arrivalDate || !hostingModal.departureDate) {
      setHostingModalError("Arrival and departure dates are required.");
      return;
    }
    if (hostingModal.departureDate < hostingModal.arrivalDate) {
      setHostingModalError("Departure must be after arrival.");
      return;
    }
    if (hostingModal.arrivalDate < new Date().toISOString().slice(0, 10)) {
      setHostingModalError("Arrival date must be today or later.");
      return;
    }
    if (hostingModal.travellersCount < 1 || hostingModal.travellersCount > 20) {
      setHostingModalError("Number of travellers must be between 1 and 20.");
      return;
    }

    const maxAllowedRaw = hostingModal.maxTravellersAllowed.trim();
    const hasMaxAllowed = maxAllowedRaw.length > 0;
    const parsedMaxAllowed = hasMaxAllowed ? Number(maxAllowedRaw) : Number.NaN;
    if (hostingModal.requestType === "offer_to_host" && !hasMaxAllowed) {
      setHostingModalError("Select how many travellers you can host.");
      return;
    }
    if (hasMaxAllowed && (!Number.isFinite(parsedMaxAllowed) || parsedMaxAllowed < 1 || parsedMaxAllowed > 20)) {
      setHostingModalError("Host capacity must be between 1 and 20 when provided.");
      return;
    }

    const messageValidationError = validateSecureFreeText(hostingModal.message);
    if (messageValidationError) {
      setHostingModalError(messageValidationError);
      return;
    }

    try {
      setHostingSending(true);
      setHostingModalError(null);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? "";
      if (!accessToken) throw new Error("Missing auth session token.");

      const response = await fetch("/api/hosting/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          recipientUserId: hostingModal.targetUserId,
          requestType: hostingModal.requestType,
          tripId: hostingModal.tripId,
          arrivalDate: hostingModal.arrivalDate,
          departureDate: hostingModal.departureDate,
          arrivalFlexible: hostingModal.arrivalFlexible,
          departureFlexible: hostingModal.departureFlexible,
          travellersCount: hostingModal.travellersCount,
          maxTravellersAllowed: hasMaxAllowed ? parsedMaxAllowed : null,
          message: hostingModal.message.trim() || null,
        }),
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Failed to send hosting request.");
      }

      closeHostingModal();
      setUiInfo(
        hostingModal.requestType === "offer_to_host"
          ? "Host offer sent. Continue the request inside Messages."
          : "Hosting request sent. Continue the request inside Messages."
      );
      router.replace("/messages?tab=requests");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to send hosting request.";
      setHostingModalError(
        message.includes("Failed to fetch")
          ? "Network issue while sending request. Check your connection and retry."
          : message
      );
    } finally {
      setHostingSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />

      <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">
        {uiInfo ? (
          <div className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-[#00F5FF]/35 bg-[#00F5FF]/10 p-3 text-sm text-[#B8FBFF]">
            <span>{uiInfo}</span>
            <button
              type="button"
              onClick={() => setUiInfo(null)}
              className="text-[#B8FBFF]/70 hover:text-[#B8FBFF]"
              aria-label="Dismiss"
            >
              <MSIcon name="close" className="text-[18px]" />
            </button>
          </div>
        ) : null}

        {uiError ? (
          <div className="mb-6 rounded-xl border border-[#FF00FF]/30 bg-[#FF00FF]/10 p-3 text-sm text-[#FFC6FA]">
            {uiError}
          </div>
        ) : null}

        {membersError ? (
          <div className="mb-6 rounded-xl border border-[#FF00FF]/30 bg-[#FF00FF]/10 p-3 text-sm text-[#FFC6FA]">
            {membersError}
          </div>
        ) : null}


        <section className="border-b border-white/6 pb-3 sm:pb-4">
          <div
            className="mx-auto grid w-full max-w-none grid-cols-3 gap-2 px-0 pb-1 sm:flex sm:max-w-[560px] sm:items-center sm:justify-center sm:gap-8 sm:overflow-visible sm:px-0 sm:pb-0"
            style={{ scrollbarWidth: "none" }}
          >
            <button
              onClick={() => {
                setTab("members");
                setDiscoverMode("dancers");
                router.replace("/connections?mode=dancers", { scroll: false });
              }}
            className={[
                "group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-4 text-[13px] sm:shrink-0 sm:w-auto sm:gap-2.5 sm:px-5 sm:text-[16px] font-semibold tracking-tight transition-all duration-200 hover:-translate-y-px",
                tab === "members" && discoverMode === "dancers"
                  ? "border border-[#00F5FF]/40 bg-[linear-gradient(135deg,rgba(0,255,255,0.14),rgba(255,255,255,0.06))] text-[#00F5FF] shadow-[0_0_16px_rgba(0,255,255,0.28)]"
                  : "text-white/70 hover:text-white/95",
              ].join(" ")}
            >
              <MSIcon
                name="person"
                className={[
                  "text-[18px] transition-opacity",
                  tab === "members" && discoverMode === "dancers" ? "opacity-100" : "opacity-80 group-hover:opacity-100",
                ].join(" ")}
              />
              {t("discover.dancers")}
            </button>
            <button
              onClick={() => {
                setTab("travellers");
                setDiscoverMode("travelers");
                router.replace("/connections?mode=travelers", { scroll: false });
              }}
              className={[
                "group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-4 text-[13px] sm:shrink-0 sm:w-auto sm:gap-2.5 sm:px-5 sm:text-[16px] font-semibold tracking-tight transition-all duration-200 hover:-translate-y-px",
                tab === "travellers"
                  ? "border border-[#00F5FF]/40 bg-[linear-gradient(135deg,rgba(0,255,255,0.14),rgba(255,255,255,0.06))] text-[#00F5FF] shadow-[0_0_16px_rgba(0,255,255,0.28)]"
                  : "text-white/70 hover:text-white/95",
              ].join(" ")}
            >
              <MSIcon
                name="flight"
                className={[
                  "text-[18px] transition-opacity",
                  tab === "travellers" ? "opacity-100" : "opacity-80 group-hover:opacity-100",
                ].join(" ")}
              />
              {t("discover.travelers")}
            </button>
            <button
              onClick={() => {
                setTab("members");
                setDiscoverMode("hosts");
                router.replace("/connections?mode=hosts", { scroll: false });
              }}
              className={[
                "group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-4 text-[13px] sm:shrink-0 sm:w-auto sm:gap-2.5 sm:px-5 sm:text-[16px] font-semibold tracking-tight transition-all duration-200 hover:-translate-y-px",
                tab === "members" && discoverMode === "hosts"
                  ? "border border-[#00F5FF]/40 bg-[linear-gradient(135deg,rgba(0,255,255,0.14),rgba(255,255,255,0.06))] text-[#00F5FF] shadow-[0_0_16px_rgba(0,255,255,0.28)]"
                  : "text-white/70 hover:text-white/95",
              ].join(" ")}
            >
              <MSIcon
                name="home"
                className={[
                  "text-[18px] transition-opacity",
                  tab === "members" && discoverMode === "hosts" ? "opacity-100" : "opacity-80 group-hover:opacity-100",
                ].join(" ")}
              />
              {t("discover.hosts")}
            </button>
          </div>
        </section>

        <div className="mt-6 flex flex-col gap-4 md:mt-8 md:flex-row md:items-center md:justify-between">
          <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center md:gap-6">
            <p className="text-white/50 text-sm">
              {t("discover.showing")} <span className="text-white font-semibold">{tab === "members" ? members.length : filteredTrips.length}</span>{" "}
              {tab === "members" ? (discoverMode === "hosts" ? "hosts" : "dancers") : "travelers"}
            </p>

            <div className="hidden md:flex md:flex-row md:items-center md:gap-3 md:border-l md:border-white/10 md:pl-6">
              <div className="relative">
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="appearance-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 pr-8 text-sm text-white/85 outline-none transition hover:border-white/25 focus:border-[#00F5FF]/50"
                >
                  <option value="recommended">Recommended</option>
                  <option value="newest">Newest</option>
                  <option value="name_az">Name A-Z</option>
                  <option value="city_az">City A-Z</option>
                  {tab === "members" ? <option value="connections_desc">Most Connections</option> : null}
                  {tab === "members" ? <option value="references_desc">Most References</option> : null}
                </select>
                <MSIcon name="expand_more" className="pointer-events-none absolute right-2.5 top-2.5 text-[16px] text-white/45" />
              </div>

              {tab === "members" || tab === "travellers" ? (
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

          <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center md:w-auto md:justify-end">
            {tab === "members" ? (
              <label className="relative w-full sm:flex-1 md:w-[240px] md:flex-none">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45">
                  <MSIcon name="search" className="text-[18px]" />
                </span>
                <input
                  type="search"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder={discoverMode === "hosts" ? "Search hosts by name" : "Search dancers by name"}
                  className="h-11 w-full rounded-full border border-white/10 bg-white/5 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/35 hover:border-white/20 focus:border-[#00F5FF]/45"
                />
              </label>
            ) : null}
            {tab === "travellers" ? (
              <div className="hidden md:block">
                <RangeDatePicker
                  start={filters.tripDateFrom}
                  end={filters.tripDateTo}
                  onChangeStart={(v) => setFilters((p) => ({ ...p, tripDateFrom: v }))}
                  onChangeEnd={(v) => setFilters((p) => ({ ...p, tripDateTo: v }))}
                />
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#00F5FF] px-6 py-2.5 text-sm font-bold text-[#0A0A0A] transition hover:opacity-90 sm:w-auto"
            >
              <span className="material-symbols-outlined text-[18px]">tune</span>
              {t("discover.filters")}{activeFiltersCount ? ` (${activeFiltersCount})` : ""}
            </button>
          </div>
        </div>

        {tab === "members" ? (
          <div className="relative mt-8">
            <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
              {loadingMembers ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={`sk-${i}`}
                    className="connections-card flex min-h-[360px] flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#121212] animate-pulse md:h-64 md:min-h-0 md:flex-row"
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
                paginatedMembers.map((m) => {
                const refMember = Number(m.refMemberAll ?? 0);
                const refTrip = Number(m.refTripAll ?? 0);
                const refEvent = Number(m.refEventAll ?? 0);
                const refTotal = Number(m.refTotalAll ?? 0) || refMember + refTrip + refEvent;
                const connectionsCount = Number(m.connectionsCount ?? 0);
                return (
                  <div
                    key={m.id}
                    className="connections-card overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#121212] transition-all duration-200 will-change-transform hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(13,242,242,0.14),0_16px_42px_rgba(0,245,255,0.06)]"
                  >
                    <div className="flex min-h-[196px] md:hidden">
                      <div className="relative w-[42%] shrink-0 border-r border-white/10">
                        <button
                          type="button"
                          onClick={() => router.push(`/profile/${encodeURIComponent(m.id)}`)}
                          className="h-full w-full overflow-hidden bg-white/5"
                          title="View profile"
                        >
                          <div
                            className="h-full w-full bg-cover bg-center"
                            style={
                              m.photoUrl
                                ? { backgroundImage: `url(${m.photoUrl})` }
                                : { backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))" }
                            }
                          />
                        </button>
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col justify-between p-3">
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <h3 className="truncate text-[18px] font-semibold tracking-tight text-white">{m.name}</h3>
                                {m.verified ? <VerifiedBadge size={16} /> : null}
                              </div>
                              <div className="mt-1 text-[13px] font-medium text-[#00F5FF]">
                                {m.city}
                                <span className="text-white/60">, {m.country}</span>
                              </div>
                            </div>

                            {connectionsCount > 0 ? (
                              <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/70">
                                <MSIcon name="group" className="text-[13px] text-[#00F5FF]" />
                                <span>{connectionsCount}</span>
                              </div>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium text-white/55">
                            <span className="inline-flex items-center gap-1">
                              <MSIcon name="workspace_premium" className="text-[13px] text-[#00F5FF]" />
                              <span className="text-white/80">{refTotal}</span>
                              refs
                            </span>
                            {refMember > 0 ? (
                              <span className="inline-flex items-center gap-1">
                                <MSIcon name="person" className="text-[13px] text-[#00F5FF]" />
                                <span className="text-white/80">{refMember}</span>
                              </span>
                            ) : null}
                            {refTrip > 0 ? (
                              <span className="inline-flex items-center gap-1">
                                <MSIcon name="flight" className="text-[13px] text-[#00F5FF]" />
                                <span className="text-white/80">{refTrip}</span>
                              </span>
                            ) : null}
                          </div>

                          {m.roles.length ? (
                            <div className="mt-0.5">
                              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
                                <MSIcon name="badge" className="text-[13px] text-[#00F5FF]" />
                                <span>Roles</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {m.roles.slice(0, 2).map((r) => (
                                  <span
                                    key={r}
                                    className="rounded-md border border-white/10 bg-white/5 px-2 py-[3px] text-[9px] font-medium text-white/75"
                                  >
                                    {r}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {Object.entries(m.danceSkills ?? {}).length || m.otherStyle ? (
                            <div className="mt-1">
                              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
                                <MSIcon name="person_play" className="text-[13px] text-[#00F5FF]" />
                                <span>Dance styles</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(m.danceSkills ?? {}).slice(0, 3).map(([style, lvl]) => (
                                  <span
                                    key={style}
                                    title={`Level: ${lvl}`}
                                    className="rounded-md border border-white/10 bg-white/5 px-2 py-[3px] text-[9px] font-medium uppercase tracking-wider text-white/60"
                                  >
                                    {style}
                                  </span>
                                ))}
                                {m.otherStyle ? (
                                  <span className="rounded-md border border-white/10 bg-white/5 px-2 py-[3px] text-[9px] font-medium uppercase tracking-wider text-white/60">
                                    Other
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                          {m.langs?.length ? (
                            <div className="mt-1 flex items-center gap-1.5">
                              <MSIcon name="public" className="text-[14px] text-[#00F5FF]" />
                              <div className="flex flex-wrap gap-1.5">
                                {m.langs.slice(0, 3).map((l) => (
                                  <div
                                    key={l}
                                    className="flex size-5 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[7px] font-bold text-white/70"
                                    title={l}
                                  >
                                    {l}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Link
                            href={`/profile/${encodeURIComponent(m.id)}`}
                            className="inline-flex min-h-[40px] items-center justify-center rounded-full border border-white/10 px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-widest transition-colors hover:bg-white/5"
                            title="View profile"
                          >
                            View
                          </Link>
                          {discoverMode === "hosts" ? (
                            <button
                              className="flex min-h-[40px] items-center justify-center whitespace-nowrap rounded-full px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0A0A0A]"
                              style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#ff00ff)" }}
                              onClick={() => {
                                requestHostingAccess({
                                  targetUserId: m.id,
                                  targetName: m.name,
                                  targetPhotoUrl: m.photoUrl ?? null,
                                  targetMaxGuests: m.maxGuests ?? null,
                                  tripId: null,
                                });
                              }}
                            >
                              Request Hosting
                            </button>
                          ) : (
                            <button
                              className="flex min-h-[40px] items-center justify-center gap-2 rounded-full px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-[#0A0A0A]"
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
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="hidden md:flex md:h-64 md:min-h-0 md:flex-row">
                      <div className="relative h-full w-1/2">
                        <div
                          className="h-full w-full bg-cover bg-center"
                          style={
                            m.photoUrl
                              ? { backgroundImage: `url(${m.photoUrl})` }
                              : { backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))" }
                          }
                        />
                      </div>

                      <div className="flex h-full w-1/2 flex-col justify-between p-4">
                        <div className="min-h-0">
                          <div className="relative">
                            {connectionsCount > 0 ? (
                              <div className="absolute right-0 top-0 flex items-center gap-1 text-[12px] font-semibold text-white/40">
                                <MSIcon name="group" className="icon-sm text-[#00F5FF]" />
                                <span>{connectionsCount}</span>
                              </div>
                            ) : null}

                            <div className="mb-2 flex items-center gap-1.5">
                              <h3 className="text-[20px] font-normal tracking-tight">{m.name}</h3>
                              {m.verified ? <VerifiedBadge size={16} /> : null}
                            </div>

                            <div className="mb-3 flex items-baseline gap-2">
                              <span className="text-[15px] font-medium leading-none text-[#00F5FF]">{m.city}</span>
                              <span className="text-[15px] font-medium leading-none text-white/65">, {m.country}</span>
                            </div>

                            <div className="mb-3 flex items-center gap-3 text-[11px] font-medium text-white/45">
                              <div className="flex items-center gap-1.5 whitespace-nowrap">
                                <MSIcon name="workspace_premium" className="icon-xs text-[#00F5FF]" />
                                <span className="font-medium text-white/70">{refTotal}</span>
                                <span>References</span>
                              </div>

                              {refMember > 0 ? (
                                <div className="flex items-center gap-1.5">
                                  <MSIcon name="person" className="icon-xs text-[#00F5FF]" />
                                  <span className="font-medium text-white/70">{refMember}</span>
                                </div>
                              ) : null}

                              {refTrip > 0 ? (
                                <div className="flex items-center gap-1.5">
                                  <MSIcon name="flight" className="icon-xs text-[#00F5FF]" />
                                  <span className="font-medium text-white/70">{refTrip}</span>
                                </div>
                              ) : null}

                              {refEvent > 0 ? (
                                <div className="flex items-center gap-1.5">
                                  <MSIcon name="event_available" className="icon-xs text-[#00F5FF]" />
                                  <span className="font-medium text-white/70">{refEvent}</span>
                                </div>
                              ) : null}
                            </div>

                            <div className="mb-2.5 space-y-1">
                              <div className="flex items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                                <MSIcon name="badge" className="icon-sm text-[#00F5FF]" />
                                <div className="flex gap-1.5">
                                  {m.roles.map((r) => (
                                    <span
                                      key={r}
                                      className="whitespace-nowrap rounded-md border border-white/10 bg-white/5 px-2 py-[3px] text-[9px] font-medium text-white/70"
                                    >
                                      {r}
                                    </span>
                                  ))}
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <MSIcon name="person_play" className="icon-sm text-[#00F5FF]" />
                                <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                                  {Object.entries(m.danceSkills ?? {}).map(([style, lvl]) => (
                                    <span
                                      key={style}
                                      title={`Level: ${lvl}`}
                                      className="whitespace-nowrap rounded-md border border-white/10 bg-white/5 px-2 py-[3px] text-[9px] font-medium uppercase tracking-wider text-white/55"
                                    >
                                      {style}
                                    </span>
                                  ))}

                                  {m.otherStyle ? (
                                    <span
                                      className="whitespace-nowrap rounded-md border border-white/10 bg-white/5 px-2 py-[3px] text-[9px] font-medium uppercase tracking-wider text-white/55"
                                      title="Other style"
                                    >
                                      Other
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              {m.langs?.length ? (
                                <div className="flex items-center gap-1.5">
                                  <MSIcon name="public" className="icon-sm text-[#00F5FF]" />
                                  <div className="flex flex-wrap gap-1.5">
                                    {m.langs.slice(0, 3).map((l) => (
                                      <div
                                        key={l}
                                        className="flex size-5 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[7px] font-bold text-white/70"
                                        title={l}
                                      >
                                        {l}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="pt-3">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/profile/${encodeURIComponent(m.id)}`}
                              className="inline-flex min-h-[42px] flex-1 items-center justify-center whitespace-nowrap rounded-full border border-white/10 px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-widest transition-colors hover:bg-white/5"
                              title="View profile"
                            >
                              View
                            </Link>
                            {discoverMode === "hosts" ? (
                              <button
                                className="flex min-h-[42px] flex-1 items-center justify-center whitespace-nowrap rounded-full px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0A0A0A]"
                                style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#ff00ff)" }}
                                onClick={() => {
                                  requestHostingAccess({
                                    targetUserId: m.id,
                                    targetName: m.name,
                                    targetPhotoUrl: m.photoUrl ?? null,
                                    targetMaxGuests: m.maxGuests ?? null,
                                    tripId: null,
                                  });
                                }}
                              >
                                Request Hosting
                              </button>
                            ) : (
                              <button
                                className="flex min-h-[42px] flex-[1.5] items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[11px] font-semibold uppercase tracking-widest text-[#0A0A0A]"
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
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
              )}

              {!members.length ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/60 lg:col-span-2">
                  {memberSearch.trim()
                    ? `No ${discoverMode === "hosts" ? "hosts" : "dancers"} match "${memberSearch.trim()}".`
                    : "No matches with these filters."}
                </div>
              ) : null}
            </div>

            <PaginationControls
              page={membersPage}
              totalPages={totalMembersPages}
              totalItems={members.length}
              pageSize={DISCOVER_PAGE_SIZE}
              itemLabel={discoverMode === "hosts" ? "hosts" : "dancers"}
              onPageChange={setMembersPage}
            />

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
              <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={`trip-sk-${i}`}
                    className="connections-card relative overflow-hidden border border-white/10 rounded-3xl bg-[#121212] flex flex-col md:flex-row h-auto md:h-[236px] animate-pulse"
                  >
                    <div className="relative w-full md:w-1/2 h-36 md:h-full bg-white/5" />
                    <div className="flex w-full md:w-1/2 flex-col bg-[#121212] px-3 pt-3 pb-4 md:px-4 md:pt-3 md:pb-4">
                      <div className="mb-3 flex items-center gap-3">
                        <div className="h-11 w-11 rounded-lg bg-white/10" />
                        <div className="space-y-2">
                          <div className="h-3 w-24 rounded bg-white/10" />
                          <div className="h-5 w-36 rounded bg-white/10" />
                        </div>
                      </div>
                      <div className="flex items-start gap-3 rounded-2xl p-1.5">
                        <div className="h-[72px] w-[72px] shrink-0 rounded-[14px] bg-white/10" />
                        <div className="min-w-0 flex-1 space-y-2 pt-1">
                          <div className="h-5 w-32 rounded bg-white/10" />
                          <div className="h-4 w-24 rounded bg-white/10" />
                          <div className="flex gap-1">
                            <div className="h-5 w-5 rounded-full bg-white/10" />
                            <div className="h-5 w-5 rounded-full bg-white/10" />
                            <div className="h-5 w-5 rounded-full bg-white/10" />
                          </div>
                        </div>
                      </div>
                      <div className="mt-1 space-y-2">
                        <div className="h-4 w-40 rounded bg-white/10" />
                        <div className="flex gap-2">
                          <div className="h-6 w-24 rounded-md bg-white/10" />
                          <div className="h-6 w-20 rounded-md bg-white/10" />
                          <div className="h-6 w-16 rounded-md bg-white/10" />
                        </div>
                        <div className="flex gap-2">
                          <div className="h-5 w-8 rounded-full bg-white/10" />
                          <div className="h-5 w-8 rounded-full bg-white/10" />
                        </div>
                      </div>
                      <div className="mt-auto pt-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="h-[38px] rounded-full bg-white/10" />
                          <div className="h-[38px] rounded-full bg-white/10" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredTrips.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/60">
                No trips match these filters.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
                {paginatedTrips.map((t) => {
                  const heroUrl = getTripHeroStorageUrl(t.destination_country);
                  const heroStorageFallback = getTripHeroStorageFolderUrl(t.destination_country);
                  const heroFallback = getTripHeroFallbackUrl(t.destination_city, t.destination_country);
                  const purposeMeta = getPurposeMeta(t.purpose);

                  return (
                    <div
                      key={t.id}
                      className="connections-card relative border border-white/10 rounded-3xl bg-[#121212] overflow-hidden flex flex-col md:flex-row h-auto md:h-[236px] transition-all duration-200 will-change-transform hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(13,242,242,0.14),0_16px_42px_rgba(0,245,255,0.06)]"
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
                          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-md border border-white/10 shadow-lg">
                            <MSIcon name="calendar_month" className="text-[#0dccf2] text-[18px]" />
                            <span className="text-white text-[12px] md:text-[13px] font-bold tracking-wide uppercase">
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

                      <div className="relative z-10 flex w-full flex-col gap-0.5 bg-[#121212] px-3 pb-4 pt-3 md:w-1/2 md:px-4 md:pb-4 md:pt-3">
                        <div className="md:hidden">
                          <div className="flex items-start justify-between gap-3">
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
                              className="group min-w-0 flex-1 rounded-2xl text-left"
                            >
                              <div className="flex items-start gap-3">
                                <div className="relative shrink-0">
                                  <div className="absolute -inset-2 rounded-[14px] bg-[#d946ef]/20 blur-md" />
                                  <div
                                    className="relative h-[68px] w-[68px] rounded-[14px] bg-cover bg-center ring-1 ring-white/10"
                                    style={{
                                      backgroundImage: t.avatar_url
                                        ? `url(${t.avatar_url})`
                                        : "linear-gradient(135deg, rgba(13,204,242,0.35), rgba(217,70,239,0.35))",
                                    }}
                                  />
                                </div>
                                <div className="min-w-0">
                                  <span className="truncate text-base font-bold tracking-tight text-white">{t.display_name}</span>
                                  <span className="flex items-center gap-1 text-[12px] font-bold text-[#0dccf2] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#67F7FF]">
                                    View profile
                                    <MSIcon name="arrow_forward" className="text-[12px] transition-transform duration-200 group-hover:translate-x-0.5" />
                                  </span>
                                  {t.languages?.length ? (
                                    <div className="mt-1 flex min-w-0 items-center gap-1">
                                      <MSIcon name="public" className="icon-xs text-[#00F5FF]" />
                                      <ScrollRow ariaLabelLeft="Scroll languages left" ariaLabelRight="Scroll languages right">
                                        {t.languages.map((l) => {
                                          const code = langLabelToCode(l);
                                          return (
                                            <span
                                              key={l}
                                              className="flex size-5 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[7px] font-bold text-white/70"
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
                            </div>

                            <div className={`shrink-0 rounded-2xl border px-3 py-2 ${purposeMeta.bg} ${purposeMeta.border}`}>
                              <div className="flex items-center gap-2">
                                <MSIcon name={purposeMeta.icon} className={`${purposeMeta.text} text-[16px]`} />
                                <div className="flex flex-col">
                                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Purpose</span>
                                  <span className={`text-[13px] font-semibold ${purposeMeta.text}`}>{t.purpose ?? "Trip"}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="mt-2 flex min-w-0 items-center gap-0.5">
                            <MSIcon name="badge" className="icon-sm text-[#00F5FF]" />
                            <ScrollRow ariaLabelLeft="Scroll roles left" ariaLabelRight="Scroll roles right">
                              {(t.roles?.length ? t.roles : ["Traveller"]).map((role) => (
                                <span
                                  key={role}
                                  className="shrink-0 whitespace-nowrap px-2 py-[2px] text-[8px] font-medium uppercase tracking-[0.14em] text-white/70"
                                >
                                  {role}
                                </span>
                              ))}
                            </ScrollRow>
                          </div>
                        </div>

                        <div className="hidden md:block">
                          <div className="mb-0 flex items-center gap-3">
                            <div className={`rounded-lg border p-2 ${purposeMeta.bg} ${purposeMeta.border}`}>
                              <MSIcon name={purposeMeta.icon} className={`${purposeMeta.text} text-[18px]`} />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs font-bold uppercase tracking-wider text-white/40">
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
                            className="group w-full rounded-2xl p-1.5 text-left"
                          >
                            <div className="flex items-start gap-3">
                              <div className="relative shrink-0">
                                <div className="absolute -inset-2 rounded-[14px] bg-[#d946ef]/20 blur-md" />
                                <div
                                  className="relative h-[72px] w-[72px] rounded-[14px] bg-cover bg-center ring-1 ring-white/10"
                                  style={{
                                    backgroundImage: t.avatar_url
                                      ? `url(${t.avatar_url})`
                                      : "linear-gradient(135deg, rgba(13,204,242,0.35), rgba(217,70,239,0.35))",
                                  }}
                                />
                              </div>
                              <div className="flex min-w-0 flex-col">
                                <span className="truncate text-base font-bold tracking-tight text-white">
                                  {t.display_name}
                                </span>
                                <span className="flex items-center gap-1 text-[12px] font-bold text-[#0dccf2] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#67F7FF]">
                                  View profile
                                  <MSIcon name="arrow_forward" className="text-[12px] transition-transform duration-200 group-hover:translate-x-0.5" />
                                </span>
                                {t.languages?.length ? (
                                  <div className="mt-0.5 flex min-w-0 items-center gap-0.5">
                                    <MSIcon name="public" className="icon-xs text-[#00F5FF]" />
                                    <ScrollRow ariaLabelLeft="Scroll languages left" ariaLabelRight="Scroll languages right">
                                      {t.languages.map((l) => {
                                        const code = langLabelToCode(l);
                                        return (
                                          <span
                                            key={l}
                                            className="flex size-5 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[7px] font-bold text-white/70"
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
                              <div className="flex min-w-0 items-center gap-0.5">
                                <MSIcon name="badge" className="icon-sm text-[#00F5FF]" />
                                <ScrollRow ariaLabelLeft="Scroll roles left" ariaLabelRight="Scroll roles right">
                                  {(t.roles?.length ? t.roles : ["Traveller"]).map((role) => (
                                    <span
                                      key={role}
                                      className="shrink-0 whitespace-nowrap px-2 py-[2px] text-[8px] font-medium uppercase tracking-[0.14em] text-white/70"
                                    >
                                      {role}
                                    </span>
                                  ))}
                                </ScrollRow>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() =>
                              openTripJoinModal({
                                targetUserId: t.user_id,
                                targetName: t.display_name,
                                targetPhotoUrl: t.avatar_url ?? null,
                                tripId: t.id,
                                destinationCity: t.destination_city,
                                destinationCountry: t.destination_country,
                                startDate: t.start_date,
                                endDate: t.end_date,
                              })
                            }
                            className="flex min-h-[38px] w-full items-center justify-center gap-2 rounded-full border border-[#00F5FF]/35 bg-[#00F5FF]/12 px-4 py-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#B8FBFF] transition hover:border-[#00F5FF]/55 hover:bg-[#00F5FF]/18 hover:text-white"
                          >
                            <MSIcon name="group_add" className="text-[13px] text-[#00F5FF]" />
                            Join Trip
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openHostingRequest({
                                targetUserId: t.user_id,
                                targetName: t.display_name,
                                targetPhotoUrl: t.avatar_url ?? null,
                                requestType: "offer_to_host",
                                tripId: t.id,
                                prefillArrivalDate: t.start_date,
                                prefillDepartureDate: t.end_date,
                              })
                            }
                            className="w-full min-h-[38px] whitespace-nowrap rounded-full border border-[#FF00FF]/30 bg-[#FF00FF]/10 px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#FFC6FA] transition hover:border-[#FF00FF]/50 hover:bg-[#FF00FF]/16 hover:text-white"
                          >
                            Offer to Host
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <PaginationControls
              page={travellersPage}
              totalPages={totalTravellersPages}
              totalItems={filteredTrips.length}
              pageSize={DISCOVER_PAGE_SIZE}
              itemLabel="travelers"
              onPageChange={setTravellersPage}
            />
          </div>
        )}
      </main>

      {filtersOpen ? (
        <div className="fixed inset-0 z-[60]">
          <button aria-label="Close filters" className="absolute inset-0 bg-black/60" onClick={() => setFiltersOpen(false)} type="button" />

          <aside className="absolute right-0 top-0 h-full w-full max-w-md border-l border-white/10 bg-[#0A0A0A] shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <h2 className="text-2xl font-bold tracking-tight text-white">
                {filtersTitle}
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
              <section className="space-y-4 md:hidden">
                <div className="flex items-center gap-2 text-[#00F5FF]">
                  <MSIcon name="tune" className="text-[20px]" />
                  <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">View</h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-semibold text-white/90">Sort by</label>
                    <div className="relative mt-2">
                      <select
                        value={sortMode}
                        onChange={(e) => setSortMode(e.target.value as SortMode)}
                        className="w-full appearance-none rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/90 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                      >
                        <option value="recommended">Recommended</option>
                        <option value="newest">Newest</option>
                        <option value="name_az">Name A-Z</option>
                        <option value="city_az">City A-Z</option>
                        {tab === "members" ? <option value="connections_desc">Most Connections</option> : null}
                        {tab === "members" ? <option value="references_desc">Most References</option> : null}
                      </select>
                      <MSIcon name="expand_more" className="pointer-events-none absolute right-3 top-3 text-[20px] text-white/40" />
                    </div>
                  </div>
                  {tab === "members" || tab === "travellers" ? (
                    <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-4">
                      <span>
                        <span className="block text-xs font-bold uppercase tracking-wider text-white/75">My City</span>
                        <span className="mt-0.5 block text-[11px] text-white/45">
                          {myCity ? `Only show ${myCity}` : "Set your city in profile first"}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={myCityOnly}
                        onChange={(e) => setMyCityOnly(e.target.checked)}
                        disabled={!myCity}
                        className="h-5 w-5 rounded border-white/20 bg-transparent accent-[#00F5FF]"
                      />
                    </label>
                  ) : null}
                </div>
                {tab === "travellers" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-sm font-semibold text-white/90">Trip from</label>
                      <input
                        type="date"
                        value={filters.tripDateFrom ?? ""}
                        onChange={(e) => setFilters((p) => ({ ...p, tripDateFrom: e.target.value || undefined }))}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/90 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-white/90">Trip to</label>
                      <input
                        type="date"
                        value={filters.tripDateTo ?? ""}
                        onChange={(e) => setFilters((p) => ({ ...p, tripDateTo: e.target.value || undefined }))}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/90 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                      />
                    </div>
                  </div>
                ) : null}
              </section>

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

              <section className="space-y-4">
                <div className="flex items-center gap-2 text-[#00F5FF]">
                  <MSIcon name="verified" className="text-[20px]" />
                  <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">References</h3>
                </div>
                <p className="text-[11px] text-white/45">Filter by whether a member or traveller already has reference history.</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: "all", label: "All" },
                    { key: "has", label: "Has references" },
                    { key: "none", label: "No references" },
                  ].map((option) => {
                    const selected =
                      option.key === "all"
                        ? !filters.references
                        : filters.references === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() =>
                          setFilters((p) => ({
                            ...p,
                            references: option.key === "all" ? undefined : (option.key as "has" | "none"),
                          }))
                        }
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                          selected
                            ? "border-[#00F5FF] bg-[#00F5FF]/15 text-[#00F5FF]"
                            : "border-white/10 bg-white/5 text-white/60 hover:border-white/30"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
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
                <section className="border-t border-white/10 pt-6 space-y-4">
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
                {filtersApplyLabel}
              </button>
            </div>
          </aside>
        </div>
      ) : null}
      {tab === "members" || tab === "travellers" ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 h-28 bg-gradient-to-b from-transparent to-[#0A0A0A]" />
      ) : null}

{connectModal.open && (
  <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 px-3 py-3 backdrop-blur-md sm:items-center">
    <div className="relative w-full max-w-[480px] overflow-hidden rounded-[28px] border border-white/8 bg-[#080e14] shadow-[0_32px_80px_rgba(0,0,0,0.5)] sm:rounded-[32px]"
      style={{ background: "radial-gradient(circle at top left, rgba(13,204,242,0.07), transparent 40%), radial-gradient(circle at bottom right, rgba(217,59,255,0.07), transparent 40%), #080e14" }}
    >
      {/* Close */}
      <button
        type="button"
        onClick={closeConnectModal}
        className="absolute top-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/50 hover:text-white transition"
        aria-label="Close"
      >
        <MSIcon name="close" className="text-[18px]" />
      </button>

      {/* Header */}
      <div className="flex items-center gap-4 px-6 pt-6 pb-5 border-b border-white/8">
        <div className="shrink-0">
          <div className="h-14 w-14 rounded-2xl overflow-hidden border border-white/10"
            style={{
              backgroundImage: connectModal.targetPhotoUrl
                ? `url(${connectModal.targetPhotoUrl})`
                : "linear-gradient(135deg, rgba(13,204,242,0.3), rgba(217,59,255,0.3))",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Connect with</p>
          <h3 className="truncate text-lg font-extrabold tracking-tight text-white">{connectModal.targetName}</h3>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        {/* Pending request warning */}
        {pendingWarning && (
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs text-amber-200">
            <span className="material-symbols-outlined text-[16px] text-amber-400 shrink-0">warning</span>
            <span>{pendingWarning}</span>
          </div>
        )}

        {/* Usage counter */}
        {connectRequestsLimit !== null && connectRequestsUsed !== null && (
          <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2.5 text-xs">
            <span className="text-white/40">Requests this month</span>
            <span className={
              connectRequestsUsed >= connectRequestsLimit
                ? "font-bold text-rose-400"
                : connectRequestsUsed >= connectRequestsLimit * 0.8
                  ? "font-bold text-amber-400"
                  : "font-semibold text-[#0df2f2]"
            }>
              {connectRequestsUsed} / {connectRequestsLimit}
            </span>
          </div>
        )}

        {/* Reason — menu with optional search */}
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Reason to connect</label>
          <div className="relative mt-2">
            <span className="material-symbols-outlined pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[17px] text-white/25">search</span>
            <input
              value={connectReasonQuery}
              onChange={(e) => {
                setConnectReasonQuery(e.target.value);
                setSelectedReason(null);
              }}
              placeholder="Filter reasons..."
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] pl-10 pr-4 py-2.5 text-sm text-white outline-none focus:border-[#0df2f2]/40 focus:bg-white/[0.06] transition"
            />
          </div>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-[#0b1219]">
            {visibleConnectReasons.length === 0 ? (
              <p className="px-4 py-3 text-sm text-white/40">No matches</p>
            ) : (
              visibleConnectReasons.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setSelectedReason(r.id);
                    setConnectReasonQuery("");
                  }}
                  className={`w-full px-4 py-2.5 text-left text-sm transition flex items-center justify-between gap-3 ${
                    selectedReason === r.id
                      ? "bg-[#0df2f2]/10 text-[#0df2f2]"
                      : "text-white/80 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <span>{r.label}</span>
                  <span className="shrink-0 text-[11px] text-white/30">{r.role}</span>
                </button>
              ))
            )}
          </div>
        </div>

          {/* Error */}
          {connectModalError && (
            <div className="flex items-center gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs text-amber-200">
              <span className="material-symbols-outlined text-[16px] text-amber-400 shrink-0">warning</span>
              <span>{connectModalError}</span>
            </div>
          )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 border-t border-white/8 px-6 py-5">
        <button
          type="button"
          disabled={!selectedReason || sendingRequest}
	          onClick={async () => {
	            const targetId = connectModal.targetUserId;
	            const reasonId = selectedReason;
	            const role = selectedReasonObj?.role ?? selectedRole;
	            const connectContext = connectModal.connectContext ?? "member";
	            const tripId = connectModal.tripId ?? null;
	            const requestsRedirect = "/messages?tab=requests";

            if (!targetId || !reasonId || !role) return;

            try {
              setSendingRequest(true);
              setConnectModalError(null);

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
		                if (existing.status === "accepted" && existing.id) {
		                  closeConnectModal();
		                  router.push(`/messages/${existing.id}`);
		                  return;
		                }
		                throw new Error("There is already a pending connection request with this member. Open Requests in Messages to continue.");
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
	              closeConnectModal();
	              router.push(requestsRedirect);
	            } catch (e) {
              const message = e instanceof Error ? e.message : "Failed to send request.";
              setConnectModalError(
                message.includes("Failed to fetch")
                  ? "Network issue while sending request. Check your connection and retry."
                  : message
              );
            } finally {
              setSendingRequest(false);
            }
          }}
          className="w-full h-13 rounded-2xl font-bold text-sm text-[#040a0f] disabled:opacity-40 transition hover:brightness-110"
          style={{ backgroundImage: "linear-gradient(90deg,#0df2f2 0%, #ff00ff 100%)" }}
        >
          {sendingRequest ? "Sending…" : "Send Request"}
        </button>

        <button
          type="button"
          onClick={closeConnectModal}
          className="w-full h-10 rounded-2xl border border-white/8 text-white/40 text-sm font-medium hover:text-white/70 hover:border-white/15 transition"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
)}

      {tripJoinModal.open ? (
        <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/70 px-3 py-3 backdrop-blur-md sm:items-center sm:px-4 sm:py-4">
          <div className="relative flex w-full max-w-[620px] flex-col overflow-hidden rounded-[28px] border border-[#00F5FF]/20 bg-[#121212] shadow-2xl" style={{ maxHeight: "calc(100dvh - 1.5rem)" }}>
            <button
              type="button"
              onClick={closeTripJoinModal}
              className="absolute right-5 top-5 z-10 text-white/50 transition hover:text-white"
              aria-label="Close trip request modal"
            >
              <MSIcon name="close" className="text-[22px]" />
            </button>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-6 pb-0 sm:p-8 sm:pb-0">
              <div className="mb-6 flex items-center gap-4">
                <div
                  className="h-14 w-14 shrink-0 rounded-2xl border border-[#00F5FF]/45 bg-cover bg-center"
                  style={{
                    backgroundImage: tripJoinModal.targetPhotoUrl
                      ? `url(${tripJoinModal.targetPhotoUrl})`
                      : "linear-gradient(135deg, rgba(13,204,242,0.35), rgba(217,70,239,0.35))",
                  }}
                />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#00F5FF]">Join Trip</p>
                  <h3 className="truncate text-[23px] font-extrabold tracking-tight text-white">
                    {tripJoinModal.targetName}
                  </h3>
                </div>
              </div>

              {/* Pending warning */}
              {tripJoinWarning && (
                <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs text-amber-200">
                  <span className="material-symbols-outlined text-[16px] text-amber-400 shrink-0">warning</span>
                  <span>{tripJoinWarning}</span>
                </div>
              )}

              {/* Error */}
              {tripJoinError && (
                <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-xs text-rose-200">
                  <span className="material-symbols-outlined text-[16px] text-rose-400 shrink-0">error</span>
                  <span>{tripJoinError}</span>
                </div>
              )}

              <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">{tripJoinModal.destinationCity || "Trip"}</span>
                  {tripJoinModal.destinationCountry ? <span className="text-white/45">• {tripJoinModal.destinationCountry}</span> : null}
                  {tripJoinModal.startDate && tripJoinModal.endDate ? (
                    <span className="text-white/45">
                      • {formatDateCompact(tripJoinModal.startDate)} - {formatDateCompact(tripJoinModal.endDate)}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-2 text-sm font-semibold text-white">Optional note</div>
                <p className="mb-3 text-xs text-white/50">Keep it short. Explain why you want to join or any relevant coordination detail.</p>
                <textarea
                  value={tripJoinModal.note}
                  onChange={(event) => setTripJoinModal((prev) => ({ ...prev, note: event.target.value }))}
                  maxLength={500}
                  rows={4}
                  placeholder="Add context for your trip request."
                  className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                />
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className={tripRequestMessageValidation ? "text-[#FFC6FA]" : "text-white/45"}>
                    No links, emails, social handles, or phone numbers.
                  </span>
                  <span className={tripJoinModal.note.length > 480 ? "text-amber-200" : "text-white/45"}>
                    {tripJoinModal.note.length}/500
                  </span>
                </div>
                {tripRequestMessageValidation ? (
                  <p className="mt-1 text-xs text-[#FFC6FA]">{tripRequestMessageValidation}</p>
                ) : null}
              </div>
            </div>

            {/* Fixed footer buttons */}
            <div className="shrink-0 border-t border-white/8 px-6 py-4 sm:px-8">
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
                <button
                  type="button"
                  onClick={closeTripJoinModal}
                  className="h-12 rounded-full border border-white/20 px-5 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={tripRequestSending || Boolean(tripRequestMessageValidation)}
                  onClick={sendTripJoinRequest}
                  className="h-12 rounded-full px-5 text-sm font-black uppercase tracking-wide text-[#0A0A0A] disabled:opacity-45"
                  style={{ backgroundImage: "linear-gradient(90deg,#00F5FF 0%, #FF00FF 100%)" }}
                >
                  {tripRequestSending ? "Sending…" : "Send trip request"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {hostingModal.open ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-md sm:items-center">
          <div className="relative max-h-[calc(100dvh-1rem)] w-full max-w-[640px] overflow-y-auto overscroll-contain rounded-[28px] border border-[#00F5FF]/20 bg-[#121212] p-6 shadow-2xl sm:max-h-[min(92dvh,900px)] sm:p-8">
            <button
              type="button"
              onClick={closeHostingModal}
              className="absolute right-5 top-5 text-white/50 transition hover:text-white"
              aria-label="Close hosting request modal"
            >
              <MSIcon name="close" className="text-[22px]" />
            </button>

            <div className="mb-6 flex items-center gap-4">
              <div
                className="h-14 w-14 rounded-2xl border border-[#00F5FF]/45 bg-cover bg-center"
                style={{
                  backgroundImage: hostingModal.targetPhotoUrl
                    ? `url(${hostingModal.targetPhotoUrl})`
                    : "linear-gradient(135deg, rgba(13,204,242,0.35), rgba(217,70,239,0.35))",
                }}
              />
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#00F5FF]">
                  {hostingModal.requestType === "offer_to_host" ? "Offer to Host" : "Request Hosting"}
                </p>
                <h3 className="truncate text-[23px] font-extrabold tracking-tight text-white">
                  {hostingModal.targetName}
                </h3>
              </div>
            </div>

            {/* Pending warning */}
            {hostingModalWarning && (
              <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs text-amber-200">
                <span className="material-symbols-outlined text-[16px] text-amber-400 shrink-0">warning</span>
                <span>{hostingModalWarning}</span>
              </div>
            )}

            {/* Error */}
            {hostingModalError && (
              <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-xs text-rose-200">
                <span className="material-symbols-outlined text-[16px] text-rose-400 shrink-0">error</span>
                <span>{hostingModalError}</span>
              </div>
            )}

            {hostingModal.requestType === "offer_to_host" && hostingOffersLimit !== null && hostingOffersUsed !== null && (
              <div className="mb-4 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs">
                <span className="text-white/50">Hosting offers this month</span>
                <span className={
                  hostingOffersUsed >= hostingOffersLimit
                    ? "font-bold text-rose-400"
                    : hostingOffersUsed >= hostingOffersLimit * 0.8
                      ? "font-bold text-amber-400"
                      : "font-semibold text-white"
                }>
                  {hostingOffersUsed} / {hostingOffersLimit}
                </span>
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              {hostingModal.requestType === "offer_to_host" ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[#FF00FF]/20 bg-[#FF00FF]/8 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">Trip dates</div>
                    <div className="mt-2 text-sm font-semibold text-white">
                      {formatDateCompact(hostingModal.arrivalDate)} - {formatDateCompact(hostingModal.departureDate)}
                    </div>
                    <p className="mt-1 text-xs text-white/55">
                      These dates come from the traveller trip. Set how many people you can host.
                    </p>
                  </div>

                  <label className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                      Max travellers you can host
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={hostingModal.maxTravellersAllowed}
                      onChange={(event) => setHostingModal((prev) => ({ ...prev, maxTravellersAllowed: event.target.value }))}
                      className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                      placeholder="e.g. 2"
                    />
                  </label>

                  <div className="pt-3 space-y-2 border-t border-white/8">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                        Invite note
                      </span>
                      <span className={hostingModal.message.length > 480 ? "text-[11px] text-amber-200" : "text-[11px] text-white/45"}>
                        {hostingModal.message.length}/500
                      </span>
                    </div>
                    <p className="text-xs text-white/50">
                      Optional short message to make the hosting offer clearer.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {HOST_OFFER_TEMPLATES.map((template, index) => (
                        <button
                          key={`host-offer-template-${index}`}
                          type="button"
                          onClick={() => setHostingModal((prev) => ({ ...prev, message: template.text }))}
                          className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/70 transition hover:border-[#00F5FF]/40 hover:text-[#00F5FF]"
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={hostingModal.message}
                      onChange={(event) => setHostingModal((prev) => ({ ...prev, message: event.target.value }))}
                      maxLength={500}
                      rows={4}
                      placeholder="Add a short hosting invite."
                      className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                    />
                    <div className="flex items-center justify-between text-[11px]">
                      <span className={hostingMessageValidation ? "text-[#FFC6FA]" : "text-white/45"}>
                        No links, emails, social handles, or phone numbers.
                      </span>
                    </div>
                    {hostingMessageValidation ? (
                      <p className="text-xs text-[#FFC6FA]">{hostingMessageValidation}</p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <>
                  <style>{`
                    input[type="date"]::-webkit-calendar-picker-indicator {
                      filter: invert(1);
                    }
                  `}</style>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">Arrival date</span>
                      <input
                        type="date"
                        value={hostingModal.arrivalDate}
                        onChange={(event) => setHostingModal((prev) => ({ ...prev, arrivalDate: event.target.value }))}
                        className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                      />
                      <label className="mt-1 flex items-center gap-2 text-xs text-white/70">
                        <input
                          type="checkbox"
                          checked={hostingModal.arrivalFlexible}
                          onChange={(event) =>
                            setHostingModal((prev) => ({ ...prev, arrivalFlexible: event.target.checked }))
                          }
                          className="h-4 w-4 rounded border-white/25 bg-transparent accent-[#00F5FF]"
                        />
                        Flexible arrival
                      </label>
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">Departure date</span>
                      <input
                        type="date"
                        value={hostingModal.departureDate}
                        onChange={(event) => setHostingModal((prev) => ({ ...prev, departureDate: event.target.value }))}
                        className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                      />
                      <label className="mt-1 flex items-center gap-2 text-xs text-white/70">
                        <input
                          type="checkbox"
                          checked={hostingModal.departureFlexible}
                          onChange={(event) =>
                            setHostingModal((prev) => ({ ...prev, departureFlexible: event.target.checked }))
                          }
                          className="h-4 w-4 rounded border-white/25 bg-transparent accent-[#00F5FF]"
                        />
                        Flexible departure
                      </label>
                    </label>
                  </div>

                  <div className="mt-4">
                    <label className="space-y-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                        Number of travellers
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={hostingModal.targetMaxGuests ?? 20}
                        value={hostingModal.travellersCount}
                        onChange={(event) => {
                          const cap = hostingModal.targetMaxGuests ?? 20;
                          setHostingModal((prev) => ({
                            ...prev,
                            travellersCount: Math.max(1, Math.min(cap, Number(event.target.value) || 1)),
                          }));
                        }}
                        className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                      />
                      {hostingModal.targetMaxGuests && hostingModal.requestType === "request_hosting" ? (
                        <p className="text-[11px] text-white/45">
                          This host can accommodate up to {hostingModal.targetMaxGuests} {hostingModal.targetMaxGuests === 1 ? "guest" : "guests"}
                        </p>
                      ) : null}
                    </label>
                  </div>

                  <label className="mt-4 block space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                      Optional message
                    </span>
                    <textarea
                      value={hostingModal.message}
                      onChange={(event) => setHostingModal((prev) => ({ ...prev, message: event.target.value }))}
                      maxLength={500}
                      rows={4}
                      placeholder="Add context for your request. Keep it short and respectful."
                      className="w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                    />
                    <div className="flex items-center justify-between text-[11px]">
                      <span className={hostingMessageValidation ? "text-[#FFC6FA]" : "text-white/45"}>
                        No links, emails, social handles, or phone numbers.
                      </span>
                      <span className={hostingModal.message.length > 480 ? "text-amber-200" : "text-white/45"}>
                        {hostingModal.message.length}/500
                      </span>
                    </div>
                    {hostingMessageValidation ? (
                      <p className="text-xs text-[#FFC6FA]">{hostingMessageValidation}</p>
                    ) : null}
                  </label>
                </>
              )}
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={closeHostingModal}
                className="h-11 rounded-full border border-white/20 px-5 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={hostingSending || Boolean(hostingMessageValidation)}
                onClick={sendHostingRequest}
                className="h-11 rounded-full px-5 text-sm font-black uppercase tracking-wide text-[#0A0A0A] disabled:opacity-45"
                style={{ backgroundImage: "linear-gradient(90deg,#00F5FF 0%, #FF00FF 100%)" }}
              >
                {hostingSending
                  ? "Sending…"
                  : hostingModal.requestType === "offer_to_host"
                  ? "Send host offer"
                  : "Request Hosting"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <VerificationRequiredDialog
        open={verificationModalOpen}
        resumePayload={verificationResumePayload}
        onClose={() => setVerificationModalOpen(false)}
        onError={(message) => setUiError(message)}
        onAlreadyVerified={() => {
          const resume = verificationResumePayload;
          setVerificationModalOpen(false);
          setVerificationResumePayload(null);
          setViewerVerified(true);
          if (resume?.kind === "request_hosting") {
            openHostingRequest({
              targetUserId: resume.targetUserId,
              targetName: resume.targetName,
              targetPhotoUrl: resume.targetPhotoUrl,
              targetMaxGuests: resume.targetMaxGuests ?? null,
              requestType: "request_hosting",
              tripId: resume.tripId ?? null,
              prefillArrivalDate: resume.prefillArrivalDate ?? null,
              prefillDepartureDate: resume.prefillDepartureDate ?? null,
            });
          }
        }}
      />

    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0A0A0A] text-white">
          <Nav />
          <main className="mx-auto w-full max-w-[1320px] px-4 pb-10 pt-6 sm:px-6 sm:pt-8 lg:px-8">
            <section className="border-b border-white/6 pb-3 sm:pb-4">
              <div
                className="mx-auto flex w-full max-w-none items-center gap-3 overflow-x-auto px-1 pb-1 sm:max-w-[560px] sm:justify-center sm:gap-8 sm:overflow-visible sm:px-0 sm:pb-0"
                style={{ scrollbarWidth: "none" }}
              >
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={`discover-tab-sk-${index}`}
                    className="h-11 w-28 shrink-0 animate-pulse rounded-full border border-white/10 bg-white/5"
                  />
                ))}
              </div>
            </section>

            <div className="mt-6 flex flex-col gap-4 md:mt-8 md:flex-row md:items-center md:justify-between">
              <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center md:gap-6">
                <div className="h-5 w-32 animate-pulse rounded bg-white/10" />
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-3 md:border-l md:border-white/10 md:pl-6">
                  <div className="h-10 w-36 animate-pulse rounded-xl border border-white/10 bg-white/5" />
                  <div className="h-6 w-36 animate-pulse rounded bg-white/10" />
                </div>
              </div>

              <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center md:w-auto md:justify-end">
                <div className="h-11 w-full animate-pulse rounded-full border border-white/10 bg-white/5 sm:w-[320px]" />
                <div className="h-11 w-full animate-pulse rounded-full bg-[#00F5FF]/80 sm:w-[144px]" />
              </div>
            </div>

            <div className="relative mt-8">
              <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div
                    key={`discover-card-sk-${index}`}
                    className="connections-card flex min-h-[360px] animate-pulse flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#121212] md:h-64 md:min-h-0 md:flex-row"
                  >
                    <div className="h-44 w-full bg-white/5 md:h-full md:w-1/2" />
                    <div className="flex h-full w-full flex-col justify-between p-4 md:w-1/2">
                      <div className="min-h-0">
                        <div className="h-6 w-40 rounded bg-white/10" />
                        <div className="mt-3 h-4 w-36 rounded bg-white/10" />
                        <div className="mt-4 h-3 w-40 rounded bg-white/10" />
                        <div className="mt-4 flex gap-2">
                          <div className="h-5 w-16 rounded bg-white/10" />
                          <div className="h-5 w-20 rounded bg-white/10" />
                          <div className="h-5 w-14 rounded bg-white/10" />
                        </div>
                        <div className="mt-3 flex gap-2">
                          <div className="h-5 w-10 rounded bg-white/10" />
                          <div className="h-5 w-10 rounded bg-white/10" />
                          <div className="h-5 w-10 rounded bg-white/10" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-3">
                        <div className="h-10 flex-1 rounded-full bg-white/10" />
                        <div className="h-10 flex-[1.3] rounded-full bg-white/10" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </main>
        </div>
      }
    >
      <ConnectionsPageContent />
    </Suspense>
  );
}
