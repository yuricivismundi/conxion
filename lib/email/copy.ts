import type { AppEmailKind, AppEmailParams, EmailCopy } from "@/lib/email/types";

export type TripSummary = {
  city: string;
  country: string;
  startDate: string | null;
  endDate: string | null;
};

export type EventSummary = {
  title: string;
  city: string | null;
  country: string | null;
  startsAt: string | null;
};

export type HostingSummary = {
  requestType: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
};

export type SyncSummary = {
  syncType: string | null;
  scheduledAt: string | null;
};

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateBadge(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const day = new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(date);
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(date).toUpperCase();
  return `${day}-${month}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatTripDateBadge(trip: TripSummary | null) {
  if (!trip) return null;
  const start = formatDateBadge(trip.startDate);
  const end = formatDateBadge(trip.endDate);
  if (start && end) return `${start} - ${end}`;
  return start || end;
}

function formatHostingDateBadge(hosting: HostingSummary | null) {
  if (!hosting) return null;
  const start = formatDateBadge(hosting.arrivalDate);
  const end = formatDateBadge(hosting.departureDate);
  if (start && end) return `${start} - ${end}`;
  return start || end;
}

function formatTripCity(trip: TripSummary | null) {
  return trip?.city?.trim() || "Trip";
}

function formatTripCountry(trip: TripSummary | null) {
  return trip?.country?.trim().toUpperCase() || "";
}

function formatTripLabel(trip: TripSummary | null) {
  if (!trip) return "your trip";
  return [trip.city, trip.country].filter(Boolean).join(", ") || "your trip";
}

function formatEventLabel(event: EventSummary | null) {
  if (!event) return "your event";
  return event.title || [event.city, event.country].filter(Boolean).join(", ") || "your event";
}

function formatHostingLabel(hosting: HostingSummary | null) {
  if (!hosting) return "hosting plan";
  return hosting.requestType === "offer_to_host" ? "host offer" : "hosting request";
}

function capitalizeLabel(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSyncLabel(sync: SyncSummary | null) {
  if (!sync?.syncType) return "sync";
  return sync.syncType.replaceAll("_", " ");
}

function formatContextTagLabel(value: string | null | undefined) {
  const key = (value ?? "").trim().toLowerCase();
  if (key === "travel" || key === "travelling" || key === "travel_together") return "travelling";
  if (key === "host" || key === "offer_hosting" || key === "hosting") return "offer hosting";
  if (key === "guest" || key === "request_hosting" || key === "stay_as_guest") return "request hosting";
  if (key === "practice") return "practice";
  if (key === "private_class" || key === "private class" || key === "private_lesson") return "private class";
  if (key === "social_dance") return "social dance";
  if (key === "event" || key === "festival" || key === "event_festival" || key === "workshop" || key === "competition") {
    return "event / festival";
  }
  if (key === "collaboration" || key === "content_video" || key === "collaborate") return "collaborate";
  return "recent interaction";
}

function formatSupportStatusLabel(value: string | null | undefined) {
  const key = (value ?? "").trim().toLowerCase();
  if (key === "resolved") return "Resolved";
  if (key === "dismissed") return "Dismissed";
  if (key === "needs_info") return "Needs info";
  if (key === "under_review") return "Under review";
  if (key === "reopen" || key === "reopened") return "Reopened";
  return "Open";
}

export function buildCtaPath(params: AppEmailParams) {
  switch (params.kind) {
    case "connection_request_received":
      return "/messages?tab=requests";
    case "connection_request_accepted":
      return params.connectionId ? `/connections/${params.connectionId}` : "/network/connections";
    case "trip_request_received":
    case "trip_request_accepted":
    case "trip_request_declined":
      return params.tripId ? `/messages?thread=trip%3A${params.tripId}` : params.hostingRequestId ? "/activity?tab=hosting" : "/activity?tab=trips";
    case "hosting_request_received":
    case "hosting_request_accepted":
    case "hosting_request_declined":
      return "/activity?tab=hosting";
    case "activity_upcoming":
      return params.connectionId ? `/connections/${params.connectionId}` : "/network/connections";
    case "reference_received":
      return "/references";
    case "reference_prompt_due":
      return params.actorUserId
        ? `/references?userId=${encodeURIComponent(params.actorUserId)}`
        : "/references";
    case "event_request_accepted":
    case "event_request_declined":
    case "event_starting_soon":
      return params.eventId ? `/events/${params.eventId}` : "/events";
    case "welcome_member":
    case "pro_upgrade":
      return "/discover";
    case "support_case_received":
    case "support_case_updated":
      return params.supportClaimId ? `/support/cases/${params.supportClaimId}` : "/support";
  }
}

export function buildEmailCopy(params: {
  kind: AppEmailKind;
  actorName: string;
  trip: TripSummary | null;
  event: EventSummary | null;
  hosting: HostingSummary | null;
  sync: SyncSummary | null;
  contextTag?: string | null;
  promptDueAt?: string | null;
  promptExpiresAt?: string | null;
  activityTitle?: string | null;
  activityHappenedAt?: string | null;
  unreadCount?: number | null;
  ticketCode?: string | null;
  supportSubject?: string | null;
  supportStatus?: string | null;
}): EmailCopy {
  const tripLabel = formatTripLabel(params.trip);
  const eventLabel = formatEventLabel(params.event);
  const hostingLabel = formatHostingLabel(params.hosting);
  const syncLabel = formatSyncLabel(params.sync);
  const referenceContextLabel = formatContextTagLabel(params.contextTag);
  const promptDue = formatDateTime(params.promptDueAt);
  const promptExpires = formatDate(params.promptExpiresAt);
  const activityDate = formatDate(params.activityHappenedAt);
  const tripWindow =
    params.trip && (params.trip.startDate || params.trip.endDate)
      ? [formatDate(params.trip.startDate), formatDate(params.trip.endDate)].filter(Boolean).join(" to ")
      : null;
  const hostingWindow =
    params.hosting && (params.hosting.arrivalDate || params.hosting.departureDate)
      ? [formatDate(params.hosting.arrivalDate), formatDate(params.hosting.departureDate)].filter(Boolean).join(" to ")
      : null;
  const eventStart = formatDateTime(params.event?.startsAt);
  const syncStart = formatDateTime(params.sync?.scheduledAt);
  const unreadCount = Math.max(0, Math.round(params.unreadCount ?? 0));
  const supportStatus = formatSupportStatusLabel(params.supportStatus);
  const ticketCode = (params.ticketCode ?? "").trim();
  const supportSubject = params.supportSubject?.trim() || "Reference report";

  switch (params.kind) {
    case "connection_request_received":
      return {
        eyebrow: "Connection Request",
        subject: `${params.actorName} wants to connect`,
        title: `${params.actorName} sent you a request`,
        intro: `Review their profile and accept or decline.`,
        details: [],
        ctaLabel: "Review request",
        footerNote: "",
      };
    case "connection_request_accepted":
      return {
        eyebrow: "Connection Accepted",
        subject: `${params.actorName} accepted your request`,
        title: "You're now connected",
        intro: `Start a conversation with ${params.actorName}.`,
        details: [],
        ctaLabel: "Open chat",
        footerNote: "",
      };
    case "trip_request_received":
      return {
        eyebrow: "Trip Request",
        subject: `${params.actorName} requested to join ${tripLabel}`,
        title: tripLabel,
        intro: "",
        details: [],
        heroBadge: formatTripDateBadge(params.trip) ?? undefined,
        heroTitle: formatTripCity(params.trip),
        heroSubtitle: formatTripCountry(params.trip) || undefined,
        heroBody: `${params.actorName} wants to join your trip.`,
        heroTheme: "trip",
        ctaLabel: "Review trip request",
        footerNote: "",
        ctaHint: "Open the trip request and respond.",
        logoWidthPx: 168,
        showGreeting: false,
        showFooterNote: false,
        showFallbackLink: false,
      };
    case "trip_request_accepted":
      return {
        eyebrow: "Trip Request",
        subject: `Your trip request to ${tripLabel} was accepted`,
        title: tripLabel,
        intro: "",
        details: [],
        heroBadge: formatTripDateBadge(params.trip) ?? undefined,
        heroTitle: formatTripCity(params.trip),
        heroSubtitle: formatTripCountry(params.trip) || undefined,
        heroBody: `${params.actorName} accepted your request. Your trip to ${tripLabel} is confirmed.`,
        heroTheme: "trip",
        ctaLabel: "View trip",
        footerNote: "",
        ctaHint: "Open the trip to see details and connect with the host.",
        logoWidthPx: 168,
        showGreeting: false,
        showFooterNote: false,
        showFallbackLink: false,
      };
    case "trip_request_declined":
      return {
        eyebrow: "Trip Request",
        subject: `Your trip request to ${tripLabel} was declined`,
        title: tripLabel,
        intro: "",
        details: [],
        heroBadge: formatTripDateBadge(params.trip) ?? undefined,
        heroTitle: formatTripCity(params.trip),
        heroSubtitle: formatTripCountry(params.trip) || undefined,
        heroBody: `${params.actorName} couldn't accommodate your request this time. You can explore other trips.`,
        heroTheme: "trip",
        ctaLabel: "Explore trips",
        footerNote: "",
        ctaHint: "Browse available trips and send a new request.",
        logoWidthPx: 168,
        showGreeting: false,
        showFooterNote: false,
        showFallbackLink: false,
      };
    case "hosting_request_received":
      return {
        eyebrow: "Hosting Request",
        subject: `${params.actorName} sent a ${hostingLabel}`,
        title: tripLabel,
        intro: "",
        details: [],
        heroBadge: formatHostingDateBadge(params.hosting) ?? formatTripDateBadge(params.trip) ?? undefined,
        heroTitle: params.trip?.city?.trim() || capitalizeLabel(hostingLabel),
        heroSubtitle: params.trip?.country?.trim().toUpperCase() || undefined,
        heroBody: `${params.actorName} sent you a ${hostingLabel}.`,
        heroTheme: "trip",
        ctaLabel: "Review hosting request",
        footerNote: "",
        ctaHint: "Open the hosting request and respond.",
        logoWidthPx: 168,
        showGreeting: false,
        showFooterNote: false,
        showFallbackLink: false,
      };
    case "hosting_request_accepted":
      return {
        eyebrow: "Hosting Accepted",
        subject: `Your ${hostingLabel} was accepted`,
        title: `${params.actorName} said yes`,
        intro: hostingWindow ? `Your stay is set for ${hostingWindow}.` : "Coordinate the details in your inbox thread.",
        details: [],
        ctaLabel: "Open hosting inbox",
        footerNote: "",
      };
    case "hosting_request_declined":
      return {
        eyebrow: "Hosting Declined",
        subject: `Your ${hostingLabel} was declined`,
        title: `${params.actorName} can't host this time`,
        intro: "You can explore other hosts or send a new offer when timing works.",
        details: [],
        ctaLabel: "Open hosting inbox",
        footerNote: "",
      };
    case "event_request_accepted":
      return {
        eyebrow: "Event Access Accepted",
        subject: `You're in — ${eventLabel}`,
        title: "Access granted",
        intro: eventStart ? `${eventLabel} starts ${eventStart}.` : `You can now view ${eventLabel}.`,
        details: [],
        ctaLabel: "Open event",
        footerNote: "",
      };
    case "event_request_declined":
      return {
        eyebrow: "Event Access Declined",
        subject: `Your request for ${eventLabel} was declined`,
        title: "Request declined",
        intro: `${params.actorName} couldn't approve your request this time.`,
        details: [],
        ctaLabel: "Browse events",
        footerNote: "",
      };
    case "reference_received":
      return {
        eyebrow: "New Reference",
        subject: `${params.actorName} left you a reference`,
        title: "You got a reference",
        intro: "Read it and leave yours if you haven't yet.",
        details: [],
        ctaLabel: "Read reference",
        footerNote: "",
      };
    case "reference_prompt_due": {
      const activityLabel = params.activityTitle
        ? capitalizeLabel(params.activityTitle)
        : capitalizeLabel(referenceContextLabel);
      const details: string[] = [];
      if (activityDate) details.push(`${activityLabel} on ${activityDate}`);
      if (promptExpires) details.push(`Expires: ${promptExpires}`);
      return {
        eyebrow: "Reference Request",
        subject: `Leave a reference for ${params.actorName}`,
        title: "Leave a reference",
        intro: `Your ${activityLabel.toLowerCase()} with ${params.actorName} is eligible. References expire after 14 days.`,
        details,
        ctaLabel: "Leave a reference",
        footerNote: "",
      };
    }
    case "welcome_member":
      return {
        eyebrow: "Welcome",
        subject: "You're on ConXion",
        title: "Start connecting",
        intro: "Find dancers, explore events, plan trips.",
        details: [],
        ctaLabel: "Explore",
        footerNote: "",
        ctaHint: "Most users start with one connection.",
        titleSizePx: 32,
        logoWidthPx: 168,
        showGreeting: false,
        showFooterNote: false,
        showFallbackLink: false,
      };
    case "activity_upcoming":
      return {
        eyebrow: "Starting Soon",
        subject: `Your activity with ${params.actorName} is coming up`,
        title: "Activity coming up",
        intro: syncStart
          ? `You have an activity with ${params.actorName} on ${syncStart}.`
          : `You have an activity scheduled with ${params.actorName}.`,
        details: [],
        ctaLabel: "Open activity",
        footerNote: "",
      };
    case "event_starting_soon":
      return {
        eyebrow: "Event Reminder",
        subject: `${eventLabel} starts soon`,
        title: "Your event is coming up",
        intro: eventStart ? `${eventLabel} starts ${eventStart}.` : `${eventLabel} is starting soon.`,
        details: [],
        ctaLabel: "Open event",
        footerNote: "",
      };
    case "support_case_received":
      return {
        eyebrow: "Support Ticket",
        subject: ticketCode ? `[${ticketCode}] Request received` : "Support request received",
        title: ticketCode ? `Ticket ${ticketCode}` : "Request received",
        intro: `We received your report for "${supportSubject}". We'll review it shortly.`,
        details: [`Status: ${supportStatus}`],
        ctaLabel: "Open support",
        footerNote: "",
      };
    case "support_case_updated":
      return {
        eyebrow: "Support Update",
        subject: ticketCode ? `[${ticketCode}] Status updated` : "Support request updated",
        title: ticketCode ? `Ticket ${ticketCode} updated` : "Request updated",
        intro: `Your report for "${supportSubject}" is now ${(supportStatus ?? "updated").toLowerCase()}.`,
        details: [],
        ctaLabel: "Open support",
        footerNote: "",
      };
    case "pro_upgrade":
      return {
        eyebrow: "Plus Active",
        subject: "Welcome to ConXion Plus",
        title: "You're on Plus",
        intro: "Your new limits are active.",
        details: [
          "60 connection requests / month",
          "30 active chat threads / month",
          "10 hosting offers / month",
          "5 trips / month",
          "5 events / month",
          "3 extra profile photos",
          "Better visibility in discovery",
        ],
        detailStyle: "list",
        ctaLabel: "Explore",
        footerNote: "Manage your subscription any time from account settings.",
        showFallbackLink: false,
      };
  }
}
