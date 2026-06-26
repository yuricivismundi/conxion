export type AppEmailKind =
  | "connection_request_received"
  | "connection_request_accepted"
  | "trip_request_received"
  | "trip_request_accepted"
  | "trip_request_declined"
  | "hosting_request_received"
  | "hosting_request_accepted"
  | "hosting_request_declined"
  | "event_request_accepted"
  | "event_request_declined"
  | "reference_received"
  | "reference_prompt_due"
  | "welcome_member"
  | "activity_upcoming"
  | "event_starting_soon"
  | "support_case_received"
  | "support_case_updated"
  | "pro_upgrade";

export type AppEmailParams = {
  kind: AppEmailKind;
  recipientUserId: string;
  recipientEmailOverride?: string | null;
  recipientNameOverride?: string | null;
  actorUserId?: string | null;
  connectionId?: string | null;
  tripId?: string | null;
  eventId?: string | null;
  syncId?: string | null;
  hostingRequestId?: string | null;
  referenceId?: string | null;
  requestType?: string | null;
  promptId?: string | null;
  contextTag?: string | null;
  promptDueAt?: string | null;
  promptExpiresAt?: string | null;
  activityTitle?: string | null;
  activityHappenedAt?: string | null;
  reminderCount?: number | null;
  unreadCount?: number | null;
  ticketCode?: string | null;
  supportClaimId?: string | null;
  supportSubject?: string | null;
  supportStatus?: string | null;
  idempotencySeed?: string | null;
};

export type EmailCopy = {
  eyebrow: string;
  subject: string;
  title: string;
  intro: string;
  details: string[];
  heroBadge?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  heroBody?: string;
  heroTheme?: "trip";
  detailStyle?: "stack" | "list";
  ctaLabel: string;
  footerNote: string;
  ctaHint?: string;
  titleSizePx?: number;
  logoWidthPx?: number;
  showGreeting?: boolean;
  showFooterNote?: boolean;
  showFallbackLink?: boolean;
};
