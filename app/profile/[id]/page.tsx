"use client";

import Link from "next/link";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase/client";
import { resolveAvatarUrl } from "@/lib/avatar-storage";
import DashboardPage from "@/app/dashboard/page";
import Nav from "@/components/Nav";
import Avatar from "@/components/Avatar";
import EventHeroImage from "@/components/events/EventHeroImage";
import ReferencesHubView from "@/components/network/ReferencesHubView";
import ProfileMediaShowcase from "@/components/profile/ProfileMediaShowcase";
import TeacherBadge from "@/components/profile/TeacherBadge";
import RequestInfoModal from "@/components/teacher/RequestInfoModal";
import { DashboardEmbedModeProvider } from "@/components/dashboard/DashboardEmbedMode";
import VerifiedBadge from "@/components/VerifiedBadge";
import VerificationRequiredDialog from "@/components/verification/VerificationRequiredDialog";
import GetVerifiedButton from "@/components/verification/GetVerifiedButton";
import { normalizePublicAppUrl } from "@/lib/public-app-url";
import { fetchProfileMedia } from "@/lib/profile-media/read-model";
import type { ProfileMediaItem } from "@/lib/profile-media/types";
import { deriveConnectionState, isBlockedConnection } from "@/lib/connections/visibility";
import {
  fetchProfileRequestResponseStats,
  fetchVisibleConnections,
  type ProfileRequestResponseStats,
  type VisibleConnectionRow,
} from "@/lib/connections/read-model";
import {
  FALLBACK_GRADIENT,
  getTripHeroFallbackUrl,
  getTripHeroStorageFolderUrl,
  getTripHeroStorageUrl,
} from "@/lib/city-hero-images";
import {
  formatEventRange,
  mapEventMemberRows,
  mapEventRows,
  pickEventFallbackHeroUrl,
  pickEventHeroUrl,
  type EventMemberRecord,
  type EventRecord,
} from "@/lib/events/model";
import {
  REFERENCE_CONTEXT_TAGS,
  normalizeReferenceContextTag,
  referenceContextFamily,
  referenceContextLabel,
  type ReferenceContextTag,
} from "@/lib/activities/types";
import { fetchReferencesForMember } from "@/lib/references/read-model";
import {
  formatGuestGenderPreference,
  formatSleepingArrangement,
  isHostingListingOpen,
  normalizeHostingPreferredGuestGender,
  normalizeHostingSleepingArrangement,
  type HostingPreferredGuestGender,
  type HostingSleepingArrangement,
} from "@/lib/hosting/preferences";
import { hasTeacherBadgeRole } from "@/lib/teacher-info/roles";
import { clearVerificationResume, loadVerificationResume } from "@/lib/verification-client";
import { VERIFICATION_SUCCESS_MESSAGE, VERIFIED_VIA_PAYMENT_LABEL, isPaymentVerified } from "@/lib/verification";
import { isUuidLike, normalizeProfileUsernameInput } from "@/lib/profile-username";
import DarkConnectModal from "@/components/DarkConnectModal";
import { cx } from "@/lib/cx";

type DanceSkill = { level?: string; verified?: boolean };
type DanceSkills = Record<string, DanceSkill>;

type ProfileData = {
  userId: string;
  username: string | null;
  displayName: string;
  city: string;
  country: string;
  avatarUrl: string | null;
  verified: boolean;
  verifiedLabel: string | null;
  canHost: boolean;
  hostingStatus: string | null;
  maxGuests: number | null;
  hostingLastMinuteOk: boolean;
  hostingPreferredGuestGender: HostingPreferredGuestGender;
  hostingKidFriendly: boolean;
  hostingPetFriendly: boolean;
  hostingSmokingAllowed: boolean;
  hostingSleepingArrangement: HostingSleepingArrangement;
  hostingGuestShare: string | null;
  hostingTransitAccess: string | null;
  roles: string[];
  languages: string[];
  danceSkills: DanceSkills;
  interests: string[];
  availability: string[];
  createdAt: string | null;
  lastSeenAt: string | null;
  instagramHandle: string | null;
  whatsappHandle: string | null;
  youtubeUrl: string | null;
};

type ReferenceItem = {
  id: string;
  authorId: string;
  recipientId: string;
  direction: "received" | "given";
  sentiment: "positive" | "neutral" | "negative";
  context: ReferenceContextTag;
  entityType: string;
  body: string;
  replyText: string | null;
  createdAt: string;
};

type TripItem = {
  id: string;
  userId: string;
  destinationCity: string;
  destinationCountry: string;
  startDate: string;
  endDate: string;
  purpose: string;
  status: string;
  createdAt: string | null;
};

type SyncItem = {
  id: string;
  connectionId: string;
  status: string;
  type: string;
  completedAt: string | null;
  scheduledAt: string | null;
  note: string | null;
};

type SupabaseCountQueryResult = {
  count: number | null;
  error: { message: string } | null;
};

type SupabaseCompatClient = {
  from: (table: string) => {
    select: (
      columns: string,
      options?: { head?: boolean; count?: "exact" | "planned" | "estimated" }
    ) => {
      eq: (column: string, value: string) => Promise<SupabaseCountQueryResult>;
    };
  };
};

type ConnectionLite = {
  id: string;
  requesterId: string;
  targetId: string;
};

type EventTimelineItem = {
  event: EventRecord;
  relation: "hosted" | "going" | "waitlist";
  label: string;
};

type ReferenceContextFilter = "all" | ReferenceContextTag;
type ReferenceDirectionFilter = "all" | "received" | "given";
type ReferenceSortFilter = "latest" | "oldest";
type TabKey = "overview" | "references" | "dance-tools" | "trips" | "events";
const TAB_ORDER: TabKey[] = ["overview", "references", "trips", "events", "dance-tools"];
type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string };
type ProfileActionMenuState = {
  source: "desktop" | "mobile";
  placement: "above" | "below";
  anchorY: number;
  left: number;
  width: number;
};
type ProfileListItem = {
  displayName: string;
  avatarUrl: string | null;
};

const EMPTY_PROFILE_REQUEST_RESPONSE_STATS: ProfileRequestResponseStats = {
  totalRequests: 0,
  respondedRequests: 0,
  pendingRequests: 0,
  responseRate: 0,
};

const TAB_LABELS: Record<TabKey, string> = {
  overview: "Overview",
  references: "References",
  trips: "Trips",
  events: "Events",
  "dance-tools": "Dance tools",
};

function isTabKey(value: string | null): value is TabKey {
  return Boolean(value) && TAB_ORDER.includes(value as TabKey);
}

type ConnectionState =
  | { status: "none" }
  | { status: "pending"; role: "requester" | "target"; id: string }
  | { status: "accepted"; id: string }
  | { status: "blocked"; id: string };

const STYLE_ORDER = ["bachata", "salsa", "kizomba", "zouk", "tango", "other"] as const;


function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(row: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return fallback;
}

function pickNullableString(row: Record<string, unknown>, keys: string[]) {
  const value = pickString(row, keys);
  return value || null;
}

function asStringArrayLoose(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    }
    return trimmed
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

function isSchemaMissingMessage(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("relation")
  );
}

function isColumnMissingMessage(message: string) {
  const text = message.toLowerCase();
  return text.includes("column") && text.includes("does not exist");
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "Not available";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatMonthYear(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "Not available";
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
}

function formatDateRange(start: string, end: string) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return "Dates not set";

  const startText = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(startDate);
  const endText = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(endDate);
  return `${startText} - ${endText}`;
}

function formatRelativeTime(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "Not available";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "Just now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function normalizeSentiment(value: string): "positive" | "neutral" | "negative" {
  const lower = value.toLowerCase();
  if (lower === "positive" || lower === "4" || lower === "5") return "positive";
  if (lower === "negative" || lower === "1" || lower === "2") return "negative";
  return "neutral";
}

function normalizeContext(value: string) {
  return normalizeReferenceContextTag(value);
}

function titleCase(value: string) {
  if (!value) return value;
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function summarizeEventText(text: string | null | undefined, max = 78) {
  const value = (text ?? "").trim();
  if (!value) return "No description provided yet.";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}...`;
}

function profileEventTypeBadge(eventType: string) {
  const normalized = eventType.toLowerCase();
  if (normalized.includes("festival")) return "border-fuchsia-300/35 bg-fuchsia-400/15 text-fuchsia-100";
  if (normalized.includes("workshop") || normalized.includes("class") || normalized.includes("masterclass")) {
    return "border-cyan-300/35 bg-cyan-300/15 text-cyan-100";
  }
  if (normalized.includes("social")) return "border-fuchsia-300/35 bg-fuchsia-400/15 text-fuchsia-100";
  return "border-slate-300/30 bg-slate-400/15 text-slate-100";
}

function profileEventDateBadgeParts(value: string) {
  const parsed = parseDate(value);
  if (!parsed) return { weekday: "--", month: "--", day: "--" };
  return {
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(parsed),
    month: new Intl.DateTimeFormat("en-US", { month: "short" }).format(parsed).toUpperCase(),
    day: new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(parsed),
  };
}

function getProfileEventTimelineStatus(event: EventRecord) {
  if (event.status === "cancelled") {
    return {
      label: "Cancelled",
      textClass: "text-rose-300/90",
    };
  }

  const now = Date.now();
  const start = parseDate(event.startsAt)?.getTime() ?? null;
  const end = parseDate(event.endsAt)?.getTime() ?? null;
  if (start !== null && end !== null) {
    if (start <= now && now <= end) {
      return {
        label: "Happening now",
        textClass: "text-red-400",
      };
    }
    if (end < now) {
      return {
        label: "Ended",
        textClass: "text-slate-400",
      };
    }
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);
  if ((event.startsAt ?? "").slice(0, 10) === tomorrowIso) {
    return {
      label: "Tomorrow",
      textClass: "text-cyan-200/90",
    };
  }

  return {
    label: "Upcoming",
    textClass: "text-emerald-300/90",
  };
}

function profileEventRelationLabel(item: EventTimelineItem) {
  if (item.relation === "hosted") return "Hosted";
  if (item.relation === "waitlist") return "Waitlist";
  const endAt = parseDate(item.event.endsAt)?.getTime() ?? null;
  return endAt !== null && endAt < Date.now() ? "Joined" : "Joining";
}

function profileEventRelationTone(item: EventTimelineItem) {
  if (item.relation === "hosted") return "border-fuchsia-300/35 bg-fuchsia-400/14 text-fuchsia-100";
  if (item.relation === "waitlist") return "border-amber-300/35 bg-amber-400/14 text-amber-100";
  return "border-emerald-300/35 bg-emerald-400/14 text-emerald-100";
}

function profileEventRelationIcon(item: EventTimelineItem) {
  if (item.relation === "hosted") return "event_available";
  if (item.relation === "waitlist") return "schedule";
  return "check_circle";
}

function ProfileEventCard({ item }: { item: EventTimelineItem }) {
  const hero = pickEventHeroUrl(item.event);
  const fallbackHero = pickEventFallbackHeroUrl(item.event);
  const dateBadge = profileEventDateBadgeParts(item.event.startsAt);
  const timeline = getProfileEventTimelineStatus(item.event);
  const relationLabel = profileEventRelationLabel(item);
  const locationLabel = [item.event.venueName, item.event.city, item.event.country].filter(Boolean).join(", ") || "Location not set";

  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#121212] shadow-[0_6px_20px_rgba(0,0,0,0.3)] transition hover:-translate-y-0.5 hover:border-cyan-300/30">
      <Link href={`/events/${item.event.id}`} className="block">
        <div className="relative h-[108px]">
          <EventHeroImage
            key={`${hero ?? ""}|${fallbackHero ?? ""}`}
            primarySrc={hero}
            fallbackSrc={fallbackHero}
            alt={item.event.title}
            className="h-full w-full object-cover transition duration-700 hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-transparent to-transparent" />

          <div className="absolute left-2 top-2 flex items-center gap-1.5">
            <span className={cx("rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase", profileEventTypeBadge(item.event.eventType))}>
              {item.event.eventType}
            </span>
          </div>

          <div className="absolute right-2 top-2">
            <span className="rounded-full border border-white/20 bg-black/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-100">
              {item.event.visibility}
            </span>
          </div>
        </div>
      </Link>

      <div className="relative flex flex-1 flex-col p-2">
        <div className="pointer-events-none absolute right-2 top-1 z-10">
          <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/14 px-2 py-1 text-center shadow-[0_8px_20px_rgba(34,211,238,0.12)]">
            <p className="text-[10px] font-semibold tracking-wide text-cyan-100">{dateBadge.weekday}</p>
            <p className="text-[10px] font-semibold tracking-wide text-cyan-100">{dateBadge.month}</p>
            <p className="text-[22px] font-extrabold leading-none text-white">{dateBadge.day}</p>
          </div>
        </div>

        <div className="mb-0.5">
          <p className={cx("mb-0.5 text-[10px] font-semibold uppercase tracking-wide", timeline.textClass)}>{timeline.label}</p>
          <Link href={`/events/${item.event.id}`} className="block min-w-0 pr-[98px]">
            <h3 className="line-clamp-2 min-h-[34px] text-[15px] font-bold leading-tight text-white">{item.event.title}</h3>
          </Link>
          <p className="mt-0.5 truncate text-[11px] font-semibold text-cyan-200/90">
            {formatEventRange(item.event.startsAt, item.event.endsAt)}
          </p>
        </div>

        <div>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-slate-300">
            <span className="material-symbols-outlined text-[16px] text-cyan-200">location_on</span>
            <span className="truncate">{locationLabel}</span>
            {item.event.styles.length ? (
              <>
                <span className="text-white/40">,</span>
                <span className="truncate text-cyan-100/85">{item.event.styles.slice(0, 2).map(titleCase).join(", ")}</span>
              </>
            ) : null}
          </p>

          <p className="mt-0.5 line-clamp-2 min-h-[30px] text-[13px] leading-[1.25] text-slate-400">
            {summarizeEventText(item.event.description)}
          </p>
        </div>

        <div className="mt-auto flex items-center gap-1.5 border-t border-white/10 pt-1">
          <div
            className={cx(
              "inline-flex h-[33px] flex-1 items-center justify-center gap-1 rounded-xl border text-[12px] font-semibold",
              profileEventRelationTone(item)
            )}
          >
            <span className="material-symbols-outlined text-[16px]">{profileEventRelationIcon(item)}</span>
            {relationLabel}
          </div>
          <Link
            href={`/events/${item.event.id}`}
            className="inline-flex h-[33px] items-center justify-center rounded-xl border border-white/15 bg-white/[0.05] px-3 text-[12px] font-semibold text-slate-100 transition hover:bg-white/[0.08]"
          >
            Open
          </Link>
        </div>
      </div>
    </article>
  );
}

function formatDanceLevelLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const base = trimmed.split("(")[0]?.trim() || trimmed;
  if (base === "Teacher/Competitor") return "Teacher";
  return base;
}

function slugifyName(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sentimentBadge(sentiment: "positive" | "neutral" | "negative") {
  if (sentiment === "positive") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  if (sentiment === "negative") return "border-rose-400/30 bg-rose-500/10 text-rose-200";
  return "border-slate-400/30 bg-slate-500/10 text-slate-200";
}

const FOLLOW_TRACK_ACTIVITY_DEFAULTS = [
  "travel_plans",
  "hosting_availability",
  "new_references",
  "competition_results",
] as const;

function contextBadge(context: string) {
  const family = referenceContextFamily(context);
  if (family === "practice") return "border-cyan-300/30 bg-cyan-300/10 text-cyan-100";
  if (family === "travel" || family === "festival") return "border-violet-300/30 bg-violet-300/10 text-violet-100";
  if (family === "event") return "border-fuchsia-300/30 bg-fuchsia-300/10 text-fuchsia-100";
  if (family === "hosting") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  if (family === "collaboration") return "border-sky-300/30 bg-sky-300/10 text-sky-100";
  return "border-white/20 bg-white/[0.05] text-slate-200";
}

function useCountUp(target: number, enabled: boolean, durationMs = 900) {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const setOnFrame = (nextValue: number) => {
      frameRef.current = window.requestAnimationFrame(() => {
        setValue(nextValue);
        frameRef.current = null;
      });
    };

    if (!enabled) {
      setOnFrame(target);
      return () => {
        if (frameRef.current !== null) {
          window.cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
      };
    }

    if (target <= 0) {
      setOnFrame(0);
      return () => {
        if (frameRef.current !== null) {
          window.cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
      };
    }

    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / durationMs, 1);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(target * eased));
      if (progress < 1) frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [target, enabled, durationMs]);

  return value;
}

function EmptyPanel({
  icon,
  title,
  detail,
  ctaLabel,
  onCta,
}: {
  icon: string;
  title: string;
  detail: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[linear-gradient(160deg,rgba(34,211,238,0.08),rgba(0,0,0,0.25))] p-5 text-center shadow-[0_12px_26px_rgba(0,0,0,0.25)]">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-cyan-100">
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </div>
      <p className="text-sm font-semibold text-slate-100">{title}</p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
      {ctaLabel && onCta ? (
        <button
          type="button"
          onClick={onCta}
          className="mt-3 rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
        >
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}

function ProfilePageSkeleton() {
  return (
    <div className="min-h-screen bg-[#05070c] text-slate-100">
      <Nav />

      <main className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[28px] border border-cyan-200/10 bg-[#0b141a]/70 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="h-28 bg-[linear-gradient(130deg,rgba(14,116,144,0.32),rgba(192,38,211,0.2))] sm:h-36" />

          <div className="px-4 pb-6 sm:px-6 lg:px-8">
            <div className="-mt-16 flex flex-col gap-5 sm:-mt-20 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:text-left">
                <div className="h-32 w-32 animate-pulse rounded-full border-4 border-[#071116] bg-white/10 sm:h-40 sm:w-40" />
                <div className="min-w-0 space-y-3 pb-1">
                  <div className="h-8 w-48 animate-pulse rounded-full bg-white/10 sm:w-60" />
                  <div className="h-4 w-28 animate-pulse rounded-full bg-white/10" />
                  <div className="h-4 w-36 animate-pulse rounded-full bg-white/10" />
                </div>
              </div>

              <div className="flex gap-2">
                <div className="h-11 w-28 animate-pulse rounded-xl border border-white/10 bg-white/[0.05]" />
                <div className="h-11 w-32 animate-pulse rounded-xl bg-[linear-gradient(90deg,rgba(34,211,238,0.7),rgba(217,70,239,0.7))]" />
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={`profile-metric-skeleton-${index}`}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 shadow-[0_10px_30px_rgba(0,0,0,0.22)]"
            >
              <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
              <div className="mt-3 h-8 w-14 animate-pulse rounded bg-white/10" />
              <div className="mt-2 h-3 w-24 animate-pulse rounded bg-white/10" />
            </div>
          ))}
        </section>

        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,360px)]">
          <section className="space-y-6">
            <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
              <div className="h-6 w-40 animate-pulse rounded bg-white/10" />
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div className="space-y-3">
                  <div className="h-4 w-20 animate-pulse rounded bg-white/10" />
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={`role-skeleton-${index}`} className="h-8 w-24 animate-pulse rounded-full bg-white/[0.07]" />
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div key={`language-skeleton-${index}`} className="h-8 w-20 animate-pulse rounded-full bg-white/[0.07]" />
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <div className="h-4 w-28 animate-pulse rounded bg-white/10" />
                <div className="mt-3 flex flex-wrap gap-2">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={`style-skeleton-${index}`} className="h-8 w-24 animate-pulse rounded-full bg-white/[0.07]" />
                  ))}
                </div>
              </div>

              <div className="mt-6 border-t border-white/10 pt-5">
                <div className="h-4 w-16 animate-pulse rounded bg-white/10" />
                <div className="mt-4 grid grid-cols-2 auto-rows-[136px] gap-3 sm:auto-rows-[168px] lg:grid-cols-4 lg:auto-rows-[178px]">
                  <div className="col-span-2 row-span-2 animate-pulse rounded-[24px] bg-white/[0.06]" />
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={`media-skeleton-${index}`} className="animate-pulse rounded-[24px] bg-white/[0.06]" />
                  ))}
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={`info-skeleton-${index}`} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
                    <div className="mt-3 h-4 w-28 animate-pulse rounded bg-white/10" />
                  </div>
                ))}
              </div>
            </article>
          </section>

          <aside className="space-y-6">
            {Array.from({ length: 2 }).map((_, index) => (
              <article key={`sidebar-skeleton-${index}`} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <div className="h-5 w-32 animate-pulse rounded bg-white/10" />
                <div className="mt-4 space-y-3">
                  <div className="h-4 w-full animate-pulse rounded bg-white/10" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-white/10" />
                  <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
                </div>
              </article>
            ))}
          </aside>
        </div>
      </main>
    </div>
  );
}

function mapReferenceRows(rows: unknown[], profileId: string): ReferenceItem[] {
  const items: ReferenceItem[] = [];
  const seen = new Set<string>();
  rows.forEach((raw) => {
    const row = asRecord(raw);
    const id = pickString(row, ["id"]);
    if (!id || seen.has(id)) return;
    const authorId = pickString(row, ["author_id", "from_user_id", "source_id"]);
    const recipientId = pickString(row, ["recipient_id", "to_user_id", "target_id"]);
    const createdAt = pickString(row, ["created_at", "updated_at"]);
    if (!id || !authorId || !recipientId || !createdAt) return;
    const direction = recipientId === profileId ? "received" : authorId === profileId ? "given" : null;
    if (!direction) return;
    seen.add(id);

    const sentimentRaw = pickString(row, ["sentiment", "rating"]);
    const contextRaw = pickString(row, ["context_tag", "context", "entity_type"], "collaboration");
    const normalizedContext = normalizeContext(contextRaw);
    const body = pickString(row, ["text", "body", "feedback", "content"]) || "No additional details provided.";

    items.push({
      id,
      authorId,
      recipientId,
      direction,
      sentiment: normalizeSentiment(sentimentRaw || "neutral"),
      context: normalizedContext,
      entityType: normalizedContext,
      body,
      replyText: pickNullableString(row, ["reply_text"]),
      createdAt,
    });
  });
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function mapTripRows(rows: unknown[]): TripItem[] {
  return rows
    .map((raw) => {
      const row = asRecord(raw);
      const id = pickString(row, ["id"]);
      if (!id) return null;

      return {
        id,
        userId: pickString(row, ["user_id"]),
        destinationCity: pickString(row, ["destination_city", "city"]),
        destinationCountry: pickString(row, ["destination_country", "country"]),
        startDate: pickString(row, ["start_date", "from_date"]),
        endDate: pickString(row, ["end_date", "to_date"]),
        purpose: pickString(row, ["purpose"], "Trip"),
        status: pickString(row, ["status"], "active"),
        createdAt: pickNullableString(row, ["created_at"]),
      } satisfies TripItem;
    })
    .filter((row): row is TripItem => Boolean(row));
}

function mapSyncRows(rows: unknown[]): SyncItem[] {
  return rows
    .map((raw) => {
      const row = asRecord(raw);
      const id = pickString(row, ["id"]);
      const connectionId = pickString(row, ["connection_id", "conn_id"]);
      if (!id || !connectionId) return null;

      return {
        id,
        connectionId,
        status: pickString(row, ["status"], "accepted"),
        type: pickString(row, ["type"], "Sync"),
        completedAt: pickNullableString(row, ["completed_at"]),
        scheduledAt: pickNullableString(row, ["scheduled_at", "created_at"]),
        note: pickNullableString(row, ["note"]),
      } satisfies SyncItem;
    })
    .filter((row): row is SyncItem => Boolean(row))
    .sort((a, b) => (b.completedAt ?? b.scheduledAt ?? "").localeCompare(a.completedAt ?? a.scheduledAt ?? ""));
}

function mapConnectionSyncRows(rows: unknown[]): SyncItem[] {
  return rows
    .map((raw) => {
      const row = asRecord(raw);
      const id = pickString(row, ["id"]);
      const connectionId = pickString(row, ["connection_id"]);
      if (!id || !connectionId) return null;

      const rawType = pickString(row, ["sync_type", "type"], "Activity");
      const type =
        rawType === "training"
          ? "Practice"
          : rawType === "social_dancing"
            ? "Social Dance"
            : rawType === "workshop"
              ? "Workshop"
              : titleCase(rawType.replaceAll("_", " "));

      return {
        id,
        connectionId,
        status: pickString(row, ["status"], "accepted"),
        type,
        completedAt: pickNullableString(row, ["completed_at"]),
        scheduledAt: pickNullableString(row, ["scheduled_at", "created_at"]),
        note: pickNullableString(row, ["note"]),
      } satisfies SyncItem;
    })
    .filter((row): row is SyncItem => Boolean(row))
    .sort((a, b) => (b.completedAt ?? b.scheduledAt ?? "").localeCompare(a.completedAt ?? a.scheduledAt ?? ""));
}

function MemberProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ id?: string | string[]; username?: string | string[] }>();
  const supabaseCompat = supabase as unknown as SupabaseCompatClient;
  const profileParam = params?.id;
  const usernameParam = params?.username;
  const routeProfileKey = Array.isArray(profileParam)
    ? profileParam[0]
    : Array.isArray(usernameParam)
      ? usernameParam[0]
      : profileParam ?? usernameParam;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);
  const [viewerVerified, setViewerVerified] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileMedia, setProfileMedia] = useState<ProfileMediaItem[]>([]);
  const [state, setState] = useState<ConnectionState>({ status: "none" });
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [verificationModalOpen, setVerificationModalOpen] = useState(false);

  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [referenceContextFilter, setReferenceContextFilter] = useState<ReferenceContextFilter>("all");
  const [referenceDirectionFilter, setReferenceDirectionFilter] = useState<ReferenceDirectionFilter>("all");
  const [referenceSortFilter, setReferenceSortFilter] = useState<ReferenceSortFilter>("latest");
  const [referenceAuthors, setReferenceAuthors] = useState<Record<string, string>>({});
  const [, setPendingReferenceTypes] = useState<Set<ReferenceContextTag>>(new Set());

  const [trips, setTrips] = useState<TripItem[]>([]);
  const [eventsTimeline, setEventsTimeline] = useState<EventTimelineItem[]>([]);
  const [syncs, setSyncs] = useState<SyncItem[]>([]);
  const [danceGoalsCount, setDanceGoalsCount] = useState(0);
  const [danceCompetitionsCount, setDanceCompetitionsCount] = useState(0);
  const [danceMovesCount, setDanceMovesCount] = useState(0);
  const [requestResponseStats, setRequestResponseStats] = useState<ProfileRequestResponseStats>(EMPTY_PROFILE_REQUEST_RESPONSE_STATS);
  const [acceptedConnections, setAcceptedConnections] = useState<ConnectionLite[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileListItem>>({});
  const [viewerAcceptedUserIds, setViewerAcceptedUserIds] = useState<string[]>([]);
  const [tab, setTab] = useState<TabKey>("overview");
  const [avatarLightboxOpen, setAvatarLightboxOpen] = useState(false);
  const [avatarPreviewFailed, setAvatarPreviewFailed] = useState(false);
  const [animateMetrics, setAnimateMetrics] = useState(false);
  const [tabTransitionLoading, setTabTransitionLoading] = useState(false);
  const [supportingPanelsLoading, setSupportingPanelsLoading] = useState(false);
  const [supportingDataError, setSupportingDataError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [followingBusy, setFollowingBusy] = useState(false);
  const [contactFollowing, setContactFollowing] = useState(false);
  const [followContactId, setFollowContactId] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<ProfileActionMenuState | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [requestInfoOpen, setRequestInfoOpen] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [teacherInquiryEnabled, setTeacherInquiryEnabled] = useState(false);
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
  const panelSwitchTimerRef = useRef<number | null>(null);
  const toastCounterRef = useRef(0);
  const profileLoadRequestIdRef = useRef(0);

  const profileUserId = profile?.userId ?? (routeProfileKey && isUuidLike(routeProfileKey) ? routeProfileKey : null);
  const isSelf = meId !== null && profileUserId === meId;
  const isTeacherProfile = hasTeacherBadgeRole(profile?.roles);
  const canRequestInfo = !isSelf && isTeacherProfile && teacherInquiryEnabled;
  const canRevealContacts = isSelf || state.status === "accepted";
  const panelLoading = tabTransitionLoading || (supportingPanelsLoading && !(tab === "dance-tools" && isSelf));
  const requestedReferenceConnectionId = searchParams.get("connectionId");
  const requestedTab = useMemo(() => {
    const raw = searchParams.get("tab");
    if (!raw) return null;
    const normalized = raw.toLowerCase();
    return isTabKey(normalized) ? normalized : null;
  }, [searchParams]);
  const hostingAvailable = useMemo(() => isHostingListingOpen(profile?.canHost === true, profile?.hostingStatus), [profile?.canHost, profile?.hostingStatus]);
  const showHostingDetails = useMemo(
    () =>
      Boolean(
        profile &&
          (
            profile.canHost ||
            profile.hostingStatus ||
            profile.maxGuests !== null ||
            profile.hostingGuestShare ||
            profile.hostingTransitAccess
          )
      ),
    [profile]
  );

  // Redirect to teacher profile if the teacher has set that as their default view
  useEffect(() => {
    if (!isTeacherProfile || !profileUserId || isSelf) return;
    void supabase
      .from("teacher_profiles")
      .select("default_public_view,teacher_profile_enabled,is_public")
      .eq("user_id", profileUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (
          data?.default_public_view === "teacher" &&
          data?.teacher_profile_enabled &&
          data?.is_public
        ) {
          router.replace(`/profile/${profileUserId}/teacher`);
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileUserId, isTeacherProfile, isSelf]);

  const mobileSettingsLinks = useMemo(
    () =>
      [
        { href: "/me/edit", label: "Profile settings", icon: "person_edit" },
        { href: "/account-settings", label: "Account settings", icon: "settings" },
        { href: "/notifications", label: "Notifications", icon: "notifications" },
        { href: "/pricing", label: "Upgrade your plan", icon: "workspace_premium" },
        ...(viewerIsAdmin ? [{ href: "/admin/space", label: "Admin control", icon: "admin_panel_settings" }] : []),
      ],
    [viewerIsAdmin]
  );

  const skillList = useMemo(() => {
    const skills = profile?.danceSkills ?? {};
    const keys = Object.keys(skills);
    if (!keys.length) return [] as Array<{ style: string; level: string; verified: boolean }>;

    const ordered: string[] = [];
    for (const style of STYLE_ORDER) {
      if (skills[style]) ordered.push(style);
    }
    keys.forEach((style) => {
      if (!ordered.includes(style)) ordered.push(style);
    });

    return ordered.map((style) => ({
      style,
      level: (skills[style]?.level ?? "").trim(),
      verified: skills[style]?.verified === true,
    }));
  }, [profile?.danceSkills]);

  const referenceStats = useMemo(() => {
    const byContext = REFERENCE_CONTEXT_TAGS.reduce(
      (acc, tag) => {
        acc[tag] = 0;
        return acc;
      },
      {} as Record<ReferenceContextTag, number>
    );
    const totals = {
      total: references.length,
      received: 0,
      given: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      byContext,
    };

    references.forEach((row) => {
      totals[row.direction] += 1;
      totals[row.sentiment] += 1;
      totals.byContext[row.context] += 1;
    });

    const trustScore = totals.total > 0 ? Math.round(((totals.positive + totals.neutral) / totals.total) * 100) : 0;

    return {
      ...totals,
      trustScore,
    };
  }, [references]);

  const filteredReferences = useMemo(() => {
    const rows = references.filter((row) => {
      const directionMatch = referenceDirectionFilter === "all" || row.direction === referenceDirectionFilter;
      const contextMatch = referenceContextFilter === "all" || row.context === referenceContextFilter;
      return directionMatch && contextMatch;
    });
    return rows.sort((a, b) =>
      referenceSortFilter === "oldest"
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt)
    );
  }, [referenceContextFilter, referenceDirectionFilter, referenceSortFilter, references]);
  const visibleActivities = useMemo(
    () =>
      syncs.filter((item) => {
        const status = (item.status || "").toLowerCase();
        return Boolean(item.completedAt) || status === "accepted" || status === "active" || status === "scheduled";
      }),
    [syncs]
  );

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const activeTrips = useMemo(
    () =>
      trips
        .filter((trip) => trip.status !== "inactive" && trip.endDate && trip.endDate >= todayIso)
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [todayIso, trips]
  );

  const pastTrips = useMemo(
    () =>
      trips
        .filter((trip) => !trip.endDate || trip.endDate < todayIso || trip.status === "inactive")
        .sort((a, b) => b.endDate.localeCompare(a.endDate)),
    [todayIso, trips]
  );

  const upcomingEvents = useMemo(() => {
    const now = Date.now();
    return eventsTimeline.filter((item) => {
      const endsAt = parseDate(item.event.endsAt);
      return endsAt ? endsAt.getTime() >= now : false;
    });
  }, [eventsTimeline]);
  const pastEvents = useMemo(() => {
    const now = Date.now();
    return eventsTimeline.filter((item) => {
      const endsAt = parseDate(item.event.endsAt);
      return endsAt ? endsAt.getTime() < now : true;
    });
  }, [eventsTimeline]);

  const completedSyncs = useMemo(() => syncs.filter((item) => Boolean(item.completedAt)), [syncs]);
  const respondedRequestCount = requestResponseStats.respondedRequests;
  const responseRate = requestResponseStats.responseRate;
  const primaryInterest = useMemo(() => profile?.interests?.[0] ?? null, [profile?.interests]);
  const availabilityLabel = useMemo(
    () => (profile?.availability?.length ? profile.availability.join(" · ") : null),
    [profile?.availability]
  );
  const shareUrl = useMemo(() => {
    const appBase =
      (typeof window !== "undefined" ? normalizePublicAppUrl(window.location.origin) : "") ||
      normalizePublicAppUrl(process.env.NEXT_PUBLIC_APP_URL) ||
      "";
    const username = (profile?.username ?? "").trim();
    if (username) return `${appBase}/u/${encodeURIComponent(username)}`;
    if (!profileUserId) return "";
    const encodedName = slugifyName(profile?.displayName ?? "");
    return encodedName ? `${appBase}/profile/${profileUserId}?name=${encodedName}` : `${appBase}/profile/${profileUserId}`;
  }, [profile?.displayName, profile?.username, profileUserId]);
  const shareDisplayUrl = useMemo(() => shareUrl.replace(/^https?:\/\//, ""), [shareUrl]);
  const teacherShareUrl = useMemo(() => {
    if (!isTeacherProfile || !profileUserId) return "";
    const appBase =
      (typeof window !== "undefined" ? normalizePublicAppUrl(window.location.origin) : "") ||
      normalizePublicAppUrl(process.env.NEXT_PUBLIC_APP_URL) ||
      "";
    return `${appBase}/profile/${profileUserId}/teacher`;
  }, [isTeacherProfile, profileUserId]);

  const mutualConnectionUserIds = useMemo(() => {
    if (!profileUserId || !meId || meId === profileUserId) return [] as string[];
    const viewerAccepted = new Set(viewerAcceptedUserIds.filter((userId) => userId && userId !== profileUserId));
    const mutualIds = acceptedConnections
      .map((row) => (row.requesterId === profileUserId ? row.targetId : row.requesterId))
      .filter((userId) => userId && userId !== meId && viewerAccepted.has(userId));
    return Array.from(new Set(mutualIds));
  }, [acceptedConnections, meId, profileUserId, viewerAcceptedUserIds]);
  const mutualProfiles = useMemo(
    () => mutualConnectionUserIds.map((userId) => ({ userId, ...(profilesById[userId] ?? { displayName: "Member", avatarUrl: null }) })),
    [mutualConnectionUserIds, profilesById]
  );

  const refPositivePercent = referenceStats.total > 0 ? Math.round((referenceStats.positive / referenceStats.total) * 100) : 0;
  const metricReferences = useCountUp(referenceStats.total, animateMetrics);
  const metricPositiveRefs = useCountUp(referenceStats.positive, animateMetrics);
  const metricRefPositivePercent = useCountUp(refPositivePercent, animateMetrics);
  const metricResponseRate = useCountUp(responseRate, animateMetrics);
  const metricRespondedRequests = useCountUp(respondedRequestCount, animateMetrics);
  const metricActiveTrips = useCountUp(activeTrips.length, animateMetrics);
  const metricPastTrips = useCountUp(pastTrips.length, animateMetrics);
  const metricUpcomingEvents = useCountUp(upcomingEvents.length, animateMetrics);
  const metricEvents = useCountUp(eventsTimeline.length, animateMetrics);
  const metricDanceGoals = useCountUp(danceGoalsCount, animateMetrics);
  const metricDanceCompetitions = useCountUp(danceCompetitionsCount, animateMetrics);
  const metricDanceMoves = useCountUp(danceMovesCount, animateMetrics);
  const metricCompletedSyncs = useCountUp(completedSyncs.length, animateMetrics);
  const metricTotalSyncs = useCountUp(syncs.length, animateMetrics);
  const visibleTabs = useMemo(
    () =>
      TAB_ORDER.map((key) => [key, TAB_LABELS[key]] as [TabKey, string]).filter(([key]) => {
        if (key === "dance-tools") return isSelf;
        return true;
      }),
    [isSelf]
  );

  const metricCards = useMemo(
    () => {
      const cards: Array<{ key: TabKey; icon: string; title: string; value: string; sub: string }> = [
        {
          key: "references",
          icon: "rate_review",
          title: "References",
          value: `${metricReferences}`,
          sub: `+ ${metricPositiveRefs} positive · ${metricRefPositivePercent}%`,
        },
        {
          key: "overview",
          icon: "reply",
          title: "Response rate",
          value: `${metricResponseRate}%`,
          sub: requestResponseStats.totalRequests > 0 ? `${metricRespondedRequests} handled` : "No requests yet",
        },
      ];

      cards.push(
        {
          key: "trips",
          icon: "travel_explore",
          title: "Trips",
          value: `${metricActiveTrips}`,
          sub: `${metricPastTrips} attended`,
        },
        {
          key: "events",
          icon: "event",
          title: "Events",
          value: `${metricEvents}`,
          sub: `${metricUpcomingEvents} upcoming`,
        },
        ...(isSelf
          ? [
              {
                key: "dance-tools" as TabKey,
                icon: "sports_gymnastics",
                title: "Dance tools",
                value: "",
                sub: `${metricDanceMoves} moves learned|${metricDanceGoals} active goals|${metricDanceCompetitions} competitions`,
              },
            ]
          : [])
      );

      return cards;
    },
    [
      metricReferences,
      metricPositiveRefs,
      metricRefPositivePercent,
      metricResponseRate,
      metricRespondedRequests,
      requestResponseStats.totalRequests,
      metricDanceGoals,
      metricDanceCompetitions,
      metricDanceMoves,
      isSelf,
      metricActiveTrips,
      metricPastTrips,
      metricUpcomingEvents,
      metricEvents,
    ]
  );

  useEffect(() => {
    if (visibleTabs.some(([key]) => key === tab)) return;
    setTab("overview");
  }, [tab, visibleTabs]);

  useEffect(() => {
    if (!requestedTab) return;
    if (!visibleTabs.some(([key]) => key === requestedTab)) return;
    setTab((current) => (current === requestedTab ? current : requestedTab));
  }, [requestedTab, visibleTabs]);

  useEffect(() => {
    if (!shareDialogOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShareDialogOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shareDialogOpen]);

  function pushToast(kind: ToastKind, message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    const id = toastCounterRef.current + 1;
    toastCounterRef.current = id;
    setToasts((prev) => [...prev, { id, kind, message: trimmed }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 3600);
  }

  function setInfoFeedback(message: string) {
    setInfo(message);
    setError(null);
    pushToast("success", message);
  }

  function setErrorFeedback(message: string) {
    setError(message);
    pushToast("error", message);
  }

  async function copyShareLink() {
    if (!shareUrl) return;

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        pushToast("success", "Profile link copied.");
        return;
      }

      if (typeof document !== "undefined") {
        const input = document.createElement("input");
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
        pushToast("success", "Profile link copied.");
        return;
      }

      pushToast("info", "Copy is not supported on this device.");
    } catch {
      pushToast("error", "Could not copy the profile link.");
    }
  }

  async function shareProfile() {
    if (!profileUserId || !profile || !shareUrl) return;
    const location = [profile.city, profile.country].filter(Boolean).join(", ");
    const text = location
      ? `Check out ${profile.displayName}'s ConXion profile from ${location}.`
      : `Check out ${profile.displayName}'s ConXion profile.`;
    const prefersNativeShare =
      typeof window !== "undefined" &&
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;

    try {
      if (prefersNativeShare) {
        await navigator.share({
          title: `${profile.displayName} on ConXion`,
          text,
          url: shareUrl,
        });
        pushToast("success", "Profile shared.");
        return;
      }

      setShareDialogOpen(true);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      pushToast("error", "Could not share profile. Try again.");
    }
  }

  async function toggleFollowingMember() {
    if (!meId || !profileUserId || !profile || isSelf) return;
    const nextFollowing = !contactFollowing;
    const danceStyles = Object.keys(profile.danceSkills ?? {}).filter((value) => value.trim().length > 0);

    setFollowingBusy(true);
    setError(null);
    setInfo(null);

    const basePayload = {
      user_id: meId,
      contact_type: "member",
      linked_user_id: profileUserId,
      name: profile.displayName || "Member",
      role: profile.roles ?? [],
      city: profile.city || null,
      country: profile.country || null,
      instagram: profile.instagramHandle || null,
      whatsapp: profile.whatsappHandle || null,
      email: null,
      tags: [] as string[],
      notes: null,
    };

    if (followContactId) {
      const updateRes = await supabase
        .from("dance_contacts")
        .update({
          is_following: nextFollowing,
          track_activity: nextFollowing ? [...FOLLOW_TRACK_ACTIVITY_DEFAULTS] : [],
        })
        .eq("id", followContactId)
        .eq("user_id", meId)
        .select("id")
        .maybeSingle();

      if (updateRes.error) {
        setFollowingBusy(false);
        if (isColumnMissingMessage(updateRes.error.message)) {
          setErrorFeedback("Following needs the relationship-layer SQL migration: scripts/sql/2026-03-17_network_relationship_layer.sql");
          return;
        }
        if (isSchemaMissingMessage(updateRes.error.message)) {
          setErrorFeedback("Dance Contacts is not ready yet. Run SQL migration: scripts/sql/2026-03-05_dashboard_dance_contacts.sql");
          return;
        }
        setErrorFeedback(updateRes.error.message);
        return;
      }

      setFollowingBusy(false);
      setContactFollowing(nextFollowing);
      setInfoFeedback(
        nextFollowing
          ? "Added to Following. You can add a private note later from Network > Following."
          : "Removed from Following."
      );
      return;
    }

    const insertPayload = {
      ...basePayload,
      meeting_context: null,
      is_following: nextFollowing,
      track_activity: nextFollowing ? [...FOLLOW_TRACK_ACTIVITY_DEFAULTS] : [],
      dance_styles: danceStyles,
    };

    const upsertRes = await supabase
      .from("dance_contacts")
      .upsert(insertPayload, { onConflict: "user_id,linked_user_id" })
      .select("id,is_following")
      .single();

    if (upsertRes.error) {
      setFollowingBusy(false);
      if (isColumnMissingMessage(upsertRes.error.message)) {
        setErrorFeedback("Following needs the relationship-layer SQL migration: scripts/sql/2026-03-17_network_relationship_layer.sql");
        return;
      }
      if (isSchemaMissingMessage(upsertRes.error.message)) {
        setErrorFeedback("Dance Contacts is not ready yet. Run SQL migration: scripts/sql/2026-03-05_dashboard_dance_contacts.sql");
        return;
      }
      setErrorFeedback(upsertRes.error.message);
      return;
    }

    const upsertedRow = asRecord(upsertRes.data);
    setFollowingBusy(false);
    setFollowContactId(pickString(upsertedRow, ["id"]) || null);
    setContactFollowing(nextFollowing);
    setInfoFeedback("Added to Following. You can add a private note later from Network > Following.");
  }

  function closeActionMenu() {
    setActionMenu(null);
  }

  async function signOutFromProfile() {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore sign-out network errors and continue with local redirect.
    }
    window.location.assign("/auth");
  }

  function openActionMenu(event: MouseEvent<HTMLButtonElement>, source: "desktop" | "mobile", placement: "above" | "below") {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 264;
    const margin = 12;
    const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
    const anchorY = placement === "below" ? rect.bottom + 8 : rect.top - 8;

    setActionMenu((current) => {
      if (
        current &&
        current.source === source &&
        current.placement === placement &&
        Math.abs(current.anchorY - anchorY) < 1 &&
        Math.abs(current.left - left) < 1
      ) {
        return null;
      }
      return { source, placement, anchorY, left, width };
    });
  }

  useEffect(() => {
    if (!actionMenu) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeActionMenu();
    };
    const handleViewportChange = () => closeActionMenu();

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [actionMenu]);

  function handleTabChange(nextTab: TabKey) {
    if (nextTab === tab) return;
    if (panelSwitchTimerRef.current) {
      window.clearTimeout(panelSwitchTimerRef.current);
      panelSwitchTimerRef.current = null;
    }
    setTabTransitionLoading(true);
    setTab(nextTab);
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextTab === "overview") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", nextTab);
    }
    const nextQuery = nextParams.toString();
    router.replace(`${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`, { scroll: false });
    panelSwitchTimerRef.current = window.setTimeout(() => {
      setTabTransitionLoading(false);
      panelSwitchTimerRef.current = null;
    }, 220);
  }

  async function callConnectionAction(payload: {
    connId?: string;
    action: "accept" | "decline" | "undo_decline" | "cancel" | "block" | "report";
    targetUserId?: string;
    reason?: string;
    note?: string;
    context?: "connection" | "trip" | "message" | "profile" | "reference";
    contextId?: string | null;
  }) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token ?? "";
    if (!accessToken) throw new Error("Missing auth session token.");

    const response = await fetch("/api/connections/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !result?.ok) throw new Error(result?.error ?? `Failed to ${payload.action}.`);
  }

  async function refreshPairConnectionState(userId: string, visibleConnections?: VisibleConnectionRow[]) {
    if (!profileUserId) return;

    const rows =
      visibleConnections ??
      (await fetchVisibleConnections(supabase, userId).catch(() => [] as VisibleConnectionRow[]));

    const pairRows = rows
      .map((row) => ({
        id: row.id,
        status: row.status as "pending" | "accepted" | "blocked",
        requester_id: row.requester_id,
        target_id: row.target_id,
        blocked_by: row.blocked_by,
      }))
      .filter((row) => {
        const pairA = row.requester_id === userId && row.target_id === profileUserId;
        const pairB = row.requester_id === profileUserId && row.target_id === userId;
        return pairA || pairB;
      });

    if (profileUserId === userId) {
      setState({ status: "accepted", id: "self" });
      return;
    }

    if (pairRows.some((row) => isBlockedConnection(row))) {
      const blocked = pairRows.find((row) => isBlockedConnection(row));
      setState(blocked ? { status: "blocked", id: blocked.id } : { status: "blocked", id: "blocked" });
      return;
    }

    setState(deriveConnectionState(pairRows, userId, profileUserId));
  }

  useEffect(() => {
    return () => {
      if (panelSwitchTimerRef.current) {
        window.clearTimeout(panelSwitchTimerRef.current);
        panelSwitchTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!loading) setAnimateMetrics(true);
  }, [loading]);

  useEffect(() => {
    const verificationState = searchParams.get("verification");
    if (verificationState === "cancelled") {
      clearVerificationResume();
      return;
    }
    if (verificationState !== "success" || !profileUserId) return;

    setInfo(VERIFICATION_SUCCESS_MESSAGE);
    const resume = loadVerificationResume();
    if (resume?.kind === "profile_hosting_request" && resume.profileId === profileUserId) {
      clearVerificationResume();
      router.replace(`/connections?mode=hosts&request_host=${encodeURIComponent(profileUserId)}`);
    }
  }, [profileUserId, router, searchParams]);

  useEffect(() => {
    if (!meId || !profileUserId || isSelf) {
      setFollowContactId(null);
      setContactFollowing(false);
      return;
    }
    let cancelled = false;
    async function run() {
      let res = await supabase
        .from("dance_contacts")
        .select("id,is_following")
        .eq("user_id", meId)
        .eq("linked_user_id", profileUserId)
        .limit(1)
        .maybeSingle();
      if (res.error && isColumnMissingMessage(res.error.message)) {
        res = await supabase
          .from("dance_contacts")
          .select("id")
          .eq("user_id", meId)
          .eq("linked_user_id", profileUserId)
          .limit(1)
          .maybeSingle();
      }
      if (cancelled) return;
      if (res.error) {
        setFollowContactId(null);
        setContactFollowing(false);
        return;
      }
      const row = asRecord(res.data);
      const nextId = pickString(row, ["id"]);
      setFollowContactId(nextId || null);
      setContactFollowing(row.is_following === true);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [meId, profileUserId, isSelf]);

  useEffect(() => {
    if (!routeProfileKey) {
      setLoading(false);
      setError("Profile is missing.");
      return;
    }
    const resolvedRouteProfileKey = routeProfileKey;

    const requestId = profileLoadRequestIdRef.current + 1;
    profileLoadRequestIdRef.current = requestId;
    let cancelled = false;
    const canCommit = () => !cancelled && profileLoadRequestIdRef.current === requestId;

    async function load() {
      let initialReady = false;
      setLoading(true);
      setTabTransitionLoading(false);
      setSupportingPanelsLoading(false);
      setError(null);
      setSupportingDataError(null);
      setTeacherInquiryEnabled(false);
      setRequestInfoOpen(false);
      setInfo(null);
      setViewerVerified(false);
      setViewerIsAdmin(false);
      setProfile(null);
      setState({ status: "none" });
      setDanceGoalsCount(0);
      setDanceCompetitionsCount(0);
      setProfileMedia([]);
      setRequestResponseStats(EMPTY_PROFILE_REQUEST_RESPONSE_STATS);
      setViewerAcceptedUserIds([]);
      setReferences([]);
      setTrips([]);
      setEventsTimeline([]);
      setSyncs([]);
      setAcceptedConnections([]);
      setProfilesById({});
      setReferenceAuthors({});
      setPendingReferenceTypes(new Set());

      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth.user;
        if (!user) {
          router.replace("/auth");
          return;
        }

        const myUserId = user.id;
        setMeId(myUserId);

        const profileSelect = [
          "user_id",
          "username",
          "display_name",
          "city",
          "country",
          "avatar_url",
          "avatar_path",
          "verified",
          "verified_label",
          "can_host",
          "hosting_status",
          "max_guests",
          "hosting_last_minute_ok",
          "hosting_preferred_guest_gender",
          "hosting_kid_friendly",
          "hosting_pet_friendly",
          "hosting_smoking_allowed",
          "hosting_sleeping_arrangement",
          "hosting_guest_share",
          "hosting_transit_access",
          "roles",
          "languages",
          "dance_skills",
          "interests",
          "availability",
          "created_at",
          "last_seen_at",
          "instagram_handle",
          "whatsapp_handle",
          "youtube_url",
        ].join(",");

        const visibleConnectionsPromise = fetchVisibleConnections(supabase, myUserId).catch(() => [] as VisibleConnectionRow[]);
        const viewerProfilePromise = supabase.from("profiles").select("verified,verified_label").eq("user_id", myUserId).maybeSingle();
        const viewerAdminPromise = supabase.from("admins").select("user_id").eq("user_id", myUserId).maybeSingle();
        const profilePromise = isUuidLike(resolvedRouteProfileKey)
          ? supabase.from("profiles").select(profileSelect).eq("user_id", resolvedRouteProfileKey).maybeSingle()
          : supabase
              .from("profiles")
              .select(profileSelect)
              .eq("username", normalizeProfileUsernameInput(resolvedRouteProfileKey))
              .maybeSingle();

        const [profileRes, viewerProfileRes, viewerAdminRes, visibleConnections] = await Promise.all([
          profilePromise,
          viewerProfilePromise,
          viewerAdminPromise,
          visibleConnectionsPromise,
        ]);

        if (!canCommit()) return;

        setViewerAcceptedUserIds(
          Array.from(
            new Set(
              visibleConnections
                .filter((row) => row.is_accepted_visible && row.other_user_id && row.other_user_id !== myUserId)
                .map((row) => row.other_user_id)
            )
          )
        );

        if (profileRes.error) {
          setError(profileRes.error.message);
          return;
        }

        const profileRow = profileRes.data ? asRecord(profileRes.data) : null;
        if (!profileRow) {
          setError("Profile not found.");
          return;
        }

        const resolvedProfileId = pickString(profileRow, ["user_id"]);
        if (!resolvedProfileId) {
          setError("Profile not found.");
          return;
        }
        const resolvedRoles = asStringArrayLoose(profileRow.roles);
        const isTeacherRoleProfile = hasTeacherBadgeRole(resolvedRoles);

        const pairRows = visibleConnections
          .map((row) => ({
            id: row.id,
            status: row.status as "pending" | "accepted" | "blocked",
            requester_id: row.requester_id,
            target_id: row.target_id,
            blocked_by: row.blocked_by,
          }))
          .filter((row) => {
            const pairA = row.requester_id === myUserId && row.target_id === resolvedProfileId;
            const pairB = row.requester_id === resolvedProfileId && row.target_id === myUserId;
            return pairA || pairB;
          });

        if (pairRows.some((row) => isBlockedConnection(row))) {
          router.replace("/connections");
          return;
        }

        if (!viewerProfileRes.error) {
          setViewerVerified(isPaymentVerified((viewerProfileRes.data ?? null) as Record<string, unknown> | null));
        }
        if (!viewerAdminRes.error) {
          setViewerIsAdmin(Boolean(viewerAdminRes.data));
        }

        if (resolvedProfileId === myUserId) {
          setState({ status: "accepted", id: "self" });
        } else {
          setState(deriveConnectionState(pairRows, myUserId, resolvedProfileId));
        }

        const normalizedProfile: ProfileData = {
          userId: resolvedProfileId,
          username: pickNullableString(profileRow, ["username"]),
          displayName: pickString(profileRow, ["display_name"], "Member"),
          city: pickString(profileRow, ["city"]),
          country: pickString(profileRow, ["country"]),
          avatarUrl: resolveAvatarUrl({
            avatarUrl: pickNullableString(profileRow, ["avatar_url"]),
            avatarPath: pickNullableString(profileRow, ["avatar_path"]),
          }),
          verified: profileRow.verified === true,
          verifiedLabel: isPaymentVerified(profileRow) ? VERIFIED_VIA_PAYMENT_LABEL : null,
          canHost: profileRow.can_host === true,
          hostingStatus: pickNullableString(profileRow, ["hosting_status"]),
          maxGuests:
            typeof profileRow.max_guests === "number" && Number.isFinite(profileRow.max_guests)
              ? profileRow.max_guests
              : null,
          hostingLastMinuteOk: profileRow.hosting_last_minute_ok === true,
          hostingPreferredGuestGender: normalizeHostingPreferredGuestGender(profileRow.hosting_preferred_guest_gender),
          hostingKidFriendly: profileRow.hosting_kid_friendly === true,
          hostingPetFriendly: profileRow.hosting_pet_friendly === true,
          hostingSmokingAllowed: profileRow.hosting_smoking_allowed === true,
          hostingSleepingArrangement: normalizeHostingSleepingArrangement(profileRow.hosting_sleeping_arrangement),
          hostingGuestShare: pickNullableString(profileRow, ["hosting_guest_share"]),
          hostingTransitAccess: pickNullableString(profileRow, ["hosting_transit_access"]),
          roles: asStringArrayLoose(profileRow.roles),
          languages: asStringArrayLoose(profileRow.languages),
          danceSkills:
            profileRow.dance_skills && typeof profileRow.dance_skills === "object"
              ? (profileRow.dance_skills as DanceSkills)
              : {},
          interests: asStringArrayLoose(profileRow.interests),
          availability: asStringArrayLoose(profileRow.availability),
          createdAt: pickNullableString(profileRow, ["created_at"]),
          lastSeenAt: pickNullableString(profileRow, ["last_seen_at"]),
          instagramHandle: pickNullableString(profileRow, ["instagram_handle"]),
          whatsappHandle: pickNullableString(profileRow, ["whatsapp_handle"]),
          youtubeUrl: pickNullableString(profileRow, ["youtube_url"]),
        };

        setProfile(normalizedProfile);
        initialReady = true;
        setLoading(false);
        setSupportingPanelsLoading(true);

        void (async () => {
          let hasSupportingDataIssue = false;
          const markSupportingDataIssue = () => {
            hasSupportingDataIssue = true;
          };

          try {
            const profileMediaPromise = fetchProfileMedia(supabase, {
              userId: resolvedProfileId,
              viewerUserId: myUserId,
              includeAllOwn: myUserId === resolvedProfileId,
            }).catch((mediaError) => {
              const message = mediaError instanceof Error ? mediaError.message : "Could not load profile media.";
              if (!isSchemaMissingMessage(message)) {
                console.warn("[profile] profile media query failed", message);
                markSupportingDataIssue();
              }
              return [] as ProfileMediaItem[];
            });
            const requestResponseStatsPromise = fetchProfileRequestResponseStats(supabase, resolvedProfileId).catch((statsError) => {
              const message = statsError instanceof Error ? statsError.message : "Could not load profile response stats.";
              if (!isSchemaMissingMessage(message)) {
                console.warn("[profile] response stats query failed", message);
                markSupportingDataIssue();
              }
              return EMPTY_PROFILE_REQUEST_RESPONSE_STATS;
            });
            const teacherInquiryAvailabilityPromise = isTeacherRoleProfile
              ? fetch(`/api/teacher-info/public/${encodeURIComponent(resolvedProfileId)}`, { cache: "no-store" })
                  .then(async (response) => {
                    const result = (await response.json().catch(() => null)) as { ok?: boolean; enabled?: boolean } | null;
                    if (!response.ok || !result?.ok) {
                      markSupportingDataIssue();
                      return true;
                    }
                    return result.enabled === true;
                  })
                  .catch(() => {
                    markSupportingDataIssue();
                    return true;
                  })
              : Promise.resolve(false);
            const danceCompetitionsCountPromise =
              myUserId === resolvedProfileId
                ? supabaseCompat.from("dance_competitions_user").select("id", { head: true, count: "exact" }).eq("user_id", resolvedProfileId)
                : Promise.resolve({ count: 0, error: null });
            const danceGoalsCountPromise =
              myUserId === resolvedProfileId
                ? supabaseCompat.from("dance_goals_user").select("id", { head: true, count: "exact" }).eq("user_id", resolvedProfileId)
                : Promise.resolve({ count: 0, error: null });
            const danceMovesCountPromise =
              myUserId === resolvedProfileId
                ? supabaseCompat.from("dance_moves_user").select("id", { head: true, count: "exact" }).eq("user_id", resolvedProfileId)
                : Promise.resolve({ count: 0, error: null });

            const [
              profileReferenceRows,
              tripsRes,
              hostedEventsRes,
              memberEventsRes,
              profileMediaRows,
              profileRequestResponseStats,
              teacherInquiryAvailable,
              danceCompetitionsCountRes,
              danceGoalsCountRes,
              danceMovesCountRes,
              acceptedConnectionsDirect,
              connectionSyncsByMemberRes,
            ] = await Promise.all([
              fetchReferencesForMember(supabase, {
                memberId: resolvedProfileId,
                select: "*",
                perColumnLimit: 400,
              }),
              supabase
                .from("trips")
                .select("id,user_id,destination_city,destination_country,start_date,end_date,purpose,status,created_at")
                .eq("user_id", resolvedProfileId)
                .order("start_date", { ascending: false })
                .limit(300),
              supabase.from("events").select("*").eq("host_user_id", resolvedProfileId).order("starts_at", { ascending: false }).limit(300),
              supabase.from("event_members").select("*").eq("user_id", resolvedProfileId).in("status", ["host", "going", "waitlist"]).limit(500),
              profileMediaPromise,
              requestResponseStatsPromise,
              teacherInquiryAvailabilityPromise,
              danceCompetitionsCountPromise,
              danceGoalsCountPromise,
              danceMovesCountPromise,
              supabase
                .from("connections")
                .select("id,requester_id,target_id,status")
                .or(`requester_id.eq.${resolvedProfileId},target_id.eq.${resolvedProfileId}`)
                .eq("status", "accepted")
                .limit(500),
              supabase
                .from("connection_syncs")
                .select("id,connection_id,status,sync_type,scheduled_at,note,completed_at,created_at,requester_id,recipient_id")
                .or(`requester_id.eq.${resolvedProfileId},recipient_id.eq.${resolvedProfileId}`)
                .order("created_at", { ascending: false })
                .limit(500),
            ]);

            if (!canCommit()) return;

            setTeacherInquiryEnabled(teacherInquiryAvailable);
            setProfileMedia(profileMediaRows);
            setRequestResponseStats(profileRequestResponseStats);
            if (danceCompetitionsCountRes?.error) {
              if (!isSchemaMissingMessage(danceCompetitionsCountRes.error.message)) {
                console.warn("[profile] dance competitions count query failed", danceCompetitionsCountRes.error.message);
                markSupportingDataIssue();
              }
              setDanceCompetitionsCount(0);
            } else {
              setDanceCompetitionsCount(Math.max(0, danceCompetitionsCountRes?.count ?? 0));
            }
            if (danceGoalsCountRes?.error) {
              if (!isSchemaMissingMessage(danceGoalsCountRes.error.message)) {
                console.warn("[profile] dance goals count query failed", danceGoalsCountRes.error.message);
                markSupportingDataIssue();
              }
              setDanceGoalsCount(0);
            } else {
              setDanceGoalsCount(Math.max(0, danceGoalsCountRes?.count ?? 0));
            }
            if (danceMovesCountRes?.error) {
              if (!isSchemaMissingMessage(danceMovesCountRes.error.message)) {
                console.warn("[profile] dance moves count query failed", danceMovesCountRes.error.message);
              }
              setDanceMovesCount(0);
            } else {
              setDanceMovesCount(Math.max(0, danceMovesCountRes?.count ?? 0));
            }

            const nowIso = new Date().toISOString();
            const pendingPromptsRes =
              resolvedProfileId && myUserId !== resolvedProfileId
                ? await supabase
                    .from("reference_requests")
                    .select("id,context_tag,due_at,expires_at,status")
                    .eq("user_id", myUserId)
                    .eq("peer_user_id", resolvedProfileId)
                    .eq("status", "pending")
                    .lte("due_at", nowIso)
                    .gte("expires_at", nowIso)
                    .limit(200)
                : { data: [], error: null };

            if (!canCommit()) return;

            const pendingTypes = new Set<ReferenceContextTag>();
            if (!pendingPromptsRes.error) {
              for (const raw of ((pendingPromptsRes.data ?? []) as unknown[])) {
                const row = asRecord(raw);
                pendingTypes.add(normalizeContext(pickString(row, ["context_tag"], "collaboration")));
              }
            } else if (!isSchemaMissingMessage(pendingPromptsRes.error.message)) {
              markSupportingDataIssue();
            }
            setPendingReferenceTypes(pendingTypes);

            const mappedRefs = mapReferenceRows(profileReferenceRows, resolvedProfileId);
            setReferences(mappedRefs);

            const mappedTrips = tripsRes.error ? [] : mapTripRows((tripsRes.data ?? []) as unknown[]);
            setTrips(mappedTrips);

            const hostedEvents = hostedEventsRes.error ? [] : mapEventRows((hostedEventsRes.data ?? []) as unknown[]);
            const memberRows = memberEventsRes.error ? [] : mapEventMemberRows((memberEventsRes.data ?? []) as unknown[]);

            const hostedEventIds = new Set(hostedEvents.map((event) => event.id));
            const relatedEventIds = Array.from(
              new Set(memberRows.map((row) => row.eventId).filter((eventId) => eventId && !hostedEventIds.has(eventId)))
            );

            let relatedEvents: EventRecord[] = [];
            if (relatedEventIds.length > 0) {
              const relatedEventsRes = await supabase.from("events").select("*").in("id", relatedEventIds);
              if (!relatedEventsRes.error) {
                relatedEvents = mapEventRows((relatedEventsRes.data ?? []) as unknown[]);
              } else {
                markSupportingDataIssue();
              }
            }

            if (!canCommit()) return;

            const eventsById: Record<string, EventRecord> = {};
            [...hostedEvents, ...relatedEvents].forEach((event) => {
              eventsById[event.id] = event;
            });

            const timeline: EventTimelineItem[] = [];
            hostedEvents.forEach((event) => {
              timeline.push({ event, relation: "hosted", label: "Hosted" });
            });

            memberRows.forEach((row) => {
              if (row.status !== "going" && row.status !== "waitlist") return;
              const event = eventsById[row.eventId];
              if (!event) return;
              timeline.push({
                event,
                relation: row.status,
                label: row.status === "going" ? "Joining" : "Waitlist",
              });
            });

            timeline.sort((a, b) => b.event.startsAt.localeCompare(a.event.startsAt));
            setEventsTimeline(timeline);

            let acceptedRows: ConnectionLite[] = [];
            if (!acceptedConnectionsDirect.error) {
              acceptedRows = ((acceptedConnectionsDirect.data ?? []) as unknown[])
                .map((raw) => {
                  const row = asRecord(raw);
                  const id = pickString(row, ["id"]);
                  const requesterId = pickString(row, ["requester_id"]);
                  const targetId = pickString(row, ["target_id"]);
                  if (!id || !requesterId || !targetId) return null;
                  return {
                    id,
                    requesterId,
                    targetId,
                  } satisfies ConnectionLite;
                })
                .filter((row): row is ConnectionLite => Boolean(row));
            } else {
              acceptedRows = visibleConnections
                .filter((row) => row.is_accepted_visible && (row.requester_id === resolvedProfileId || row.target_id === resolvedProfileId))
                .map((row) => ({
                  id: row.id,
                  requesterId: row.requester_id,
                  targetId: row.target_id,
                }));
              if (!isSchemaMissingMessage(acceptedConnectionsDirect.error.message)) {
                markSupportingDataIssue();
              }
            }

            setAcceptedConnections(acceptedRows);

            const connectionIds = acceptedRows.map((row) => row.id).filter(Boolean);
            let syncRows: SyncItem[] = [];
            if (connectionIds.length > 0) {
              const acceptedConnectionIds = new Set(connectionIds);

              if (!connectionSyncsByMemberRes.error && (connectionSyncsByMemberRes.data?.length ?? 0) > 0) {
                syncRows = mapConnectionSyncRows(
                  ((connectionSyncsByMemberRes.data ?? []) as unknown[]).filter((raw) => {
                    const row = asRecord(raw);
                    return acceptedConnectionIds.has(pickString(row, ["connection_id"]));
                  })
                );
              } else {
                if (connectionSyncsByMemberRes.error && !isSchemaMissingMessage(connectionSyncsByMemberRes.error.message)) {
                  markSupportingDataIssue();
                }
                const fallback = await supabase.from("syncs").select("*").in("connection_id", connectionIds).limit(1000);
                if (!fallback.error) {
                  const all = mapSyncRows((fallback.data ?? []) as unknown[]);
                  syncRows = all.filter((row) => acceptedConnectionIds.has(row.connectionId));
                } else if (!isSchemaMissingMessage(fallback.error.message)) {
                  markSupportingDataIssue();
                }
              }
            }

            if (!canCommit()) return;

            setSyncs(syncRows);

            const profileIds = new Set<string>();
            mappedRefs.forEach((row) => {
              if (row.authorId && row.authorId !== resolvedProfileId) profileIds.add(row.authorId);
              if (row.recipientId && row.recipientId !== resolvedProfileId) profileIds.add(row.recipientId);
            });
            acceptedRows.forEach((row) => {
              if (row.requesterId && row.requesterId !== resolvedProfileId) profileIds.add(row.requesterId);
              if (row.targetId && row.targetId !== resolvedProfileId) profileIds.add(row.targetId);
            });
            timeline.forEach((item) => {
              if (item.event.hostUserId && item.event.hostUserId !== resolvedProfileId) profileIds.add(item.event.hostUserId);
            });

            if (profileIds.size > 0) {
              const ids = Array.from(profileIds);
              const profileNamesRes = await supabase.from("profiles").select("user_id,display_name,avatar_url,avatar_path").in("user_id", ids);
              if (!profileNamesRes.error) {
                const nameMap: Record<string, ProfileListItem> = {};
                ((profileNamesRes.data ?? []) as unknown[]).forEach((raw) => {
                  const row = asRecord(raw);
                  const userId = pickString(row, ["user_id"]);
                  if (!userId) return;
                  nameMap[userId] = {
                    displayName: pickString(row, ["display_name"], "Member"),
                    avatarUrl: resolveAvatarUrl({
                      avatarUrl: pickNullableString(row, ["avatar_url"]),
                      avatarPath: pickNullableString(row, ["avatar_path"]),
                    }),
                  };
                });
                setProfilesById(nameMap);

                const authorMap: Record<string, string> = {};
                Object.entries(nameMap).forEach(([id, value]) => {
                  authorMap[id] = value.displayName;
                });
                setReferenceAuthors(authorMap);
              } else {
                markSupportingDataIssue();
              }
            } else {
              setProfilesById({});
              setReferenceAuthors({});
            }

            if (!canCommit()) return;
            setSupportingDataError(
              hasSupportingDataIssue ? "Some profile sections could not be loaded completely. Refresh to try again." : null
            );
          } catch (supportingError) {
            if (!canCommit()) return;
            console.warn(
              "[profile] supporting data query failed",
              supportingError instanceof Error ? supportingError.message : String(supportingError)
            );
            setSupportingDataError("Some profile sections could not be loaded completely. Refresh to try again.");
          } finally {
            if (canCommit()) setSupportingPanelsLoading(false);
          }
        })();
      } catch (err: unknown) {
        if (!canCommit()) return;
        setError(err instanceof Error ? err.message : "Could not load this profile right now.");
      } finally {
        if (canCommit() && !initialReady) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [routeProfileKey, router, supabaseCompat]);

  async function connect() {
    if (!meId || !profileUserId) return;

    setBusy(true);
    setError(null);
    setInfo(null);

    const incomingPending = await supabase
      .from("connections")
      .select("id,status")
      .eq("requester_id", profileUserId)
      .eq("target_id", meId)
      .maybeSingle();

    if (!incomingPending.error && incomingPending.data?.id && incomingPending.data.status === "pending") {
      try {
        await callConnectionAction({ connId: incomingPending.data.id, action: "accept" });
        await refreshPairConnectionState(meId);
        setInfoFeedback("Connection accepted.");
      } catch (err) {
        setErrorFeedback(err instanceof Error ? err.message : "Failed to accept request.");
      }
      setBusy(false);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token ?? "";
    if (!accessToken) {
      setBusy(false);
      setErrorFeedback("Missing auth session. Please sign in again.");
      return;
    }

    try {
      const response = await fetch("/api/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          requesterId: meId,
          targetId: profileUserId,
          payload: { connect_context: "member" },
        }),
      });

      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        setErrorFeedback(result?.error ?? "Failed to send request.");
        setBusy(false);
        return;
      }

      await refreshPairConnectionState(meId);
      setInfoFeedback("Connection request sent.");
    } catch (err) {
      setErrorFeedback(err instanceof Error ? err.message : "Failed to send request.");
    }

    setBusy(false);
  }

  async function acceptRequest() {
    if (!meId || state.status !== "pending" || state.role !== "target") return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await callConnectionAction({ connId: state.id, action: "accept" });
      await refreshPairConnectionState(meId);
      setInfoFeedback("Connection accepted.");
    } catch (err) {
      setErrorFeedback(err instanceof Error ? err.message : "Failed to accept request.");
    }
    setBusy(false);
  }

  async function declineRequest() {
    if (!meId || state.status !== "pending" || state.role !== "target") return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await callConnectionAction({ connId: state.id, action: "decline" });
      await refreshPairConnectionState(meId);
      setInfoFeedback("Request declined.");
    } catch (err) {
      setErrorFeedback(err instanceof Error ? err.message : "Failed to decline request.");
    }
    setBusy(false);
  }

  async function cancelRequest() {
    if (!meId || state.status !== "pending" || state.role !== "requester") return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await callConnectionAction({ connId: state.id, action: "cancel" });
      await refreshPairConnectionState(meId);
      setInfoFeedback("Request cancelled.");
    } catch (err) {
      setErrorFeedback(err instanceof Error ? err.message : "Failed to cancel request.");
    }
    setBusy(false);
  }

  async function blockMember() {
    if (!meId || !profileUserId) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if ("id" in state && state.id && state.id !== "self") {
        await callConnectionAction({ connId: state.id, action: "block" });
      } else {
        await callConnectionAction({ action: "block", targetUserId: profileUserId });
      }
      setInfoFeedback("Member blocked.");
      router.replace("/connections");
    } catch (err) {
      setErrorFeedback(err instanceof Error ? err.message : "Failed to block member.");
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  async function reportMember() {
    if (!meId || !profileUserId || isSelf) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await callConnectionAction({
        connId: "id" in state && state.id && state.id !== "self" ? state.id : undefined,
        targetUserId: profileUserId,
        action: "report",
        reason: "profile_concern",
        context: "profile",
        contextId: profileUserId,
      });
      setInfoFeedback("Report submitted. Our moderation team will review it.");
    } catch (err) {
      setErrorFeedback(err instanceof Error ? err.message : "Failed to submit report.");
    }
    setBusy(false);
  }

  if (loading) {
    return <ProfilePageSkeleton />;
  }

  if (!profileUserId || !profile) {
    return (
      <div className="min-h-screen bg-[#05070c] text-slate-100">
        <Nav />
        <main className="mx-auto flex min-h-[60vh] max-w-[1200px] items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">
            {error ?? "Profile not found."}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05070c] text-slate-100">
      <Nav />

      <main className={cx("mx-auto w-full max-w-[1280px] px-4 pt-6 sm:px-6 lg:px-8", !isSelf ? "pb-20" : "pb-16")}>
        {toasts.length ? (
          <div className="pointer-events-none fixed left-1/2 top-[74px] z-[95] flex w-[min(94vw,560px)] -translate-x-1/2 flex-col gap-2">
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={cx(
                  "toast-in rounded-xl border px-4 py-2.5 text-sm shadow-[0_14px_34px_rgba(0,0,0,0.45)] backdrop-blur",
                  toast.kind === "success"
                    ? "border-emerald-300/35 bg-emerald-400/15 text-emerald-50"
                    : toast.kind === "error"
                      ? "border-rose-300/35 bg-rose-400/15 text-rose-50"
                      : "border-cyan-300/35 bg-cyan-300/15 text-cyan-50"
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <span className="material-symbols-outlined text-[15px]">
                    {toast.kind === "success" ? "check_circle" : toast.kind === "error" ? "error" : "info"}
                  </span>
                  {toast.message}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <section className="relative overflow-visible rounded-[28px] border border-cyan-200/10 bg-[#0b141a]/70 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="hero-ambient hero-ambient--left" />
            <div className="hero-ambient hero-ambient--right" />
            <div className="hero-noise" />
          </div>
          <div className="relative h-28 w-full sm:h-36">
            <div className="absolute inset-0 bg-[linear-gradient(130deg,rgba(14,116,144,0.45),rgba(192,38,211,0.32))]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.24),transparent_52%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(232,121,249,0.2),transparent_58%)]" />
            {isTeacherProfile ? (
              <div className="pointer-events-none absolute inset-y-0 right-4 hidden items-start justify-end pt-3 sm:flex sm:right-6 sm:pt-4 lg:right-8">
                <TeacherBadge className="w-[190px] sm:w-[280px] lg:w-[360px]" />
              </div>
            ) : null}
          </div>

          <div className="relative px-4 pb-6 sm:px-6 lg:px-8">
            <div className="-mt-16 flex flex-col gap-5 sm:-mt-20 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:text-left">
                <div className="relative shrink-0">
                  {isTeacherProfile ? (
                    <span className="absolute -top-5 left-1/2 z-10 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100 sm:hidden">
                      Teacher
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setAvatarPreviewFailed(false);
                      setAvatarLightboxOpen(true);
                    }}
                    className="group mx-auto flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-[#071116] bg-[#11242c] shadow-[0_12px_36px_rgba(0,0,0,0.5)] transition hover:border-cyan-300/40 sm:mx-0 sm:h-40 sm:w-40"
                    aria-label="Enlarge profile photo"
                  >
                    {profile.avatarUrl ? (
                      <img
                        src={profile.avatarUrl}
                        alt={profile.displayName}
                        className="h-full w-full rounded-full bg-[#11242c] object-cover object-center transition group-hover:scale-[1.03]"
                      />
                    ) : (
                      <Avatar src={profile.avatarUrl} alt={profile.displayName} size={112} className="h-full w-full rounded-full sm:[width:160px] sm:[height:160px]" />
                    )}
                  </button>
                </div>

                <div className="min-w-0 pb-1">
                  <div className="flex items-center justify-center gap-2 sm:justify-start">
                    <h1 className="truncate text-2xl font-bold text-white sm:text-3xl">{profile.displayName}</h1>
                    {profile.verified ? (
                      <VerifiedBadge size={20} title={VERIFIED_VIA_PAYMENT_LABEL} />
                    ) : null}
                  </div>

                  {profile.username ? (
                    <p className="mt-1 text-sm font-medium text-cyan-200/90">@{profile.username}</p>
                  ) : null}

                  <p className="mt-1 text-sm text-slate-300">
                    {[profile.city, profile.country].filter(Boolean).join(", ") || "Location not set"}
                  </p>

                  {isTeacherProfile && profileUserId ? (
                    <Link
                      href={`/profile/${profileUserId}/teacher`}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-cyan-300/80 hover:text-cyan-200"
                    >
                      <span className="material-symbols-outlined text-[13px]">school</span>
                      View teacher profile
                    </Link>
                  ) : null}

                  {!isSelf && (acceptedConnections.length > 0 || mutualProfiles.length > 0) ? (
                    <div className="mt-3">
                      <p className="text-sm font-medium text-slate-200">
                        {acceptedConnections.length > 0 ? `${acceptedConnections.length} connections` : ""}
                        {acceptedConnections.length > 0 && mutualProfiles.length > 0 ? " • " : ""}
                        {mutualProfiles.length > 0 ? `${mutualProfiles.length} mutual` : ""}
                      </p>

                      {mutualProfiles.length > 0 ? (
                        <div className="mt-3 flex items-center justify-center sm:justify-start">
                          {mutualProfiles.slice(0, 8).map((item, index) => (
                            <div
                              key={item.userId}
                              className={cx(
                                "relative h-10 w-10 overflow-hidden rounded-full border-2 border-[#0b141a] bg-[#13202a] shadow-[0_8px_18px_rgba(0,0,0,0.28)]",
                                index > 0 ? "-ml-2.5" : ""
                              )}
                              title={item.displayName}
                            >
                              <Avatar src={item.avatarUrl} alt={item.displayName} size={40} className="h-full w-full rounded-full" />
                            </div>
                          ))}
                          {mutualProfiles.length > 8 ? (
                            <div className="-ml-2.5 inline-flex h-10 min-w-10 items-center justify-center rounded-full border-2 border-[#0b141a] bg-white/[0.08] px-2 text-[11px] font-semibold text-white/85">
                              +{mutualProfiles.length - 8}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {isSelf ? (
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:hidden">
                      <button
                        type="button"
                        onClick={() => void shareProfile()}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-black/30 text-white/90 hover:bg-black/45"
                        aria-label="Share profile"
                      >
                        <span className="material-symbols-outlined text-[18px]">share</span>
                      </button>
                      <Link
                        href="/notifications"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-black/30 text-white/90 hover:bg-black/45"
                        aria-label="Open notifications"
                      >
                        <span className="material-symbols-outlined text-[18px]">notifications</span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => setMobileSettingsOpen(true)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-black/30 text-white/90 hover:bg-black/45"
                        aria-label="Open settings menu"
                      >
                        <span className="material-symbols-outlined text-[18px]">settings</span>
                      </button>
                      <Link
                        href="/me/edit"
                        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-[#06121a] hover:brightness-110"
                      >
                        Edit profile
                      </Link>
                    </div>
                  ) : null}
                </div>
              </div>

              {!isSelf ? (
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  <div className="flex flex-wrap items-center gap-2">
                  {state.status === "none" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setConnectModalOpen(true)}
                        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-[#06121a] hover:brightness-110"
                      >
                        Connect
                      </button>
                    </>
                  ) : null}

                  {state.status === "pending" && state.role === "requester" ? (
                    <button
                      type="button"
                      onClick={() => void cancelRequest()}
                      disabled={busy}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/20 bg-black/30 px-4 py-2.5 text-sm font-semibold text-white/90 hover:bg-black/45 disabled:opacity-60"
                    >
                      {busy ? "Cancelling..." : "Cancel request"}
                    </button>
                  ) : null}

                  {state.status === "pending" && state.role === "target" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void declineRequest()}
                        disabled={busy}
                        className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/20 bg-black/30 px-4 py-2.5 text-sm font-semibold text-white/90 hover:bg-black/45 disabled:opacity-60"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        onClick={() => void acceptRequest()}
                        disabled={busy}
                        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-[#06121a] hover:brightness-110 disabled:opacity-60"
                      >
                        Accept
                      </button>
                    </>
                  ) : null}

                  {state.status === "accepted" ? (
                    <>
                      {!isTeacherProfile ? (
                        <span className="rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-100">
                          Connected
                        </span>
                      ) : null}
                      {state.id !== "self" ? (
                        <Link
                          href={`/messages?thread=${encodeURIComponent(`conn:${state.id}`)}`}
                          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-[#06121a] hover:brightness-110"
                        >
                          <span className="material-symbols-outlined text-[16px]">chat_bubble</span>
                          Message
                        </Link>
                      ) : null}
                    </>
                  ) : null}

                  {isTeacherProfile && profileUserId ? (
                    <Link
                      href={`/profile/${profileUserId}/teacher`}
                      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
                    >
                      <span className="material-symbols-outlined text-[16px]">school</span>
                      Teacher page
                    </Link>
                  ) : null}

                  <button
                    type="button"
                    onClick={(event) => openActionMenu(event, "desktop", "below")}
                    aria-haspopup="menu"
                    aria-expanded={actionMenu?.source === "desktop"}
                    className="flex items-center justify-center rounded-xl border border-white/20 bg-black/30 px-3 py-2 text-slate-100 hover:bg-black/45"
                  >
                      <span className="material-symbols-outlined text-[20px]">more_horiz</span>
                  </button>
                  </div>
                </div>
              ) : (
                <div className="hidden items-center gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={() => void shareProfile()}
                    className="rounded-xl border border-white/20 bg-black/30 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-black/45"
                  >
                    Share profile
                  </button>
                  {isTeacherProfile && profileUserId ? (
                    <Link
                      href={`/profile/${profileUserId}/teacher`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
                    >
                      <span className="material-symbols-outlined text-[16px]">school</span>
                      Teacher page
                    </Link>
                  ) : null}
                  <Link
                    href="/me/edit"
                    className="rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-[#06121a] hover:brightness-110"
                  >
                    Edit profile
                  </Link>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className={cx("no-scrollbar mt-5 flex gap-3 overflow-x-auto sm:grid sm:grid-cols-2 lg:grid-cols-3", isSelf ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
          {metricCards.map((card, index) => (
            <button
              key={card.key}
              type="button"
              onClick={() => handleTabChange(card.key as TabKey)}
              aria-pressed={tab === card.key}
              style={{ animationDelay: `${index * 70}ms` }}
              className={cx(
                "metric-card flex min-h-[108px] min-w-[148px] shrink-0 flex-col items-center justify-center rounded-2xl border px-4 py-4 text-center shadow-[0_10px_30px_rgba(0,0,0,0.22)] transition sm:min-w-0",
                (card.key === "overview" || card.key === "dance-tools") && "hidden sm:flex",
                tab === card.key
                  ? "border-cyan-300/35 bg-[linear-gradient(170deg,rgba(34,211,238,0.18),rgba(232,121,249,0.08))]"
                  : "border-white/10 bg-[linear-gradient(170deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01))]",
                animateMetrics ? "metric-card--show" : ""
              )}
            >
              <p className={cx("mb-1 text-xs uppercase tracking-wide", tab === card.key ? "text-cyan-100" : "text-slate-400")}>{card.title}</p>
              {card.key === "dance-tools" ? (
                <ul className={cx("mt-0.5 space-y-0.5 text-left text-[11px]", tab === card.key ? "text-cyan-100/80" : "text-slate-400")}>
                  {card.sub.split("|").map((item) => (
                    <li key={item} className="flex items-center gap-1">
                      <span className="h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <p className="text-2xl font-bold text-white">{card.value}</p>
                  <p className={cx("mt-1 text-[11px]", tab === card.key ? "text-cyan-100/80" : "text-slate-400")}>{card.sub}</p>
                </>
              )}
            </button>
          ))}
        </section>

        <div className="mt-6 pb-1">
          <div className="no-scrollbar flex overflow-x-auto gap-1 sm:hidden">
            {visibleTabs.map(([key, label]) => {
              const selected = tab === key;
              return (
                <button
                  key={`mobile-${key}`}
                  type="button"
                  onClick={() => handleTabChange(key)}
                  className={cx(
                    "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition",
                    selected
                      ? "bg-gradient-to-r from-cyan-300/30 to-fuchsia-400/30 text-cyan-100 border border-cyan-300/35"
                      : "border border-white/10 bg-black/20 text-slate-300 hover:text-white"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div
            className="hidden gap-1 rounded-2xl border border-white/10 bg-black/20 p-1 sm:grid"
            style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
          >
            {visibleTabs.map(([key, label]) => {
                const selected = tab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleTabChange(key)}
                    className={cx(
                      "rounded-xl border px-3 py-2 text-sm font-semibold transition",
                      selected
                        ? "border-cyan-300/35 bg-gradient-to-r from-cyan-300/20 to-fuchsia-400/20 text-cyan-100"
                        : "border-transparent text-slate-400 hover:border-white/10 hover:text-white"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
          </div>
        </div>

        <div
          className={cx(
            "mt-6 grid grid-cols-1 gap-6",
            tab === "overview" ? "xl:grid-cols-[minmax(0,2fr)_minmax(280px,360px)]" : "xl:grid-cols-1"
          )}
        >
          <section className="space-y-6">
            {supportingDataError ? (
              <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
                {supportingDataError}
              </div>
            ) : null}
            {panelLoading ? (
              <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <div className="profile-shimmer mb-4 h-5 w-44 rounded-md" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="profile-shimmer h-20 rounded-2xl" />
                  <div className="profile-shimmer h-20 rounded-2xl" />
                  <div className="profile-shimmer h-20 rounded-2xl" />
                  <div className="profile-shimmer h-20 rounded-2xl" />
                </div>
                <div className="mt-4 space-y-3">
                  <div className="profile-shimmer h-4 w-full rounded-md" />
                  <div className="profile-shimmer h-4 w-11/12 rounded-md" />
                  <div className="profile-shimmer h-4 w-9/12 rounded-md" />
                </div>
              </article>
            ) : (
              <div key={tab} className="profile-panel-enter space-y-6">
            {tab === "overview" ? (
              <>
                <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                  <h2 className="mb-4 text-lg font-bold text-white">Profile overview</h2>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        <span className="material-symbols-outlined text-[16px] text-cyan-300">person</span>
                        Roles
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {profile.roles.length ? (
                          profile.roles.map((role) => (
                            <span key={role} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-slate-200">
                              {role}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-slate-400">No roles selected.</span>
                        )}
                      </div>
                    </div>

                    <div>
                      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        <span className="material-symbols-outlined text-[16px] text-cyan-300">language</span>
                        Languages
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {profile.languages.length ? (
                          profile.languages.map((language) => (
                            <span key={language} className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-slate-300">
                              {language}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-slate-400">No languages listed.</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5">
                    <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <span className="material-symbols-outlined text-[16px] text-cyan-300">queue_music</span>
                      Dance styles
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {skillList.length ? (
                        skillList.map((item) => (
                          <span
                            key={item.style}
                            className={cx(
                              "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs",
                              item.verified
                                ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100"
                                : "border-white/10 bg-white/[0.05] text-slate-200"
                            )}
                          >
                            {titleCase(item.style)}
                            {item.level ? <span className="text-slate-300">({formatDanceLevelLabel(item.level)})</span> : null}
                            {item.verified ? (
                              <span className="material-symbols-outlined fill-1 text-[12px] text-[#00F5FF]" title="Verified">
                                verified
                              </span>
                            ) : null}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-400">No dance styles listed.</span>
                      )}
                    </div>
                  </div>

                  {profileMedia.length ? (
                    <div className="mt-5">
                      <ProfileMediaShowcase
                        media={profileMedia}
                        isOwner={isSelf}
                        onManage={
                          isSelf
                            ? () => {
                                router.push("/me/edit/media");
                              }
                            : undefined
                        }
                      />
                    </div>
                  ) : null}

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        <span className="material-symbols-outlined text-[14px] text-cyan-300">favorite</span>
                        Interest
                      </p>
                      <p className="text-sm text-slate-200">{primaryInterest ?? "Not shared"}</p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        <span className="material-symbols-outlined text-[14px] text-cyan-300">schedule</span>
                        Availability
                      </p>
                      <p className="text-sm text-slate-200">{availabilityLabel ?? "Not shared"}</p>
                    </div>
                  </div>
                </article>

              </>
            ) : null}

            {tab === "references" ? isSelf ? (
              <ReferencesHubView embedded initialConnectionId={requestedReferenceConnectionId} />
            ) : (
              <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <div className="mb-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Direction
                      <select
                        value={referenceDirectionFilter}
                        onChange={(event) => setReferenceDirectionFilter(event.target.value as ReferenceDirectionFilter)}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium normal-case text-white outline-none transition focus:border-cyan-300/35"
                      >
                        <option value="all">All ({referenceStats.total})</option>
                        <option value="received">Received ({referenceStats.received})</option>
                        <option value="given">Given ({referenceStats.given})</option>
                      </select>
                    </label>

                    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Category
                      <select
                        value={referenceContextFilter}
                        onChange={(event) => setReferenceContextFilter(event.target.value as ReferenceContextFilter)}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium normal-case text-white outline-none transition focus:border-cyan-300/35"
                      >
                        <option value="all">All categories</option>
                        {REFERENCE_CONTEXT_TAGS.map((tag) => (
                          <option key={tag} value={tag}>
                            {referenceContextLabel(tag)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Sort
                      <select
                        value={referenceSortFilter}
                        onChange={(event) => setReferenceSortFilter(event.target.value as ReferenceSortFilter)}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium normal-case text-white outline-none transition focus:border-cyan-300/35"
                      >
                        <option value="latest">Latest</option>
                        <option value="oldest">Oldest</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="space-y-3">
                  {filteredReferences.length === 0 ? (
                    <EmptyPanel
                      icon="forum"
                      title="No references for this filter"
                      detail="Try another direction, category, or sort to explore this member's feedback."
                    />
                  ) : (
                    filteredReferences.map((item) => {
                      const counterpartId = item.direction === "given" ? item.recipientId : item.authorId;
                      const counterpartProfile =
                        counterpartId === profileUserId
                          ? { displayName: profile?.displayName ?? "Member", avatarUrl: profile?.avatarUrl ?? null }
                          : profilesById[counterpartId] ?? null;
                      const counterpartName = counterpartProfile?.displayName ?? referenceAuthors[counterpartId] ?? "Member";
                      return (
                        <article key={item.id} className="rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(22,22,24,0.96),rgba(13,14,18,0.96))] p-5 shadow-[0_18px_44px_rgba(0,0,0,0.22)]">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex gap-4">
                              <Avatar
                                src={counterpartProfile?.avatarUrl ?? null}
                                alt={counterpartName}
                                size={48}
                                className="h-12 w-12 rounded-full border-2 border-white/10"
                              />
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="text-xl font-bold text-white">{counterpartName}</h4>
                                  <span
                                    className={cx(
                                      "rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-tight",
                                      item.direction === "given"
                                        ? "border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-100"
                                        : "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
                                    )}
                                  >
                                    {item.direction === "given" ? "Given" : "Received"}
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                  <span
                                    className={cx(
                                      "rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase",
                                      contextBadge(item.context)
                                    )}
                                  >
                                    {referenceContextLabel(item.context)}
                                  </span>
                                  <span>{formatDate(item.createdAt)}</span>
                                </div>
                              </div>
                            </div>
                            <span className={cx("rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase", sentimentBadge(item.sentiment))}>
                              {item.sentiment}
                            </span>
                          </div>

                          <div className="mt-4 pl-16">
                            <p className="text-base italic leading-relaxed text-slate-200">
                              &ldquo;{item.body}&rdquo;
                            </p>

                            {item.replyText ? (
                              <div className="mt-5 rounded-2xl border border-cyan-300/18 bg-[#0f1621] p-4">
                                <div className="flex gap-3">
                                  <Avatar
                                    src={profile?.avatarUrl ?? null}
                                    alt={profile?.displayName ?? "Member"}
                                    size={32}
                                    className="h-8 w-8 rounded-full border border-white/10"
                                  />
                                  <p className="text-sm italic leading-relaxed text-slate-300">
                                    &ldquo;{item.replyText}&rdquo;
                                  </p>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </article>
            ) : null}

            {tab === "dance-tools" && isSelf ? (
              <DashboardEmbedModeProvider value="growth">
                <DashboardPage />
              </DashboardEmbedModeProvider>
            ) : null}

            {tab === "trips" ? (
              <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">

                <div className="space-y-4">
                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-slate-200">Active trips</h3>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {activeTrips.length === 0 ? (
                        <EmptyPanel
                          icon="travel_explore"
                          title="No active trips"
                          detail="When a new trip is published, it will show up here."
                          ctaLabel={pastTrips.length ? "View travel history below" : "Back to overview"}
                          onCta={() => handleTabChange(pastTrips.length ? "trips" : "overview")}
                        />
                      ) : (
                        activeTrips.map((trip) => {
                          const heroUrl = getTripHeroStorageUrl(trip.destinationCountry);
                          const heroStorageFallback = getTripHeroStorageFolderUrl(trip.destinationCountry);
                          const heroFallback = getTripHeroFallbackUrl(trip.destinationCity, trip.destinationCountry);

                          return (
                            <div key={trip.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                              <div className="relative h-28 w-full bg-slate-800">
                                {(heroUrl || heroStorageFallback || heroFallback) ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={heroUrl || heroStorageFallback || heroFallback}
                                    alt={`${trip.destinationCity}, ${trip.destinationCountry}`}
                                    className="h-full w-full object-cover"
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
                                ) : (
                                  <div className="h-full w-full" style={{ background: FALLBACK_GRADIENT }} />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-[#060b0d] via-transparent to-transparent" />
                              </div>

                              <div className="p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-base font-semibold text-white">
                                      {[trip.destinationCity, trip.destinationCountry].filter(Boolean).join(", ") || "Destination not set"}
                                    </p>
                                    <p className="text-xs text-slate-400">{formatDateRange(trip.startDate, trip.endDate)}</p>
                                  </div>
                                  <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">
                                    {trip.purpose}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-slate-200">Past trips</h3>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {pastTrips.length === 0 ? (
                        <EmptyPanel
                          icon="history"
                          title="No past trips"
                          detail="Completed travel history will be visible here."
                          ctaLabel="Back to overview"
                          onCta={() => handleTabChange("overview")}
                        />
                      ) : (
                        pastTrips.map((trip) => (
                          <div key={trip.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                            <div className="flex h-full flex-col justify-between gap-4">
                              <div>
                                <p className="text-base font-semibold text-white">
                                  {[trip.destinationCity, trip.destinationCountry].filter(Boolean).join(", ") || "Destination not set"}
                                </p>
                                <p className="mt-1 text-xs text-slate-400">{formatDateRange(trip.startDate, trip.endDate)}</p>
                              </div>
                              <span className="w-fit rounded-full border border-white/15 bg-white/[0.05] px-3 py-1 text-xs text-slate-300">
                                {trip.purpose}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              </article>
            ) : null}

            {tab === "events" ? (
              <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">

                <div className="space-y-4">
                  {eventsTimeline.length === 0 ? (
                    <EmptyPanel
                      icon="event_busy"
                      title="No event activity yet"
                      detail="Hosted and joined events will appear here when this member starts taking part in events."
                      ctaLabel="Back to overview"
                      onCta={() => handleTabChange("overview")}
                    />
                  ) : (
                    <>
                      <section>
                        <h3 className="mb-3 text-sm font-semibold text-slate-200">Current and upcoming</h3>
                        {upcomingEvents.length === 0 ? (
                          <EmptyPanel
                            icon="event_available"
                            title="No upcoming events"
                            detail="Future joined or hosted events will appear here."
                          />
                        ) : (
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {upcomingEvents.map((item) => (
                              <ProfileEventCard key={`${item.relation}-${item.event.id}`} item={item} />
                            ))}
                          </div>
                        )}
                      </section>

                      <section>
                        <h3 className="mb-3 text-sm font-semibold text-slate-200">Past events</h3>
                        {pastEvents.length === 0 ? (
                          <EmptyPanel
                            icon="history"
                            title="No past events"
                            detail="Completed joined or hosted events will appear here."
                          />
                        ) : (
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {pastEvents.map((item) => (
                              <ProfileEventCard key={`${item.relation}-${item.event.id}`} item={item} />
                            ))}
                          </div>
                        )}
                      </section>
                    </>
                  )}
                </div>
              </article>
            ) : null}

              </div>
            )}
          </section>

          {tab === "overview" ? (
          <aside className="space-y-6">
            <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">Member Trust</h3>
              <div className="space-y-3">
                <section className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <span className="material-symbols-outlined fill-1 text-[15px] text-cyan-300">verified_user</span>
                    Verification
                  </p>
                  <div className="space-y-2 text-xs text-slate-300">
                    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                      <span className="text-slate-400">Status</span>
                      {profile.verified ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/35 bg-emerald-300/12 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
                          <VerifiedBadge size={14} />
                          Verified
                        </span>
                      ) : isSelf ? (
                        <GetVerifiedButton
                          className="inline-flex min-h-8 items-center justify-center rounded-lg bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-3 py-1.5 text-[11px] font-semibold text-[#06121a] hover:brightness-110"
                          returnTo={`/profile/${profile.userId}`}
                          onError={(message) => pushToast("error", message)}
                        >
                          Get verified
                        </GetVerifiedButton>
                      ) : (
                        <span className="font-medium text-slate-400">Not verified</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                      <span className="text-slate-400">Member since</span>
                      <span className="font-semibold text-slate-100">{formatMonthYear(profile.createdAt)}</span>
                    </div>
                  </div>
                </section>

                {showHostingDetails ? (
                  <section className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <span className="material-symbols-outlined text-[15px] text-fuchsia-200">home</span>
                      Hosting details
                    </p>
                    <div className="space-y-2 text-xs text-slate-300">
                      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                        <span className="text-slate-400">Status</span>
                        <span className={cx("font-semibold", hostingAvailable ? "text-emerald-100" : "text-slate-100")}>
                          {hostingAvailable ? "Accepting guests" : "Not accepting guests"}
                        </span>
                      </div>
                      {hostingAvailable ? (
                        <>
                          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                            <span className="text-slate-400">Max guests</span>
                            <span className="font-semibold text-slate-100">{profile.maxGuests ?? "Not set"}</span>
                          </div>
                          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                            <span className="text-slate-400">Last-minute requests</span>
                            <span className="font-semibold text-slate-100">{profile.hostingLastMinuteOk ? "Yes" : "No"}</span>
                          </div>
                          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                            <span className="text-slate-400">Preferred guest gender</span>
                            <span className="font-semibold text-slate-100">{formatGuestGenderPreference(profile.hostingPreferredGuestGender)}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { label: "Kid friendly", value: profile.hostingKidFriendly },
                              { label: "Pet friendly", value: profile.hostingPetFriendly },
                              { label: "Smoking allowed", value: profile.hostingSmokingAllowed },
                            ].map((item) => (
                              <div key={item.label} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                                <p className="text-slate-400">{item.label}</p>
                                <p className="mt-1 font-semibold text-slate-100">{item.value ? "Yes" : "No"}</p>
                              </div>
                            ))}
                            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                              <p className="text-slate-400">Sleeping arrangement</p>
                              <p className="mt-1 font-semibold text-slate-100">{formatSleepingArrangement(profile.hostingSleepingArrangement)}</p>
                            </div>
                          </div>
                          {profile.hostingGuestShare ? (
                            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                              <p className="text-slate-400">What I can share with guests</p>
                              <p className="mt-1 leading-5 text-slate-100">{profile.hostingGuestShare}</p>
                            </div>
                          ) : null}
                          {profile.hostingTransitAccess ? (
                            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                              <p className="text-slate-400">Public transportation access</p>
                              <p className="mt-1 leading-5 text-slate-100">{profile.hostingTransitAccess}</p>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </section>
                ) : null}
              </div>
            </article>

          </aside>
          ) : null}
        </div>

        {profileUserId && profile ? (
          <RequestInfoModal
            open={requestInfoOpen}
            recipientUserId={profileUserId}
            recipientName={profile.displayName}
            onClose={() => setRequestInfoOpen(false)}
            onSubmitted={(message) => setInfoFeedback(message)}
          />
        ) : null}

        <VerificationRequiredDialog
          open={verificationModalOpen}
          resumePayload={profileUserId ? { kind: "profile_hosting_request", profileId: profileUserId } : null}
          onClose={() => setVerificationModalOpen(false)}
          onError={(message) => setErrorFeedback(message)}
          onAlreadyVerified={() => {
            setViewerVerified(true);
            setVerificationModalOpen(false);
            if (profile?.userId) {
              router.push(`/connections?mode=hosts&request_host=${encodeURIComponent(profile.userId)}`);
            }
          }}
        />

        {shareDialogOpen && typeof document !== "undefined"
          ? createPortal(
              <div
                className="fixed inset-0 z-[141] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
                onClick={() => setShareDialogOpen(false)}
              >
                <div
                  className="w-full max-w-sm rounded-2xl border border-white/12 bg-[#0f1419] p-4 shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold text-white/70">Share profile</p>
                    <button
                      type="button"
                      onClick={() => setShareDialogOpen(false)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/40 hover:text-white"
                      aria-label="Close"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                  <div className="flex flex-col gap-3">
                    {/* Social profile */}
                    <div>
                      {isTeacherProfile && (
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-white/40">Social Profile</p>
                      )}
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white/80">
                          {shareDisplayUrl}
                        </div>
                        <button
                          type="button"
                          onClick={() => void copyShareLink()}
                          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-3 text-sm font-semibold text-[#06121a] hover:brightness-110"
                        >
                          <span className="material-symbols-outlined text-[16px]">content_copy</span>
                          Copy
                        </button>
                      </div>
                    </div>
                    {/* Teacher profile — only for teachers */}
                    {isTeacherProfile && teacherShareUrl && (
                      <div>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-white/40">Teacher Profile</p>
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white/80">
                            {teacherShareUrl.replace(/^https?:\/\//, "")}
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(teacherShareUrl);
                                pushToast("success", "Teacher profile link copied");
                              } catch {
                                pushToast("error", "Could not copy link");
                              }
                            }}
                            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-3 text-sm font-semibold text-[#06121a] hover:brightness-110"
                          >
                            <span className="material-symbols-outlined text-[16px]">content_copy</span>
                            Copy
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}

        {actionMenu && typeof document !== "undefined"
          ? createPortal(
              <>
                <div className="fixed inset-0 z-[139]" onClick={closeActionMenu} aria-hidden="true" />
                <div
                  role="menu"
                  className="fixed z-[140] w-[264px] overflow-hidden rounded-xl border border-white/15 bg-[#091117] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.72)]"
                  style={{
                    top: actionMenu.anchorY,
                    left: actionMenu.left,
                    transform: actionMenu.placement === "above" ? "translateY(-100%)" : undefined,
                    backgroundColor: "#091117",
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  {canRequestInfo ? (
                    <button
                      type="button"
                      onClick={() => {
                        closeActionMenu();
                        setRequestInfoOpen(true);
                      }}
                      className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-cyan-100 hover:bg-cyan-300/15"
                    >
                      <span className="material-symbols-outlined text-[16px]">school</span>
                      Request Teaching Info
                    </button>
                  ) : null}
                  {hostingAvailable ? (
                    <button
                      type="button"
                      onClick={() => {
                        closeActionMenu();
                        if (viewerVerified) {
                          router.push(`/connections?mode=hosts&request_host=${encodeURIComponent(profile.userId)}`);
                          return;
                        }
                        setVerificationModalOpen(true);
                      }}
                      className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-fuchsia-100 hover:bg-fuchsia-300/15"
                    >
                      <span className="material-symbols-outlined text-[16px]">home</span>
                      Request Hosting
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      closeActionMenu();
                      void shareProfile();
                    }}
                    className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10"
                  >
                    <span className="material-symbols-outlined text-[16px]">share</span>
                    Share profile
                  </button>
                  {state.status === "accepted" && state.id !== "self" ? (
                    <button
                      type="button"
                      onClick={() => {
                        closeActionMenu();
                        void toggleFollowingMember();
                      }}
                      disabled={followingBusy}
                      className={cx(
                        "mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10 disabled:opacity-60",
                        contactFollowing ? "text-emerald-100" : "text-white/90"
                      )}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {contactFollowing ? "check" : "person_add"}
                      </span>
                      {followingBusy ? "Updating..." : contactFollowing ? "Following" : "Add to Following"}
                    </button>
                  ) : null}
                  {state.status === "pending" && state.role === "target" ? (
                    <button
                      type="button"
                      onClick={() => {
                        closeActionMenu();
                        void declineRequest();
                      }}
                      disabled={busy}
                      className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10 disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                      Decline request
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      closeActionMenu();
                      void reportMember();
                    }}
                    disabled={busy}
                    className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-amber-100 hover:bg-amber-300/15 disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined text-[16px]">flag</span>
                    Report member
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      closeActionMenu();
                      void blockMember();
                    }}
                    disabled={busy || state.status === "blocked"}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-100 hover:bg-rose-300/15 disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined text-[16px]">block</span>
                    {state.status === "blocked" ? "Blocked" : "Block member"}
                  </button>
                </div>
              </>,
              document.body
            )
          : null}

        {avatarLightboxOpen ? (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
            onClick={() => setAvatarLightboxOpen(false)}
          >
            <div
              className="relative w-full max-w-[960px] overflow-hidden rounded-3xl border border-white/15 bg-[#0b141a] p-3 shadow-[0_30px_90px_rgba(0,0,0,0.65)]"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setAvatarLightboxOpen(false)}
                className="absolute right-4 top-4 z-10 rounded-full border border-white/20 bg-black/45 p-1.5 text-white/90 hover:bg-black/70"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
              <div className="flex max-h-[84vh] min-h-[320px] w-full items-center justify-center overflow-hidden rounded-2xl bg-black">
                {profile.avatarUrl && !avatarPreviewFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatarUrl}
                    alt={profile.displayName}
                    className="h-full w-full object-contain"
                    loading="eager"
                    onError={() => setAvatarPreviewFailed(true)}
                  />
                ) : (
                  <Avatar src={profile.avatarUrl} alt={profile.displayName} size={420} className="rounded-2xl border-none" />
                )}
              </div>
              <p className="mt-2 text-center text-[11px] text-slate-500">Tap outside to close</p>
            </div>
          </div>
        ) : null}

        {mobileSettingsOpen ? (
          <div
            className="fixed inset-0 z-[130] flex items-end bg-black/75 px-0 backdrop-blur-sm sm:hidden"
            onClick={() => setMobileSettingsOpen(false)}
          >
            <div
              className="w-full rounded-t-[28px] border border-white/10 bg-[#0b141a] px-4 pb-5 pt-4 shadow-[0_-24px_60px_rgba(0,0,0,0.5)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200/80">Settings</p>
                  <p className="mt-1 text-sm text-slate-300">Quick access to the same profile and account actions available in the web app settings menu.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileSettingsOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/25 text-slate-200"
                  aria-label="Close settings menu"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {mobileSettingsLinks.map((item) => (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => {
                      setMobileSettingsOpen(false);
                      router.push(item.href);
                    }}
                    className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm text-white/85"
                  >
                    <span className="inline-flex items-center gap-3">
                      <span className="material-symbols-outlined text-[18px] text-cyan-200/90">{item.icon}</span>
                      {item.label}
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-slate-500">chevron_right</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setMobileSettingsOpen(false);
                    void signOutFromProfile();
                  }}
                  className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm text-white/85"
                >
                  <span className="inline-flex items-center gap-3">
                    <span className="material-symbols-outlined text-[18px] text-slate-200">logout</span>
                    Logout
                  </span>
                  <span className="material-symbols-outlined text-[18px] text-slate-500">chevron_right</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <style jsx>{`
          .profile-panel-enter {
            animation: profilePanelIn 220ms ease-out;
          }

          .profile-shimmer {
            position: relative;
            overflow: hidden;
            background: rgba(148, 163, 184, 0.14);
          }

          .profile-shimmer::after {
            content: "";
            position: absolute;
            inset: 0;
            transform: translateX(-120%);
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.32), transparent);
            animation: profileShimmer 1.2s linear infinite;
          }

          .toast-in {
            animation: toastIn 180ms ease-out;
          }

          .hero-ambient {
            position: absolute;
            border-radius: 9999px;
            filter: blur(60px);
            opacity: 0.45;
            animation: heroDrift 14s ease-in-out infinite;
          }

          .hero-ambient--left {
            left: -10%;
            top: -42%;
            height: 210px;
            width: 210px;
            background: radial-gradient(circle, rgba(34, 211, 238, 0.3), transparent 70%);
          }

          .hero-ambient--right {
            right: -12%;
            top: -40%;
            height: 240px;
            width: 240px;
            background: radial-gradient(circle, rgba(232, 121, 249, 0.28), transparent 72%);
            animation-delay: -5s;
          }

          .hero-noise {
            position: absolute;
            inset: 0;
            opacity: 0.07;
            background-image: radial-gradient(rgba(255, 255, 255, 0.7) 0.8px, transparent 0.8px);
            background-size: 3px 3px;
            mix-blend-mode: soft-light;
          }

          .metric-card {
            opacity: 0;
            transform: translateY(8px);
          }

          .metric-card--show {
            animation: metricCardIn 360ms ease-out forwards;
          }

          .material-symbols-outlined {
            text-transform: none;
            font-feature-settings: "liga" 1;
            letter-spacing: normal;
            word-spacing: normal;
            white-space: nowrap;
            direction: ltr;
          }

          @keyframes profilePanelIn {
            from {
              opacity: 0;
              transform: translateY(6px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          @keyframes profileShimmer {
            100% {
              transform: translateX(120%);
            }
          }

          @keyframes toastIn {
            from {
              opacity: 0;
              transform: translateY(-6px) scale(0.98);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }

          @keyframes metricCardIn {
            from {
              opacity: 0;
              transform: translateY(8px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          @keyframes heroDrift {
            0%,
            100% {
              transform: translate3d(0, 0, 0);
            }
            50% {
              transform: translate3d(0, 10px, 0);
            }
          }
        `}</style>
      </main>

      {profile && profileUserId && (
        <DarkConnectModal
          open={connectModalOpen}
          onClose={() => {
            setConnectModalOpen(false);
            if (meId) void refreshPairConnectionState(meId);
          }}
          targetUserId={profileUserId}
          targetName={profile.displayName}
          targetPhotoUrl={profile.avatarUrl}
        />
      )}
    </div>
  );
}

export default function MemberProfilePageRoute() {
  return <MemberProfilePage />;
}
