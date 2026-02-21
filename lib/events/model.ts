import {
  getTripHeroFallbackUrl,
  getTripHeroStorageFolderUrl,
  getTripHeroStorageUrl,
} from "@/lib/city-hero-images";

export type EventVisibility = "public" | "private";
export type EventStatus = "draft" | "published" | "cancelled";
export type EventCoverStatus = "pending" | "approved" | "rejected";
export type EventMemberStatus = "host" | "going" | "waitlist" | "left";
export type EventRequestStatus = "pending" | "accepted" | "declined" | "cancelled";

export type EventLink = {
  label: string;
  url: string;
  type: string;
};

export type EventRecord = {
  id: string;
  hostUserId: string;
  title: string;
  description: string | null;
  eventType: string;
  styles: string[];
  visibility: EventVisibility;
  city: string;
  country: string;
  venueName: string | null;
  venueAddress: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number | null;
  coverUrl: string | null;
  coverStatus: EventCoverStatus;
  coverReviewedBy: string | null;
  coverReviewedAt: string | null;
  coverReviewNote: string | null;
  hiddenByAdmin: boolean;
  hiddenReason: string | null;
  links: EventLink[];
  status: EventStatus;
  createdAt: string;
  updatedAt: string;
};

export type EventMemberRecord = {
  id: string;
  eventId: string;
  userId: string;
  memberRole: string;
  status: EventMemberStatus;
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EventRequestRecord = {
  id: string;
  eventId: string;
  requesterId: string;
  note: string | null;
  status: EventRequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LiteProfile = {
  userId: string;
  displayName: string;
  city: string;
  country: string;
  avatarUrl: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(row: Record<string, unknown>, key: string, fallback = "") {
  const value = row[key];
  return typeof value === "string" ? value : fallback;
}

function pickNullableString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function pickNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseLinks(rawLinks: unknown): EventLink[] {
  const linksSource =
    typeof rawLinks === "string"
      ? (() => {
          try {
            return JSON.parse(rawLinks) as unknown;
          } catch {
            return [];
          }
        })()
      : rawLinks;

  if (!Array.isArray(linksSource)) return [];

  return linksSource
    .map((raw) => {
      const row = asRecord(raw);
      const url = pickString(row, "url").trim();
      if (!url) return null;
      return {
        label: pickString(row, "label") || pickString(row, "type") || "Link",
        url,
        type: pickString(row, "type") || "link",
      } satisfies EventLink;
    })
    .filter((link): link is EventLink => Boolean(link));
}

function parseStyles(rawStyles: unknown): string[] {
  if (Array.isArray(rawStyles)) {
    return rawStyles
      .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
      .filter((item) => item.length > 0);
  }

  if (typeof rawStyles === "string" && rawStyles.trim().startsWith("{") && rawStyles.trim().endsWith("}")) {
    return rawStyles
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^\"|\"$/g, "").toLowerCase())
      .filter((item) => item.length > 0);
  }

  return [];
}

function normalizeEventVisibility(raw: string): EventVisibility {
  return raw === "private" ? "private" : "public";
}

function normalizeEventStatus(raw: string): EventStatus {
  if (raw === "draft" || raw === "cancelled") return raw;
  return "published";
}

function normalizeCoverStatus(raw: string): EventCoverStatus {
  if (raw === "approved" || raw === "rejected") return raw;
  return "pending";
}

function normalizeMemberStatus(raw: string): EventMemberStatus {
  if (raw === "host" || raw === "going" || raw === "waitlist" || raw === "left") return raw;
  return "going";
}

function normalizeRequestStatus(raw: string): EventRequestStatus {
  if (raw === "pending" || raw === "accepted" || raw === "declined" || raw === "cancelled") return raw;
  return "pending";
}

export function mapEventRows(rows: unknown[]): EventRecord[] {
  return rows
    .map((raw) => {
      const row = asRecord(raw);
      const id = pickString(row, "id");
      const hostUserId = pickString(row, "host_user_id");
      const startsAt = pickString(row, "starts_at");
      const endsAt = pickString(row, "ends_at");
      const createdAt = pickString(row, "created_at");
      const updatedAt = pickString(row, "updated_at");

      if (!id || !hostUserId || !startsAt || !endsAt || !createdAt || !updatedAt) return null;

      return {
        id,
        hostUserId,
        title: pickString(row, "title") || "Untitled Event",
        description: pickNullableString(row, "description"),
        eventType: pickString(row, "event_type") || "Social",
        styles: parseStyles(row.styles),
        visibility: normalizeEventVisibility(pickString(row, "visibility")),
        city: pickString(row, "city"),
        country: pickString(row, "country"),
        venueName: pickNullableString(row, "venue_name"),
        venueAddress: pickNullableString(row, "venue_address"),
        startsAt,
        endsAt,
        capacity: pickNumber(row, "capacity"),
        coverUrl: pickNullableString(row, "cover_url"),
        coverStatus: normalizeCoverStatus(pickString(row, "cover_status")),
        coverReviewedBy: pickNullableString(row, "cover_reviewed_by"),
        coverReviewedAt: pickNullableString(row, "cover_reviewed_at"),
        coverReviewNote: pickNullableString(row, "cover_review_note"),
        hiddenByAdmin: row.hidden_by_admin === true,
        hiddenReason: pickNullableString(row, "hidden_reason"),
        links: parseLinks(row.links),
        status: normalizeEventStatus(pickString(row, "status")),
        createdAt,
        updatedAt,
      } satisfies EventRecord;
    })
    .filter((event): event is EventRecord => Boolean(event));
}

export function mapEventMemberRows(rows: unknown[]): EventMemberRecord[] {
  return rows
    .map((raw) => {
      const row = asRecord(raw);
      const id = pickString(row, "id");
      const eventId = pickString(row, "event_id");
      const userId = pickString(row, "user_id");
      const createdAt = pickString(row, "created_at");
      const updatedAt = pickString(row, "updated_at");
      if (!id || !eventId || !userId || !createdAt || !updatedAt) return null;

      return {
        id,
        eventId,
        userId,
        memberRole: pickString(row, "member_role") || "guest",
        status: normalizeMemberStatus(pickString(row, "status")),
        joinedAt: pickNullableString(row, "joined_at"),
        createdAt,
        updatedAt,
      } satisfies EventMemberRecord;
    })
    .filter((member): member is EventMemberRecord => Boolean(member));
}

export function mapEventRequestRows(rows: unknown[]): EventRequestRecord[] {
  return rows
    .map((raw) => {
      const row = asRecord(raw);
      const id = pickString(row, "id");
      const eventId = pickString(row, "event_id");
      const requesterId = pickString(row, "requester_id");
      const createdAt = pickString(row, "created_at");
      const updatedAt = pickString(row, "updated_at");
      if (!id || !eventId || !requesterId || !createdAt || !updatedAt) return null;

      return {
        id,
        eventId,
        requesterId,
        note: pickNullableString(row, "note"),
        status: normalizeRequestStatus(pickString(row, "status")),
        decidedBy: pickNullableString(row, "decided_by"),
        decidedAt: pickNullableString(row, "decided_at"),
        createdAt,
        updatedAt,
      } satisfies EventRequestRecord;
    })
    .filter((request): request is EventRequestRecord => Boolean(request));
}

export function mapProfileRows(rows: unknown[]): Record<string, LiteProfile> {
  const map: Record<string, LiteProfile> = {};
  rows.forEach((raw) => {
    const row = asRecord(raw);
    const userId = pickString(row, "user_id");
    if (!userId) return;
    map[userId] = {
      userId,
      displayName: pickString(row, "display_name") || "Member",
      city: pickString(row, "city"),
      country: pickString(row, "country"),
      avatarUrl: pickNullableString(row, "avatar_url"),
    };
  });
  return map;
}

export function pickEventHeroUrl(event: EventRecord) {
  if (event.coverUrl && event.coverStatus === "approved") return event.coverUrl;
  return (
    getTripHeroStorageFolderUrl(event.country) ||
    getTripHeroStorageUrl(event.country) ||
    getTripHeroFallbackUrl(event.city, event.country)
  );
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatShortDate(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

export function formatDateTime(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatEventRange(start: string, end: string) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return "Date not available";

  const sameDay = startDate.toDateString() === endDate.toDateString();
  if (sameDay) {
    const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(startDate);
    const startTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(startDate);
    const endTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(endDate);
    return `${day} • ${startTime} - ${endTime}`;
  }

  const startText = formatDateTime(start);
  const endText = formatDateTime(end);
  return `${startText} - ${endText}`;
}

export function monthToken(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(date).toUpperCase();
}

export function dayToken(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(date);
}

export function buildMapsUrl(event: EventRecord) {
  const query = [event.venueName, event.venueAddress, event.city, event.country].filter(Boolean).join(", ");
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
