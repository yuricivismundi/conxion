export type AdminTrendPoint = {
  key: string;
  label: string;
  value: number;
};

export type AdminLiteProfile = {
  userId: string;
  displayName: string;
  city: string;
  country: string;
  avatarUrl: string | null;
};

export type AdminOverviewStats = {
  totalMembers: number;
  totalProfiles: number;
  verifiedMembers: number;
  plusMembers: number;
  activeHosts: number;
  totalAdmins: number;
  newUsers7d: number;
  newUsers30d: number;
  openReports: number;
  openPrivacyRequests: number;
  openReferenceClaims: number;
  pendingAvatarReviews: number;
  pendingEventCovers: number;
  pendingRequests: number;
  upcomingEvents: number;
  hiddenEvents: number;
  references30d: number;
  events30d: number;
  moderationActions30d: number;
};

export type AdminEventsHealth = {
  upcomingTotal: number;
  upcomingPublicVisible: number;
  pastTotal: number;
  archivedTotal: number;
  generatedAt: string;
};

export type AdminDistributionItem = {
  key: string;
  label: string;
  value: number;
};

export type AdminFlaggedMember = AdminLiteProfile & {
  reports: number;
};

export type AdminReportQueueItem = {
  id: string;
  status: string;
  context: string;
  contextId: string | null;
  reason: string;
  note: string | null;
  createdAt: string;
  reporter: AdminLiteProfile | null;
  target: AdminLiteProfile | null;
  ticketCode: string | null;
  claimId: string | null;
  subject: string | null;
  description: string | null;
  referenceExcerpt: string | null;
  contextTag: string | null;
  reporterEmail: string | null;
  evidenceLinks: string[];
  profileLink: string | null;
};

export type AdminPhotoQueueItem = AdminLiteProfile & {
  avatarStatus: string;
  uploadedAt: string | null;
};

export type AdminEventCoverQueueItem = {
  eventId: string;
  title: string;
  status: string;
  visibility: string;
  coverStatus: string;
  coverUrl: string | null;
  createdAt: string;
  startsAt: string;
  city: string;
  country: string;
  hiddenByAdmin: boolean;
  hiddenReason: string | null;
  coverReviewNote: string | null;
  openReports: number;
  totalReports: number;
  host: AdminLiteProfile | null;
};

export type AdminPrivacyQueueItem = {
  id: string;
  ticketCode: string;
  requestType: string;
  status: string;
  subject: string;
  description: string;
  requesterEmail: string | null;
  dueAt: string;
  createdAt: string;
  requester: AdminLiteProfile | null;
};

export type AdminRequestQueueItemType =
  | "trip_request"
  | "hosting_request"
  | "service_inquiry"
  | "event_request"
  | "reference_request";

export type AdminRequestQueueItem = {
  id: string;
  type: AdminRequestQueueItemType;
  label: string;
  status: string;
  createdAt: string;
  requester: AdminLiteProfile | null;
  target: AdminLiteProfile | null;
  title: string;
  subtitle: string;
  meta: string | null;
};

export type AdminModerationLogItem = {
  id: string;
  action: string;
  note: string | null;
  createdAt: string;
  reportId: string | null;
  actor: AdminLiteProfile | null;
  target: AdminLiteProfile | null;
};

export type AdminOverviewResponse = {
  generatedAt: string;
  stats: AdminOverviewStats;
  trends: {
    signupsWeekly: AdminTrendPoint[];
    requestsWeekly: AdminTrendPoint[];
    reportsWeekly: AdminTrendPoint[];
    eventsMonthly: AdminTrendPoint[];
    referencesMonthly: AdminTrendPoint[];
  };
  distribution: {
    requestsByType: AdminDistributionItem[];
    reportsByContext: AdminDistributionItem[];
  };
  highlights: {
    flaggedMembers: AdminFlaggedMember[];
    adminTeam: AdminLiteProfile[];
  };
  queues: {
    reports: AdminReportQueueItem[];
    avatars: AdminPhotoQueueItem[];
    eventCovers: AdminEventCoverQueueItem[];
    privacy: AdminPrivacyQueueItem[];
    requests: AdminRequestQueueItem[];
    logs: AdminModerationLogItem[];
  };
  eventsHealth: AdminEventsHealth | null;
};
