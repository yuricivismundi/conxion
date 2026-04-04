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
  if (key === "travel") return "trip";
  if (key === "host") return "hosting stay";
  if (key === "guest") return "hosted stay";
  if (key === "practice") return "practice";
  if (key === "event") return "event";
  if (key === "festival") return "festival";
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
    case "connection_request_declined":
      return "/messages?tab=requests";
    case "connection_request_accepted":
      return params.connectionId ? `/connections/${params.connectionId}` : "/network/connections";
    case "trip_request_received":
    case "trip_request_accepted":
    case "trip_request_declined":
    case "travel_plan_upcoming":
      return params.tripId ? `/trips/${params.tripId}` : params.hostingRequestId ? "/trips/hosting" : "/trips";
    case "hosting_request_received":
    case "hosting_request_accepted":
    case "hosting_request_declined":
      return "/trips/hosting";
    case "sync_proposed":
    case "sync_accepted":
    case "sync_declined":
    case "sync_upcoming":
      return params.connectionId ? `/connections/${params.connectionId}` : "/network/connections";
    case "sync_completed":
    case "reference_received":
    case "reference_prompt_due":
    case "reference_prompt_reminder":
      return "/references";
    case "event_request_received":
    case "event_joined":
      return params.eventId ? `/events/${params.eventId}/inbox` : "/events";
    case "event_request_accepted":
    case "event_request_declined":
    case "event_starting_soon":
      return params.eventId ? `/events/${params.eventId}` : "/events";
    case "welcome_member":
    case "pro_upgrade":
      return "/discover";
    case "inbox_digest":
      return "/messages";
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
        subject: `${params.actorName} sent you a connection request`,
        title: "New connection request",
        intro: `${params.actorName} wants to connect with you on ConXion.`,
        details: [],
        ctaLabel: "Review request",
        footerNote: "Accept or decline the request inside your ConXion inbox.",
      };
    case "connection_request_accepted":
      return {
        eyebrow: "Connection Accepted",
        subject: `${params.actorName} accepted your connection request`,
        title: "Connection request accepted",
        intro: `${params.actorName} accepted your request. You can continue in chat now.`,
        details: [],
        ctaLabel: "Open connection",
        footerNote: "The connection is now active in your network.",
      };
    case "connection_request_declined":
      return {
        eyebrow: "Connection Update",
        subject: `${params.actorName} declined your connection request`,
        title: "Connection request declined",
        intro: `${params.actorName} declined your connection request.`,
        details: [],
        ctaLabel: "View requests",
        footerNote: "You can keep exploring dancers and send a new request elsewhere.",
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
        title: "Hosting request accepted",
        intro: `${params.actorName} accepted your ${hostingLabel}.`,
        details: hostingWindow ? [`Stay window: ${hostingWindow}`] : [],
        ctaLabel: "Open hosting inbox",
        footerNote: "Use the inbox thread to coordinate arrival details and expectations.",
      };
    case "hosting_request_declined":
      return {
        eyebrow: "Hosting Declined",
        subject: `Your ${hostingLabel} was declined`,
        title: "Hosting request declined",
        intro: `${params.actorName} declined your ${hostingLabel}.`,
        details: hostingWindow ? [`Stay window: ${hostingWindow}`] : [],
        ctaLabel: "Open hosting inbox",
        footerNote: "You can keep exploring hosts or send another offer when relevant.",
      };
    case "sync_proposed":
      return {
        eyebrow: "Sync Request",
        subject: `${params.actorName} proposed a ${syncLabel}`,
        title: "New sync request",
        intro: `${params.actorName} wants to sync with you.`,
        details: [],
        ctaLabel: "Review sync",
        footerNote: "",
        ctaHint: syncStart ? `Scheduled for ${syncStart}` : "Open the request and respond.",
        titleSizePx: 30,
        logoWidthPx: 168,
        showGreeting: false,
        showFooterNote: false,
        showFallbackLink: false,
      };
    case "sync_accepted":
      return {
        eyebrow: "Sync Accepted",
        subject: `${params.actorName} accepted your ${syncLabel}`,
        title: "Sync accepted",
        intro: `${params.actorName} accepted your ${syncLabel}.`,
        details: syncStart ? [`Scheduled for: ${syncStart}`] : [],
        ctaLabel: "Open connection",
        footerNote: "The session is confirmed. Use chat to align timing and logistics.",
      };
    case "sync_declined":
      return {
        eyebrow: "Sync Declined",
        subject: `${params.actorName} declined your ${syncLabel}`,
        title: "Sync declined",
        intro: `${params.actorName} declined your ${syncLabel}.`,
        details: syncStart ? [`Scheduled for: ${syncStart}`] : [],
        ctaLabel: "Open connection",
        footerNote: "You can propose another sync later from the same connection.",
      };
    case "sync_completed":
      return {
        eyebrow: "Reference Opportunity",
        subject: `${params.actorName} marked your ${syncLabel} as completed`,
        title: "Session completed",
        intro: `${params.actorName} marked your ${syncLabel} as completed. You can now leave a reference.`,
        details: [],
        ctaLabel: "Leave a reference",
        footerNote: "A strong network grows from timely feedback after real interactions.",
      };
    case "event_request_received":
      return {
        eyebrow: "Event Access Request",
        subject: `${params.actorName} requested access to ${eventLabel}`,
        title: "New event access request",
        intro: `${params.actorName} requested access to ${eventLabel}.`,
        details: eventStart ? [`Starts: ${eventStart}`] : [],
        ctaLabel: "Review request",
        footerNote: "Approve or decline from the event inbox.",
      };
    case "event_request_accepted":
      return {
        eyebrow: "Event Access Accepted",
        subject: `Your request for ${eventLabel} was accepted`,
        title: "Event request accepted",
        intro: `${params.actorName} accepted your request for ${eventLabel}.`,
        details: eventStart ? [`Starts: ${eventStart}`] : [],
        ctaLabel: "Open event",
        footerNote: "You can now view the event and any chat or attendance updates.",
      };
    case "event_request_declined":
      return {
        eyebrow: "Event Access Declined",
        subject: `Your request for ${eventLabel} was declined`,
        title: "Event request declined",
        intro: `${params.actorName} declined your request for ${eventLabel}.`,
        details: eventStart ? [`Starts: ${eventStart}`] : [],
        ctaLabel: "View event",
        footerNote: "Keep exploring events that match your travel and dance plans.",
      };
    case "event_joined":
      return {
        eyebrow: "New Attendee",
        subject: `${params.actorName} joined ${eventLabel}`,
        title: "New event attendee",
        intro: `${params.actorName} joined ${eventLabel}.`,
        details: eventStart ? [`Starts: ${eventStart}`] : [],
        ctaLabel: "Open event inbox",
        footerNote: "The event inbox has the latest attendance and request activity.",
      };
    case "reference_received":
      return {
        eyebrow: "New Reference",
        subject: `${params.actorName} left you a reference`,
        title: "New reference received",
        intro: `${params.actorName} left you a reference on ConXion.`,
        details: [],
        ctaLabel: "Read reference",
        footerNote: "Open your references to review and respond if needed.",
      };
    case "reference_prompt_due":
      return {
        eyebrow: "Reference Reminder",
        subject: `Leave a reference for your ${referenceContextLabel}`,
        title: "Your reference is ready",
        intro: `Your ${referenceContextLabel} with ${params.actorName} is now eligible for a reference.`,
        details: promptDue ? [`Available since: ${promptDue}`] : [],
        ctaLabel: "Leave a reference",
        footerNote: "A short reference keeps trust signals fresh for both dancers.",
      };
    case "reference_prompt_reminder":
      return {
        eyebrow: "Reference Follow-up",
        subject: `Reminder: leave a reference for your ${referenceContextLabel}`,
        title: "Quick reminder to leave a reference",
        intro: `You still have time to leave a reference for your ${referenceContextLabel} with ${params.actorName}.`,
        details: promptDue ? [`Reference unlocked: ${promptDue}`] : [],
        ctaLabel: "Open references",
        footerNote: "Reference prompts expire, so it is best to leave feedback while the interaction is still fresh.",
      };
    case "welcome_member":
      return {
        eyebrow: "Welcome",
        subject: "Explore dancers on ConXion",
        title: "Start your journey",
        intro: "Find dancers, hosts, events and more.",
        details: [],
        ctaLabel: "Explore dancers",
        footerNote: "",
        ctaHint: "Most users start with one connection.",
        titleSizePx: 32,
        logoWidthPx: 168,
        showGreeting: false,
        showFooterNote: false,
        showFallbackLink: false,
      };
    case "sync_upcoming":
      return {
        eyebrow: "Starting Soon",
        subject: `Your ${syncLabel} with ${params.actorName} is coming up`,
        title: "Your sync is coming up",
        intro: `${syncLabel[0]?.toUpperCase() ?? "S"}${syncLabel.slice(1)} with ${params.actorName} is scheduled soon.`,
        details: syncStart ? [`Starts: ${syncStart}`] : [],
        ctaLabel: "Open sync",
        footerNote: "Use the connection thread to confirm timing or any last details.",
      };
    case "event_starting_soon":
      return {
        eyebrow: "Event Reminder",
        subject: `${eventLabel} starts soon`,
        title: "Your event starts soon",
        intro: `${eventLabel} is coming up soon on ConXion.`,
        details: eventStart ? [`Starts: ${eventStart}`] : [],
        ctaLabel: "Open event",
        footerNote: "Check the event page for attendees, updates, and final logistics.",
      };
    case "travel_plan_upcoming":
      return {
        eyebrow: "Travel Reminder",
        subject: params.hosting ? "Your hosting plan starts soon" : `${tripLabel} starts soon`,
        title: params.hosting ? "Your hosting plan starts soon" : "Your trip starts soon",
        intro: params.hosting
          ? `Your ${hostingLabel} with ${params.actorName} is coming up soon.`
          : `${tripLabel} is coming up soon on ConXion.`,
        details: hostingWindow ? [`Stay window: ${hostingWindow}`] : tripWindow ? [`Trip dates: ${tripWindow}`] : [],
        ctaLabel: params.hosting ? "Open hosting" : "Open trip",
        footerNote: "Review your thread now so travel details are aligned before the date arrives.",
      };
    case "inbox_digest":
      return {
        eyebrow: "Inbox",
        subject: `${unreadCount} unread conversation${unreadCount === 1 ? "" : "s"} on ConXion`,
        title: unreadCount === 1 ? "You have 1 unread message" : `You have ${unreadCount} unread messages`,
        intro: "Open your inbox and catch up.",
        details: [],
        ctaLabel: "Open inbox",
        footerNote: "",
        ctaHint: "Fast replies keep momentum.",
        titleSizePx: 30,
        logoWidthPx: 168,
        showGreeting: false,
        showFooterNote: false,
        showFallbackLink: false,
      };
    case "support_case_received":
      return {
        eyebrow: "Support Ticket",
        subject: ticketCode ? `[${ticketCode}] Request received` : "Support request received",
        title: ticketCode ? `${ticketCode} received` : "Support request received",
        intro: `We received your report for "${supportSubject}" and added it to the moderation queue.`,
        details: [
          `Status: ${supportStatus}`,
          "Replies by email are not enabled yet. Add new context from your Support page inside ConXion.",
        ],
        ctaLabel: "Open support",
        footerNote: "We review safety and trust cases directly in the admin console so moderation history stays consistent.",
      };
    case "support_case_updated":
      return {
        eyebrow: "Support Update",
        subject: ticketCode ? `[${ticketCode}] Status updated` : "Support request updated",
        title: ticketCode ? `${ticketCode} updated` : "Support request updated",
        intro: `Your report for "${supportSubject}" is now ${(supportStatus ?? "updated").toLowerCase()}.`,
        details: [`Current status: ${supportStatus}`],
        ctaLabel: "Open support",
        footerNote: "Check the case details in ConXion for the latest moderation status and notes.",
      };
    case "pro_upgrade":
      return {
        eyebrow: "Plus Active",
        subject: "Welcome to ConXion Plus",
        title: "You're now on Plus",
        intro: "Thank you for upgrading. Your new limits are active and ready to use.",
        details: [
          "60 connection requests per month",
          "30 active chat threads per month",
          "10 hosting offers per month",
          "5 trips per month",
          "5 events per month",
          "3 additional profile photos",
          "Better visibility in discovery",
        ],
        detailStyle: "list",
        ctaLabel: "Explore the community",
        footerNote: "Your Plus subscription renews monthly. Manage it any time from your account settings.",
        showFallbackLink: false,
      };
  }
}
