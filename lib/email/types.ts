export type AppEmailKind =
  | "connection_request_received"
  | "connection_request_accepted"
  | "connection_request_declined"
  | "trip_request_received"
  | "hosting_request_received"
  | "hosting_request_accepted"
  | "hosting_request_declined"
  | "sync_proposed"
  | "sync_accepted"
  | "sync_declined"
  | "sync_completed"
  | "event_request_received"
  | "event_request_accepted"
  | "event_request_declined"
  | "event_joined"
  | "reference_received"
  | "reference_prompt_due"
  | "reference_prompt_reminder"
  | "welcome_member"
  | "sync_upcoming"
  | "event_starting_soon"
  | "travel_plan_upcoming"
  | "inbox_digest"
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
