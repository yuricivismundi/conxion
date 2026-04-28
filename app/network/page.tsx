"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Avatar from "@/components/Avatar";
import Nav from "@/components/Nav";
import PaginationControls from "@/components/PaginationControls";
import VerifiedBadge from "@/components/VerifiedBadge";
import { fetchVisibleConnections } from "@/lib/connections/read-model";
import { isSchemaMissingError } from "@/lib/growth/types";
import { supabase } from "@/lib/supabase/client";

const CORE_DANCE_STYLES = ["bachata", "salsa", "kizomba", "tango", "zouk"] as const;

type NetworkTab = "feed" | "connections" | "references" | "following" | "contacts";

type EventActivity = {
  eventId: string;
  title: string;
  city: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  attendees: Array<{ userId: string; displayName: string; avatarUrl: string | null }>;
};
type ConnectionView = "all" | "recent" | "following";
type ContactType = "member" | "external";
type TrackActivity = "travel_plans" | "hosting_availability" | "new_references" | "competition_results";

type ProfileLite = {
  userId: string;
  displayName: string;
  city: string;
  country: string;
  avatarUrl: string | null;
  roles: string[];
  danceStyles: string[];
  availability: string[];
  verified: boolean;
};

type ConnectionItem = {
  id: string;
  otherUserId: string;
  createdAt: string | null;
  profile: ProfileLite | null;
};

type ContactRow = {
  id: string;
  userId: string;
  contactType: ContactType;
  linkedUserId: string | null;
  name: string;
  roles: string[];
  city: string;
  country: string;
  danceStyles: string[];
  tags: string[];
  notes: string | null;
  meetingContext: string | null;
  isFollowing: boolean;
  trackActivity: TrackActivity[];
  updatedAt: string;
  createdAt: string;
};

type TripActivity = {
  city: string;
  country: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string | null;
};

type HostingActivity = {
  canHost: boolean;
  hostingStatus: string | null;
};

type ReferenceActivity = {
  total: number;
  recent30d: number;
  latestAt: string | null;
};

type CompetitionActivity = {
  total: number;
  latestAt: string | null;
  latestEventName: string | null;
  latestResult: string | null;
};

type ContactCard = {
  id: string;
  contactType: ContactType;
  linkedUserId: string | null;
  displayName: string;
  city: string;
  country: string;
  avatarUrl: string | null;
  roles: string[];
  danceStyles: string[];
  tags: string[];
  notes: string | null;
  meetingContext: string | null;
  isFollowing: boolean;
  trackActivity: TrackActivity[];
  statusIndicators: string[];
  travelActivity: TripActivity | null;
  hostingActivity: HostingActivity | null;
  referenceActivity: ReferenceActivity;
  competitionActivity: CompetitionActivity;
  updatedAt: string;
  createdAt: string;
};

type FeedItem = {
  id: string;
  contactName: string;
  avatarUrl: string | null;
  type: TrackActivity;
  title: string;
  body: string;
  at: string | null;
};

type EditDraft = {
  tags: string;
  meetingContext: string;
  notes: string;
  roles: string;
  danceStyles: string;
};

type AddDraft = {
  name: string;
  city: string;
  country: string;
  roles: string;
  danceStyles: string;
  tags: string;
  meetingContext: string;
  notes: string;
};

type InfoTooltipProps = {
  title: string;
  body: string;
};

const NETWORK_PAGE_SIZE = 25;
const CONNECTIONS_PAGE_SIZE = 40; // 4 cols × 10 rows

const TRACK_ACTIVITY_OPTIONS: Array<{ key: TrackActivity; label: string; shortLabel: string; hint: string }> = [
  {
    key: "travel_plans",
    label: "Travel plans",
    shortLabel: "Travel",
    hint: "Upcoming trips and destinations.",
  },
  {
    key: "hosting_availability",
    label: "Hosting availability",
    shortLabel: "Hosting",
    hint: "When this dancer opens hosting.",
  },
  {
    key: "new_references",
    label: "New references",
    shortLabel: "References",
    hint: "Recent trust updates.",
  },
  {
    key: "competition_results",
    label: "Competition results",
    shortLabel: "Competitions",
    hint: "Latest competition entries.",
  },
];

const DEFAULT_TRACK_ACTIVITY: TrackActivity[] = TRACK_ACTIVITY_OPTIONS.map((item) => item.key);
const TAB_ORDER: NetworkTab[] = ["feed", "connections", "references", "following", "contacts"];
const ReferencesHubView = dynamic(() => import("@/components/network/ReferencesHubView"), {
  ssr: false,
  loading: () => (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-xl border border-white/10 bg-[#121212]">
        <div className="flex flex-col divide-y divide-white/10 md:flex-row md:divide-x md:divide-y-0">
          <div className="w-full px-8 py-6 md:w-1/4">
            <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
            <div className="mt-4 h-10 w-20 animate-pulse rounded bg-white/10" />
          </div>
          <div className="flex-1 px-8 py-6">
            <div className="h-3 w-36 animate-pulse rounded bg-white/10" />
            <div className="mt-5 h-2 w-full animate-pulse rounded-full bg-white/10" />
            <div className="mt-4 flex gap-4">
              <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
            </div>
          </div>
          <div className="w-full px-8 py-6 md:w-[22%]">
            <div className="mx-auto h-3 w-24 animate-pulse rounded bg-white/10" />
            <div className="mx-auto mt-4 h-12 w-24 animate-pulse rounded bg-white/10" />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-8 lg:flex-row">
        <aside className="w-full shrink-0 lg:w-64 space-y-8">
          <div className="rounded-xl border border-white/10 bg-[#101317] p-4">
            <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
            <div className="mt-4 space-y-2">
              {[0, 1, 2, 3].map((idx) => (
                <div key={idx} className="h-10 animate-pulse rounded-lg bg-white/[0.05]" />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#101317] p-4">
            <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
            <div className="mt-4 space-y-2">
              {[0, 1, 2, 3, 4].map((idx) => (
                <div key={idx} className="h-10 animate-pulse rounded-lg bg-white/[0.05]" />
              ))}
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-4">
          {[0, 1, 2].map((idx) => (
            <article key={idx} className="rounded-xl border border-white/10 bg-[#121212] p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-4">
                  <div className="h-12 w-12 animate-pulse rounded-full border border-white/10 bg-white/[0.04]" />
                  <div className="space-y-3">
                    <div className="h-5 w-40 animate-pulse rounded bg-white/10" />
                    <div className="h-3 w-56 animate-pulse rounded bg-white/10" />
                  </div>
                </div>
                <div className="h-6 w-6 animate-pulse rounded-full bg-white/10" />
              </div>
              <div className="mt-6 space-y-3 pl-16">
                <div className="h-4 w-full animate-pulse rounded bg-white/10" />
                <div className="h-4 w-[92%] animate-pulse rounded bg-white/10" />
                <div className="h-4 w-[78%] animate-pulse rounded bg-white/10" />
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  ),
});

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(row: Record<string, unknown>, key: string, fallback = "") {
  const value = row[key];
  return typeof value === "string" ? value : fallback;
}

function pickNullableString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function InfoTooltip({ title, body }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | undefined>(undefined);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button || typeof window === "undefined") return;

      const rect = button.getBoundingClientRect();
      const viewportPadding = 16;
      const width = Math.min(288, Math.max(180, window.innerWidth - viewportPadding * 2));
      const estimatedHeight = tooltipRef.current?.offsetHeight ?? 132;
      const fitsBelow = rect.bottom + 8 + estimatedHeight <= window.innerHeight - viewportPadding;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - width),
        window.innerWidth - width - viewportPadding
      );
      const top = fitsBelow
        ? rect.bottom + 8
        : Math.max(viewportPadding, rect.top - estimatedHeight - 8);

      setTooltipStyle({ left, top, width });
    };

    updatePosition();

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && !containerRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        onFocus={() => setOpen(true)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-slate-400 transition hover:border-cyan-300/35 hover:text-cyan-100"
      >
        <span className="material-symbols-outlined text-[14px]">info</span>
      </button>
      <div
        ref={tooltipRef}
        style={tooltipStyle}
        className={[
          "fixed z-20 rounded-2xl border border-white/12 bg-[#101317] p-3 text-left shadow-[0_16px_40px_rgba(0,0,0,0.35)] transition",
          open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0",
        ].join(" ")}
        role="tooltip"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">{title}</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">{body}</p>
      </div>
    </div>
  );
}

function normalizeCsvList(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseTags(value: string) {
  const unique = new Set<string>();
  const tags: string[] = [];
  for (const item of normalizeCsvList(value)) {
    const normalized = normalizeToken(item);
    if (!normalized || unique.has(normalized)) continue;
    unique.add(normalized);
    tags.push(normalized);
  }
  return tags;
}

function parseLabels(value: string) {
  const unique = new Set<string>();
  const labels: string[] = [];
  for (const item of normalizeCsvList(value)) {
    const normalized = item.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (unique.has(key)) continue;
    unique.add(key);
    labels.push(normalized);
  }
  return labels;
}

function normalizeActivityArray(value: unknown) {
  const allowed = new Set<TrackActivity>(TRACK_ACTIVITY_OPTIONS.map((item) => item.key));
  const picked: TrackActivity[] = [];
  const seen = new Set<string>();
  for (const item of asStringArray(value)) {
    const normalized = normalizeToken(item) as TrackActivity;
    if (!allowed.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    picked.push(normalized);
  }
  return picked;
}

function toMs(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = new Date(value);
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatRelative(value: string | null | undefined) {
  const time = toMs(value);
  if (!time) return "Recently";
  const diff = Date.now() - time;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function titleCase(value: string) {
  if (!value) return value;
  return value
    .split(/\s+/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function mergeDuplicateContacts(rows: ContactRow[]) {
  const dedupedMembers = new Map<string, ContactRow>();
  const passthrough: ContactRow[] = [];

  for (const row of rows) {
    if (row.contactType !== "member" || !row.linkedUserId) {
      passthrough.push(row);
      continue;
    }

    const existing = dedupedMembers.get(row.linkedUserId);
    if (!existing) {
      dedupedMembers.set(row.linkedUserId, row);
      continue;
    }

    const representative =
      existing.isFollowing !== row.isFollowing
        ? existing.isFollowing
          ? existing
          : row
        : toMs(existing.updatedAt) >= toMs(row.updatedAt)
          ? existing
          : row;
    const mergedIsFollowing = existing.isFollowing || row.isFollowing;

    dedupedMembers.set(row.linkedUserId, {
      ...representative,
      roles: uniqueValues([...existing.roles, ...row.roles]),
      danceStyles: uniqueValues([...existing.danceStyles, ...row.danceStyles]),
      tags: uniqueValues([...existing.tags, ...row.tags]).map((tag) => normalizeToken(tag)),
      notes: representative.notes ?? existing.notes ?? row.notes,
      meetingContext: representative.meetingContext ?? existing.meetingContext ?? row.meetingContext,
      isFollowing: mergedIsFollowing,
      trackActivity: mergedIsFollowing ? normalizeActivityArray([...existing.trackActivity, ...row.trackActivity]) : [],
      createdAt:
        toMs(existing.createdAt) && toMs(row.createdAt)
          ? toMs(existing.createdAt) <= toMs(row.createdAt)
            ? existing.createdAt
            : row.createdAt
          : existing.createdAt || row.createdAt,
      updatedAt: toMs(existing.updatedAt) >= toMs(row.updatedAt) ? existing.updatedAt : row.updatedAt,
    });
  }

  return [...passthrough, ...dedupedMembers.values()].sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt));
}

function getActiveTab(value: string | null): NetworkTab {
  if (!value) return "feed";
  const normalized = value.toLowerCase();
  if (normalized === "saved") return "following";
  if (TAB_ORDER.includes(normalized as NetworkTab)) {
    return normalized as NetworkTab;
  }
  return "feed";
}

function tabHref(tab: NetworkTab) {
  return tab === "feed" ? "/network" : `/network?tab=${tab}`;
}

function hasRole(roles: string[], keyword: string) {
  const needle = normalizeToken(keyword);
  return roles.some((role) => normalizeToken(role).includes(needle));
}

function isColumnMissingError(message: string) {
  const text = message.toLowerCase();
  return text.includes("column") && text.includes("does not exist");
}

function contactCardMatchesFilters(
  card: ContactCard,
  filters: {
    needle: string;
    cityFilter: string;
    styleFilter: string;
    styleText: string;
    roleFilter: string;
    activityFilter: "all" | TrackActivity;
  }
) {
  if (filters.cityFilter !== "all") {
    const cityLabel = [card.city, card.country].filter(Boolean).join(", ");
    if (cityLabel !== filters.cityFilter) return false;
  }

  if (filters.styleFilter !== "all") {
    const styles = card.danceStyles.map((s) => s.toLowerCase());
    if (filters.styleFilter === "other") {
      const needle = filters.styleText.trim().toLowerCase();
      if (needle && !styles.some((s) => s.includes(needle))) return false;
    } else {
      if (!styles.includes(filters.styleFilter.toLowerCase())) return false;
    }
  }

  if (filters.roleFilter !== "all") {
    const inRoles = card.roles.some((role) => role.toLowerCase() === filters.roleFilter.toLowerCase());
    const inStatus = card.statusIndicators.some((status) => status.toLowerCase() === filters.roleFilter.toLowerCase());
    if (!inRoles && !inStatus) return false;
  }

  if (filters.activityFilter !== "all") {
    if (filters.activityFilter === "travel_plans" && !card.travelActivity) return false;
    if (filters.activityFilter === "hosting_availability" && !(card.hostingActivity?.canHost ?? false)) return false;
    if (filters.activityFilter === "new_references" && card.referenceActivity.recent30d <= 0) return false;
    if (filters.activityFilter === "competition_results" && card.competitionActivity.total <= 0) return false;
  }

  if (!filters.needle) return true;

  const haystack = [
    card.displayName,
    card.city,
    card.country,
    card.notes,
    card.meetingContext,
    ...card.tags,
    ...card.roles,
    ...card.danceStyles,
    ...card.statusIndicators,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(filters.needle);
}

function GenericAvatar() {
  return (
    <div className="flex h-full w-full items-end justify-center overflow-hidden rounded-2xl bg-gradient-to-b from-white/[0.06] to-white/[0.03]">
      <svg viewBox="0 0 60 72" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-[70%]">
        <ellipse cx="30" cy="22" rx="13" ry="13" fill="rgba(255,255,255,0.12)" />
        <path d="M4 66c0-14.36 11.64-26 26-26s26 11.64 26 26" fill="rgba(255,255,255,0.08)" />
      </svg>
    </div>
  );
}

function useFixedDropdown() {
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (dropRef.current?.contains(t)) return;
      setOpen(false);
    }
    function handleScroll() { setOpen(false); }
    document.addEventListener("click", handleClick, true);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  function toggle() {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen((v) => !v);
  }

  return { btnRef, dropRef, rect, open, setOpen, toggle };
}

function FixedDropdown({ rect, dropRef, children }: { rect: DOMRect; dropRef: React.RefObject<HTMLDivElement | null>; children: React.ReactNode }) {
  const top = rect.bottom + 6;
  const right = window.innerWidth - rect.right;
  return (
    <div
      ref={dropRef}
      style={{ position: "fixed", top, right, zIndex: 9999 }}
      className="min-w-[180px] overflow-hidden rounded-2xl border border-white/10 bg-[#111] shadow-2xl"
    >
      {children}
    </div>
  );
}

function ConnectionCardMenu({
  connId,
  isFollowing,
  contactId,
  onUnfollow,
  onRemove,
}: {
  connId: string;
  isFollowing: boolean;
  contactId: string | null;
  onUnfollow: () => void;
  onRemove: () => void;
}) {
  const { btnRef, dropRef, rect, open, toggle } = useFixedDropdown();

  async function handleUnfollow() {
    if (!contactId) return;
    onUnfollow();
    await supabase.from("contacts").update({ is_following: false }).eq("id", contactId);
  }

  async function handleRemove() {
    onRemove();
    const { data: authData } = await supabase.auth.getSession();
    const token = authData.session?.access_token;
    if (!token) return;
    await fetch("/api/connections/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ connId, action: "remove" }),
    });
  }

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="flex h-10 w-6 shrink-0 items-center justify-center text-white/50 transition-colors hover:text-white"
        aria-label="Connection options"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 22, lineHeight: 1, fontVariationSettings: "'wght' 700" }}>more_vert</span>
      </button>
      {open && rect ? (
        <FixedDropdown rect={rect} dropRef={dropRef}>
          {isFollowing ? (
            <button type="button" onClick={() => void handleUnfollow()} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-white/80 hover:bg-white/[0.06]">
              <span className="material-symbols-outlined text-[16px] text-white/40">person_off</span>
              Unfollow
            </button>
          ) : null}
          <button type="button" onClick={() => void handleRemove()} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-rose-400 hover:bg-white/[0.06]">
            <span className="material-symbols-outlined text-[16px]">link_off</span>
            Remove connection
          </button>
        </FixedDropdown>
      ) : null}
    </div>
  );
}

function FollowingCardMenu({
  contactId,
  onUnfollow,
}: {
  contactId: string;
  onUnfollow: () => void;
}) {
  const { btnRef, dropRef, rect, open, toggle } = useFixedDropdown();
  async function handleUnfollow() {
    onUnfollow();
    await supabase.from("contacts").update({ is_following: false }).eq("id", contactId);
  }
  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="flex h-10 w-6 shrink-0 items-center justify-center text-white/50 transition-colors hover:text-white"
        aria-label="Following options"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 22, lineHeight: 1, fontVariationSettings: "'wght' 700" }}>more_vert</span>
      </button>
      {open && rect ? (
        <FixedDropdown rect={rect} dropRef={dropRef}>
          <button type="button" onClick={() => void handleUnfollow()} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-white/80 hover:bg-white/[0.06]">
            <span className="material-symbols-outlined text-[16px] text-white/40">person_off</span>
            Unfollow
          </button>
        </FixedDropdown>
      ) : null}
    </div>
  );
}

function ContactCardMenu({
  card,
  busyContactId,
  onEditContact,
  onEditNote,
  onRemove,
}: {
  card: { id: string; linkedUserId?: string | null };
  busyContactId: string | null;
  onEditContact: () => void;
  onEditNote: () => void;
  onRemove: () => void;
}) {
  const { btnRef, dropRef, rect, open, toggle } = useFixedDropdown();

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="flex h-10 w-6 shrink-0 items-center justify-center text-white/50 transition-colors hover:text-white"
        aria-label="Contact options"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 22, lineHeight: 1, fontVariationSettings: "'wght' 700" }}>more_vert</span>
      </button>
      {open && rect ? (
        <FixedDropdown rect={rect} dropRef={dropRef}>
          {card.linkedUserId ? (
            <button type="button" onClick={() => onEditContact()} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-white/80 hover:bg-white/[0.06]">
              <span className="material-symbols-outlined text-[16px] text-white/40">person_edit</span>
              Edit Contact
            </button>
          ) : null}
          <button type="button" onClick={() => onEditNote()} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-white/80 hover:bg-white/[0.06]">
            <span className="material-symbols-outlined text-[16px] text-white/40">edit_note</span>
            Edit Note
          </button>
          <button type="button" onClick={() => onRemove()} disabled={busyContactId === card.id} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-rose-400 hover:bg-white/[0.06] disabled:opacity-60">
            <span className="material-symbols-outlined text-[16px]">person_remove</span>
            Remove
          </button>
        </FixedDropdown>
      ) : null}
    </div>
  );
}

function NetworkPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = getActiveTab(searchParams.get("tab"));
  const referenceConnectionId = searchParams.get("connectionId");
  const referenceUserId = searchParams.get("userId");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);
  const [myCity, setMyCity] = useState<string>("");
  const [myCountry, setMyCountry] = useState<string>("");

  const [eventActivities, setEventActivities] = useState<EventActivity[]>([]);
  const [followersCount, setFollowersCount] = useState<number>(0);
  const [followerProfiles, setFollowerProfiles] = useState<Array<{ userId: string; displayName: string; avatarUrl: string | null }>>([]);
  const [networkSection, setNetworkSection] = useState<"feed" | "connections" | "following" | "contacts">("feed");
  const [followingListPage, setFollowingListPage] = useState(1);
  const [followersListPage, setFollowersListPage] = useState(1);
  const [followQuery, setFollowQuery] = useState("");
  const [connections, setConnections] = useState<ConnectionItem[]>([]);

  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [supportsRichContacts, setSupportsRichContacts] = useState(true);

  const [memberProfiles, setMemberProfiles] = useState<Record<string, ProfileLite>>({});
  const [tripByUser, setTripByUser] = useState<Record<string, TripActivity>>({});
  const [hostingByUser, setHostingByUser] = useState<Record<string, HostingActivity>>({});
  const [referenceByUser, setReferenceByUser] = useState<Record<string, ReferenceActivity>>({});
  const [competitionByUser, setCompetitionByUser] = useState<Record<string, CompetitionActivity>>({});

  const [referencesReceivedCount, setReferencesReceivedCount] = useState(0);
  const [referencesGivenCount, setReferencesGivenCount] = useState(0);

  const [query, setQuery] = useState("");
  const [connectionView, setConnectionView] = useState<ConnectionView>("all");
  const [showConnectionFilters, setShowConnectionFilters] = useState(false);
  const [showContactFilters, setShowContactFilters] = useState(false);
  const [connectionsPage, setConnectionsPage] = useState(1);
  const [contactsPage, setContactsPage] = useState(1);
  const [connectionCityFilter, setConnectionCityFilter] = useState("all");
  const [connectionStyleFilter, setConnectionStyleFilter] = useState("all");
  const [connectionStyleText, setConnectionStyleText] = useState("");
  const [connectionRoleFilter, setConnectionRoleFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [styleFilter, setStyleFilter] = useState("all");
  const [styleText, setStyleText] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState<"all" | TrackActivity>("all");

  const [editContactId, setEditContactId] = useState<string | null>(null);

  const [feedSearch, setFeedSearch] = useState("");

  // Scroll refs for activity feed rows
  const scrollFollowingRef = useRef<HTMLDivElement>(null);
  const scrollTravelRef = useRef<HTMLDivElement>(null);
  const scrollCityRef = useRef<HTMLDivElement>(null);
  const scrollEventsRef = useRef<HTMLDivElement>(null);
  const scrollHostingRef = useRef<HTMLDivElement>(null);

  function scrollRow(ref: React.RefObject<HTMLDivElement | null>, dir: "left" | "right") {
    if (!ref.current) return;
    ref.current.scrollBy({ left: dir === "right" ? 280 : -280, behavior: "smooth" });
  }
  const [editDraft, setEditDraft] = useState<EditDraft>({
    tags: "",
    meetingContext: "",
    notes: "",
    roles: "",
    danceStyles: "",
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>({
    name: "",
    city: "",
    country: "",
    roles: "",
    danceStyles: "",
    tags: "",
    meetingContext: "",
    notes: "",
  });

  const [busyContactId, setBusyContactId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (activeTab !== "references" || !meId) return;
    const params = new URLSearchParams();
    params.set("tab", "references");
    if (referenceConnectionId) {
      params.set("connectionId", referenceConnectionId);
    }
    if (referenceUserId) {
      params.set("userId", referenceUserId);
    }
    router.replace(`/profile/${encodeURIComponent(meId)}?${params.toString()}`);
  }, [activeTab, meId, referenceConnectionId, referenceUserId, router]);

  useEffect(() => {
    let cancelled = false;

    async function loadNetwork() {
      setLoading(true);
      setError(null);
      setInfo(null);

      const authRes = await supabase.auth.getUser();
      const user = authRes.data.user;
      if (!user) {
        router.replace("/auth?next=/network");
        return;
      }
      if (cancelled) return;
      setMeId(user.id);

      try {
        const [visibleRows, contactsLoad] = await Promise.all([
          fetchVisibleConnections(supabase, user.id),
          (async () => {
            const richColumns =
              "id,user_id,contact_type,linked_user_id,name,role,city,country,tags,notes,meeting_context,is_following,track_activity,dance_styles,created_at,updated_at";
            const baseColumns = "id,user_id,contact_type,linked_user_id,name,role,city,country,tags,notes,created_at,updated_at";

            let rich = true;
            let res = (await supabase
              .from("dance_contacts")
              .select(richColumns)
              .eq("user_id", user.id)
              .order("updated_at", { ascending: false })
              .limit(140)) as { data: unknown[] | null; error: { message: string } | null };

            if (res.error && isColumnMissingError(res.error.message)) {
              rich = false;
              res = (await supabase
                .from("dance_contacts")
                .select(baseColumns)
                .eq("user_id", user.id)
                .order("updated_at", { ascending: false })
                .limit(140)) as { data: unknown[] | null; error: { message: string } | null };
            }

            return { rich, res };
          })(),
        ]);

        const acceptedRows = visibleRows.filter((row) => row.is_accepted_visible && row.other_user_id);
        const otherIds = Array.from(new Set(acceptedRows.map((row) => row.other_user_id).filter(Boolean)));

        let connectionsProfileMap = new Map<string, ProfileLite>();
        if (otherIds.length > 0) {
          const profilesRes = await supabase
            .from("profiles")
            .select("user_id,display_name,city,country,avatar_url,roles,dance_styles,availability,verified")
            .in("user_id", otherIds.slice(0, 800));

          if (!profilesRes.error) {
            connectionsProfileMap = new Map(
              (profilesRes.data ?? []).map((raw: unknown) => {
                const row = asRecord(raw);
                const id = pickString(row, "user_id");
                return [
                  id,
                  {
                    userId: id,
                    displayName: pickString(row, "display_name", "Member"),
                    city: pickString(row, "city"),
                    country: pickString(row, "country"),
                    avatarUrl: pickNullableString(row, "avatar_url"),
                    roles: asStringArray(row.roles),
                    danceStyles: asStringArray(row.dance_styles),
                    availability: asStringArray(row.availability),
                    verified: row.verified === true,
                  } satisfies ProfileLite,
                ];
              })
            );
          }
        }

        const mappedConnections = acceptedRows
          .map((row) => ({
            id: row.id,
            otherUserId: row.other_user_id,
            createdAt: row.created_at,
            profile: connectionsProfileMap.get(row.other_user_id) ?? null,
          }))
          .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));

        if (cancelled) return;
        setConnections(mappedConnections);

        const { rich, res: contactsRes } = contactsLoad;
        setSupportsRichContacts(rich);

        if (contactsRes.error) {
          if (isSchemaMissingError(contactsRes.error.message)) {
            setContacts([]);
            setMemberProfiles({});
            setTripByUser({});
            setHostingByUser({});
            setReferenceByUser({});
            setCompetitionByUser({});
            setReferencesReceivedCount(0);
            setReferencesGivenCount(0);
            setInfo("Network contacts table is missing. Run: scripts/sql/2026-03-05_dashboard_dance_contacts.sql");
            setLoading(false);
            return;
          }
          throw contactsRes.error;
        }

        if (!rich) {
          setInfo(
            "Contacts loaded in compatibility mode. Run scripts/sql/2026-03-17_network_relationship_layer.sql to enable follow/activity tracking."
          );
        }

        const mappedContacts = ((contactsRes.data ?? []) as unknown[])
          .map((raw: unknown) => {
            const row = asRecord(raw);
            const id = pickString(row, "id");
            const userId = pickString(row, "user_id");
            const name = pickString(row, "name");
            const createdAt = pickString(row, "created_at");
            const updatedAt = pickString(row, "updated_at");
            if (!id || !userId || !name || !createdAt || !updatedAt) return null;

            const contactTypeRaw = pickString(row, "contact_type", "external").toLowerCase();
            const contactType: ContactType = contactTypeRaw === "member" ? "member" : "external";
            const trackActivity = normalizeActivityArray(row.track_activity);
            const isFollowing = row.is_following === true;

            return {
              id,
              userId,
              contactType,
              linkedUserId: pickNullableString(row, "linked_user_id"),
              name,
              roles: asStringArray(row.role),
              city: pickString(row, "city"),
              country: pickString(row, "country"),
              danceStyles: asStringArray(row.dance_styles),
              tags: asStringArray(row.tags).map((tag) => normalizeToken(tag)),
              notes: pickNullableString(row, "notes"),
              meetingContext: pickNullableString(row, "meeting_context"),
              isFollowing,
              trackActivity: isFollowing ? (trackActivity.length > 0 ? trackActivity : DEFAULT_TRACK_ACTIVITY) : [],
              createdAt,
              updatedAt,
            } satisfies ContactRow;
          })
          .filter((item: ContactRow | null): item is ContactRow => Boolean(item));

        const dedupedContacts = mergeDuplicateContacts(mappedContacts);

        if (cancelled) return;
        setContacts(dedupedContacts);

        const memberIds = Array.from(
          new Set(
            dedupedContacts
              .filter((contact) => contact.contactType === "member")
              .map((contact) => contact.linkedUserId)
              .filter((value): value is string => Boolean(value))
          )
        );

        if (memberIds.length === 0) {
          setMemberProfiles({});
          setTripByUser({});
          setHostingByUser({});
          setReferenceByUser({});
          setCompetitionByUser({});
          setReferencesReceivedCount(0);
          setReferencesGivenCount(0);
          setLoading(false);
          return;
        }

        const [
          profileRes,
          hostingRes,
          tripsRes,
          competitionRes,
          myProfileRes,
          followersCountRes,
          eventMembersRes,
        ] = await Promise.all([
          supabase
            .from("profiles")
            .select("user_id,display_name,city,country,avatar_url,roles,dance_styles,availability,verified")
            .in("user_id", memberIds),
          supabase
            .from("profiles")
            .select("user_id,can_host,hosting_status")
            .in("user_id", memberIds),
          (async () => {
            const todayIso = new Date().toISOString().slice(0, 10);
            let res = (await supabase
              .from("trips")
              .select("user_id,destination_city,destination_country,start_date,end_date,status,created_at")
              .in("user_id", memberIds)
              .gte("end_date", todayIso)
              .order("start_date", { ascending: true })
              .limit(1000)) as { data: unknown[] | null; error: { message: string } | null };
            if (res.error && isColumnMissingError(res.error.message)) {
              res = (await supabase
                .from("trips")
                .select("user_id,destination_city,destination_country,start_date,end_date,created_at")
                .in("user_id", memberIds)
                .gte("end_date", todayIso)
                .order("start_date", { ascending: true })
                .limit(1000)) as { data: unknown[] | null; error: { message: string } | null };
            }
            return res;
          })(),
          supabase
            .from("dance_competitions_user")
            .select("user_id,event_name,result,created_at,year")
            .in("user_id", memberIds)
            .order("created_at", { ascending: false })
            .limit(1000),
          supabase
            .from("profiles")
            .select("city,country")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("dance_contacts")
            .select("user_id")
            .eq("linked_user_id", user.id)
            .eq("is_following", true)
            .eq("contact_type", "member")
            .limit(300),
          (async () => {
            const todayIso = new Date().toISOString().slice(0, 10);
            return supabase
              .from("event_members")
              .select("user_id,event_id,events(id,title,city,country,starts_at,ends_at)")
              .in("user_id", memberIds.slice(0, 200))
              .in("status", ["going", "host", "waitlist"])
              .limit(300);
          })(),
        ]);

        const fetchReferencesByMemberColumns = async (
          columns: Array<"recipient_id" | "to_user_id" | "target_id" | "author_id" | "from_user_id" | "source_id">
        ): Promise<Array<Record<string, unknown>>> => {
          const rows: Array<Record<string, unknown>> = [];
          const seen = new Set<string>();
          for (const column of columns) {
            const res = await supabase
              .from("references")
              .select(`id,${column},created_at`)
              .in(column, memberIds)
              .order("created_at", { ascending: false })
              .limit(3000);
            if (res.error) {
              if (isColumnMissingError(res.error.message) || isSchemaMissingError(res.error.message)) continue;
              throw new Error(res.error.message);
            }
            for (const raw of res.data ?? []) {
              const row = asRecord(raw);
              const id = pickString(row, "id");
              if (!id || seen.has(id)) continue;
              seen.add(id);
              rows.push(row);
            }
          }
          return rows;
        };

        const [refsRows, refsGivenRows] = await Promise.all([
          fetchReferencesByMemberColumns(["recipient_id"]),
          fetchReferencesByMemberColumns(["author_id"]),
        ]);

        if (cancelled) return;

        const profilesMap: Record<string, ProfileLite> = {};
        if (!profileRes.error) {
          for (const raw of profileRes.data ?? []) {
            const row = asRecord(raw);
            const id = pickString(row, "user_id");
            if (!id) continue;
            profilesMap[id] = {
              userId: id,
              displayName: pickString(row, "display_name", "Member"),
              city: pickString(row, "city"),
              country: pickString(row, "country"),
              avatarUrl: pickNullableString(row, "avatar_url"),
              roles: asStringArray(row.roles),
              danceStyles: asStringArray(row.dance_styles),
              availability: asStringArray(row.availability),
              verified: row.verified === true,
            };
          }
        }

        const hostingMap: Record<string, HostingActivity> = {};
        if (!hostingRes.error) {
          for (const raw of hostingRes.data ?? []) {
            const row = asRecord(raw);
            const id = pickString(row, "user_id");
            if (!id) continue;
            hostingMap[id] = {
              canHost: row.can_host === true,
              hostingStatus: pickNullableString(row, "hosting_status"),
            };
          }
        }

        const activeStatuses = new Set(["active", "published", "open", "upcoming"]);
        const tripMap: Record<string, TripActivity> = {};
        if (!tripsRes.error) {
          for (const raw of tripsRes.data ?? []) {
            const row = asRecord(raw);
            const userIdValue = pickString(row, "user_id");
            if (!userIdValue || tripMap[userIdValue]) continue;
            const statusValue = pickString(row, "status", "active").toLowerCase();
            if (row.status !== undefined && !activeStatuses.has(statusValue)) continue;
            tripMap[userIdValue] = {
              city: pickString(row, "destination_city"),
              country: pickString(row, "destination_country"),
              startDate: pickNullableString(row, "start_date"),
              endDate: pickNullableString(row, "end_date"),
              createdAt: pickNullableString(row, "created_at"),
            };
          }
        }

        const referenceMap: Record<string, ReferenceActivity> = {};
        const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        for (const raw of refsRows) {
          const row = asRecord(raw);
          const recipientId = pickString(row, "recipient_id") || pickString(row, "to_user_id") || pickString(row, "target_id");
          const createdAt = pickNullableString(row, "created_at");
          if (!recipientId) continue;
          if (!referenceMap[recipientId]) {
            referenceMap[recipientId] = { total: 0, recent30d: 0, latestAt: null };
          }
          referenceMap[recipientId].total += 1;
          if (createdAt && toMs(createdAt) >= recentCutoff) {
            referenceMap[recipientId].recent30d += 1;
          }
          if (!referenceMap[recipientId].latestAt && createdAt) {
            referenceMap[recipientId].latestAt = createdAt;
          }
        }

        const competitionMap: Record<string, CompetitionActivity> = {};
        if (!competitionRes.error) {
          for (const raw of competitionRes.data ?? []) {
            const row = asRecord(raw);
            const userIdValue = pickString(row, "user_id");
            if (!userIdValue) continue;
            if (!competitionMap[userIdValue]) {
              competitionMap[userIdValue] = {
                total: 0,
                latestAt: null,
                latestEventName: null,
                latestResult: null,
              };
            }
            competitionMap[userIdValue].total += 1;
            if (!competitionMap[userIdValue].latestAt) {
              competitionMap[userIdValue].latestAt = pickNullableString(row, "created_at");
              competitionMap[userIdValue].latestEventName = pickNullableString(row, "event_name");
              competitionMap[userIdValue].latestResult = pickNullableString(row, "result");
            }
          }
        }

        setMemberProfiles(profilesMap);
        setHostingByUser(hostingMap);
        setTripByUser(tripMap);
        setReferenceByUser(referenceMap);
        setCompetitionByUser(competitionMap);

        // My city
        const myProfileRow = asRecord(myProfileRes?.data ?? {});
        setMyCity(pickString(myProfileRow, "city"));
        setMyCountry(pickString(myProfileRow, "country"));
        const followerUserIds = ((followersCountRes?.data ?? []) as Array<{ user_id?: string }>)
          .map((r) => r.user_id)
          .filter((id): id is string => Boolean(id));
        setFollowersCount(followerUserIds.length);
        if (followerUserIds.length > 0) {
          const followerProfilesRes = await supabase
            .from("profiles")
            .select("user_id,display_name,avatar_url")
            .in("user_id", followerUserIds.slice(0, 200));
          if (!followerProfilesRes.error) {
            setFollowerProfiles(
              (followerProfilesRes.data ?? []).map((r: unknown) => {
                const row = asRecord(r);
                return {
                  userId: pickString(row, "user_id"),
                  displayName: pickString(row, "display_name", "Member"),
                  avatarUrl: pickNullableString(row, "avatar_url"),
                };
              })
            );
          }
        }

        // Events attended by connections — group by event
        const eventMap = new Map<string, EventActivity>();
        if (!eventMembersRes.error) {
          for (const raw of eventMembersRes.data ?? []) {
            const row = asRecord(raw);
            const userId = pickString(row, "user_id");
            const eventRow = asRecord(row.events ?? {});
            const eventId = pickString(eventRow, "id");
            if (!eventId || !userId) continue;
            const startDate = pickNullableString(eventRow, "starts_at") ?? pickNullableString(eventRow, "start_date");
            // Skip events without start date or in the past
            if (!startDate) continue;
            if (!eventMap.has(eventId)) {
              eventMap.set(eventId, {
                eventId,
                title: pickString(eventRow, "title", "Event"),
                city: pickNullableString(eventRow, "city"),
                country: pickNullableString(eventRow, "country"),
                startDate,
                endDate: pickNullableString(eventRow, "ends_at") ?? pickNullableString(eventRow, "end_date"),
                attendees: [],
              });
            }
            const profile = connectionsProfileMap.get(userId);
            if (profile) {
              const ev = eventMap.get(eventId)!;
              if (ev.attendees.length < 8 && !ev.attendees.find((a) => a.userId === userId)) {
                ev.attendees.push({ userId, displayName: profile.displayName, avatarUrl: profile.avatarUrl });
              }
            }
          }
        }
        const eventsWithAttendees = Array.from(eventMap.values())
          .filter((ev) => ev.attendees.length > 0)
          .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
        setEventActivities(eventsWithAttendees);

        setReferencesReceivedCount(refsRows.length);
        setReferencesGivenCount(refsGivenRows.length);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load network data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadNetwork();
    return () => {
      cancelled = true;
    };
  }, [router, refreshKey]);

  const contactsById = useMemo(() => {
    const map: Record<string, ContactRow> = {};
    for (const contact of contacts) map[contact.id] = contact;
    return map;
  }, [contacts]);

  const connectionCount = connections.length;
  const externalContactsCount = contacts.filter((contact) => contact.contactType === "external").length;
  const followingCount = contacts.filter((contact) => contact.contactType === "member" && contact.isFollowing).length;
  const referencesTotalCount = referencesReceivedCount + referencesGivenCount;

  const contactCards = useMemo<ContactCard[]>(() => {
    return contacts.map((contact) => {
      const profile = contact.linkedUserId ? memberProfiles[contact.linkedUserId] : undefined;
      const roles = uniqueValues([...(profile?.roles ?? []), ...contact.roles]).map((role) => titleCase(role));
      const danceStyles = uniqueValues([...(profile?.danceStyles ?? []), ...contact.danceStyles]).map((style) => titleCase(style));
      const tags = contact.tags.filter((tag) => normalizeToken(tag) !== "member");

      const travelActivity = contact.linkedUserId ? (tripByUser[contact.linkedUserId] ?? null) : null;
      const hostingActivity = contact.linkedUserId ? (hostingByUser[contact.linkedUserId] ?? null) : null;
      const referenceActivity = contact.linkedUserId
        ? (referenceByUser[contact.linkedUserId] ?? { total: 0, recent30d: 0, latestAt: null })
        : { total: 0, recent30d: 0, latestAt: null };
      const competitionActivity = contact.linkedUserId
        ? (competitionByUser[contact.linkedUserId] ?? {
            total: 0,
            latestAt: null,
            latestEventName: null,
            latestResult: null,
          })
        : {
            total: 0,
            latestAt: null,
            latestEventName: null,
            latestResult: null,
          };

      const statusIndicators: string[] = [];
      if (hasRole(roles, "teacher")) statusIndicators.push("Teacher");
      if (hasRole(roles, "organizer")) statusIndicators.push("Organizer");
      if (hasRole(roles, "dj")) statusIndicators.push("DJ");
      if ((hostingActivity?.canHost ?? false) || hasRole(roles, "host")) statusIndicators.push("Host");
      if (travelActivity) statusIndicators.push("Festival traveler");
      if ((competitionActivity.total ?? 0) > 0) statusIndicators.push("Competition dancer");

      return {
        id: contact.id,
        contactType: contact.contactType,
        linkedUserId: contact.linkedUserId,
        displayName: profile?.displayName || contact.name,
        city: profile?.city || contact.city,
        country: profile?.country || contact.country,
        avatarUrl: profile?.avatarUrl ?? null,
        roles,
        danceStyles,
        tags,
        notes: contact.notes,
        meetingContext: contact.meetingContext,
        isFollowing: contact.isFollowing,
        trackActivity: contact.trackActivity,
        statusIndicators,
        travelActivity,
        hostingActivity,
        referenceActivity,
        competitionActivity,
        updatedAt: contact.updatedAt,
        createdAt: contact.createdAt,
      };
    });
  }, [competitionByUser, contacts, hostingByUser, memberProfiles, referenceByUser, tripByUser]);

  const connectionCityOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of connections) {
      const cityLabel = [item.profile?.city, item.profile?.country].filter(Boolean).join(", ");
      if (cityLabel) values.add(cityLabel);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [connections]);

  const connectionStyleOptions = useMemo(() => {
    const values = new Set<string>([...CORE_DANCE_STYLES]);
    for (const item of connections) {
      for (const style of item.profile?.danceStyles ?? []) {
        const s = style.toLowerCase();
        if (!CORE_DANCE_STYLES.includes(s as typeof CORE_DANCE_STYLES[number])) values.add(s);
      }
    }
    return Array.from(values);
  }, [connections]);

  const connectionRoleOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of connections) {
      for (const role of item.profile?.roles ?? []) values.add(role);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [connections]);

  const cityOptions = useMemo(() => {
    const values = new Set<string>();
    for (const contact of contactCards) {
      const cityLabel = [contact.city, contact.country].filter(Boolean).join(", ");
      if (cityLabel) values.add(cityLabel);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [contactCards]);

  const styleOptions = useMemo(() => {
    const values = new Set<string>([...CORE_DANCE_STYLES]);
    for (const contact of contactCards) {
      for (const style of contact.danceStyles) {
        const s = style.toLowerCase();
        if (!CORE_DANCE_STYLES.includes(s as typeof CORE_DANCE_STYLES[number])) values.add(s);
      }
    }
    return Array.from(values);
  }, [contactCards]);

  const roleOptions = useMemo(() => {
    const values = new Set<string>();
    for (const contact of contactCards) {
      for (const role of contact.roles) values.add(role);
      for (const status of contact.statusIndicators) values.add(status);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [contactCards]);

  const filteredConnections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return connections.filter((item) => {
      const profile = item.profile;
      const cityLabel = [profile?.city ?? "", profile?.country ?? ""].filter(Boolean).join(", ");
      if (connectionCityFilter !== "all" && cityLabel !== connectionCityFilter) return false;

      if (connectionStyleFilter !== "all") {
        const styles = (profile?.danceStyles ?? []).map((s) => s.toLowerCase());
        if (connectionStyleFilter === "other") {
          const needle = connectionStyleText.trim().toLowerCase();
          if (needle && !styles.some((s) => s.includes(needle))) return false;
        } else {
          if (!styles.includes(connectionStyleFilter.toLowerCase())) return false;
        }
      }

      if (connectionRoleFilter !== "all") {
        if (!(profile?.roles ?? []).some((role) => role.toLowerCase() === connectionRoleFilter.toLowerCase())) return false;
      }

      if (!needle) return true;
      const haystack = [
        profile?.displayName ?? "",
        profile?.city ?? "",
        profile?.country ?? "",
        ...(profile?.danceStyles ?? []),
        ...(profile?.roles ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [connectionCityFilter, connectionRoleFilter, connectionStyleFilter, connections, query]);

  const followedMemberIds = useMemo(
    () =>
      new Set(
        contacts
          .filter((contact) => contact.contactType === "member" && contact.isFollowing && Boolean(contact.linkedUserId))
          .map((contact) => contact.linkedUserId as string)
      ),
    [contacts]
  );

  const recentConnectionCutoff = useMemo(() => Date.now() - 45 * 24 * 60 * 60 * 1000, []);
  const recentConnectionsCount = useMemo(
    () => connections.filter((item) => toMs(item.createdAt) >= recentConnectionCutoff).length,
    [connections, recentConnectionCutoff]
  );
  const followingConnectionsCount = useMemo(
    () => connections.filter((item) => followedMemberIds.has(item.otherUserId)).length,
    [connections, followedMemberIds]
  );

  const visibleConnections = useMemo(() => {
    if (connectionView === "all") return filteredConnections;
    if (connectionView === "recent") {
      return filteredConnections.filter((item) => toMs(item.createdAt) >= recentConnectionCutoff);
    }
    return filteredConnections.filter((item) => followedMemberIds.has(item.otherUserId));
  }, [connectionView, filteredConnections, recentConnectionCutoff, followedMemberIds]);
  const totalConnectionsPages = useMemo(
    () => Math.max(1, Math.ceil(visibleConnections.length / CONNECTIONS_PAGE_SIZE)),
    [visibleConnections.length]
  );
  const paginatedConnections = useMemo(
    () => visibleConnections.slice((connectionsPage - 1) * CONNECTIONS_PAGE_SIZE, connectionsPage * CONNECTIONS_PAGE_SIZE),
    [connectionsPage, visibleConnections]
  );

  const scopedContacts = useMemo(() => {
    if (networkSection === "following") return contactCards.filter((card) => card.contactType === "member" && card.isFollowing);
    if (networkSection === "contacts") return contactCards.filter((card) => card.contactType === "external");
    return contactCards;
  }, [networkSection, contactCards]);

  const filteredContactCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scopedContacts.filter((card) =>
      contactCardMatchesFilters(card, { needle, cityFilter, styleFilter, styleText, roleFilter, activityFilter })
    );
  }, [activityFilter, cityFilter, query, roleFilter, scopedContacts, styleFilter]);
  const totalContactsPages = useMemo(
    () => Math.max(1, Math.ceil(filteredContactCards.length / CONNECTIONS_PAGE_SIZE)),
    [filteredContactCards.length]
  );
  const paginatedContactCards = useMemo(
    () => filteredContactCards.slice((contactsPage - 1) * CONNECTIONS_PAGE_SIZE, contactsPage * CONNECTIONS_PAGE_SIZE),
    [contactsPage, filteredContactCards]
  );

  const hasContactFilters =
    query.trim().length > 0 || cityFilter !== "all" || styleFilter !== "all" || roleFilter !== "all" || activityFilter !== "all";
  const hasFollowingFilters =
    followQuery.trim().length > 0 || cityFilter !== "all" || styleFilter !== "all" || roleFilter !== "all" || activityFilter !== "all";
  const hasConnectionFilters =
    query.trim().length > 0 || connectionCityFilter !== "all" || connectionStyleFilter !== "all" || connectionRoleFilter !== "all";
  const activeNotesTooltip =
    networkSection === "following"
      ? {
          title: "Following Notes",
          body: "Keep private notes on the members you follow. Add tags, meeting context, and personal reminders so you always have reference context for why they matter in your network.",
        }
      : networkSection === "contacts"
      ? {
          title: "Contact Notes",
          body: "Keep private notes on the contacts you add, including external contacts. Add tags, context, roles, and notes so you always have reference context for why they matter in your network.",
        }
      : null;

  const followedFeed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];

    for (const card of contactCards) {
      if (card.contactType !== "member") continue;
      if (!card.isFollowing) continue;
      const tracks = card.trackActivity.length > 0 ? card.trackActivity : DEFAULT_TRACK_ACTIVITY;

      for (const track of tracks) {
        if (track === "travel_plans" && card.travelActivity) {
          items.push({
            id: `${card.id}-travel`,
            contactName: card.displayName,
            avatarUrl: card.avatarUrl,
            type: "travel_plans",
            title: "Travel update",
            body: `${card.travelActivity.city || "New city"}${card.travelActivity.country ? `, ${card.travelActivity.country}` : ""}`,
            at: card.travelActivity.startDate ?? card.travelActivity.createdAt,
          });
        }

        if (track === "hosting_availability" && (card.hostingActivity?.canHost ?? false)) {
          const status = card.hostingActivity?.hostingStatus
            ? titleCase(card.hostingActivity.hostingStatus)
            : "Available";
          items.push({
            id: `${card.id}-hosting`,
            contactName: card.displayName,
            avatarUrl: card.avatarUrl,
            type: "hosting_availability",
            title: "Hosting update",
            body: `Hosting status: ${status}`,
            at: card.updatedAt,
          });
        }

        if (track === "new_references" && card.referenceActivity.recent30d > 0) {
          items.push({
            id: `${card.id}-references`,
            contactName: card.displayName,
            avatarUrl: card.avatarUrl,
            type: "new_references",
            title: "Reference update",
            body: `${card.referenceActivity.recent30d} new reference${card.referenceActivity.recent30d === 1 ? "" : "s"} in 30d`,
            at: card.referenceActivity.latestAt,
          });
        }

        if (track === "competition_results" && card.competitionActivity.total > 0) {
          const competitionText =
            card.competitionActivity.latestEventName && card.competitionActivity.latestResult
              ? `${card.competitionActivity.latestEventName} • ${card.competitionActivity.latestResult}`
              : `${card.competitionActivity.total} competition result${card.competitionActivity.total === 1 ? "" : "s"}`;
          items.push({
            id: `${card.id}-competitions`,
            contactName: card.displayName,
            avatarUrl: card.avatarUrl,
            type: "competition_results",
            title: "Competition update",
            body: competitionText,
            at: card.competitionActivity.latestAt,
          });
        }
      }
    }

    return items.sort((a, b) => toMs(b.at) - toMs(a.at)).slice(0, 24);
  }, [contactCards]);

  const editContact = editContactId ? contactsById[editContactId] : null;

  function resetFilters() {
    setQuery("");
    setCityFilter("all");
    setStyleFilter("all");
    setRoleFilter("all");
    setActivityFilter("all");
  }

  function resetFollowingFilters() {
    setFollowQuery("");
    setCityFilter("all");
    setStyleFilter("all");
    setRoleFilter("all");
    setActivityFilter("all");
  }

  function resetConnectionFilters() {
    setQuery("");
    setConnectionCityFilter("all");
    setConnectionStyleFilter("all");
    setConnectionRoleFilter("all");
  }

  useEffect(() => {
    setConnectionsPage(1);
  }, [networkSection, query, connectionView, connectionCityFilter, connectionStyleFilter, connectionRoleFilter]);

  useEffect(() => {
    setContactsPage(1);
  }, [networkSection, query, cityFilter, styleFilter, roleFilter, activityFilter]);

  useEffect(() => {
    setFollowingListPage(1);
  }, [networkSection, followQuery, cityFilter, styleFilter, roleFilter, activityFilter]);

  useEffect(() => {
    if (connectionsPage > totalConnectionsPages) setConnectionsPage(totalConnectionsPages);
  }, [connectionsPage, totalConnectionsPages]);

  useEffect(() => {
    if (contactsPage > totalContactsPages) setContactsPage(totalContactsPages);
  }, [contactsPage, totalContactsPages]);

  function openEditModal(card: ContactCard) {
    const contact = contactsById[card.id];
    if (!contact) return;
    setEditContactId(contact.id);
    setEditDraft({
      tags: contact.tags.join(", "),
      meetingContext: contact.meetingContext ?? "",
      notes: contact.notes ?? "",
      roles: contact.roles.join(", "),
      danceStyles: contact.danceStyles.join(", "),
    });
  }

  async function updateFollow(contact: ContactCard, nextFollowing: boolean) {
    if (!meId) return;
    if (!supportsRichContacts) {
      setInfo("Follow tracking needs the relationship-layer SQL migration. Run scripts/sql/2026-03-17_network_relationship_layer.sql");
      return;
    }

    setBusyContactId(contact.id);
    setError(null);
    const nextTrackActivity = nextFollowing
      ? contact.trackActivity.length > 0
        ? contact.trackActivity
        : DEFAULT_TRACK_ACTIVITY
      : [];

    const updateQuery = supabase
      .from("dance_contacts")
      .update({ is_following: nextFollowing, track_activity: nextTrackActivity })
      .eq("user_id", meId);

    const res =
      contact.contactType === "member" && contact.linkedUserId
        ? await updateQuery.eq("contact_type", "member").eq("linked_user_id", contact.linkedUserId)
        : await updateQuery.eq("id", contact.id);

    if (res.error) {
      setError(res.error.message);
    } else {
      setRefreshKey((value) => value + 1);
    }
    setBusyContactId(null);
  }

  async function saveContactEdits() {
    if (!meId || !editContactId) return;

    const tags = parseTags(editDraft.tags);
    const notes = editDraft.notes.trim();
    const meetingContext = editDraft.meetingContext.trim();
    const roles = parseLabels(editDraft.roles);
    const danceStyles = parseLabels(editDraft.danceStyles);

    if (tags.length > 10) {
      setError("Use up to 10 tags per contact.");
      return;
    }
    if (notes.length > 500) {
      setError("Private notes can be up to 500 characters.");
      return;
    }
    if (meetingContext.length > 160) {
      setError("Meeting context can be up to 160 characters.");
      return;
    }

    const target = contactsById[editContactId];
    if (!target) return;

    setBusyContactId(editContactId);
    setError(null);

    const patch: Record<string, unknown> = {
      tags,
      notes: notes || null,
      role: target.contactType === "external" ? roles : target.roles,
    };

    if (supportsRichContacts) {
      patch.meeting_context = meetingContext || null;
      patch.dance_styles = target.contactType === "external" ? danceStyles : target.danceStyles;
    }

    const res = await supabase
      .from("dance_contacts")
      .update(patch)
      .eq("id", editContactId)
      .eq("user_id", meId);

    if (res.error) {
      setError(res.error.message);
    } else {
      setEditContactId(null);
      setRefreshKey((value) => value + 1);
    }

    setBusyContactId(null);
  }

  async function addExternalContact() {
    if (!meId) return;

    const name = addDraft.name.trim();
    const city = addDraft.city.trim();
    const country = addDraft.country.trim();
    const notes = addDraft.notes.trim();
    const meetingContext = addDraft.meetingContext.trim();
    const tags = parseTags(addDraft.tags);
    const roles = parseLabels(addDraft.roles);
    const danceStyles = parseLabels(addDraft.danceStyles);

    if (!name) {
      setError("Contact name is required.");
      return;
    }
    if (name.length > 120) {
      setError("Contact name can be up to 120 characters.");
      return;
    }
    if (notes.length > 500) {
      setError("Private notes can be up to 500 characters.");
      return;
    }
    if (tags.length > 10) {
      setError("Use up to 10 tags per contact.");
      return;
    }
    if (meetingContext.length > 160) {
      setError("Meeting context can be up to 160 characters.");
      return;
    }

    setBusyContactId("add-contact");
    setError(null);

    const payload: Record<string, unknown> = {
      user_id: meId,
      contact_type: "external",
      linked_user_id: null,
      name,
      role: roles,
      city: city || null,
      country: country || null,
      tags,
      notes: notes || null,
    };

    if (supportsRichContacts) {
      payload.meeting_context = meetingContext || null;
      payload.dance_styles = danceStyles;
      payload.is_following = false;
      payload.track_activity = [];
    }

    const res = await supabase.from("dance_contacts").insert(payload).select("id").single();

    if (res.error) {
      setError(res.error.message);
    } else {
      setShowAddModal(false);
      setAddDraft({
        name: "",
        city: "",
        country: "",
        roles: "",
        danceStyles: "",
        tags: "",
        meetingContext: "",
        notes: "",
      });
      setRefreshKey((value) => value + 1);
    }

    setBusyContactId(null);
  }

  async function removeContact(contactId: string) {
    if (!meId) return;
    const ok = window.confirm("Remove this contact from your Network?");
    if (!ok) return;

    setBusyContactId(contactId);
    setError(null);

    const target = contactsById[contactId];
    const deleteQuery = supabase.from("dance_contacts").delete().eq("user_id", meId);
    const res =
      target?.contactType === "member" && target.linkedUserId
        ? await deleteQuery.eq("contact_type", "member").eq("linked_user_id", target.linkedUserId)
        : await deleteQuery.eq("id", contactId);

    if (res.error) {
      setError(res.error.message);
    } else {
      setRefreshKey((value) => value + 1);
    }

    setBusyContactId(null);
  }

  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <Nav />
      <main className="flex flex-1 justify-center px-4 py-5 sm:px-6 md:py-6 lg:px-12 xl:px-20">
        <div className="flex w-full max-w-[1200px] flex-col gap-5">
          {error ? (
            <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
          ) : null}
          {info ? (
            <div className="rounded-2xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-3 text-xs text-cyan-100">{info}</div>
          ) : null}

          <section className="space-y-8">
              {/* Combined header: summary + tabs */}
              <div className="border-b border-white/[0.07] pb-0">
                {/* Title + stats row */}
                <div className="flex flex-col gap-5 pb-5 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <h1 className="font-['Epilogue'] text-2xl font-extrabold tracking-tight text-white md:text-3xl">
                      Network · <span style={{ backgroundImage: "linear-gradient(135deg,#c1fffe,#ff51fa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{connectionCount} connections</span>
                    </h1>
                    <p className="text-[11px] uppercase tracking-widest text-white/40">Your global dance network overview</p>
                  </div>
                  <div className="hidden sm:grid grid-cols-3 gap-5 sm:grid-cols-5 md:gap-8">
                    <div>
                      <p className="font-['Epilogue'] text-2xl font-bold text-[#c1fffe]">{followingCount}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Following</p>
                    </div>
                    <div>
                      <p className="font-['Epilogue'] text-2xl font-bold text-[#ff51fa]">{followersCount}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Followers</p>
                    </div>
                    <div>
                      <p className="font-['Epilogue'] text-2xl font-bold text-[#c1fffe]/70">{Object.values(tripByUser).length}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Travelling</p>
                    </div>
                    <div>
                      <p className="font-['Epilogue'] text-2xl font-bold text-white/50">{Object.values(hostingByUser).filter((h) => h.canHost).length}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Hosting</p>
                    </div>
                    <div>
                      <p className="font-['Epilogue'] text-2xl font-bold text-[#00f5f5]">{eventActivities.length}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Events</p>
                    </div>
                  </div>
                </div>
                {/* Profile-style tabs */}
                <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
                <div className="no-scrollbar flex flex-1 items-end gap-4 overflow-x-auto">
                  {([
                    { key: "feed" as const, label: "Feed", count: null },
                    { key: "connections" as const, label: "Connections", count: connectionCount },
                    { key: "following" as const, label: "Following", count: followingCount + followersCount },
                    { key: "contacts" as const, label: "Contacts", count: externalContactsCount },
                  ] as const).map((s) => {
                    const active = networkSection === s.key;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setNetworkSection(s.key)}
                        aria-label={s.label}
                        className={`flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-1 pb-3 pt-2 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                          active
                            ? "border-[#25d1f4] text-white"
                            : "border-transparent text-white/35 hover:text-white/60"
                        }`}
                      >
                        <span>{s.label}</span>
                        {s.count !== null ? (
                          <span className="rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[10px] font-bold text-white/50">{s.count}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                <label className="group relative mb-1 shrink-0">
                  <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-white/35 transition-colors group-focus-within:text-cyan-300">search</span>
                  <input
                    type="text"
                    value={feedSearch}
                    onChange={(e) => setFeedSearch(e.target.value)}
                    placeholder="Search name, city, event…"
                    className="h-9 w-64 rounded-full border border-white/10 bg-white/[0.05] pl-8 pr-3 text-[12px] text-white/90 outline-none placeholder:text-white/30 focus:border-[#00F5FF]/50"
                  />
                  {feedSearch ? (
                    <button onClick={() => setFeedSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  ) : null}
                </label>
              </div>
              </div>

              {networkSection === "feed" ? (
              <>

              {loading ? (
                <div className="space-y-8">
                  <div className="h-48 animate-pulse rounded-2xl bg-white/[0.03]" />
                  <div className="h-64 animate-pulse rounded-2xl bg-white/[0.03]" />
                </div>
              ) : (
                <>
                  {/* Following activity — top of feed, 2-row carousel */}
                  {!loading ? (() => {
                    const followedUserIds = new Set(
                      contacts.filter((ct) => ct.isFollowing && ct.linkedUserId).map((ct) => ct.linkedUserId!)
                    );
                    // Build activity items from connections that are followed
                    type ActivityItem = {
                      key: string;
                      userId: string;
                      displayName: string;
                      avatarUrl: string | null;
                      kind: "trip" | "event";
                      label: string;
                      sub: string;
                      href: string;
                    };
                    const items: ActivityItem[] = [];
                    // Trips from followed connections
                    connections.forEach((c) => {
                      if (!c.otherUserId || !c.profile) return;
                      if (!followedUserIds.has(c.otherUserId)) return;
                      const trip = tripByUser[c.otherUserId];
                      if (!trip) return;
                      const dateStr = trip.startDate
                        ? new Date(trip.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
                          (trip.endDate ? ` – ${new Date(trip.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "")
                        : "";
                      items.push({
                        key: `trip-${c.id}`,
                        userId: c.otherUserId,
                        displayName: c.profile.displayName,
                        avatarUrl: c.profile.avatarUrl,
                        kind: "trip",
                        label: `${trip.city}${trip.country ? `, ${trip.country}` : ""}`,
                        sub: dateStr,
                        href: `/profile/${c.otherUserId}`,
                      });
                    });
                    // Events: attendees who are followed connections
                    eventActivities.forEach((ev) => {
                      const dateStr = ev.startDate
                        ? new Date(ev.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
                          (ev.endDate && ev.endDate !== ev.startDate ? ` – ${new Date(ev.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "")
                        : "";
                      ev.attendees.forEach((a) => {
                        if (!followedUserIds.has(a.userId)) return;
                        items.push({
                          key: `ev-${ev.eventId}-${a.userId}`,
                          userId: a.userId,
                          displayName: a.displayName,
                          avatarUrl: a.avatarUrl,
                          kind: "event",
                          label: ev.title,
                          sub: dateStr,
                          href: `/events/${ev.eventId}`,
                        });
                      });
                    });
                    const q = feedSearch.toLowerCase().trim();
                    const filtered = q ? items.filter((it) =>
                      it.displayName.toLowerCase().includes(q) ||
                      it.label.toLowerCase().includes(q) ||
                      it.sub.toLowerCase().includes(q)
                    ) : items;
                    if (filtered.length === 0) return null;
                    const row1 = filtered.slice(0, Math.ceil(filtered.length / 2));
                    const row2 = filtered.slice(Math.ceil(filtered.length / 2));
                    const renderActivityCard = (item: ActivityItem) => (
                      <div key={item.key} className="flex w-[210px] shrink-0 items-center gap-2.5 py-1.5">
                        <Link href={`/profile/${item.userId}`} className="shrink-0">
                          <div className="h-9 w-9 rounded-full bg-cover bg-center" style={{ backgroundImage: item.avatarUrl ? `url(${item.avatarUrl})` : "linear-gradient(135deg,rgba(193,255,254,0.2),rgba(255,81,250,0.2))" }} />
                        </Link>
                        <div className="min-w-0 flex-1">
                          <Link href={`/profile/${item.userId}`}>
                            <p className="truncate text-sm font-semibold text-white leading-tight">{item.displayName}</p>
                          </Link>
                          <Link href={item.href} className="group/act block mt-0.5">
                            <p className="flex items-center gap-1 truncate text-[11px] font-medium text-white/60 group-hover/act:text-[#c1fffe] transition-colors">
                              <span className="material-symbols-outlined text-[11px] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>
                                {item.kind === "trip" ? "flight_takeoff" : "calendar_month"}
                              </span>
                              <span className="truncate">{item.label}</span>
                            </p>
                            {item.sub ? <p className="text-[10px] text-white/40 truncate">{item.sub}</p> : null}
                          </Link>
                        </div>
                      </div>
                    );
                    return (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                          <h2 className="flex items-center gap-2 font-['Epilogue'] text-xl font-bold text-white">
                            <span className="material-symbols-outlined text-[#c1fffe]" style={{ fontVariationSettings: "'FILL' 1" }}>groups</span>
                            Following activity
                          </h2>
                          <div className="flex gap-1">
                            <button onClick={() => scrollRow(scrollFollowingRef, "left")} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors"><span className="material-symbols-outlined text-[16px]">chevron_left</span></button>
                            <button onClick={() => scrollRow(scrollFollowingRef, "right")} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors"><span className="material-symbols-outlined text-[16px]">chevron_right</span></button>
                          </div>
                        </div>
                        <div ref={scrollFollowingRef} className="no-scrollbar overflow-x-auto pb-1">
                          <div className="flex flex-col gap-2" style={{ width: "max-content" }}>
                            <div className="flex gap-2">{row1.map(renderActivityCard)}</div>
                            {row2.length > 0 ? <div className="flex gap-2">{row2.map(renderActivityCard)}</div> : null}
                          </div>
                        </div>
                      </div>
                    );
                  })() : null}

                  {/* Travelling now */}
                  {(() => {
                    const q = feedSearch.toLowerCase().trim();
                    const travellers = connections.filter((c) => {
                      if (!c.otherUserId || !tripByUser[c.otherUserId] || !c.profile) return false;
                      if (!q) return true;
                      const trip = tripByUser[c.otherUserId]!;
                      return (
                        c.profile.displayName.toLowerCase().includes(q) ||
                        trip.city.toLowerCase().includes(q) ||
                        (trip.country ?? "").toLowerCase().includes(q)
                      );
                    });
                    if (travellers.length === 0) return null;
                    return (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                          <h2 className="flex items-center gap-2 font-['Epilogue'] text-xl font-bold text-white">
                            <span className="material-symbols-outlined text-[#c1fffe]" style={{ fontVariationSettings: "'FILL' 1" }}>flight_takeoff</span>
                            Travelling now
                          </h2>
                          <div className="flex gap-1">
                            <button onClick={() => scrollRow(scrollTravelRef, "left")} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors"><span className="material-symbols-outlined text-[16px]">chevron_left</span></button>
                            <button onClick={() => scrollRow(scrollTravelRef, "right")} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors"><span className="material-symbols-outlined text-[16px]">chevron_right</span></button>
                          </div>
                        </div>
                        <div ref={scrollTravelRef} className="no-scrollbar flex gap-2.5 overflow-x-auto pb-1">
                          {travellers.slice(0, 12).map((conn) => {
                            const prof = conn.profile!;
                            const trip = tripByUser[conn.otherUserId]!;
                            const dateStr = trip.startDate
                              ? new Date(trip.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
                                (trip.endDate ? ` – ${new Date(trip.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "")
                              : "";
                            return (
                              <Link key={conn.id} href={`/profile/${prof.userId}`} className="flex w-[200px] shrink-0 items-center gap-2.5 py-1.5 hover:opacity-80 transition-opacity">
                                <div className="h-9 w-9 shrink-0 rounded-full bg-cover bg-center" style={{ backgroundImage: prof.avatarUrl ? `url(${prof.avatarUrl})` : "linear-gradient(135deg,rgba(193,255,254,0.2),rgba(255,81,250,0.2))" }} />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-white leading-tight">{prof.displayName}</p>
                                  <p className="flex items-center gap-1 truncate text-[11px] font-medium text-white/60 mt-0.5">
                                    <span className="material-symbols-outlined text-[11px] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>flight_takeoff</span>
                                    <span className="truncate">{trip.city}{trip.country ? `, ${trip.country}` : ""}</span>
                                  </p>
                                  {dateStr ? <p className="text-[10px] text-white/40 truncate">{dateStr}</p> : null}
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Dancers in your city */}
                  {myCity ? (() => {
                    const q = feedSearch.toLowerCase().trim();
                    const inCity = connections.filter((c) => {
                      const trip = c.otherUserId ? tripByUser[c.otherUserId] : null;
                      if (!trip) return false;
                      if (trip.city.toLowerCase() !== myCity.toLowerCase()) return false;
                      if (!q) return true;
                      return (
                        (c.profile?.displayName ?? "").toLowerCase().includes(q) ||
                        trip.city.toLowerCase().includes(q)
                      );
                    });
                    if (inCity.length === 0) return null;
                    return (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h2 className="font-['Epilogue'] text-xl font-bold text-white">Dancers in your city</h2>
                          <div className="flex gap-1">
                            <button onClick={() => scrollRow(scrollCityRef, "left")} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors"><span className="material-symbols-outlined text-[16px]">chevron_left</span></button>
                            <button onClick={() => scrollRow(scrollCityRef, "right")} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors"><span className="material-symbols-outlined text-[16px]">chevron_right</span></button>
                          </div>
                        </div>
                        <div ref={scrollCityRef} className="no-scrollbar flex gap-2.5 overflow-x-auto pb-1">
                          {inCity.slice(0, 12).map((conn) => {
                            const prof = conn.profile!;
                            const trip = tripByUser[conn.otherUserId]!;
                            const dateStr = trip.startDate
                              ? new Date(trip.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
                                (trip.endDate ? ` – ${new Date(trip.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "")
                              : "";
                            return (
                              <Link key={conn.id} href={`/profile/${prof.userId}`} className="flex w-[200px] shrink-0 items-center gap-2.5 py-1.5 hover:opacity-80 transition-opacity">
                                <div className="h-9 w-9 shrink-0 rounded-full bg-cover bg-center" style={{ backgroundImage: prof.avatarUrl ? `url(${prof.avatarUrl})` : "linear-gradient(135deg,rgba(193,255,254,0.2),rgba(255,81,250,0.2))" }} />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-white leading-tight">{prof.displayName}</p>
                                  <p className="flex items-center gap-1 truncate text-[11px] font-medium text-white/60 mt-0.5">
                                    <span className="material-symbols-outlined text-[11px] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>location_on</span>
                                    <span className="truncate">{trip.city}{trip.country ? `, ${trip.country}` : ""}</span>
                                  </p>
                                  {dateStr ? <p className="text-[10px] text-white/40 truncate">{dateStr}</p> : null}
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })() : null}

                  {/* Attending Events */}
                  {(() => {
                    const q = feedSearch.toLowerCase().trim();
                    const filteredEvents = q
                      ? eventActivities.filter((ev) =>
                          ev.title.toLowerCase().includes(q) ||
                          (ev.city ?? "").toLowerCase().includes(q) ||
                          ev.attendees.some((a) => a.displayName.toLowerCase().includes(q))
                        )
                      : eventActivities;
                    return filteredEvents.length > 0 ? (
                    <div className="space-y-5">
                      <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                        <h2 className="flex items-center gap-2 font-['Epilogue'] text-xl font-bold text-white">
                          <span className="material-symbols-outlined text-[#c1fffe]" style={{ fontVariationSettings: "'FILL' 1" }}>calendar_month</span>
                          Attending Events
                        </h2>
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <button onClick={() => scrollRow(scrollEventsRef, "left")} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors"><span className="material-symbols-outlined text-[16px]">chevron_left</span></button>
                            <button onClick={() => scrollRow(scrollEventsRef, "right")} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors"><span className="material-symbols-outlined text-[16px]">chevron_right</span></button>
                          </div>
                          <Link href="/events" className="text-xs font-bold uppercase tracking-wider text-white/40 hover:text-[#ff51fa] transition-colors">Explore all</Link>
                        </div>
                      </div>
                      <div ref={scrollEventsRef} className="no-scrollbar flex gap-6 overflow-x-auto pb-2">
                        {filteredEvents.map((ev) => {
                          const dateStr = ev.startDate
                            ? new Date(ev.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                            : "";
                          const endStr = ev.endDate && ev.endDate !== ev.startDate
                            ? `–${new Date(ev.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                            : "";
                          const isSoon = ev.startDate && new Date(ev.startDate).getTime() - Date.now() < 14 * 86400_000;
                          return (
                            <div key={ev.eventId} className="min-w-[240px] shrink-0 snap-start flex flex-col gap-3 py-1">
                              <div>
                                <Link href={`/events/${ev.eventId}`} className="inline-flex items-center gap-2 flex-wrap">
                                  <h3 className="font-['Epilogue'] text-base font-bold leading-tight text-white hover:text-[#c1fffe] transition-colors">{ev.title}</h3>
                                  {null}
                                </Link>
                                <p className="mt-0.5 text-xs font-medium text-white/50">{[dateStr, endStr].filter(Boolean).join(" ")}{ev.city ? ` · ${ev.city}` : ""}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex -space-x-1.5">
                                  {ev.attendees.slice(0, 4).map((a) => (
                                    <div
                                      key={a.userId}
                                      title={a.displayName}
                                      className="h-6 w-6 rounded-full border border-black/60 bg-cover bg-center"
                                      style={{ backgroundImage: a.avatarUrl ? `url(${a.avatarUrl})` : "linear-gradient(135deg,rgba(193,255,254,0.3),rgba(255,81,250,0.3))" }}
                                    />
                                  ))}
                                </div>
                                <span className="text-xs text-white/50">
                                  {ev.attendees.length > 4 ? `+${ev.attendees.length - 4} ` : ""}{ev.attendees.length === 1 ? ev.attendees[0].displayName : `${ev.attendees.length} connections going`}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null;
                  })()}

                  {/* Hosting */}
                  {(() => {
                    const q = feedSearch.toLowerCase().trim();
                    const hosts = connections.filter((c) => {
                      if (!c.otherUserId || !hostingByUser[c.otherUserId]?.canHost || !c.profile) return false;
                      if (!q) return true;
                      return (
                        c.profile.displayName.toLowerCase().includes(q) ||
                        (c.profile.city ?? "").toLowerCase().includes(q) ||
                        (c.profile.country ?? "").toLowerCase().includes(q)
                      );
                    });
                    if (hosts.length === 0) return null;
                    return (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                          <h2 className="flex items-center gap-2 font-['Epilogue'] text-xl font-bold text-white">
                            <span className="material-symbols-outlined text-[#c1fffe]" style={{ fontVariationSettings: "'FILL' 1" }}>home</span>
                            Hosting available
                          </h2>
                          <div className="flex gap-1">
                            <button onClick={() => scrollRow(scrollHostingRef, "left")} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors"><span className="material-symbols-outlined text-[16px]">chevron_left</span></button>
                            <button onClick={() => scrollRow(scrollHostingRef, "right")} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition-colors"><span className="material-symbols-outlined text-[16px]">chevron_right</span></button>
                          </div>
                        </div>
                        <div ref={scrollHostingRef} className="no-scrollbar flex gap-2.5 overflow-x-auto pb-1">
                          {hosts.slice(0, 12).map((conn) => {
                            const prof = conn.profile!;
                            const hosting = hostingByUser[conn.otherUserId]!;
                            return (
                              <Link key={conn.id} href={`/profile/${prof.userId}`} className="flex w-[200px] shrink-0 items-center gap-2.5 py-1.5 hover:opacity-80 transition-opacity">
                                <div className="h-9 w-9 shrink-0 rounded-full bg-cover bg-center" style={{ backgroundImage: prof.avatarUrl ? `url(${prof.avatarUrl})` : "linear-gradient(135deg,rgba(193,255,254,0.2),rgba(255,81,250,0.2))" }} />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-white leading-tight">{prof.displayName}</p>
                                  <p className="flex items-center gap-1 truncate text-[11px] font-medium text-white/60 mt-0.5">
                                    <span className="material-symbols-outlined text-[11px] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>home</span>
                                    <span className="truncate">{prof.city ? `${prof.city}${prof.country ? `, ${prof.country}` : ""}` : "Open to host"}</span>
                                  </p>
                                  {hosting.hostingStatus ? <p className="text-[10px] text-white/40 truncate">{hosting.hostingStatus}</p> : null}
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })() }

                  {/* Empty state */}
                  {!loading && connections.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center">
                      <span className="material-symbols-outlined text-4xl text-white/20">group</span>
                      <p className="mt-3 text-sm text-white/40">No connections yet. Start connecting with dancers!</p>
                      <Link href="/connections" className="mt-4 inline-flex items-center gap-1 rounded-full bg-[#00ffff] px-5 py-2.5 text-sm font-bold text-[#004343]">
                        Discover dancers
                      </Link>
                    </div>
                  ) : null}
                </>
              )}


              </>
              ) : null}
            </section>

          {/* Network directory: Connections / Following+Followers / Contacts */}
          {networkSection !== "feed" ? (
          <section className="space-y-4">
            <section className="space-y-3">
              {networkSection === "connections" ? (
                  <div className="hidden sm:flex justify-start sm:justify-end">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{visibleConnections.length} visible</p>
                  </div>
              ) : null}

              {networkSection === "contacts" ? (
                <div className="flex justify-start sm:justify-end">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <p>
                      Showing {filteredContactCards.length} of {scopedContacts.length}
                    </p>
                    {activeNotesTooltip ? (
                      <InfoTooltip title={activeNotesTooltip.title} body={activeNotesTooltip.body} />
                    ) : null}
                  </div>
                </div>
              ) : null}

              {networkSection === "connections" ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 sm:justify-end">
                    <div className="group relative min-w-0 flex-1 sm:max-w-[280px]">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-500 transition-colors group-focus-within:text-cyan-300">
                        search
                      </span>
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search connections..."
                        className="w-full rounded-2xl border border-white/10 bg-[#121212] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-cyan-300/50 focus:ring-0"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowConnectionFilters((value) => !value)}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-bold transition ${
                        showConnectionFilters || hasConnectionFilters
                          ? "bg-[#00F5FF] text-[#0A0A0A]"
                          : "bg-[#00F5FF] text-[#0A0A0A] hover:opacity-90"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">tune</span>
                      <span className="hidden sm:inline">Filters</span>
                    </button>
                  </div>

                  {showConnectionFilters ? (
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <select
                        value={connectionCityFilter}
                        onChange={(event) => setConnectionCityFilter(event.target.value)}
                        className="rounded-2xl border border-white/10 bg-[#121212] px-3 py-3 text-sm text-white"
                      >
                        <option value="all">All cities</option>
                        {connectionCityOptions.map((city) => (
                          <option key={city} value={city}>
                            {city}
                          </option>
                        ))}
                      </select>
                      <div className="space-y-1.5">
                        <select
                          value={connectionStyleFilter}
                          onChange={(event) => { setConnectionStyleFilter(event.target.value); setConnectionStyleText(""); }}
                          className="w-full rounded-2xl border border-white/10 bg-[#121212] px-3 py-3 text-sm text-white"
                        >
                          <option value="all">All dance styles</option>
                          {connectionStyleOptions.map((style) => (
                            <option key={style} value={style}>
                              {style.charAt(0).toUpperCase() + style.slice(1).toLowerCase()}
                            </option>
                          ))}
                          <option value="other">Other…</option>
                        </select>
                        {connectionStyleFilter === "other" && (
                          <input
                            value={connectionStyleText}
                            onChange={(e) => setConnectionStyleText(e.target.value)}
                            placeholder="Search style (e.g. Hip Hop)"
                            className="w-full rounded-2xl border border-white/10 bg-[#121212] px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-cyan-300/50"
                          />
                        )}
                      </div>
                      <select
                        value={connectionRoleFilter}
                        onChange={(event) => setConnectionRoleFilter(event.target.value)}
                        className="rounded-2xl border border-white/10 bg-[#121212] px-3 py-3 text-sm text-white"
                      >
                        <option value="all">All roles</option>
                        {connectionRoleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={resetConnectionFilters}
                        disabled={!hasConnectionFilters}
                        className="rounded-2xl border border-white/10 bg-[#121212] px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-45"
                      >
                        Clear Filters
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {networkSection === "contacts" ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-end gap-2">
                    <div className="group relative min-w-0 flex-1 sm:max-w-[240px]">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-500 transition-colors group-focus-within:text-cyan-300">
                        search
                      </span>
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search contacts..."
                        className="w-full rounded-2xl border border-white/10 bg-[#121212] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-cyan-300/50 focus:ring-0"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddModal(true)}
                      className="inline-flex h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-3 text-xs font-bold text-[#06121a] hover:brightness-110 sm:px-4 sm:text-sm"
                    >
                      <span className="material-symbols-outlined text-[17px] sm:text-[18px]">person_add</span>
                      <span className="hidden sm:inline">Add Contact</span>
                      <span className="sm:hidden">Add</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowContactFilters((value) => !value)}
                      className={`inline-flex h-[42px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition sm:px-4 sm:text-sm ${
                        showContactFilters || hasContactFilters
                          ? "bg-[#00F5FF] text-[#0A0A0A]"
                          : "bg-[#00F5FF] text-[#0A0A0A] hover:opacity-90"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">tune</span>
                      <span className="hidden sm:inline">Filters</span>
                    </button>
                  </div>

                  {showContactFilters ? (
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                      <select
                        value={cityFilter}
                        onChange={(event) => setCityFilter(event.target.value)}
                        className="rounded-2xl border border-white/10 bg-[#121212] px-3 py-4 text-sm text-white"
                      >
                        <option value="all">All cities</option>
                        {cityOptions.map((city) => (
                          <option key={city} value={city}>
                            {city}
                          </option>
                        ))}
                      </select>
                      <div className="space-y-1.5">
                        <select
                          value={styleFilter}
                          onChange={(event) => { setStyleFilter(event.target.value); setStyleText(""); }}
                          className="w-full rounded-2xl border border-white/10 bg-[#121212] px-3 py-4 text-sm text-white"
                        >
                          <option value="all">All dance styles</option>
                          {styleOptions.map((style) => (
                            <option key={style} value={style}>
                              {style.charAt(0).toUpperCase() + style.slice(1).toLowerCase()}
                            </option>
                          ))}
                          <option value="other">Other…</option>
                        </select>
                        {styleFilter === "other" && (
                          <input
                            value={styleText}
                            onChange={(e) => setStyleText(e.target.value)}
                            placeholder="Search style (e.g. Hip Hop)"
                            className="w-full rounded-2xl border border-white/10 bg-[#121212] px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-cyan-300/50"
                          />
                        )}
                      </div>
                      <select
                        value={roleFilter}
                        onChange={(event) => setRoleFilter(event.target.value)}
                        className="rounded-2xl border border-white/10 bg-[#121212] px-3 py-4 text-sm text-white"
                      >
                        <option value="all">All roles</option>
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <select
                        value={activityFilter}
                        onChange={(event) => setActivityFilter(event.target.value as "all" | TrackActivity)}
                        className="rounded-2xl border border-white/10 bg-[#121212] px-3 py-4 text-sm text-white"
                      >
                        <option value="all">All activity</option>
                        {TRACK_ACTIVITY_OPTIONS.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={resetFilters}
                        disabled={!hasContactFilters}
                        className="rounded-2xl border border-white/10 bg-[#121212] px-4 py-4 text-sm font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-45"
                      >
                        Clear Filters
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>

          <section className="space-y-6">
            {networkSection === "connections" ? (
              <>
                {loading ? (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                    {Array.from({ length: 16 }).map((_, i) => (
                      <div key={`net-sk-conn-${i}`} className="flex animate-pulse items-center gap-3 py-2.5">
                        <div className="h-[60px] w-[60px] shrink-0 rounded-2xl bg-white/[0.06]" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3.5 w-24 rounded bg-white/[0.07]" />
                          <div className="h-2.5 w-20 rounded bg-white/[0.05]" />
                          <div className="h-2.5 w-16 rounded bg-white/[0.04]" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : visibleConnections.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-8 text-center text-sm text-slate-500">
                    No connections found for this filter.
                  </div>
                ) : (
                  <div className="animate-fade-in-grid grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                    {paginatedConnections.map((item) => {
                      const profile = item.profile;
                      const cityLabel = [profile?.city, profile?.country].filter(Boolean).join(", ") || "Location not set";
                      const roleLabel = profile?.roles.slice(0, 2).join(" • ") || "Dancer";
                      const isFollowing = followedMemberIds.has(item.otherUserId);
                      return (
                        <div key={item.id} className="flex items-center gap-2 py-2.5">
                          <Link href={`/profile/${encodeURIComponent(item.otherUserId)}`} className="relative shrink-0">
                            <div
                              className="h-[60px] w-[60px] rounded-2xl bg-cover bg-center"
                              style={{ backgroundImage: profile?.avatarUrl ? `url(${profile.avatarUrl})` : "linear-gradient(135deg,rgba(193,255,254,0.15),rgba(255,81,250,0.15))" }}
                            />
                            {isFollowing ? (
                              <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: "linear-gradient(135deg,#00F5FF,#FF00E5)" }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 10, color: "#06121a", lineHeight: 1 }}>check</span>
                              </div>
                            ) : null}
                          </Link>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <Link href={`/profile/${encodeURIComponent(item.otherUserId)}`} className="truncate text-[13px] font-bold text-white hover:text-[#7FEFF8] transition-colors">{profile?.displayName ?? "Member"}</Link>
                              {profile?.verified ? <VerifiedBadge size={14} /> : null}
                            </div>
                            <p className="truncate text-[11px] text-[#7FEFF8]/80">{cityLabel}</p>
                            <p className="truncate text-[10px] text-slate-500">{roleLabel}</p>
                          </div>
                          <ConnectionCardMenu
                            connId={item.id}
                            isFollowing={isFollowing}
                            contactId={contacts.find((c) => c.linkedUserId === item.otherUserId)?.id ?? null}
                            onUnfollow={() => setContacts((prev) => prev.map((c) => c.linkedUserId === item.otherUserId ? { ...c, isFollowing: false } : c))}
                            onRemove={() => setConnections((prev) => prev.filter((c) => c.id !== item.id))}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                {visibleConnections.length ? (
                  <PaginationControls
                    page={connectionsPage}
                    totalPages={totalConnectionsPages}
                    totalItems={visibleConnections.length}
                    pageSize={CONNECTIONS_PAGE_SIZE}
                    itemLabel="connections"
                    onPageChange={setConnectionsPage}
                  />
                ) : null}
              </>
            ) : null}

            {networkSection === "following" ? (() => {
              const FOLLOW_PAGE_SIZE = 40;
              const allFollowingCards = contactCards.filter((c) => c.isFollowing && c.contactType === "member");
              const followQ = followQuery.trim().toLowerCase();
              const followingCards = allFollowingCards.filter((card) =>
                contactCardMatchesFilters(card, {
                  needle: followQ,
                  cityFilter,
                  styleFilter,
                  styleText,
                  roleFilter,
                  activityFilter,
                })
              );
              const totalFollowingPages = Math.ceil(followingCards.length / FOLLOW_PAGE_SIZE);
              const pagedFollowing = followingCards.slice((followingListPage - 1) * FOLLOW_PAGE_SIZE, followingListPage * FOLLOW_PAGE_SIZE);
              const totalFollowersPages = Math.ceil(followerProfiles.length / FOLLOW_PAGE_SIZE);
              const pagedFollowers = followerProfiles.slice((followersListPage - 1) * FOLLOW_PAGE_SIZE, followersListPage * FOLLOW_PAGE_SIZE);
              return (
              <div className="space-y-8">
                {/* Following — 4-col grid with search */}
                <div className="space-y-3">
                  {/* Search row */}
                  <div className="flex items-center gap-2 sm:justify-end">
                    <div className="group relative min-w-0 flex-1 sm:max-w-[280px]">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-500 transition-colors group-focus-within:text-cyan-300">search</span>
                      <input
                        value={followQuery}
                        onChange={(e) => setFollowQuery(e.target.value)}
                        placeholder="Search following..."
                        className="w-full rounded-2xl border border-white/10 bg-[#121212] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-cyan-300/50 focus:ring-0"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowContactFilters((value) => !value)}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-bold transition ${
                        showContactFilters || hasFollowingFilters
                          ? "bg-[#00F5FF] text-[#0A0A0A]"
                          : "bg-[#00F5FF] text-[#0A0A0A] hover:opacity-90"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">tune</span>
                      <span className="hidden sm:inline">Filters</span>
                    </button>
                  </div>

                  {showContactFilters ? (
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                      <select
                        value={cityFilter}
                        onChange={(event) => setCityFilter(event.target.value)}
                        className="rounded-2xl border border-white/10 bg-[#121212] px-3 py-4 text-sm text-white"
                      >
                        <option value="all">All cities</option>
                        {cityOptions.map((city) => (
                          <option key={city} value={city}>
                            {city}
                          </option>
                        ))}
                      </select>
                      <div className="space-y-1.5">
                        <select
                          value={styleFilter}
                          onChange={(event) => { setStyleFilter(event.target.value); setStyleText(""); }}
                          className="w-full rounded-2xl border border-white/10 bg-[#121212] px-3 py-4 text-sm text-white"
                        >
                          <option value="all">All dance styles</option>
                          {styleOptions.map((style) => (
                            <option key={style} value={style}>
                              {style.charAt(0).toUpperCase() + style.slice(1).toLowerCase()}
                            </option>
                          ))}
                          <option value="other">Other…</option>
                        </select>
                        {styleFilter === "other" && (
                          <input
                            value={styleText}
                            onChange={(e) => setStyleText(e.target.value)}
                            placeholder="Search style (e.g. Hip Hop)"
                            className="w-full rounded-2xl border border-white/10 bg-[#121212] px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-cyan-300/50"
                          />
                        )}
                      </div>
                      <select
                        value={roleFilter}
                        onChange={(event) => setRoleFilter(event.target.value)}
                        className="rounded-2xl border border-white/10 bg-[#121212] px-3 py-4 text-sm text-white"
                      >
                        <option value="all">All roles</option>
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <select
                        value={activityFilter}
                        onChange={(event) => setActivityFilter(event.target.value as "all" | TrackActivity)}
                        className="rounded-2xl border border-white/10 bg-[#121212] px-3 py-4 text-sm text-white"
                      >
                        <option value="all">All activity</option>
                        {TRACK_ACTIVITY_OPTIONS.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={resetFollowingFilters}
                        disabled={!hasFollowingFilters}
                        className="rounded-2xl border border-white/10 bg-[#121212] px-4 py-4 text-sm font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-45"
                      >
                        Clear Filters
                      </button>
                    </div>
                  ) : null}
                  <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">Following · {allFollowingCards.length}</p>
                  {loading ? (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="flex animate-pulse items-center gap-2 py-2.5">
                          <div className="h-[60px] w-[60px] shrink-0 rounded-2xl bg-white/[0.06]" />
                          <div className="flex-1 space-y-1.5">
                            <div className="h-3.5 w-24 rounded bg-white/[0.07]" />
                            <div className="h-2.5 w-20 rounded bg-white/[0.05]" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : followingCards.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/10 py-6 text-center text-sm text-white/30">
                      {followQ ? "No results found." : "Not following anyone yet."}
                    </p>
                  ) : (
                    <>
                      <div className="animate-fade-in-grid grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                        {pagedFollowing.map((card) => {
                          const cityLabel = [card.city, card.country].filter(Boolean).join(", ") || "Location not set";
                          const roleLabel = card.roles.slice(0, 2).join(" • ") || "Dancer";
                          const hasLinkedProfile = Boolean(card.linkedUserId);
                          return (
                            <div key={card.id} className="flex items-center gap-2 py-2.5">
                              {hasLinkedProfile ? (
                                <Link href={`/profile/${encodeURIComponent(card.linkedUserId ?? "")}`} className="shrink-0">
                                  {card.avatarUrl ? (
                                    <div className="h-[60px] w-[60px] rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url(${card.avatarUrl})` }} />
                                  ) : (
                                    <div className="h-[60px] w-[60px] rounded-2xl overflow-hidden"><GenericAvatar /></div>
                                  )}
                                </Link>
                              ) : card.avatarUrl ? (
                                <div className="h-[60px] w-[60px] shrink-0 rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url(${card.avatarUrl})` }} />
                              ) : (
                                <div className="h-[60px] w-[60px] shrink-0 rounded-2xl overflow-hidden"><GenericAvatar /></div>
                              )}
                              <div className="min-w-0 flex-1">
                                {hasLinkedProfile ? (
                                  <Link href={`/profile/${encodeURIComponent(card.linkedUserId ?? "")}`}>
                                    <p className="truncate text-sm font-semibold text-white">{card.displayName}</p>
                                  </Link>
                                ) : (
                                  <p className="truncate text-sm font-semibold text-white">{card.displayName}</p>
                                )}
                                <p className="truncate text-[11px] text-[#7FEFF8]/80">{cityLabel}</p>
                                <p className="truncate text-[10px] text-slate-500">{roleLabel}</p>
                              </div>
                              <FollowingCardMenu
                                contactId={card.id}
                                onUnfollow={() => setRefreshKey((v) => v + 1)}
                              />
                            </div>
                          );
                        })}
                      </div>
                      {totalFollowingPages > 1 ? (
                        <PaginationControls page={followingListPage} totalPages={totalFollowingPages} totalItems={followingCards.length} pageSize={FOLLOW_PAGE_SIZE} itemLabel="people" onPageChange={setFollowingListPage} />
                      ) : null}
                    </>
                  )}
                </div>

                {/* Followers */}
                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">Followers · {followersCount}</p>
                  {loading ? (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="flex animate-pulse items-center gap-2 py-2.5">
                          <div className="h-[60px] w-[60px] shrink-0 rounded-2xl bg-white/[0.06]" />
                          <div className="flex-1 space-y-1.5">
                            <div className="h-3.5 w-24 rounded bg-white/[0.07]" />
                            <div className="h-2.5 w-20 rounded bg-white/[0.05]" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : followerProfiles.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/10 py-6 text-center text-sm text-white/30">No followers yet.</p>
                  ) : (
                    <>
                      <div className="animate-fade-in-grid grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                        {pagedFollowers.map((fp) => (
                          <Link key={fp.userId} href={`/profile/${fp.userId}`} className="flex items-center gap-2 py-2.5">
                            <div className="h-[60px] w-[60px] shrink-0 rounded-2xl bg-cover bg-center" style={{ backgroundImage: fp.avatarUrl ? `url(${fp.avatarUrl})` : "linear-gradient(135deg,rgba(193,255,254,0.2),rgba(255,81,250,0.2))" }} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-white">{fp.displayName}</p>
                            </div>
                          </Link>
                        ))}
                      </div>
                      {totalFollowersPages > 1 ? (
                        <PaginationControls page={followersListPage} totalPages={totalFollowersPages} totalItems={followerProfiles.length} pageSize={FOLLOW_PAGE_SIZE} itemLabel="people" onPageChange={setFollowersListPage} />
                      ) : null}
                    </>
                  )}
                </div>
              </div>
              );
            })() : null}

            {networkSection === "contacts" ? (
              <>
                <article className="space-y-6">
                  {loading ? (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                      {Array.from({ length: 16 }).map((_, i) => (
                        <div key={`net-sk-contact-${i}`} className="flex animate-pulse items-center gap-3 py-2.5">
                          <div className="h-[60px] w-[60px] shrink-0 rounded-2xl bg-white/[0.06]" />
                          <div className="flex-1 space-y-1.5">
                            <div className="h-3.5 w-24 rounded bg-white/[0.07]" />
                            <div className="h-2.5 w-20 rounded bg-white/[0.05]" />
                            <div className="h-2.5 w-16 rounded bg-white/[0.04]" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : filteredContactCards.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/15 bg-black/20 px-3 py-8 text-center text-sm text-slate-500">
                      No contacts match the current filters.
                    </div>
                  ) : (
                    <div className="animate-fade-in-grid grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                      {paginatedContactCards.map((card) => {
                        const cityLabel = [card.city, card.country].filter(Boolean).join(", ") || "Location not set";
                        const roleLabel = card.roles.slice(0, 2).join(" • ") || (card.contactType === "external" ? "External contact" : "Dancer");
                        return (
                          <div key={card.id} className="flex items-center gap-2 py-2.5">
                            {card.linkedUserId ? (
                              <Link href={`/profile/${encodeURIComponent(card.linkedUserId)}`} className="relative h-[60px] w-[60px] shrink-0">
                                {card.avatarUrl ? (
                                  <div className="h-full w-full rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url(${card.avatarUrl})` }} />
                                ) : (
                                  <div className="h-full w-full rounded-2xl overflow-hidden"><GenericAvatar /></div>
                                )}
                                {card.isFollowing ? (
                                  <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: "linear-gradient(135deg,#00F5FF,#FF00E5)" }}>
                                    <span className="material-symbols-outlined" style={{ fontSize: 10, color: "#06121a", lineHeight: 1 }}>check</span>
                                  </div>
                                ) : null}
                              </Link>
                            ) : (
                              <div className="relative h-[60px] w-[60px] shrink-0 rounded-2xl overflow-hidden">
                                {card.avatarUrl ? (
                                  <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${card.avatarUrl})` }} />
                                ) : (
                                  <GenericAvatar />
                                )}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1">
                                {card.linkedUserId ? (
                                  <Link href={`/profile/${encodeURIComponent(card.linkedUserId)}`} className="truncate text-[13px] font-bold text-white hover:text-[#7FEFF8] transition-colors">{card.displayName}</Link>
                                ) : (
                                  <span className="truncate text-[13px] font-bold text-white">{card.displayName}</span>
                                )}
                              </div>
                              <p className="truncate text-[11px] text-[#7FEFF8]/80">{cityLabel}</p>
                              <p className="truncate text-[10px] text-slate-500">{roleLabel}</p>
                            </div>
                            <ContactCardMenu
                              card={card}
                              busyContactId={busyContactId}
                              onEditContact={() => openEditModal(card)}
                              onEditNote={() => openEditModal(card)}
                              onRemove={() => void removeContact(card.id)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {networkSection === "contacts" && filteredContactCards.length ? (
                    <PaginationControls
                      page={contactsPage}
                      totalPages={totalContactsPages}
                      totalItems={filteredContactCards.length}
                      pageSize={CONNECTIONS_PAGE_SIZE}
                      itemLabel="contacts"
                      onPageChange={setContactsPage}
                      className="pt-2"
                    />
                  ) : null}
                </article>

              </>
            ) : null}

            </section>
          </section>
          ) : null}
        </div>
      </main>

      {editContact ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl border border-white/15 bg-[#0b141a] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.55)]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white">Edit Note</h3>
                <p className="mt-1 text-xs text-slate-400">Update notes, tags, and meeting context.</p>
              </div>
              <button
                type="button"
                onClick={() => setEditContactId(null)}
                className="rounded-full border border-white/20 bg-black/40 p-1.5 text-white/90 hover:bg-black/65"
                aria-label="Close edit dialog"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="grid gap-3">
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                Tags (comma separated)
                <input
                  value={editDraft.tags}
                  onChange={(event) => setEditDraft((prev) => ({ ...prev, tags: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  placeholder="festival buddy, teacher"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                Context of meeting
                <input
                  value={editDraft.meetingContext}
                  onChange={(event) => setEditDraft((prev) => ({ ...prev, meetingContext: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  placeholder="Met at Warsaw Bachata Festival"
                  maxLength={160}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                Notes
                <textarea
                  value={editDraft.notes}
                  onChange={(event) => setEditDraft((prev) => ({ ...prev, notes: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  rows={3}
                  maxLength={500}
                  placeholder="Notes for future follow-up"
                />
              </label>

              {editContact.contactType === "external" ? (
                <>
                  <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                    Roles (comma separated)
                    <input
                      value={editDraft.roles}
                      onChange={(event) => setEditDraft((prev) => ({ ...prev, roles: event.target.value }))}
                      className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                      placeholder="Organizer, DJ"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                    Dance styles (comma separated)
                    <input
                      value={editDraft.danceStyles}
                      onChange={(event) => setEditDraft((prev) => ({ ...prev, danceStyles: event.target.value }))}
                      className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                      placeholder="Bachata, Salsa"
                    />
                  </label>
                </>
              ) : null}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditContactId(null)}
                className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-white/[0.1]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveContactEdits()}
                disabled={busyContactId === editContact.id}
                className="rounded-lg bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-1.5 text-sm font-semibold text-[#06121a] disabled:opacity-60"
              >
                {busyContactId === editContact.id ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showAddModal ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl border border-white/15 bg-[#0b141a] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.55)]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white">Add External Contact</h3>
                <p className="mt-1 text-xs text-slate-400">Keep trusted people from events, studios, and festivals in your network.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-full border border-white/20 bg-black/40 p-1.5 text-white/90 hover:bg-black/65"
                aria-label="Close add contact dialog"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                Name
                <input
                  value={addDraft.name}
                  onChange={(event) => setAddDraft((prev) => ({ ...prev, name: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  placeholder="Marta Ruiz"
                  maxLength={120}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                City
                <input
                  value={addDraft.city}
                  onChange={(event) => setAddDraft((prev) => ({ ...prev, city: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  placeholder="Madrid"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                Country
                <input
                  value={addDraft.country}
                  onChange={(event) => setAddDraft((prev) => ({ ...prev, country: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  placeholder="Spain"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                Roles
                <input
                  value={addDraft.roles}
                  onChange={(event) => setAddDraft((prev) => ({ ...prev, roles: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  placeholder="Organizer, Teacher"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                Dance styles
                <input
                  value={addDraft.danceStyles}
                  onChange={(event) => setAddDraft((prev) => ({ ...prev, danceStyles: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  placeholder="Bachata, Salsa"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                Tags
                <input
                  value={addDraft.tags}
                  onChange={(event) => setAddDraft((prev) => ({ ...prev, tags: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  placeholder="festival buddy, host"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                Context of meeting
                <input
                  value={addDraft.meetingContext}
                  onChange={(event) => setAddDraft((prev) => ({ ...prev, meetingContext: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  placeholder="Met at Lisbon social night"
                  maxLength={160}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                Private notes
                <textarea
                  value={addDraft.notes}
                  onChange={(event) => setAddDraft((prev) => ({ ...prev, notes: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  rows={3}
                  maxLength={500}
                  placeholder="Runs Thursday socials. Follow up before next trip."
                />
              </label>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-white/[0.1]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void addExternalContact()}
                disabled={busyContactId === "add-contact"}
                className="rounded-lg bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-1.5 text-sm font-semibold text-[#06121a] disabled:opacity-60"
              >
                {busyContactId === "add-contact" ? "Saving..." : "Save contact"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NetworkPageFallback() {
  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <Nav />
      <main className="mx-auto w-full max-w-[1320px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
        <div className="space-y-5">
          <section className="border-b border-white/6 pb-3">
            <div className="no-scrollbar mx-auto flex w-full max-w-[860px] gap-2 overflow-x-auto pb-1 sm:justify-center">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`network-tab-sk-${index}`}
                  className="h-10 w-36 shrink-0 animate-pulse rounded-full border border-white/10 bg-white/5"
                />
              ))}
            </div>
          </section>

          <div className="flex justify-start sm:justify-end">
            <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="h-12 w-full animate-pulse rounded-2xl border border-white/10 bg-white/5 sm:ml-auto sm:w-[340px] sm:flex-1" />
            <div className="h-11 w-full animate-pulse rounded-full bg-[#00F5FF]/80 sm:w-[132px]" />
          </div>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={`network-card-sk-${index}`} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mx-auto mb-3 h-[116px] w-[116px] animate-pulse rounded-2xl bg-white/5" />
                <div className="mx-auto h-5 w-2/3 animate-pulse rounded bg-white/10" />
                <div className="mx-auto mt-2 h-4 w-1/2 animate-pulse rounded bg-white/10" />
                <div className="mx-auto mt-2 h-3 w-3/4 animate-pulse rounded bg-white/10" />
                <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
                  <div className="h-10 animate-pulse rounded-xl bg-white/10" />
                  <div className="h-10 w-10 animate-pulse rounded-xl bg-white/10" />
                </div>
              </div>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}

export default function NetworkPage() {
  return (
    <Suspense fallback={<NetworkPageFallback />}>
      <NetworkPageContent />
    </Suspense>
  );
}
