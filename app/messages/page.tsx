"use client";

import dynamic from "next/dynamic";
import { Suspense, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image, { type ImageLoaderProps } from "next/image";
import Link from "next/link";
import TeacherInquiryCard from "@/components/messages/TeacherInquiryCard";
import Nav from "@/components/Nav";
import PendingRequestBanner from "@/components/requests/PendingRequestBanner";
import BookSessionModal from "@/components/teacher/BookSessionModal";
import ShareInquiryInfoModal from "@/components/teacher/ShareInquiryInfoModal";
import { supabase } from "@/lib/supabase/client";
import { getBillingAccountState } from "@/lib/billing/account-state";
import { getPlanLimits } from "@/lib/billing/limits";
import { fetchVisibleConnections } from "@/lib/connections/read-model";
import { mapGroupRows, type GroupChatMode, type GroupRecord } from "@/lib/groups/model";
import { fetchProfileMedia } from "@/lib/profile-media/read-model";
import type { ProfileMediaItem } from "@/lib/profile-media/types";
import { hasTeacherBadgeRole } from "@/lib/teacher-info/roles";
import { fetchTeacherInfoBlocks } from "@/lib/teacher-info/read-model";
import type { TeacherInfoBlock } from "@/lib/teacher-info/types";
import { canUseTeacherProfile } from "@/lib/teacher-profile/access";
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_ICONS,
  LINKED_MEMBER_ACTIVITY_TYPES,
  REFERENCE_CONTEXT_TAGS,
  activityTypeLabel,
  activityUsesDateRange,
  normalizeActivityType,
  normalizeReferenceContextTag,
  referenceContextLabel,
  type ActivityType,
  type ReferenceContextTag,
} from "@/lib/activities/types";
import {
  formatSleepingArrangement,
  normalizeHostingPreferredGuestGender,
  parseHostingSleepingArrangement,
  normalizeHostingSleepingArrangement,
  type HostingPreferredGuestGender,
  type HostingSleepingArrangement,
} from "@/lib/hosting/preferences";
import { isPaymentVerified } from "@/lib/verification";
import {
  SERVICE_INQUIRY_KIND_LABELS,
  type ServiceInquiryKind,
  type TeacherInquiryShareSnapshot,
} from "@/lib/service-inquiries/types";
import { fetchPendingPairConflict } from "@/lib/requests/pending-pair-client";
import { fetchLinkedConnectionOptions, type LinkedMemberOption } from "@/lib/requests/linked-members";
import { travelIntentReasonLabel, tripJoinReasonLabel } from "@/lib/trips/join-reasons";
import {
  canPostToEventThread,
  eventThreadTabLabel,
  normalizeEventAccessType,
  normalizeEventChatMode,
  type EventAccessType,
  type EventChatMode,
} from "@/lib/events/access";
import {
  mapEventRows,
  pickEventFallbackHeroUrl,
  pickEventHeroUrl,
  type EventRecord,
} from "@/lib/events/model";
import { DismissibleBanner } from "@/components/DismissibleBanner";

type ThreadKind = "connection" | "trip" | "direct" | "event" | "group";
type FilterTab = "all" | "active" | "pending" | "archived";
type InboxKindFilter = "all" | "connection" | "event" | "group";
type MessagingState = "inactive" | "active" | "archived";

type ThreadContextTag =
  | "connection_request"
  | "hosting_request"
  | "trip_join_request"
  | "event_chat"
  | "regular_chat"
  | "activity"
  | "service_inquiry";
type ThreadStatusTag =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "active"
  | "completed"
  | "expired"
  | "info_shared"
  | "inquiry_followup_pending";

type ParsedThread = { kind: ThreadKind; id: string };

type ProfileRow = {
  user_id?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  city?: string | null;
  country?: string | null;
};

type TripRow = {
  id?: string;
  destination_city?: string | null;
  destination_country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type ThreadRow = {
  threadId: string;
  dbThreadId: string | null;
  kind: ThreadKind;
  contextTag?: ThreadContextTag;
  statusTag?: ThreadStatusTag;
  hasPendingRequest?: boolean;
  hasAcceptedInteraction?: boolean;
  isRelationshipPending?: boolean;
  metaLabel?: string;
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  preview: string;
  updatedAt: string;
  unreadCount: number;
  badge: string;
  otherUserId?: string | null;
  eventId?: string | null;
  groupId?: string | null;
  messagingState?: MessagingState;
  activatedAt?: string | null;
  activationCycleStart?: string | null;
  activationCycleEnd?: string | null;
};

type ThreadDbRow = {
  id?: string;
  thread_type?: string;
  connection_id?: string | null;
  trip_id?: string | null;
  event_id?: string | null;
  group_id?: string | null;
  direct_user_low?: string | null;
  direct_user_high?: string | null;
  last_message_at?: string | null;
  created_at?: string | null;
};

type ThreadMessageDbRow = {
  id?: string;
  thread_id?: string;
  sender_id?: string;
  body?: string | null;
  message_type?: string | null;
  context_tag?: string | null;
  status_tag?: string | null;
  metadata?: unknown;
  created_at?: string;
};

type ComposeConnectionTarget = {
  connectionId: string;
  otherUserId: string;
  displayName: string;
  subtitle: string;
  avatarUrl: string | null;
};

type ComposeTripTarget = {
  tripId: string;
  displayName: string;
  subtitle: string;
  updatedAt: string;
};

type TripRequestRow = {
  id?: string;
  trip_id?: string;
  requester_id?: string;
  status?: string;
  decided_at?: string | null;
  updated_at?: string | null;
  created_at?: string;
};

type MessageItem = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  messageType?: "text" | "system" | "request";
  contextTag?: ThreadContextTag;
  statusTag?: ThreadStatusTag;
  metadata?: Record<string, unknown>;
  status?: "sending" | "sent" | "failed";
  localOnly?: boolean;
};

type MessageReactionDbRow = {
  message_id?: string;
  reactor_id?: string;
  emoji?: string;
};

type MessageReactionAggregate = {
  emoji: string;
  count: number;
  mine: boolean;
};

type ReplyTarget = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};

type ActiveThreadMeta = {
  kind: ThreadKind;
  contextTag?: ThreadContextTag;
  statusTag?: ThreadStatusTag;
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  badge: string;
  otherUserId: string | null;
  connectionId: string | null;
  tripId: string | null;
  eventId?: string | null;
  threadId: string | null;
  messagingState?: MessagingState;
  activatedAt?: string | null;
  activationCycleStart?: string | null;
  activationCycleEnd?: string | null;
  hasAcceptedInteraction?: boolean;
  isRelationshipPending?: boolean;
  serviceInquiryId?: string | null;
  serviceInquiryRequesterId?: string | null;
  serviceInquiryRecipientId?: string | null;
  serviceInquiryFollowupUsed?: boolean;
  groupId?: string | null;
  groupChatMode?: GroupChatMode | null;
  canPostToGroupThread?: boolean;
  isGroupHost?: boolean;
  eventAccessType?: EventAccessType | null;
  eventChatMode?: EventChatMode | null;
  canPostToEventThread?: boolean;
  isEventHost?: boolean;
};

type ActiveGroupThreadRecord = GroupRecord & {
  isHost: boolean;
};

type ContactSidebarData = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  city: string;
  country: string;
  roles: string[];
  danceStyles: string[];
  interests: string[];
  availability: string[];
  languages: string[];
  referencesTotal: number;
  referencesPositive: number;
  referencesByContext: Record<ReferenceContextTag, number>;
  tripsJoinedAccepted: number;
  hostingAccepted: number;
  connectionsCount: number;
  canHost: boolean;
  hostingStatus: string;
  maxGuests: number | null;
  hostingLastMinuteOk: boolean;
  hostingPreferredGuestGender: HostingPreferredGuestGender;
  hostingKidFriendly: boolean;
  hostingPetFriendly: boolean;
  hostingSmokingAllowed: boolean;
  hostingSleepingArrangement: HostingSleepingArrangement;
  hostingGuestShare: string | null;
  hostingTransitAccess: string | null;
  verified: boolean;
  verifiedLabel: string | null;
  mediaItems: ProfileMediaItem[];
};

type ReferencePromptItem = {
  id: string;
  peerUserId: string;
  contextTag: ReferenceContextTag;
  sourceTable: string;
  sourceId: string;
  dueAt: string;
  expiresAt: string;
};

type SubmittedReferenceState = {
  contextTags: Set<ReferenceContextTag>;
  latestSubmittedAt: string | null;
};

type ThreadContextRow = {
  id?: string;
  thread_id?: string;
  source_table?: string;
  source_id?: string;
  context_tag?: string;
  status_tag?: string;
  title?: string | null;
  city?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  requester_id?: string | null;
  recipient_id?: string | null;
  metadata?: unknown;
  updated_at?: string | null;
  created_at?: string | null;
};

type ThreadContextItem = {
  id: string;
  threadId: string;
  sourceTable: string;
  sourceId: string;
  contextTag: ThreadContextTag;
  statusTag: ThreadStatusTag;
  title: string | null;
  city: string | null;
  startDate: string | null;
  endDate: string | null;
  requesterId: string | null;
  recipientId: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string;
  createdAt: string;
};

type ServiceInquiryOwnFlowState = "pending" | "followup_available" | "followup_pending";

type ThreadPrefsPatch = {
  archived_at?: string | null;
  muted_until?: string | null;
  pinned_at?: string | null;
  last_read_at?: string | null;
};

type ThreadParticipantDbRow = {
  thread_id?: string;
  user_id?: string;
  last_read_at?: string | null;
  archived_at?: string | null;
  muted_until?: string | null;
  pinned_at?: string | null;
  messaging_state?: string | null;
  activated_at?: string | null;
  activation_cycle_start?: string | null;
  activation_cycle_end?: string | null;
};

type MessagingSummary = {
  plan: "free" | "premium";
  activeCount: number;
  activeLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
  pendingCount: number;
  cycleStart: string | null;
  cycleEnd: string | null;
};

type InteractionStatus = "none" | "pending" | "accepted";

type RequestQuotaSummary = {
  used: number;
  limit: number | null;
  remaining: number | null;
};

type ChatFooterCtaState = "request_connect" | "pending" | "start_conversation" | "unavailable";

type ConnectRequestModalState = {
  open: boolean;
  targetUserId: string | null;
  targetName: string;
  targetPhotoUrl: string | null;
  connectContext: "member" | "traveller";
  tripId: string | null;
};

type VisibleConnectionLite = {
  id: string;
  other_user_id: string;
  trip_id: string | null;
  connect_context: string | null;
};

type ActivityDraft = {
  activityType: ActivityType;
  note: string;
  dateMode: "none" | "set";
  startAt: string;
  endAt: string;
  linkedMemberUserId: string;
};

const ContactSidebarPanel = dynamic(() => import("@/components/messages/ContactSidebarPanel"), {
  ssr: false,
});
const DarkConnectModal = dynamic(() => import("@/components/DarkConnectModal"), { ssr: false });
const ReportDialog = dynamic(() => import("@/components/messages/ReportDialog"), { ssr: false });
const BlockDialog = dynamic(() => import("@/components/messages/BlockDialog"), { ssr: false });
const ComposeDialog = dynamic(() => import("@/components/messages/ComposeDialog"), { ssr: false });

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "🎉"];
const QUICK_STARTERS = ["Hey! 👋", "Are you available this week?", "Sounds good ✅", "Let’s coordinate details."];
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "👏", "😮", "😢", "🙏"];
const DEFAULT_ACTIVITY_DRAFT: ActivityDraft = {
  activityType: "practice",
  note: "",
  dateMode: "none",
  startAt: "",
  endAt: "",
  linkedMemberUserId: "",
};
const EMPTY_CONNECT_REQUEST_MODAL: ConnectRequestModalState = {
  open: false,
  targetUserId: null,
  targetName: "Member",
  targetPhotoUrl: null,
  connectContext: "member",
  tripId: null,
};
const DAY_MS = 24 * 60 * 60 * 1000;
const LINKABLE_ACTIVITY_TYPES = new Set<ActivityType>(LINKED_MEMBER_ACTIVITY_TYPES);

function SidebarAccordion({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-white/[0.07]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between py-3 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">{title}</span>
        <svg
          className={`h-3 w-3 text-white/30 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open ? <div className="pb-3">{children}</div> : null}
    </div>
  );
}

function addOneMonthIso(value?: string | null) {
  const base = value ? new Date(value) : new Date();
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setMonth(fallback.getMonth() + 1);
    return fallback.toISOString();
  }
  base.setMonth(base.getMonth() + 1);
  return base.toISOString();
}

const LOCAL_REACTIONS_STORAGE_KEY = "cx_messages_reactions_local_v1";
const LOCAL_MANUAL_UNREAD_STORAGE_KEY = "cx_messages_manual_unread_v1";
const LOCAL_THREAD_DRAFTS_STORAGE_KEY = "cx_messages_thread_drafts_v1";
const LOCAL_ARCHIVED_THREADS_STORAGE_KEY = "cx_messages_archived_threads_v1";
const LOCAL_MUTED_THREADS_STORAGE_KEY = "cx_messages_muted_threads_v1";
const LOCAL_PINNED_THREADS_STORAGE_KEY = "cx_messages_pinned_threads_v1";
const REPORT_REASON_OPTIONS = [
  "Harassment",
  "Suicide or self-injury",
  "Pretending to be someone else",
  "Violence or dangerous organizations",
  "Nudity or sexual activity",
  "Selling or promoting restricted items",
  "Scam or fraud",
  "Hate speech",
  "Other",
];

const REPLY_MARKER_REGEX = /^\[\[reply:([a-zA-Z0-9_-]+)\]\]\n?/;

function buildComposeTargets(
  rows: VisibleConnectionLite[],
  profilesById: Record<string, { displayName: string; avatarUrl: string | null; city: string; country: string }>
) {
  const dedupe = new Map<string, ComposeConnectionTarget>();
  rows.forEach((row) => {
    if (!row.id) return;
    const profile = profilesById[row.other_user_id];
    const cityCountry = [profile?.city ?? "", profile?.country ?? ""].filter(Boolean).join(", ");
    const subtitle = row.trip_id || row.connect_context === "trip" || row.connect_context === "traveller" ? "Trip thread" : cityCountry || "Connection";
    dedupe.set(row.id, {
      connectionId: row.id,
      otherUserId: row.other_user_id,
      displayName: profile?.displayName ?? "Connection",
      subtitle,
      avatarUrl: profile?.avatarUrl ?? null,
    });
  });
  return Array.from(dedupe.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function buildTripComposeTargets(
  acceptedTripIds: string[],
  tripsById: Record<string, TripRow>,
  updatedAtByTripId: Record<string, string>
) {
  return acceptedTripIds
    .map((tripId) => {
      const trip = tripsById[tripId];
      const destination = [trip?.destination_city ?? "", trip?.destination_country ?? ""].filter(Boolean).join(", ");
      const start = trip?.start_date ? formatDateShort(trip.start_date) : null;
      const subtitle = [destination || "Trip", start].filter(Boolean).join(" • ");
      return {
        tripId,
        displayName: destination ? `Trip to ${destination}` : "Trip thread",
        subtitle: subtitle || "Trip",
        updatedAt: updatedAtByTripId[tripId] || trip?.start_date || new Date().toISOString(),
      } satisfies ComposeTripTarget;
    })
    .sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt));
}

function toTime(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRelative(iso?: string) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function formatDateShort(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatActivityDateTime(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatActivityWindow(startAt?: string, endAt?: string) {
  const start = formatActivityDateTime(startAt);
  const end = formatActivityDateTime(endAt);
  if (start && end) return `${start} - ${end}`;
  return start || end || "No dates set";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function activityTypeIcon(value: string) {
  return ACTIVITY_TYPE_ICONS[normalizeActivityType(value)] ?? "bolt";
}

function parseTripLabel(row: TripRow | null | undefined) {
  if (!row?.destination_city || !row.destination_country) return "Trip chat";
  const datePart = row.start_date ? formatDateShort(row.start_date) : "TBD";
  return `${row.destination_city}, ${row.destination_country} • ${datePart}`;
}

function formatStarterDateWindow(startDate?: string | null, endDate?: string | null) {
  const start = startDate ? formatDateShort(startDate) : "";
  const end = endDate ? formatDateShort(endDate) : "";
  if (start && end) return `${start} - ${end}`;
  return start || end || "those dates";
}

function buildAcceptedStarterMessage(context: ThreadContextItem | null) {
  if (!context) return "Hey! Happy to connect here 🙂";

  if (context.contextTag === "trip_join_request") {
    const city = context.city?.trim() || "your city";
    return `Hey! I’m planning to join your trip to ${city}. Would be great to connect and dance together 🙌`;
  }

  if (context.contextTag === "hosting_request") {
    const city = context.city?.trim() || "your city";
    const dateWindow = formatStarterDateWindow(context.startDate, context.endDate);
    return `Hey! I’ll be in ${city} ${dateWindow}. Would love to connect and see if staying together works 🙂`;
  }

  return "Hey! Happy to connect here 🙂";
}

function formatTime(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function supportsSyncedMessageReactions(kind: ThreadKind) {
  return kind === "connection" || kind === "trip";
}

const CONTEXT_LABELS: Record<ThreadContextTag, string> = {
  connection_request: "Connection request",
  hosting_request: "Hosting request",
  trip_join_request: "Trip join request",
  event_chat: "Event chat",
  activity: "Activity",
  service_inquiry: "Teaching services",
  regular_chat: "Chat",
};

const STATUS_LABELS: Record<ThreadStatusTag, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  active: "Active",
  completed: "Completed",
  expired: "Expired",
  info_shared: "Info shared",
  inquiry_followup_pending: "Follow-up pending",
};

function contextGroupLabel(tag: ThreadContextTag) {
  if (tag === "connection_request") return "Connections";
  if (tag === "trip_join_request") return "Trips";
  if (tag === "hosting_request") return "Request hosting";
  if (tag === "event_chat") return "Events";
  if (tag === "service_inquiry") return "Teaching services";
  if (tag === "activity") return "Connections";
  return "Connections";
}

function contextSupportsCancel(tag: ThreadContextTag, metadata?: Record<string, unknown>) {
  if (tag === "connection_request") return true;
  if (tag === "trip_join_request") return true;
  if (tag === "hosting_request") return true;
  if (tag === "event_chat") return typeof metadata?.event_id === "string" && metadata.event_id.length > 0;
  if (tag === "activity") return true;
  return false;
}

function normalizeContextTag(value: string | null | undefined, fallback: ThreadContextTag = "regular_chat"): ThreadContextTag {
  if (value === "connection_request") return value;
  if (value === "hosting_request") return value;
  if (value === "trip_join_request") return value;
  if (value === "event_chat") return value;
  if (value === "activity") return value;
  if (value === "service_inquiry") return value;
  if (value === "regular_chat") return value;
  return fallback;
}

function normalizeStatusTag(value: string | null | undefined, fallback: ThreadStatusTag = "active"): ThreadStatusTag {
  if (value === "pending") return value;
  if (value === "accepted") return value;
  if (value === "declined") return value;
  if (value === "cancelled") return value;
  if (value === "active") return value;
  if (value === "completed") return value;
  if (value === "expired") return value;
  if (value === "info_shared") return value;
  if (value === "inquiry_followup_pending") return value;
  return fallback;
}

function normalizeMessagingState(value: string | null | undefined, fallback: MessagingState = "inactive"): MessagingState {
  if (value === "inactive") return value;
  if (value === "active") return value;
  if (value === "archived") return value;
  return fallback;
}

function normalizeMessageType(value: string | null | undefined): "text" | "system" | "request" {
  if (value === "request" || value === "system" || value === "text") return value;
  return "text";
}

const CHAT_UNLOCK_CONTEXT_TAGS: ThreadContextTag[] = [
  "connection_request",
  "trip_join_request",
  "hosting_request",
  "event_chat",
  "activity",
  "service_inquiry",
];

function isAcceptedInteractionStatus(status: ThreadStatusTag) {
  return status === "accepted" || status === "active" || status === "completed";
}

function isChatUnlockingContext(context: Pick<ThreadContextItem, "contextTag" | "statusTag">) {
  if (context.contextTag === "service_inquiry") return context.statusTag === "active";
  if (context.contextTag === "regular_chat") return context.statusTag === "active";
  return context.statusTag === "accepted" || context.statusTag === "active";
}

function contextToneClasses(tag: ThreadContextTag) {
  if (tag === "connection_request") return "border-cyan-300/35 bg-cyan-300/10 text-cyan-100";
  if (tag === "hosting_request") return "border-fuchsia-300/35 bg-fuchsia-300/10 text-fuchsia-100";
  if (tag === "trip_join_request") return "border-violet-300/35 bg-violet-300/10 text-violet-100";
  if (tag === "event_chat") return "border-sky-300/35 bg-sky-300/10 text-sky-100";
  if (tag === "activity") return "border-cyan-300/35 bg-[linear-gradient(90deg,rgba(0,245,255,0.14),rgba(255,0,255,0.08))] text-cyan-100";
  if (tag === "service_inquiry") return "border-amber-300/35 bg-amber-300/10 text-amber-100";
  return "border-white/20 bg-white/[0.05] text-slate-200";
}

function statusToneClasses(tag: ThreadStatusTag) {
  if (tag === "pending") return "border-fuchsia-300/35 bg-fuchsia-300/10 text-fuchsia-100";
  if (tag === "accepted" || tag === "active") return "border-emerald-300/35 bg-emerald-300/10 text-emerald-100";
  if (tag === "completed") return "border-cyan-300/35 bg-cyan-300/10 text-cyan-100";
  if (tag === "info_shared") return "border-cyan-300/35 bg-cyan-300/10 text-cyan-100";
  if (tag === "inquiry_followup_pending") return "border-amber-300/35 bg-amber-300/10 text-amber-100";
  if (tag === "declined") return "border-rose-300/35 bg-rose-300/10 text-rose-100";
  if (tag === "expired") return "border-amber-300/35 bg-amber-300/10 text-amber-100";
  if (tag === "cancelled") return "border-white/20 bg-white/[0.05] text-slate-300";
  return "border-white/20 bg-white/[0.05] text-slate-300";
}

function isPendingLikeStatus(status: ThreadStatusTag) {
  return status === "pending" || status === "inquiry_followup_pending";
}

function parseContextMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore invalid JSON payloads.
    }
  }
  return {};
}

function parseTeacherInquiryShareSnapshot(metadata: Record<string, unknown>): TeacherInquiryShareSnapshot | null {
  if (asString(metadata.card_type) !== "teacher_inquiry_share") return null;
  const inquiryId = asString(metadata.service_inquiry_id).trim();
  const inquiryKind = asString(metadata.inquiry_kind).trim();
  if (!inquiryId || !inquiryKind || !SERVICE_INQUIRY_KIND_LABELS[inquiryKind as ServiceInquiryKind]) return null;

  const teacherSummaryRaw = asRecord(metadata.teacher_summary);
  const selectedBlocksRaw = Array.isArray(metadata.selected_blocks) ? metadata.selected_blocks : [];
  const selectedBlocks = selectedBlocksRaw
    .map((row) => ({
      id: asString(asRecord(row).id),
      userId: asString(asRecord(row).userId || asRecord(row).user_id),
      kind: asString(asRecord(row).kind) as TeacherInfoBlock["kind"],
      title: asString(asRecord(row).title),
      shortSummary: asString(asRecord(row).shortSummary ?? asRecord(row).short_summary) || null,
      contentJson: parseContextMetadata(asRecord(row).contentJson ?? asRecord(row).content_json) as TeacherInfoBlock["contentJson"],
      isActive: Boolean(asRecord(row).isActive ?? asRecord(row).is_active ?? true),
      position: Number(asRecord(row).position ?? 0) || 0,
      createdAt: asString(asRecord(row).createdAt ?? asRecord(row).created_at) || new Date(0).toISOString(),
      updatedAt: asString(asRecord(row).updatedAt ?? asRecord(row).updated_at) || new Date(0).toISOString(),
    }))
    .filter((block) => block.id && block.userId && block.title);

  return {
    inquiryId,
    inquiryKind: inquiryKind as ServiceInquiryKind,
    headline: asString(metadata.headline).trim() || null,
    introText: asString(metadata.intro_text).trim() || null,
    teacherIntroNote: asString(metadata.teacher_intro_note).trim() || null,
    teacherSummary: {
      userId: asString(teacherSummaryRaw.userId ?? teacherSummaryRaw.user_id),
      displayName: asString(teacherSummaryRaw.displayName ?? teacherSummaryRaw.display_name) || "Teacher",
      avatarUrl: asString(teacherSummaryRaw.avatarUrl ?? teacherSummaryRaw.avatar_url) || null,
      city: asString(teacherSummaryRaw.city) || null,
      country: asString(teacherSummaryRaw.country) || null,
    },
    selectedBlocks,
    profileConfig: null,
    sharedAt: asString(metadata.shared_at) || new Date().toISOString(),
  };
}

function isSchemaMissingMessage(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("column") ||
    text.includes("relation") ||
    text.includes("record \"r\" has no field")
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeReferenceContext(value: string): ReferenceContextTag {
  return normalizeReferenceContextTag(value);
}

function emptyReferenceContextCounts(): Record<ReferenceContextTag, number> {
  return REFERENCE_CONTEXT_TAGS.reduce(
    (acc, tag) => {
      acc[tag] = 0;
      return acc;
    },
    {} as Record<ReferenceContextTag, number>
  );
}

function parseDanceStyleKeys(rawDanceSkills: unknown, rawDanceStyles: unknown) {
  const fromSkills =
    rawDanceSkills && typeof rawDanceSkills === "object" && !Array.isArray(rawDanceSkills)
      ? Object.keys(rawDanceSkills as Record<string, unknown>)
      : [];
  const fromStyles = asStringArrayLoose(rawDanceStyles);
  return Array.from(
    new Set(
      [...fromSkills, ...fromStyles]
        .map((style) => style.trim())
        .filter(Boolean)
        .map((style) => style.toLowerCase())
    )
  );
}

function describeContextMeta(context: ThreadContextItem) {
  const parts: string[] = [];
  const activityType = typeof context.metadata.activity_type === "string" ? context.metadata.activity_type : "";
  const inquiryKind = asString(context.metadata.inquiry_kind);
  if (context.contextTag === "activity" && activityType) {
    const activityLabel = activityTypeLabel(activityType);
    if (!context.title || context.title.trim().toLowerCase() !== activityLabel.trim().toLowerCase()) {
      parts.push(activityLabel);
    }
  }
  if (context.contextTag === "service_inquiry" && inquiryKind && SERVICE_INQUIRY_KIND_LABELS[inquiryKind as ServiceInquiryKind]) {
    parts.push(SERVICE_INQUIRY_KIND_LABELS[inquiryKind as ServiceInquiryKind]);
  }
  if (context.city) parts.push(context.city);
  const dateParts = [context.startDate ? formatDateShort(context.startDate) : "", context.endDate ? formatDateShort(context.endDate) : ""].filter(Boolean);
  if (dateParts.length === 2) {
    parts.push(`${dateParts[0]} - ${dateParts[1]}`);
  } else if (dateParts.length === 1) {
    parts.push(dateParts[0]);
  }
  return parts.join(" • ");
}

function describeServiceInquiryRequest(context: ThreadContextItem) {
  if (context.contextTag !== "service_inquiry") return [];
  const parts: Array<{ label: string; value: string }> = [];
  const inquiryKind = asString(context.metadata.inquiry_kind);
  const inquiryLabel =
    inquiryKind && SERVICE_INQUIRY_KIND_LABELS[inquiryKind as ServiceInquiryKind]
      ? SERVICE_INQUIRY_KIND_LABELS[inquiryKind as ServiceInquiryKind]
      : "";
  const requestedDates = asString(context.metadata.requested_dates_text).trim();
  const requesterMessage = asString(context.metadata.requester_message).trim();

  if (inquiryLabel) {
    parts.push({ label: "Request type", value: inquiryLabel });
  }
  if (requestedDates) {
    parts.push({ label: "Requested dates", value: requestedDates });
  }
  if (requesterMessage) {
    parts.push({ label: "Note", value: requesterMessage });
  }
  return parts;
}

function describeTripJoinRequest(context: ThreadContextItem) {
  if (context.contextTag !== "trip_join_request") return [];
  const parts: Array<{ label: string; value: string }> = [];
  const reasonRaw =
    asString(context.metadata.trip_join_reason).trim() ||
    asString(context.metadata.reason).trim();
  const note = asString(context.metadata.note).trim();
  const noteIsDuplicateReason = Boolean(
    reasonRaw &&
      note &&
      note.localeCompare(reasonRaw, undefined, { sensitivity: "accent" }) === 0
  );

  if (reasonRaw) {
    parts.push({ label: "Reason", value: tripJoinReasonLabel(reasonRaw) });
  }
  if (note && !noteIsDuplicateReason) {
    parts.push({ label: "Note", value: note });
  }
  return parts;
}

function describeHostingRequest(context: ThreadContextItem) {
  if (context.contextTag !== "hosting_request") return [];
  const parts: Array<{ label: string; value: string }> = [];
  const requestType = asString(context.metadata.request_type).trim();
  const reasonRaw = asString(context.metadata.reason).trim();
  const normalizedHostingSpaceType = parseHostingSleepingArrangement(reasonRaw);
  const note = asString(context.metadata.message).trim() || asString(context.metadata.note).trim();
  const noteIsDuplicateReason = Boolean(
    reasonRaw &&
      note &&
      note.localeCompare(reasonRaw, undefined, { sensitivity: "accent" }) === 0
  );

  if (reasonRaw) {
    parts.push({
      label: requestType === "offer_to_host" ? "Space type" : "Reason",
      value:
        requestType === "request_hosting"
          ? travelIntentReasonLabel(reasonRaw)
          : normalizedHostingSpaceType
            ? formatSleepingArrangement(normalizedHostingSpaceType)
            : reasonRaw,
    });
  }
  if (note && !noteIsDuplicateReason) {
    parts.push({ label: requestType === "offer_to_host" ? "Invite note" : "Note", value: note });
  }
  return parts;
}

function contextHistoryTitle(context: ThreadContextItem) {
  const activityType = typeof context.metadata.activity_type === "string" ? context.metadata.activity_type : "";
  if (context.contextTag === "activity" && activityType) {
    return activityTypeLabel(activityType);
  }
  return CONTEXT_LABELS[context.contextTag];
}

function contextHistorySummary(context: ThreadContextItem) {
  const activityType = typeof context.metadata.activity_type === "string" ? context.metadata.activity_type : "";
  const contextLabel =
    context.contextTag === "activity" && activityType
      ? activityTypeLabel(activityType)
      : CONTEXT_LABELS[context.contextTag];

  if (context.statusTag === "accepted" || context.statusTag === "active") {
    if (context.contextTag === "connection_request") return "Connection accepted. Chat unlocked.";
    if (context.contextTag === "activity") return `${contextLabel} accepted.`;
    if (context.contextTag === "service_inquiry") return "Teaching services — chat unlocked.";
    return `${contextLabel} accepted.`;
  }
  if (context.statusTag === "info_shared") {
    return "Details shared. The requester can send one follow-up message.";
  }
  if (context.statusTag === "inquiry_followup_pending") {
    return "Follow-up received. Accept the conversation to open normal chat.";
  }
  if (context.statusTag === "completed") {
    return `${contextLabel} completed. Reference prompt becomes available from this interaction.`;
  }
  if (context.statusTag === "declined") {
    return `${contextLabel} declined.`;
  }
  if (context.statusTag === "cancelled") {
    return `${contextLabel} cancelled.`;
  }
  return `${contextLabel} logged in this thread.`;
}

function threadPreviewFromContext(context: ThreadContextItem) {
  const activityType = typeof context.metadata.activity_type === "string" ? context.metadata.activity_type : "";
  const contextLabel =
    context.contextTag === "activity" && activityType
      ? activityTypeLabel(activityType)
      : CONTEXT_LABELS[context.contextTag];

  if (context.statusTag === "pending") {
    if (context.contextTag === "activity") return `${contextLabel} requested.`;
    if (context.contextTag === "service_inquiry") return `${contextLabel} pending.`;
    return `${contextLabel} pending.`;
  }
  if (context.statusTag === "info_shared") return "Information shared. One follow-up is available.";
  if (context.statusTag === "inquiry_followup_pending") return "Follow-up waiting for teacher approval.";

  return contextHistorySummary(context);
}

function defaultThreadPreview(kind: ThreadKind) {
  if (kind === "trip") return "Trip thread";
  if (kind === "event") return "No messages yet.";
  if (kind === "group") return "No messages yet.";
  if (kind === "connection") return "No messages yet.";
  return "";
}

function latestTextPreview(messages: MessageItem[], fallback: string) {
  const lastText = [...messages]
    .filter((message) => (message.messageType ?? "text") === "text")
    .sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt))
    .at(-1);
  if (!lastText) return fallback;
  const parsed = parseReplyPayload(lastText.body);
  const text = parsed.text.trim();
  return text || fallback;
}

function threadContextResolutionWeight(context: ThreadContextItem) {
  if (context.statusTag === "completed") return 60;
  if (context.statusTag === "accepted") return 50;
  if (context.statusTag === "active") return 45;
  if (context.statusTag === "info_shared") return 44;
  if (context.statusTag === "inquiry_followup_pending") return 43;
  if (context.statusTag === "pending") return 40;
  if (context.statusTag === "declined") return 30;
  if (context.statusTag === "cancelled") return 20;
  return 0;
}

function formatChatDayLabel(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function parseThreadToken(rawToken: string): ParsedThread | null {
  if (!rawToken) return null;
  if (rawToken.startsWith("conn:")) return { kind: "connection", id: rawToken.slice(5) };
  if (rawToken.startsWith("trip:")) return { kind: "trip", id: rawToken.slice(5) };
  if (rawToken.startsWith("direct:")) return { kind: "direct", id: rawToken.slice(7) };
  if (rawToken.startsWith("event:")) return { kind: "event", id: rawToken.slice(6) };
  if (rawToken.startsWith("group:")) return { kind: "group", id: rawToken.slice(6) };
  return { kind: "connection", id: rawToken };
}

function parseFilterTab(rawTab: string | null): FilterTab | null {
  if (!rawTab) return null;
  if (rawTab === "all") return "all";
  if (rawTab === "active") return "active";
  if (rawTab === "pending") return "pending";
  if (rawTab === "archived") return "archived";
  return null;
}

function normalizeThreadKindFilter(kind: ThreadKind): Exclude<InboxKindFilter, "all"> {
  if (kind === "event") return "event";
  if (kind === "group") return "group";
  return "connection";
}

function parseInboxKindFilter(rawKind: string | null): InboxKindFilter | null {
  if (!rawKind) return null;
  if (rawKind === "all") return "all";
  if (rawKind === "connection") return "connection";
  if (rawKind === "event") return "event";
  if (rawKind === "group") return "group";
  return null;
}

function daysUntilPendingExpiry(context: ThreadContextItem) {
  const base = toTime(context.createdAt || context.updatedAt);
  if (!base) return null;
  const expiry = base + 14 * 24 * 60 * 60 * 1000;
  const diff = expiry - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function formatRemaining(ms: number) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatDaysLeft(days: number) {
  if (days <= 0) return "Expires today.";
  if (days === 1) return "1 day left.";
  return `${days} days left.`;
}

function parseReplyPayload(body: string) {
  const raw = body ?? "";
  const match = raw.match(REPLY_MARKER_REGEX);
  if (!match) {
    return { replyToId: null as string | null, text: raw };
  }
  const replyToId = match[1] ?? null;
  const text = raw.replace(REPLY_MARKER_REGEX, "");
  return { replyToId, text };
}

function toSingleLineText(value: string, max = 140) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max).trimEnd()}...`;
}

function buildReactionAggregateMap(rows: MessageReactionDbRow[], viewerId: string | null) {
  const byMessage: Record<string, Record<string, MessageReactionAggregate>> = {};

  rows.forEach((row) => {
    const messageId = row.message_id ?? "";
    const emoji = row.emoji ?? "";
    const reactorId = row.reactor_id ?? "";
    if (!messageId || !emoji) return;

    if (!byMessage[messageId]) byMessage[messageId] = {};
    if (!byMessage[messageId][emoji]) {
      byMessage[messageId][emoji] = { emoji, count: 0, mine: false };
    }
    byMessage[messageId][emoji].count += 1;
    if (viewerId && reactorId === viewerId) {
      byMessage[messageId][emoji].mine = true;
    }
  });

  const result: Record<string, MessageReactionAggregate[]> = {};
  Object.entries(byMessage).forEach(([messageId, emojiMap]) => {
    result[messageId] = Object.values(emojiMap).sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
  });
  return result;
}

function shouldFallbackPrefs(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("archived_at") ||
      lower.includes("muted_until") ||
      lower.includes("pinned_at") ||
      lower.includes("last_read_at") ||
      lower.includes("schema cache") ||
    lower.includes("column") ||
    lower.includes("could not find the table") ||
    lower.includes("relation")
  );
}

function normalizeThreadContextRow(row: ThreadContextRow): ThreadContextItem | null {
  const id = row.id ?? "";
  const threadId = row.thread_id ?? "";
  const sourceTable = row.source_table ?? "";
  const sourceId = row.source_id ?? "";
  if (!id || !threadId || !sourceTable || !sourceId) return null;

  return {
    id,
    threadId,
    sourceTable,
    sourceId,
    contextTag: normalizeContextTag(row.context_tag),
    statusTag: normalizeStatusTag(row.status_tag),
    title: row.title ?? null,
    city: row.city ?? null,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    requesterId: row.requester_id ?? null,
    recipientId: row.recipient_id ?? null,
    metadata: parseContextMetadata(row.metadata),
    updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    createdAt: row.created_at ?? row.updated_at ?? new Date().toISOString(),
  };
}

function enrichThreadWithContext(thread: ThreadRow, contexts: ThreadContextItem[]): ThreadRow {
  const sorted = collapseDuplicateThreadContexts(contexts);
  const pending = sorted.find((context) => isPendingLikeStatus(context.statusTag)) ?? null;
  const primary = pending ?? sorted[0] ?? null;
  const hasAcceptedInteraction = sorted.some(
    (context) => CHAT_UNLOCK_CONTEXT_TAGS.includes(context.contextTag) && isAcceptedInteractionStatus(context.statusTag)
  );
  const isRelationshipPending = Boolean(pending) && !hasAcceptedInteraction;

  const fallbackContext: ThreadContextTag = thread.kind === "event" ? "event_chat" : "regular_chat";
  const contextTag = primary?.contextTag ?? thread.contextTag ?? fallbackContext;
  const statusTag = primary?.statusTag ?? thread.statusTag ?? "active";
  const metaLabel = primary ? describeContextMeta(primary) : thread.metaLabel ?? "";

  return {
    ...thread,
    contextTag,
    statusTag,
    hasPendingRequest: sorted.some((context) => isPendingLikeStatus(context.statusTag)) || Boolean(thread.hasPendingRequest),
    hasAcceptedInteraction,
    isRelationshipPending,
    metaLabel,
    preview: primary && isPendingLikeStatus(primary.statusTag) ? threadPreviewFromContext(primary) : thread.preview,
  };
}

function shouldIncludeInboxThread(thread: ThreadRow) {
  return true;
}

function inboxKindLabel(kind: InboxKindFilter) {
  if (kind === "connection") return "Connections";
  if (kind === "event") return "Events";
  if (kind === "group") return "Groups";
  return "All types";
}

function normalizeInboxTabForKind(kind: InboxKindFilter, tab: FilterTab): FilterTab {
  if (tab === "archived") return "archived";
  if (kind === "group" && tab === "pending") return "all";
  return tab;
}

function eventTypeBadgeClass(eventType: string) {
  const key = eventType.trim().toLowerCase();
  if (key.includes("festival") || key.includes("congress")) return "border-fuchsia-300/40 bg-fuchsia-500/15 text-fuchsia-100";
  if (key.includes("workshop") || key.includes("class")) return "border-cyan-300/40 bg-cyan-500/15 text-cyan-100";
  if (key.includes("social")) return "border-emerald-300/40 bg-emerald-500/15 text-emerald-100";
  return "border-white/15 bg-white/[0.06] text-white/75";
}

function threadContextPriority(context: ThreadContextItem) {
  const pendingBoost = isPendingLikeStatus(context.statusTag) ? 100 : 0;
  const statusWeight =
    context.statusTag === "accepted" ? 50 :
    context.statusTag === "completed" ? 40 :
    context.statusTag === "active" ? 30 :
    context.statusTag === "info_shared" ? 28 :
    context.statusTag === "inquiry_followup_pending" ? 26 :
    context.statusTag === "declined" ? 20 :
    context.statusTag === "cancelled" ? 10 :
    0;
  const tagWeight =
    context.contextTag === "connection_request" ? 50 :
    context.contextTag === "trip_join_request" ? 40 :
    context.contextTag === "hosting_request" ? 30 :
    context.contextTag === "event_chat" ? 20 :
    context.contextTag === "service_inquiry" ? 15 :
    context.contextTag === "activity" ? 10 :
    0;
  return pendingBoost + statusWeight + tagWeight;
}

function collapseDuplicateThreadContexts(contexts: ThreadContextItem[]): ThreadContextItem[] {
  const bySource = new Map<string, ThreadContextItem>();

  contexts.forEach((context) => {
    const key = `${context.sourceTable}:${context.sourceId}`;
    const existing = bySource.get(key);
    if (!existing) {
      bySource.set(key, context);
      return;
    }

    const contextTime = toTime(context.updatedAt);
    const existingTime = toTime(existing.updatedAt);
    const contextResolution = threadContextResolutionWeight(context);
    const existingResolution = threadContextResolutionWeight(existing);
    const contextPriority = threadContextPriority(context);
    const existingPriority = threadContextPriority(existing);

    if (
      contextResolution > existingResolution ||
      (contextResolution === existingResolution &&
        (contextTime > existingTime ||
          (contextTime === existingTime && contextPriority > existingPriority)))
    ) {
      bySource.set(key, context);
    }
  });

  const collapsed = Array.from(bySource.values());
  const canonicalConnection = [...collapsed]
    .filter((context) => context.contextTag === "connection_request")
    .sort((a, b) => {
      const resolutionDelta = threadContextResolutionWeight(b) - threadContextResolutionWeight(a);
      if (resolutionDelta !== 0) return resolutionDelta;
      const timeDelta = toTime(b.updatedAt) - toTime(a.updatedAt);
      if (timeDelta !== 0) return timeDelta;
      return threadContextPriority(b) - threadContextPriority(a);
    })[0];

  const filtered = canonicalConnection
    ? collapsed.filter((context) => context.contextTag !== "connection_request" || context.id === canonicalConnection.id)
    : collapsed;

  return filtered.sort((a, b) => {
    const aPriority = threadContextPriority(a);
    const bPriority = threadContextPriority(b);
    if (aPriority !== bPriority) return bPriority - aPriority;
    return toTime(b.updatedAt) - toTime(a.updatedAt);
  });
}

function isStableInboxSubtitle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes("•")) return false;
  if (/^from\b/i.test(trimmed)) return false;
  if (/^trip\b/i.test(trimmed)) return false;
  if (/^event\b/i.test(trimmed)) return false;
  return true;
}

function normalizeInboxThreadSummary(thread: ThreadRow, candidates: ThreadRow[] = [thread]): ThreadRow {
  const hasPending = isPendingLikeStatus(thread.statusTag ?? "active") || Boolean(thread.hasPendingRequest);
  if (thread.kind !== "connection" && thread.kind !== "direct") {
    return hasPending ? thread : { ...thread, metaLabel: "" };
  }

  const preferredSubtitle =
    candidates
      .map((row) => row.subtitle)
      .find((value) => isStableInboxSubtitle(value)) ||
    candidates
      .map((row) => row.metaLabel ?? "")
      .find((value) => isStableInboxSubtitle(value)) ||
    thread.subtitle;

  return {
    ...thread,
    subtitle: hasPending ? thread.subtitle : preferredSubtitle,
    metaLabel: hasPending ? thread.metaLabel : "",
  };
}

function collapseDuplicateInboxThreads(rows: ThreadRow[]): ThreadRow[] {
  const byKey = new Map<string, ThreadRow>();

  rows.forEach((row) => {
    const dedupeKey =
      (row.kind === "connection" || row.kind === "direct") && row.otherUserId
        ? `member:${row.otherUserId}`
        : `thread:${row.threadId}`;
    const existing = byKey.get(dedupeKey);
    if (!existing) {
      byKey.set(dedupeKey, row);
      return;
    }

    const rowTime = toTime(row.updatedAt);
    const existingTime = toTime(existing.updatedAt);
    const preferRow =
      rowTime > existingTime ||
      (rowTime === existingTime &&
        row.kind === "direct" &&
        existing.kind !== "direct");

    const winner = preferRow ? row : existing;
    const loser = preferRow ? existing : row;

    const merged = {
      ...winner,
      unreadCount: Math.max(winner.unreadCount, loser.unreadCount),
      hasPendingRequest: Boolean(winner.hasPendingRequest || loser.hasPendingRequest),
    } satisfies ThreadRow;

    byKey.set(dedupeKey, normalizeInboxThreadSummary(merged, [winner, loser]));
  });

  return Array.from(byKey.values())
    .map((row) => normalizeInboxThreadSummary(row))
    .sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt));
}

function deriveThreadPreviewFromState(params: {
  thread: ThreadRow;
  contexts: ThreadContextItem[];
  messages: MessageItem[];
}) {
  const collapsed = collapseDuplicateThreadContexts(params.contexts);
  const pending = collapsed.find((context) => isPendingLikeStatus(context.statusTag)) ?? null;
  if (pending) return threadPreviewFromContext(pending);
  return latestTextPreview(params.messages, defaultThreadPreview(params.thread.kind));
}

const remoteImageLoader = ({ src }: ImageLoaderProps) => src;

function MessagesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedThreadToken = searchParams.get("thread")?.trim() || null;
  const initialTab = parseFilterTab(searchParams.get("tab")) ?? "all";
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [threadsHydrated, setThreadsHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>(initialTab);
  const [kindFilter, setKindFilter] = useState<InboxKindFilter>(parseInboxKindFilter(searchParams.get("kind")) ?? "all");
  const [inboxFilterMenuOpen, setInboxFilterMenuOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeQuery, setComposeQuery] = useState("");
  const [composeConnectionTargets, setComposeConnectionTargets] = useState<ComposeConnectionTarget[]>([]);
  const [composeTripTargets, setComposeTripTargets] = useState<ComposeTripTarget[]>([]);
  const [threadContextsByDbId, setThreadContextsByDbId] = useState<Record<string, ThreadContextItem[]>>({});
  const [activeFallbackContext, setActiveFallbackContext] = useState<ThreadContextItem | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [meId, setMeId] = useState<string | null>(null);
  const [activeThreadToken, setActiveThreadToken] = useState<string | null>(null);
  const [activeMeta, setActiveMeta] = useState<ActiveThreadMeta | null>(null);
  const [contactSidebar, setContactSidebar] = useState<ContactSidebarData | null>(null);
  const [activeReferencePrompt, setActiveReferencePrompt] = useState<ReferencePromptItem | null>(null);
  const [submittedReferenceState, setSubmittedReferenceState] = useState<SubmittedReferenceState>({
    contextTags: new Set<ReferenceContextTag>(),
    latestSubmittedAt: null,
  });
  const [contactSidebarLoading, setContactSidebarLoading] = useState(false);
  const [contactSidebarError, setContactSidebarError] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<MessageItem[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [messagingSummary, setMessagingSummary] = useState<MessagingSummary | null>(null);
  const [requestQuotaSummary, setRequestQuotaSummary] = useState<RequestQuotaSummary | null>(null);
  const [activityComposerOpen, setActivityComposerOpen] = useState(false);
  const [activityDraft, setActivityDraft] = useState<ActivityDraft>(DEFAULT_ACTIVITY_DRAFT);
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityNoteOpen, setActivityNoteOpen] = useState(false);
  const [activityPendingWarning, setActivityPendingWarning] = useState<string | null>(null);
  const [activityComposerError, setActivityComposerError] = useState<string | null>(null);
  const [activityRequestsUsed, setActivityRequestsUsed] = useState<number | null>(null);
  const [activityRequestsLimit, setActivityRequestsLimit] = useState<number | null>(null);
  const [activityLinkedConnectionOptions, setActivityLinkedConnectionOptions] = useState<LinkedMemberOption[]>([]);
  const [activityLinkedPickerOpen, setActivityLinkedPickerOpen] = useState(false);
  const [activityLinkedMemberQuery, setActivityLinkedMemberQuery] = useState("");
  const activityDraftUsesDateRange = useMemo(
    () => activityUsesDateRange(activityDraft.activityType),
    [activityDraft.activityType]
  );
  const activitySupportsLinkedMember = LINKABLE_ACTIVITY_TYPES.has(activityDraft.activityType);
  const filteredActivityLinkedConnectionOptions = useMemo(() => {
    const query = activityLinkedMemberQuery.trim().toLowerCase();
    const options = activityLinkedConnectionOptions.filter((option) => option.userId !== activeMeta?.otherUserId);
    if (!query) return options;
    return options.filter((option) => [option.displayName, option.city, option.country].join(" ").toLowerCase().includes(query));
  }, [activeMeta?.otherUserId, activityLinkedConnectionOptions, activityLinkedMemberQuery]);
  const [threadDbSupported, setThreadDbSupported] = useState(true);
  const [threadBody, setThreadBody] = useState("");
  const [sending, setSending] = useState(false);
  const [threadInfo, setThreadInfo] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("Scam or fraud");
  const [reportNote, setReportNote] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportFromMessageId, setReportFromMessageId] = useState<string | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("Safety concern");
  const [blockNote, setBlockNote] = useState("");
  const [blockBusy, setBlockBusy] = useState(false);
  const [archivedThreads, setArchivedThreads] = useState<Record<string, true>>({});
  const [mutedUntilByThread, setMutedUntilByThread] = useState<Record<string, string>>({});
  const [pinnedThreads, setPinnedThreads] = useState<Record<string, true>>({});
  const [threadPrefsInLocalMode, setThreadPrefsInLocalMode] = useState(false);
  const [activeLastReadAt, setActiveLastReadAt] = useState<string | null>(null);
  const [activePeerLastReadAt, setActivePeerLastReadAt] = useState<string | null>(null);
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
  const [openThreadRowMenuId, setOpenThreadRowMenuId] = useState<string | null>(null);
  const [threadActionsOpen, setThreadActionsOpen] = useState(false);
  const [archiveToContinueOpen, setArchiveToContinueOpen] = useState(false);
  const [requestActionBusyId, setRequestActionBusyId] = useState<string | null>(null);
  const [groupSettingsBusy, setGroupSettingsBusy] = useState(false);
  const [chatFooterBusy, setChatFooterBusy] = useState<"request" | "activate" | null>(null);
  const [showActivateConfirm, setShowActivateConfirm] = useState(false);
  const [connectRequestModal, setConnectRequestModal] = useState<ConnectRequestModalState>(EMPTY_CONNECT_REQUEST_MODAL);
  const [optimisticActivatedByThread, setOptimisticActivatedByThread] = useState<
    Record<string, { activatedAt: string; activationEnd: string }>
  >({});
  const [shareInquiryContext, setShareInquiryContext] = useState<ThreadContextItem | null>(null);
  const [shareInquiryBlocks, setShareInquiryBlocks] = useState<TeacherInfoBlock[]>([]);
  const [shareInquiryBusy, setShareInquiryBusy] = useState(false);
  const [shareInquiryError, setShareInquiryError] = useState<string | null>(null);
  const [chatBookingOpen, setChatBookingOpen] = useState(false);
  const [chatBookingAvailable, setChatBookingAvailable] = useState(false);

  useEffect(() => {
    if (activityDraft.dateMode === "none" && (activityDraft.startAt || activityDraft.endAt)) {
      setActivityDraft((prev) => ({ ...prev, startAt: "", endAt: "" }));
      return;
    }
    if (!activityDraftUsesDateRange && activityDraft.endAt) {
      setActivityDraft((prev) => ({ ...prev, endAt: "" }));
    }
  }, [activityDraft.dateMode, activityDraft.endAt, activityDraft.startAt, activityDraftUsesDateRange]);
  useEffect(() => {
    if (activitySupportsLinkedMember) return;
    if (!activityDraft.linkedMemberUserId && !activityLinkedPickerOpen && !activityLinkedMemberQuery) return;
    setActivityDraft((prev) => ({ ...prev, linkedMemberUserId: "" }));
    setActivityLinkedPickerOpen(false);
    setActivityLinkedMemberQuery("");
  }, [activityDraft.linkedMemberUserId, activityLinkedMemberQuery, activityLinkedPickerOpen, activitySupportsLinkedMember]);

  useEffect(() => {
    let cancelled = false;

    async function checkPendingPairConflict() {
      if (!activityComposerOpen || !activeMeta?.otherUserId) {
        if (!cancelled) setActivityPendingWarning(null);
        return;
      }

      try {
        const warning = await fetchPendingPairConflict(activeMeta.otherUserId);
        if (cancelled) return;
        setActivityPendingWarning(warning);
      } catch {
        if (!cancelled) setActivityPendingWarning(null);
      }
    }

    void checkPendingPairConflict();
    return () => {
      cancelled = true;
    };
  }, [activityComposerOpen, activeMeta?.otherUserId]);

  useEffect(() => {
    if (!activityComposerOpen) {
      setActivityComposerError(null);
      return;
    }
    setActivityComposerError(null);
  }, [activityComposerOpen, activeMeta?.otherUserId]);

  useEffect(() => {
    let cancelled = false;

    async function loadLinkedConnections() {
      if (!activityComposerOpen || !meId) {
        if (!cancelled) {
          setActivityLinkedConnectionOptions([]);
          setActivityLinkedPickerOpen(false);
          setActivityLinkedMemberQuery("");
        }
        return;
      }

      try {
        const options = await fetchLinkedConnectionOptions(supabase, meId);
        if (!cancelled) setActivityLinkedConnectionOptions(options);
      } catch {
        if (!cancelled) setActivityLinkedConnectionOptions([]);
      }
    }

    void loadLinkedConnections();
    return () => {
      cancelled = true;
    };
  }, [activityComposerOpen, meId]);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [manualUnreadByThread, setManualUnreadByThread] = useState<Record<string, true>>({});
  const [threadDrafts, setThreadDrafts] = useState<Record<string, string>>({});
  const [hoveredUnreadThreadId, setHoveredUnreadThreadId] = useState<string | null>(null);
  const [recentlyUpdatedThreadIds, setRecentlyUpdatedThreadIds] = useState<Record<string, true>>({});
  const [messageReactions, setMessageReactions] = useState<Record<string, MessageReactionAggregate[]>>({});
  const [reactionsServerSupported, setReactionsServerSupported] = useState(true);
  const [localReactionsByThread, setLocalReactionsByThread] = useState<
    Record<string, Record<string, MessageReactionAggregate[]>>
  >({});
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
  const [, setPeerTyping] = useState(false);
  const [meAvatarUrl, setMeAvatarUrl] = useState<string | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [clockMs, setClockMs] = useState(Date.now());
  const [connectionEventsFeed, setConnectionEventsFeed] = useState<
    Array<{
      id: string;
      title: string;
      city: string | null;
      country: string | null;
      startsAt: string | null;
      coverUrl: string | null;
      attendeeCount: number;
      connectionNames: string[];
      connectionAvatars: Array<string | null>;
    }>
  >([]);
  const [connectionEventsFeedLoading, setConnectionEventsFeedLoading] = useState(false);
  const [activeCurrentEvent, setActiveCurrentEvent] = useState<EventRecord | null>(null);
  const [activeCurrentGroup, setActiveCurrentGroup] = useState<ActiveGroupThreadRecord | null>(null);

  const buildInboxUrl = useCallback(
    (options?: { tab?: FilterTab | null; threadToken?: string | null; kind?: InboxKindFilter | null }) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      const nextTab = options && "tab" in options ? options.tab ?? "all" : activeTab;
      const nextKind = options && "kind" in options ? options.kind ?? "all" : kindFilter;

      nextParams.delete("mobile");

      if (!nextTab || nextTab === "all") nextParams.delete("tab");
      else nextParams.set("tab", nextTab);

      if (!nextKind || nextKind === "all") nextParams.delete("kind");
      else nextParams.set("kind", nextKind);

      if (options && "threadToken" in options) {
        if (options.threadToken) nextParams.set("thread", options.threadToken);
        else nextParams.delete("thread");
      }

      const qs = nextParams.toString();
      return qs ? `/messages?${qs}` : "/messages";
    },
    [activeTab, kindFilter, searchParams]
  );

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const threadActionsRef = useRef<HTMLDivElement | null>(null);
  const inboxFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const connectionFeedRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const localReactionsByThreadRef = useRef<Record<string, Record<string, MessageReactionAggregate[]>>>({});
  const threadDraftsRef = useRef<Record<string, string>>({});
  const previousThreadsRef = useRef<Record<string, { updatedAt: string; unreadCount: number }>>({});
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const threadLoadRequestIdRef = useRef(0);
  const typingLastSentAtRef = useRef(0);
  const typingTimeoutRef = useRef<number | null>(null);
  const composerLockReasonRef = useRef<string | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [feedLightboxUrl, setFeedLightboxUrl] = useState<string | null>(null);
  const swipeGestureRef = useRef<{
    messageId: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

  const resolveAccessToken = useCallback(async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token?.trim() ?? "";
      if (accessToken) return accessToken;

      const userRes = await supabase.auth.getUser();
      if (userRes.data.user) {
        const refreshed = await supabase.auth.refreshSession();
        const refreshedToken = refreshed.data.session?.access_token?.trim() ?? "";
        if (refreshedToken) return refreshedToken;
      }

      await wait(150);
    }

    throw new Error("Missing auth session token.");
  }, []);

  const loadOwnTeacherInquiryBlocks = useCallback(async () => {
    if (!meId) return [] as TeacherInfoBlock[];
    const rows = await fetchTeacherInfoBlocks(supabase, meId, { activeOnly: true });
    setShareInquiryBlocks(rows);
    return rows;
  }, [meId]);

  const refreshMessagingSummary = useCallback(async () => {
    try {
      const [rpc, authData] = await Promise.all([
        supabase.rpc("cx_sync_user_messaging_state"),
        supabase.auth.getUser(),
      ]);
      if (rpc.error) throw rpc.error;
      const data = asRecord(rpc.data);
      const viewerId = authData.data.user?.id ?? "";

      // Derive the correct plan limits from auth metadata (RPC may return stale/free-tier values)
      const userMeta = authData.data.user?.user_metadata;
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const [profileRes, requestCountRes] = await Promise.all([
        supabase.from("profiles").select("verified,verified_label").eq("user_id", viewerId).maybeSingle(),
        viewerId
          ? supabase
              .from("connections")
              .select("id", { count: "exact", head: true })
              .eq("requester_id", viewerId)
              .gte("created_at", monthStart.toISOString())
          : Promise.resolve({ count: 0, error: null }),
      ]);
      const isVerified = (profileRes.data as { verified?: boolean } | null)?.verified === true;
      const billingState = getBillingAccountState({ userMetadata: userMeta, isVerified });
      const planLimits = getPlanLimits(billingState.currentPlanId);
      const requestLimit = planLimits.connectionRequestsPerMonth ?? null;
      const requestsUsed = Number(requestCountRes.count) || 0;

      const summary: MessagingSummary = {
        plan: billingState.currentPlanId === "pro" ? "premium" : "free",
        activeCount: Number(data.activeCount) || 0,
        activeLimit: planLimits.activeChatThreadsPerMonth ?? 10,
        monthlyUsed: Number(data.monthlyUsed) || 0,
        monthlyLimit: planLimits.initiatedChatsPerMonth ?? 10,
        pendingCount: Number(data.pendingCount) || 0,
        cycleStart: asString(data.cycleStart) || null,
        cycleEnd: asString(data.cycleEnd) || null,
      };
      setMessagingSummary(summary);
      setRequestQuotaSummary({
        used: requestsUsed,
        limit: requestLimit,
        remaining: requestLimit === null ? null : Math.max(0, requestLimit - requestsUsed),
      });
      return summary;
    } catch {
      setMessagingSummary((prev) => prev);
      setRequestQuotaSummary((prev) => prev);
      return null;
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeThreadToken) return;
    if (!optimisticActivatedByThread[activeThreadToken]) return;
    const storedState = activeMeta?.messagingState ?? null;
    const persistedActivationReady = storedState === "active" && Boolean(activeMeta?.activationCycleEnd);
    const shouldClear = persistedActivationReady || (storedState !== null && storedState !== "active");
    if (!shouldClear) return;

    setOptimisticActivatedByThread((prev) => {
      if (!prev[activeThreadToken]) return prev;
      const next = { ...prev };
      delete next[activeThreadToken];
      return next;
    });
  }, [activeMeta?.activationCycleEnd, activeMeta?.messagingState, activeThreadToken, optimisticActivatedByThread]);

  useEffect(() => {
    if (!meId) {
      setMessagingSummary(null);
      setRequestQuotaSummary(null);
      return;
    }
    void refreshMessagingSummary();
  }, [meId, refreshMessagingSummary, reloadTick]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LOCAL_REACTIONS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, Record<string, MessageReactionAggregate[]>> | null;
      if (parsed && typeof parsed === "object") {
        localReactionsByThreadRef.current = parsed;
        setLocalReactionsByThread(parsed);
      }
    } catch {
      // Ignore invalid local cache payloads.
    }
  }, []);

  useEffect(() => {
    localReactionsByThreadRef.current = localReactionsByThread;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_REACTIONS_STORAGE_KEY, JSON.stringify(localReactionsByThread));
    } catch {
      // Ignore local storage failures.
    }
  }, [localReactionsByThread]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LOCAL_MANUAL_UNREAD_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, true> | null;
      if (parsed && typeof parsed === "object") {
        setManualUnreadByThread(parsed);
      }
    } catch {
      // Ignore invalid local cache payloads.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_MANUAL_UNREAD_STORAGE_KEY, JSON.stringify(manualUnreadByThread));
      window.dispatchEvent(new CustomEvent("cx:manual-unread-changed"));
    } catch {
      // Ignore local storage failures.
    }
  }, [manualUnreadByThread]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LOCAL_THREAD_DRAFTS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string> | null;
      if (parsed && typeof parsed === "object") {
        threadDraftsRef.current = parsed;
        setThreadDrafts(parsed);
      }
    } catch {
      // Ignore invalid local cache payloads.
    }
  }, []);

  useEffect(() => {
    threadDraftsRef.current = threadDrafts;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_THREAD_DRAFTS_STORAGE_KEY, JSON.stringify(threadDrafts));
    } catch {
      // Ignore local storage failures.
    }
  }, [threadDrafts]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LOCAL_ARCHIVED_THREADS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, true> | null;
      if (parsed && typeof parsed === "object") {
        setArchivedThreads(parsed);
      }
    } catch {
      // Ignore invalid local cache payloads.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_ARCHIVED_THREADS_STORAGE_KEY, JSON.stringify(archivedThreads));
    } catch {
      // Ignore local storage failures.
    }
  }, [archivedThreads]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LOCAL_MUTED_THREADS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string> | null;
      if (parsed && typeof parsed === "object") {
        const now = Date.now();
        const cleaned = Object.fromEntries(Object.entries(parsed).filter(([, until]) => toTime(until) > now));
        setMutedUntilByThread(cleaned);
      }
    } catch {
      // Ignore invalid local cache payloads.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_MUTED_THREADS_STORAGE_KEY, JSON.stringify(mutedUntilByThread));
    } catch {
      // Ignore local storage failures.
    }
  }, [mutedUntilByThread]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LOCAL_PINNED_THREADS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, true> | null;
      if (parsed && typeof parsed === "object") {
        setPinnedThreads(parsed);
      }
    } catch {
      // Ignore invalid local cache payloads.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_PINNED_THREADS_STORAGE_KEY, JSON.stringify(pinnedThreads));
    } catch {
      // Ignore local storage failures.
    }
  }, [pinnedThreads]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && threadActionsRef.current && !threadActionsRef.current.contains(target)) {
        setThreadActionsOpen(false);
      }
      if (target && inboxFilterMenuRef.current && !inboxFilterMenuRef.current.contains(target)) {
        setInboxFilterMenuOpen(false);
      }
      const el = target instanceof Element ? target : null;
      if (!el?.closest('[data-thread-row-menu="true"]')) {
        setOpenThreadRowMenuId(null);
      }
    };

    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === "Escape") {
        setOpenMessageMenuId(null);
        setOpenThreadRowMenuId(null);
        setThreadActionsOpen(false);
        setComposerEmojiOpen(false);
        setHoveredUnreadThreadId(null);
        if (reportOpen) setReportOpen(false);
        if (blockOpen) setBlockOpen(false);
        if (composeOpen) setComposeOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [blockOpen, composeOpen, reportOpen]);

  useEffect(() => {
    const currentMap: Record<string, { updatedAt: string; unreadCount: number }> = {};
    threads.forEach((thread) => {
      currentMap[thread.threadId] = {
        updatedAt: thread.updatedAt,
        unreadCount: thread.unreadCount,
      };
    });

	    const previous = previousThreadsRef.current;
	    const previousIds = Object.keys(previous);
	    if (previousIds.length > 0) {
      const changedIds = threads
        .filter((thread) => {
          const prev = previous[thread.threadId];
          if (!prev) return false;
          return toTime(thread.updatedAt) > toTime(prev.updatedAt) || thread.unreadCount > prev.unreadCount;
        })
        .map((thread) => thread.threadId);

	      if (changedIds.length > 0) {
        previousThreadsRef.current = currentMap;
	        setRecentlyUpdatedThreadIds((prev) => {
	          const next = { ...prev };
	          changedIds.forEach((id) => {
	            next[id] = true;
          });
          return next;
        });

	        const timer = window.setTimeout(() => {
	          setRecentlyUpdatedThreadIds((prev) => {
	            const next = { ...prev };
            changedIds.forEach((id) => {
              delete next[id];
            });
            return next;
          });
        }, 1200);

	        return () => window.clearTimeout(timer);
	      }
	    }

    previousThreadsRef.current = currentMap;
  }, [threads]);

  useEffect(() => {
    setMutedUntilByThread((prev) => {
      const entries = Object.entries(prev);
      const next = entries.filter(([, until]) => toTime(until) > clockMs);
      if (next.length === entries.length) return prev;
      return Object.fromEntries(next);
    });
  }, [clockMs]);

  const loadThreadReactions = useCallback(
    async (params: { kind: ThreadKind; threadScopeId: string; viewerId: string; threadToken?: string }) => {
      if (!supportsSyncedMessageReactions(params.kind)) {
        setReactionsServerSupported(false);
        const nextMap = params.threadToken ? localReactionsByThreadRef.current[params.threadToken] ?? {} : {};
        setMessageReactions(nextMap);
        return false;
      }

      const res = await supabase
        .from("message_reactions")
        .select("message_id,reactor_id,emoji")
        .eq("thread_kind", params.kind)
        .eq("thread_id", params.threadScopeId)
        .limit(6000);

      if (res.error) {
        const lower = res.error.message.toLowerCase();
        if (
          lower.includes("relation") ||
          lower.includes("schema cache") ||
          lower.includes("does not exist") ||
          lower.includes("permission denied")
        ) {
          setReactionsServerSupported(false);
          return false;
        }
        throw new Error(res.error.message);
      }

      setReactionsServerSupported(true);
      const nextMap = buildReactionAggregateMap((res.data ?? []) as MessageReactionDbRow[], params.viewerId);
      setMessageReactions(nextMap);
      if (params.threadToken) {
        setLocalReactionsByThread((prev) => ({ ...prev, [params.threadToken as string]: nextMap }));
      }
      return true;
    },
    []
  );

  const loadThreadByToken = useCallback(async (token: string, userId: string) => {
    const requestId = ++threadLoadRequestIdRef.current;
    const isStale = () => threadLoadRequestIdRef.current !== requestId;
    let parsed = parseThreadToken(token);
    if (!parsed) return;
    let canonicalToken = token;

    setThreadLoading(true);
    setThreadError(null);
    setThreadInfo(null);
    setThreadDbSupported(true);
    setMessageReactions(localReactionsByThreadRef.current[token] ?? {});
    setActiveFallbackContext(null);

    try {
      if (parsed.kind === "trip") {
        const contextRes = await supabase
          .from("thread_contexts")
          .select("thread_id")
          .eq("context_tag", "trip_join_request")
          .contains("metadata", { trip_id: parsed.id })
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const contextThreadId =
          !contextRes.error && contextRes.data && typeof (contextRes.data as { thread_id?: unknown }).thread_id === "string"
            ? ((contextRes.data as { thread_id?: string }).thread_id ?? null)
            : null;
        if (isStale()) return;
        if (contextThreadId) {
          parsed = { kind: "direct", id: contextThreadId };
          canonicalToken = `direct:${contextThreadId}`;
        }
      }

      if (isStale()) return;
      if (canonicalToken !== token) {
        setActiveThreadToken(canonicalToken);
        router.replace(buildInboxUrl({ threadToken: canonicalToken }));
      }
      if (!parsed) return;

      const hydrateContextState = async (threadId: string | null) => {
        if (!threadId) return [] as ThreadContextItem[];
        const res = await supabase
          .from("thread_contexts")
          .select("id,thread_id,source_table,source_id,context_tag,status_tag,title,city,start_date,end_date,requester_id,recipient_id,metadata,created_at,updated_at")
          .eq("thread_id", threadId)
          .order("updated_at", { ascending: false })
          .limit(80);
        if (res.error) return [] as ThreadContextItem[];
        if (isStale()) return [] as ThreadContextItem[];
        let normalized = ((res.data ?? []) as ThreadContextRow[])
          .map((row) => normalizeThreadContextRow(row))
          .filter((row): row is ThreadContextItem => row !== null);

        const tripRequestIds = normalized
          .filter((row) => row.contextTag === "trip_join_request" && row.sourceId)
          .map((row) => row.sourceId);

        if (tripRequestIds.length > 0) {
          const tripRequestRes = await supabase
            .from("trip_requests")
            .select("id,reason,note")
            .in("id", tripRequestIds);
          if (!tripRequestRes.error && !isStale()) {
            const tripRequestById = new Map(
              ((tripRequestRes.data ?? []) as Array<Record<string, unknown>>)
                .map((row) => {
                  const id = typeof row.id === "string" ? row.id : "";
                  if (!id) return null;
                  return [
                    id,
                    {
                      reason: asString(row.reason).trim(),
                      note: asString(row.note).trim(),
                    },
                  ] as const;
                })
                .filter((entry): entry is readonly [string, { reason: string; note: string }] => Boolean(entry))
            );

            normalized = normalized.map((row) => {
              if (row.contextTag !== "trip_join_request") return row;
              const tripRequest = tripRequestById.get(row.sourceId);
              if (!tripRequest) return row;
              return {
                ...row,
                metadata: {
                  ...row.metadata,
                  trip_join_reason: tripRequest.reason || row.metadata.trip_join_reason,
                  note: tripRequest.note || row.metadata.note,
                },
              };
            });
          }
        }

        const hostingRequestIds = normalized
          .filter((row) => row.contextTag === "hosting_request" && row.sourceId)
          .map((row) => row.sourceId);

        if (hostingRequestIds.length > 0) {
          const hostingRequestRes = await supabase
            .from("hosting_requests")
            .select("id,request_type,reason,message")
            .in("id", hostingRequestIds);
          if (!hostingRequestRes.error && !isStale()) {
            const hostingRequestById = new Map(
              ((hostingRequestRes.data ?? []) as Array<Record<string, unknown>>)
                .map((row) => {
                  const id = typeof row.id === "string" ? row.id : "";
                  if (!id) return null;
                  return [
                    id,
                    {
                      requestType: asString(row.request_type).trim(),
                      reason: asString(row.reason).trim(),
                      message: asString(row.message).trim(),
                    },
                  ] as const;
                })
                .filter((entry): entry is readonly [string, { requestType: string; reason: string; message: string }] => Boolean(entry))
            );

            normalized = normalized.map((row) => {
              if (row.contextTag !== "hosting_request") return row;
              const hostingRequest = hostingRequestById.get(row.sourceId);
              if (!hostingRequest) return row;
              return {
                ...row,
                metadata: {
                  ...row.metadata,
                  request_type: hostingRequest.requestType || row.metadata.request_type,
                  reason: hostingRequest.reason || row.metadata.reason,
                  message: hostingRequest.message || row.metadata.message,
                },
              };
            });
          }
        }

        setThreadContextsByDbId((prev) => ({ ...prev, [threadId]: normalized }));
        return normalized;
      };

      if (parsed && parsed.kind === "connection") {
        const parsedConnectionId = parsed.id;
        const visibleRows = await fetchVisibleConnections(supabase, userId);
        if (isStale()) return;
        const row = visibleRows.find(
          (item) =>
            item.id === parsedConnectionId &&
            (item.is_visible_in_messages || item.is_incoming_pending || item.is_outgoing_pending)
        );
        if (!row) throw new Error("This conversation is not available.");

        const profileRes = await supabase
          .from("profiles")
          .select("user_id,display_name,avatar_url,city,country")
          .eq("user_id", row.other_user_id)
          .maybeSingle();
        const profile = (profileRes.data ?? null) as ProfileRow | null;

        const messagesRes = await supabase
          .from("messages")
          .select("id,sender_id,body,created_at")
          .eq("connection_id", row.id)
          .order("created_at", { ascending: true })
          .limit(1000);
        if (messagesRes.error) throw new Error(messagesRes.error.message);
        if (isStale()) return;

        let threadId: string | null = null;
        let previousLastReadAt: string | null = null;
        const threadRes = await supabase.from("threads").select("id").eq("connection_id", row.id).maybeSingle();
        if (!threadRes.error) {
          threadId = (threadRes.data as { id?: string } | null)?.id ?? null;
          if (!threadId) {
            const createThreadRes = await supabase
              .from("threads")
              .insert({
                thread_type: "connection",
                connection_id: row.id,
                created_by: userId,
                last_message_at: new Date().toISOString(),
              })
              .select("id")
              .single();
            if (!createThreadRes.error) {
              threadId = (createThreadRes.data as { id?: string } | null)?.id ?? null;
            }
          }
        }

        let contexts: ThreadContextItem[] = [];
        let participantState: ThreadParticipantDbRow | null = null;
        if (threadId) {
          const participantRes = await supabase
            .from("thread_participants")
            .select("last_read_at,messaging_state,activated_at,activation_cycle_start,activation_cycle_end,archived_at")
            .eq("thread_id", threadId)
            .eq("user_id", userId)
            .maybeSingle();
          if (!participantRes.error) {
            const participantRow = participantRes.data as ThreadParticipantDbRow | null;
            previousLastReadAt = participantRow?.last_read_at ?? null;
            participantState = participantRow;
          }

          const peerParticipantRes = await supabase
            .from("thread_participants")
            .select("last_read_at")
            .eq("thread_id", threadId)
            .eq("user_id", row.other_user_id)
            .maybeSingle();
          if (!peerParticipantRes.error) {
            const peerParticipant = peerParticipantRes.data as { last_read_at?: string | null } | null;
            setActivePeerLastReadAt(peerParticipant?.last_read_at ?? null);
          } else {
            setActivePeerLastReadAt(null);
          }

          contexts = await hydrateContextState(threadId);
        } else {
          setActivePeerLastReadAt(null);
        }
        if (isStale()) return;
        setActiveLastReadAt(previousLastReadAt);

        const fallbackStatusTag: ThreadStatusTag =
          row.status === "pending"
            ? "pending"
            : row.status === "accepted"
            ? "accepted"
            : row.status === "declined"
            ? "declined"
            : row.status === "cancelled"
            ? "cancelled"
            : "active";
        const fallbackContextTag: ThreadContextTag = fallbackStatusTag === "active" ? "regular_chat" : "connection_request";
        const primaryContext = contexts.find((ctx) => isPendingLikeStatus(ctx.statusTag)) ?? contexts[0] ?? null;
        const hasAcceptedInteraction = contexts.some(
          (ctx) => CHAT_UNLOCK_CONTEXT_TAGS.includes(ctx.contextTag) && isAcceptedInteractionStatus(ctx.statusTag)
        );
        if (!primaryContext && fallbackContextTag === "connection_request") {
          setActiveFallbackContext({
            id: `fallback-connection-${row.id}`,
            threadId: threadId ?? token,
            sourceTable: "connections",
            sourceId: row.id,
            contextTag: fallbackContextTag,
            statusTag: fallbackStatusTag,
            title: "Connection request",
            city: [profile?.city ?? "", profile?.country ?? ""].filter(Boolean).join(", ") || null,
            startDate: null,
            endDate: null,
            requesterId: row.requester_id,
            recipientId: row.target_id,
            metadata: {},
            updatedAt: row.created_at ?? new Date().toISOString(),
            createdAt: row.created_at ?? new Date().toISOString(),
          });
        }
        if (isStale()) return;

        setActiveMeta({
          kind: "connection",
          contextTag: primaryContext?.contextTag ?? fallbackContextTag,
          statusTag: primaryContext?.statusTag ?? fallbackStatusTag,
          title: profile?.display_name ?? "Connection",
          subtitle: [profile?.city ?? "", profile?.country ?? ""].filter(Boolean).join(", ") || "Connection",
          avatarUrl: profile?.avatar_url ?? null,
          badge: "Connection",
          otherUserId: row.other_user_id,
          connectionId: row.id,
          tripId: row.trip_id ?? null,
          threadId,
          messagingState: normalizeMessagingState(participantState?.messaging_state, participantState?.archived_at ? "archived" : "inactive"),
          activatedAt: participantState?.activated_at ?? null,
          activationCycleStart: participantState?.activation_cycle_start ?? null,
          activationCycleEnd: participantState?.activation_cycle_end ?? null,
          hasAcceptedInteraction,
          isRelationshipPending: isPendingLikeStatus(primaryContext?.statusTag ?? fallbackStatusTag) && !hasAcceptedInteraction,
          serviceInquiryId: null,
          serviceInquiryRequesterId: null,
          serviceInquiryRecipientId: null,
          serviceInquiryFollowupUsed: false,
        });
        setActiveMessages(
          ((messagesRes.data ?? []) as Array<Record<string, unknown>>).map((m) => ({
            id: typeof m.id === "string" ? m.id : crypto.randomUUID(),
            senderId: typeof m.sender_id === "string" ? m.sender_id : "",
            body: typeof m.body === "string" ? m.body : "",
            messageType: "text",
            contextTag: "regular_chat",
            statusTag: "active",
            metadata: {},
            createdAt: typeof m.created_at === "string" ? m.created_at : "",
            status: "sent",
          }))
        );
        if (threadId) {
          await supabase.from("thread_participants").upsert(
            [
              { thread_id: threadId, user_id: userId, role: "member", last_read_at: new Date().toISOString() },
              { thread_id: threadId, user_id: row.other_user_id, role: "member" },
            ],
            { onConflict: "thread_id,user_id" }
          );
        }
        if (isStale()) return;
        await loadThreadReactions({
          kind: "connection",
          threadScopeId: row.id,
          viewerId: userId,
          threadToken: token,
        });
        return;
      }

      if (parsed.kind === "trip") {
        const tripRes = await supabase
          .from("trips")
          .select("id,user_id,destination_city,destination_country,start_date,end_date")
          .eq("id", parsed.id)
          .maybeSingle();
        if (tripRes.error) throw new Error(tripRes.error.message);
        if (isStale()) return;
        const trip = (tripRes.data ?? null) as TripRow & { user_id?: string } | null;
        if (!trip?.id) throw new Error("Trip thread not found.");

        let allowed = trip.user_id === userId;
        if (!allowed) {
          const reqRes = await supabase
            .from("trip_requests")
            .select("id")
            .eq("trip_id", parsed.id)
            .eq("requester_id", userId)
            .eq("status", "accepted")
            .maybeSingle();
          allowed = Boolean(reqRes.data);
        }
        if (!allowed) throw new Error("You do not have access to this trip thread.");

        const existingThreadRes = await supabase.from("threads").select("id").eq("trip_id", parsed.id).maybeSingle();
        if (
          existingThreadRes.error &&
          (existingThreadRes.error.message.toLowerCase().includes("relation") ||
            existingThreadRes.error.message.toLowerCase().includes("schema cache"))
        ) {
          setThreadDbSupported(false);
          setActiveLastReadAt(null);
          setActiveMeta({
            kind: "trip",
            contextTag: "trip_join_request",
            statusTag: "active",
            title: trip.destination_city ? `Trip to ${trip.destination_city}` : "Trip chat",
            subtitle: parseTripLabel(trip),
            avatarUrl: null,
          badge: "Trip",
          otherUserId: null,
          connectionId: null,
          tripId: trip.id ?? null,
          threadId: null,
          serviceInquiryId: null,
          serviceInquiryRequesterId: null,
          serviceInquiryRecipientId: null,
          serviceInquiryFollowupUsed: false,
        });
          setActiveMessages([]);
          setThreadLoading(false);
          return;
        }
        if (existingThreadRes.error) throw new Error(existingThreadRes.error.message);
        if (isStale()) return;

        let threadId = (existingThreadRes.data as { id?: string } | null)?.id ?? null;
        let previousLastReadAt: string | null = null;
        let participantState: ThreadParticipantDbRow | null = null;
        if (!threadId) {
          const createThreadRes = await supabase
            .from("threads")
            .insert({
              thread_type: "trip",
              trip_id: parsed.id,
              created_by: userId,
              last_message_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (createThreadRes.error) throw new Error(createThreadRes.error.message);
          threadId = (createThreadRes.data as { id?: string } | null)?.id ?? null;
        }

        let contexts: ThreadContextItem[] = [];
        if (threadId) {
          const participantRes = await supabase
            .from("thread_participants")
            .select("last_read_at,messaging_state,activated_at,activation_cycle_start,activation_cycle_end,archived_at")
            .eq("thread_id", threadId)
            .eq("user_id", userId)
            .maybeSingle();
          if (!participantRes.error) {
            const participantRow = participantRes.data as ThreadParticipantDbRow | null;
            previousLastReadAt = participantRow?.last_read_at ?? null;
            participantState = participantRow;
          }
          contexts = await hydrateContextState(threadId);
        }
        if (isStale()) return;

        const tripMsgRes = threadId
          ? await supabase
              .from("thread_messages")
              .select("id,sender_id,body,message_type,context_tag,status_tag,metadata,created_at")
              .eq("thread_id", threadId)
              .order("created_at", { ascending: true })
              .limit(1000)
          : { data: [], error: null };
        if (tripMsgRes.error) throw new Error(tripMsgRes.error.message);
        if (isStale()) return;

        const primaryContext = contexts.find((ctx) => isPendingLikeStatus(ctx.statusTag)) ?? contexts[0] ?? null;
        setActivePeerLastReadAt(null);
        setActiveLastReadAt(previousLastReadAt);
        setActiveMeta({
          kind: "trip",
          contextTag: primaryContext?.contextTag ?? "trip_join_request",
          statusTag: primaryContext?.statusTag ?? "active",
          title: trip.destination_city ? `Trip to ${trip.destination_city}` : "Trip chat",
          subtitle: parseTripLabel(trip),
          avatarUrl: null,
          badge: "Trip",
          otherUserId: null,
          connectionId: null,
          tripId: trip.id ?? null,
          threadId,
          messagingState: normalizeMessagingState(participantState?.messaging_state, participantState?.archived_at ? "archived" : "inactive"),
          activatedAt: participantState?.activated_at ?? null,
          activationCycleStart: participantState?.activation_cycle_start ?? null,
          activationCycleEnd: participantState?.activation_cycle_end ?? null,
          hasAcceptedInteraction: contexts.some((ctx) => CHAT_UNLOCK_CONTEXT_TAGS.includes(ctx.contextTag) && isAcceptedInteractionStatus(ctx.statusTag)),
          isRelationshipPending:
            isPendingLikeStatus(primaryContext?.statusTag ?? "active") &&
            !contexts.some((ctx) => CHAT_UNLOCK_CONTEXT_TAGS.includes(ctx.contextTag) && isAcceptedInteractionStatus(ctx.statusTag)),
          serviceInquiryId: null,
          serviceInquiryRequesterId: null,
          serviceInquiryRecipientId: null,
          serviceInquiryFollowupUsed: false,
        });
        setActiveMessages(
          ((tripMsgRes.data ?? []) as Array<Record<string, unknown>>).map((m) => ({
            id: typeof m.id === "string" ? m.id : crypto.randomUUID(),
            senderId: typeof m.sender_id === "string" ? m.sender_id : "",
            body: typeof m.body === "string" ? m.body : "",
            messageType: normalizeMessageType(typeof m.message_type === "string" ? m.message_type : null),
            contextTag: normalizeContextTag(typeof m.context_tag === "string" ? m.context_tag : null),
            statusTag: normalizeStatusTag(typeof m.status_tag === "string" ? m.status_tag : null, "active"),
            metadata: parseContextMetadata(m.metadata),
            createdAt: typeof m.created_at === "string" ? m.created_at : "",
            status: "sent",
          }))
        );
        if (threadId) {
          await supabase.from("thread_participants").upsert(
            { thread_id: threadId, user_id: userId, role: "member", last_read_at: new Date().toISOString() },
            { onConflict: "thread_id,user_id" }
          );
          if (isStale()) return;
          await loadThreadReactions({
            kind: "trip",
            threadScopeId: threadId,
            viewerId: userId,
            threadToken: token,
          });
        }
        return;
      }

      if (parsed.kind === "direct") {
        const threadRes = await supabase
          .from("threads")
          .select("id,thread_type,direct_user_low,direct_user_high")
          .eq("id", parsed.id)
          .maybeSingle();
        if (threadRes.error) throw new Error(threadRes.error.message);
        if (isStale()) return;
        const thread = (threadRes.data ?? null) as ThreadDbRow | null;
        if (!thread?.id || thread.thread_type !== "direct") throw new Error("Direct chat not found.");

        let otherUserId = (thread.direct_user_low === userId ? thread.direct_user_high : thread.direct_user_low) ?? null;
        const memberRes = await supabase
          .from("thread_participants")
          .select("user_id,last_read_at,messaging_state,activated_at,activation_cycle_start,activation_cycle_end,archived_at")
          .eq("thread_id", thread.id)
          .in("user_id", [userId, otherUserId].filter(Boolean) as string[]);

        if (memberRes.error) throw new Error(memberRes.error.message);
        if (isStale()) return;
        const participantRows = (memberRes.data ?? []) as ThreadParticipantDbRow[];
        const meParticipant = participantRows.find((row) => row.user_id === userId);
        if (!meParticipant) throw new Error("You do not have access to this chat.");
        if (!otherUserId) {
          otherUserId = participantRows.find((row) => row.user_id && row.user_id !== userId)?.user_id ?? null;
        }

        const [profileRes, messagesRes] = await Promise.all([
          otherUserId
            ? supabase
                .from("profiles")
                .select("user_id,display_name,avatar_url,city,country")
                .eq("user_id", otherUserId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          supabase
            .from("thread_messages")
            .select("id,sender_id,body,message_type,context_tag,status_tag,metadata,created_at")
            .eq("thread_id", thread.id)
            .order("created_at", { ascending: true })
            .limit(1000),
        ]);
        if (messagesRes.error) throw new Error(messagesRes.error.message);
        if (isStale()) return;
        const profile = (profileRes.data ?? null) as ProfileRow | null;
        const contexts = await hydrateContextState(thread.id);
        if (isStale()) return;
        const primaryContext = contexts.find((ctx) => isPendingLikeStatus(ctx.statusTag)) ?? contexts[0] ?? null;
        const connectionContext = contexts.find((ctx) => ctx.sourceTable === "connections");
        const tripContext = contexts.find((ctx) => ctx.contextTag === "trip_join_request");
        const serviceInquiryContext = contexts.find((ctx) => ctx.contextTag === "service_inquiry") ?? null;
        const hasAcceptedInteraction = contexts.some((ctx) => CHAT_UNLOCK_CONTEXT_TAGS.includes(ctx.contextTag) && isAcceptedInteractionStatus(ctx.statusTag));
        const tripIdFromContext =
          typeof tripContext?.metadata?.trip_id === "string" && tripContext.metadata.trip_id.length > 0
            ? tripContext.metadata.trip_id
            : null;
        setActiveLastReadAt(meParticipant.last_read_at ?? null);
        setActivePeerLastReadAt(participantRows.find((row) => row.user_id === otherUserId)?.last_read_at ?? null);

        setActiveMeta({
          kind: "direct",
          contextTag: primaryContext?.contextTag ?? "regular_chat",
          statusTag: primaryContext?.statusTag ?? "active",
          title: profile?.display_name ?? "Direct chat",
          subtitle: [profile?.city ?? "", profile?.country ?? ""].filter(Boolean).join(", ") || "Member chat",
          avatarUrl: profile?.avatar_url ?? null,
          badge: contextGroupLabel(primaryContext?.contextTag ?? "regular_chat"),
          otherUserId,
          connectionId: connectionContext?.sourceId ?? null,
          tripId: tripIdFromContext,
          threadId: thread.id,
          messagingState: normalizeMessagingState(meParticipant?.messaging_state, meParticipant?.archived_at ? "archived" : "inactive"),
          activatedAt: meParticipant?.activated_at ?? null,
          activationCycleStart: meParticipant?.activation_cycle_start ?? null,
          activationCycleEnd: meParticipant?.activation_cycle_end ?? null,
          hasAcceptedInteraction,
          isRelationshipPending: isPendingLikeStatus(primaryContext?.statusTag ?? "active") && !hasAcceptedInteraction,
          serviceInquiryId: serviceInquiryContext?.sourceId ?? null,
          serviceInquiryRequesterId: serviceInquiryContext?.requesterId ?? null,
          serviceInquiryRecipientId: serviceInquiryContext?.recipientId ?? null,
          serviceInquiryFollowupUsed: Boolean(serviceInquiryContext?.metadata.requester_followup_used),
        });
        setActiveMessages(
          ((messagesRes.data ?? []) as Array<Record<string, unknown>>).map((m) => ({
            id: typeof m.id === "string" ? m.id : crypto.randomUUID(),
            senderId: typeof m.sender_id === "string" ? m.sender_id : "",
            body: typeof m.body === "string" ? m.body : "",
            messageType: normalizeMessageType(typeof m.message_type === "string" ? m.message_type : null),
            contextTag: normalizeContextTag(typeof m.context_tag === "string" ? m.context_tag : null),
            statusTag: normalizeStatusTag(typeof m.status_tag === "string" ? m.status_tag : null, "active"),
            metadata: parseContextMetadata(m.metadata),
            createdAt: typeof m.created_at === "string" ? m.created_at : "",
            status: "sent",
          }))
        );
        await supabase.from("thread_participants").upsert(
          { thread_id: thread.id, user_id: userId, role: "member", last_read_at: new Date().toISOString() },
          { onConflict: "thread_id,user_id" }
        );
        if (isStale()) return;
        await loadThreadReactions({
          kind: "direct",
          threadScopeId: thread.id,
          viewerId: userId,
          threadToken: token,
        });
        return;
      }

      if (parsed.kind === "group") {
        setActiveCurrentEvent(null);
        const threadRes = await supabase
          .from("threads")
          .select("id,thread_type,group_id")
          .eq("group_id", parsed.id)
          .maybeSingle();
        if (threadRes.error) throw new Error(threadRes.error.message);
        if (isStale()) return;
        const thread = (threadRes.data ?? null) as (ThreadDbRow & { group_id?: string | null }) | null;
        if (!thread?.id || thread.thread_type !== "group") throw new Error("Group chat not found.");

        const [memberRes, groupRes, messagesRes] = await Promise.all([
          supabase
            .from("thread_participants")
            .select("last_read_at,messaging_state,activated_at,activation_cycle_start,activation_cycle_end,archived_at")
            .eq("thread_id", thread.id)
            .eq("user_id", userId)
            .maybeSingle(),
          supabase
            .from("groups")
            .select("id,host_user_id,title,description,chat_mode,city,country,cover_url,cover_status,max_members,invite_token,status,created_at,updated_at")
            .eq("id", parsed.id)
            .maybeSingle(),
          supabase
            .from("thread_messages")
            .select("id,sender_id,body,message_type,context_tag,status_tag,metadata,created_at")
            .eq("thread_id", thread.id)
            .order("created_at", { ascending: true })
            .limit(1200),
        ]);
        if (messagesRes.error) throw new Error(messagesRes.error.message);
        if (isStale()) return;
        if (memberRes.error || !memberRes.data) {
          throw new Error("You do not have access to this group chat.");
        }

        const groupRecord = mapGroupRows(groupRes.data ? [groupRes.data] : [])[0] ?? null;
        if (!groupRecord) throw new Error("Group not found.");
        const groupTitle = groupRecord.title;
        const groupCity = groupRecord.city ?? "";
        const groupCountry = groupRecord.country ?? "";
        const groupChatMode: GroupChatMode = groupRecord.chatMode;
        const isGroupHost = groupRecord.hostUserId === userId;
        const groupComposerCanPost = isGroupHost || groupChatMode === "discussion";
        const groupLocation = [groupCity, groupCountry].filter(Boolean).join(", ");
        const meParticipant = memberRes.data as ThreadParticipantDbRow;
        if (!isStale()) {
          setActiveCurrentGroup({
            ...groupRecord,
            isHost: isGroupHost,
          });
        }
        const contexts = await hydrateContextState(thread.id);
        if (isStale()) return;
        const primaryContext = contexts.find((ctx) => isPendingLikeStatus(ctx.statusTag)) ?? contexts[0] ?? null;
        const hasAcceptedInteraction = contexts.some((ctx) => CHAT_UNLOCK_CONTEXT_TAGS.includes(ctx.contextTag) && isAcceptedInteractionStatus(ctx.statusTag));
        setActiveLastReadAt(meParticipant.last_read_at ?? null);
        setActivePeerLastReadAt(null);

        setActiveMeta({
          kind: "group",
          contextTag: primaryContext?.contextTag ?? "regular_chat",
          statusTag: primaryContext?.statusTag ?? "active",
          title: groupTitle,
          subtitle: groupLocation || "Private Group",
          avatarUrl: groupRecord.coverUrl,
          badge: "Group",
          otherUserId: null,
          connectionId: null,
          tripId: null,
          eventId: null,
          threadId: thread.id,
          messagingState: normalizeMessagingState(meParticipant?.messaging_state, meParticipant?.archived_at ? "archived" : "inactive"),
          activatedAt: meParticipant?.activated_at ?? null,
          activationCycleStart: meParticipant?.activation_cycle_start ?? null,
          activationCycleEnd: meParticipant?.activation_cycle_end ?? null,
          hasAcceptedInteraction,
          isRelationshipPending: false,
          serviceInquiryId: null,
          serviceInquiryRequesterId: null,
          serviceInquiryRecipientId: null,
          serviceInquiryFollowupUsed: false,
          groupId: parsed.id,
          groupChatMode,
          canPostToGroupThread: groupComposerCanPost,
          isGroupHost,
          eventAccessType: null,
          eventChatMode: null,
          canPostToEventThread: undefined,
          isEventHost: false,
        });
        setActiveMessages(
          ((messagesRes.data ?? []) as Array<Record<string, unknown>>).map((m) => ({
            id: typeof m.id === "string" ? m.id : crypto.randomUUID(),
            senderId: typeof m.sender_id === "string" ? m.sender_id : "",
            body: typeof m.body === "string" ? m.body : "",
            messageType: normalizeMessageType(typeof m.message_type === "string" ? m.message_type : null),
            contextTag: normalizeContextTag(typeof m.context_tag === "string" ? m.context_tag : null),
            statusTag: normalizeStatusTag(typeof m.status_tag === "string" ? m.status_tag : null, "active"),
            metadata: parseContextMetadata(m.metadata),
            createdAt: typeof m.created_at === "string" ? m.created_at : "",
            status: "sent",
          }))
        );
        await supabase.from("thread_participants").upsert(
          { thread_id: thread.id, user_id: userId, role: "member", last_read_at: new Date().toISOString() },
          { onConflict: "thread_id,user_id" }
        );
        if (isStale()) return;
        await loadThreadReactions({
          kind: "group",
          threadScopeId: thread.id,
          viewerId: userId,
          threadToken: token,
        });
        return;
      }

      if (parsed.kind === "event") {
        setActiveCurrentGroup(null);
        const currentEventId = parsed.id;
        const threadRes = await supabase
          .from("threads")
          .select("id,thread_type,event_id")
          .eq("event_id", parsed.id)
          .maybeSingle();
        if (threadRes.error) throw new Error(threadRes.error.message);
        if (isStale()) return;
        const thread = (threadRes.data ?? null) as ThreadDbRow | null;
        if (!thread?.id || thread.thread_type !== "event") throw new Error("Event chat not found.");

        const memberRes = await supabase
          .from("thread_participants")
          .select("last_read_at,messaging_state,activated_at,activation_cycle_start,activation_cycle_end,archived_at")
          .eq("thread_id", thread.id)
          .eq("user_id", userId)
          .maybeSingle();
        if (memberRes.error || !memberRes.data) {
          throw new Error("You do not have access to this event chat.");
        }
        if (isStale()) return;
        const meParticipant = memberRes.data as ThreadParticipantDbRow;

        const [eventRes, messagesRes] = await Promise.all([
          supabase
            .from("events")
            .select("*")
            .eq("id", parsed.id)
            .maybeSingle(),
          supabase
            .from("thread_messages")
            .select("id,sender_id,body,message_type,context_tag,status_tag,metadata,created_at")
            .eq("thread_id", thread.id)
            .order("created_at", { ascending: true })
            .limit(1200),
        ]);
        if (messagesRes.error) throw new Error(messagesRes.error.message);
        if (isStale()) return;
        const mappedEvent = mapEventRows(eventRes.data ? [eventRes.data] : [])[0] ?? null;
        const eventRow = (eventRes.data ?? null) as Record<string, unknown> | null;
        const title = mappedEvent?.title || "Event";
        const eventAccessType = normalizeEventAccessType(
          typeof eventRow?.event_access_type === "string" ? eventRow.event_access_type : null,
          typeof eventRow?.visibility === "string" ? eventRow.visibility : null
        );
        const eventChatMode = normalizeEventChatMode(
          typeof eventRow?.chat_mode === "string" ? eventRow.chat_mode : null,
          eventAccessType
        );
        const isEventHost = typeof eventRow?.host_user_id === "string" && eventRow.host_user_id === userId;
        const eventComposerCanPost = canPostToEventThread({
          accessType: eventAccessType,
          chatMode: eventChatMode,
          isHost: isEventHost,
        });
        const location = [mappedEvent?.city ?? "", mappedEvent?.country ?? ""]
          .filter(Boolean)
          .join(", ");
        const date = mappedEvent?.startsAt ? formatDateShort(mappedEvent.startsAt) : "";
        if (!isStale()) {
          setActiveCurrentEvent(mappedEvent);
        }
        const contexts = await hydrateContextState(thread.id);
        if (isStale()) return;
        const primaryContext = contexts.find((ctx) => isPendingLikeStatus(ctx.statusTag)) ?? contexts[0] ?? null;
        const hasAcceptedInteraction = contexts.some((ctx) => CHAT_UNLOCK_CONTEXT_TAGS.includes(ctx.contextTag) && isAcceptedInteractionStatus(ctx.statusTag));
        setActiveLastReadAt(meParticipant.last_read_at ?? null);
        setActivePeerLastReadAt(null);

        setActiveMeta({
          kind: "event",
          contextTag: primaryContext?.contextTag ?? "event_chat",
          statusTag: primaryContext?.statusTag ?? "active",
          title,
          subtitle: [location, date].filter(Boolean).join(" • ") || "Event",
          avatarUrl: mappedEvent ? pickEventHeroUrl(mappedEvent) || pickEventFallbackHeroUrl(mappedEvent) || null : null,
          badge: eventThreadTabLabel(eventAccessType),
          otherUserId: null,
          connectionId: null,
          tripId: null,
          eventId: parsed.id,
          threadId: thread.id,
          messagingState: normalizeMessagingState(meParticipant?.messaging_state, meParticipant?.archived_at ? "archived" : "inactive"),
          activatedAt: meParticipant?.activated_at ?? null,
          activationCycleStart: meParticipant?.activation_cycle_start ?? null,
          activationCycleEnd: meParticipant?.activation_cycle_end ?? null,
          hasAcceptedInteraction,
          isRelationshipPending: isPendingLikeStatus(primaryContext?.statusTag ?? "active") && !hasAcceptedInteraction,
          serviceInquiryId: null,
          serviceInquiryRequesterId: null,
          serviceInquiryRecipientId: null,
          serviceInquiryFollowupUsed: false,
          eventAccessType,
          eventChatMode,
          canPostToEventThread: eventComposerCanPost,
          isEventHost,
        });
        setActiveMessages(
          ((messagesRes.data ?? []) as Array<Record<string, unknown>>).map((m) => ({
            id: typeof m.id === "string" ? m.id : crypto.randomUUID(),
            senderId: typeof m.sender_id === "string" ? m.sender_id : "",
            body: typeof m.body === "string" ? m.body : "",
            messageType: normalizeMessageType(typeof m.message_type === "string" ? m.message_type : null),
            contextTag: normalizeContextTag(typeof m.context_tag === "string" ? m.context_tag : null),
            statusTag: normalizeStatusTag(typeof m.status_tag === "string" ? m.status_tag : null, "active"),
            metadata: parseContextMetadata(m.metadata),
            createdAt: typeof m.created_at === "string" ? m.created_at : "",
            status: "sent",
          }))
        );
        await supabase.from("thread_participants").upsert(
          { thread_id: thread.id, user_id: userId, role: "member", last_read_at: new Date().toISOString() },
          { onConflict: "thread_id,user_id" }
        );
        if (isStale()) return;
        await loadThreadReactions({
          kind: "event",
          threadScopeId: thread.id,
          viewerId: userId,
          threadToken: token,
        });
        return;
      }
    } catch (e: unknown) {
      if (isStale()) return;
      setThreadError(e instanceof Error ? e.message : "Failed to load thread.");
      setActiveMeta(null);
      setActiveMessages([]);
      setActiveLastReadAt(null);
      setActivePeerLastReadAt(null);
    } finally {
      if (!isStale()) {
        setThreadLoading(false);
      }
    }
  }, [buildInboxUrl, loadThreadReactions, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setThreadsHydrated(false);
      setLoading(true);
      setError(null);
      setThreadPrefsInLocalMode(false);

      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      if (cancelled) return;
      setMeId(user.id);
      const authAvatar =
        typeof user.user_metadata?.avatar_url === "string"
          ? user.user_metadata.avatar_url
          : typeof user.user_metadata?.picture === "string"
          ? user.user_metadata.picture
          : null;
      setMeAvatarUrl(authAvatar);

      if (!authAvatar) {
        const meProfileRes = await supabase.from("profiles").select("avatar_url").eq("user_id", user.id).maybeSingle();
        if (!cancelled && !meProfileRes.error) {
          const meProfile = meProfileRes.data as { avatar_url?: string | null } | null;
          setMeAvatarUrl(meProfile?.avatar_url ?? null);
        }
      }

      try {
        let archivedFromDb: Record<string, true> = {};
        let mutedFromDb: Record<string, string> = {};
        let pinnedFromDb: Record<string, true> = {};
        let localContextsByThreadId: Record<string, ThreadContextItem[]> = {};
        const visibleRows = await fetchVisibleConnections(supabase, user.id);
        const allConnections = visibleRows;
        const visibleConnections = visibleRows.filter((row) => row.is_visible_in_messages);
        const otherUserIds = Array.from(new Set(allConnections.map((row) => row.other_user_id).filter(Boolean)));
        const tripIds = Array.from(new Set(visibleConnections.map((row) => row.trip_id).filter(Boolean))) as string[];
        const connectionsById: Record<string, (typeof allConnections)[number]> = Object.fromEntries(
          allConnections.map((row) => [row.id, row])
        );

        const tripRequestColumnsPrimary = "id,trip_id,requester_id,status,decided_at,updated_at,created_at";
        const tripRequestColumnsFallback = "id,trip_id,requester_id,status,updated_at,created_at";

        const [ownedTripsRes, acceptedOutgoingPrimaryRes] = await Promise.all([
          supabase.from("trips").select("id").eq("user_id", user.id).limit(500),
          supabase
            .from("trip_requests")
            .select(tripRequestColumnsPrimary)
            .eq("requester_id", user.id)
            .eq("status", "accepted")
            .limit(500),
        ]);

        let acceptedOutgoingRows = (acceptedOutgoingPrimaryRes.data ?? []) as TripRequestRow[];
        if (acceptedOutgoingPrimaryRes.error) {
          const msg = acceptedOutgoingPrimaryRes.error.message.toLowerCase();
          if (msg.includes("column") || msg.includes("schema cache")) {
            const acceptedOutgoingFallbackRes = await supabase
              .from("trip_requests")
              .select(tripRequestColumnsFallback)
              .eq("requester_id", user.id)
              .eq("status", "accepted")
              .limit(500);
            acceptedOutgoingRows = (acceptedOutgoingFallbackRes.data ?? []) as TripRequestRow[];
          }
        }

        const ownedTripIds = Array.from(
          new Set(
            ((ownedTripsRes.data ?? []) as Array<Record<string, unknown>>)
              .map((row) => (typeof row.id === "string" ? row.id : ""))
              .filter(Boolean)
          )
        );

        let acceptedIncomingRes: { data: unknown[]; error: { message: string } | null } = { data: [], error: null };
        if (ownedTripIds.length) {
          const incomingPrimary = await supabase
            .from("trip_requests")
            .select(tripRequestColumnsPrimary)
            .in("trip_id", ownedTripIds)
            .eq("status", "accepted")
            .limit(1000);
          if (incomingPrimary.error) {
            const msg = incomingPrimary.error.message.toLowerCase();
            if (msg.includes("column") || msg.includes("schema cache")) {
              const incomingFallback = await supabase
                .from("trip_requests")
                .select(tripRequestColumnsFallback)
                .in("trip_id", ownedTripIds)
                .eq("status", "accepted")
                .limit(1000);
              acceptedIncomingRes = {
                data: (incomingFallback.data ?? []) as unknown[],
                error: incomingFallback.error ? { message: incomingFallback.error.message } : null,
              };
            } else {
              acceptedIncomingRes = { data: [], error: { message: incomingPrimary.error.message } };
            }
          } else {
            acceptedIncomingRes = { data: (incomingPrimary.data ?? []) as unknown[], error: null };
          }
        }

        const acceptedTripRows = [
          ...acceptedOutgoingRows,
          ...((acceptedIncomingRes.data ?? []) as TripRequestRow[]),
        ].filter((row) => (row.trip_id ?? "").length > 0);

        const acceptedTripIds = Array.from(new Set(acceptedTripRows.map((row) => row.trip_id ?? "").filter(Boolean)));
        const acceptedTripUpdatedAtById: Record<string, string> = {};
        acceptedTripRows.forEach((row) => {
          const id = row.trip_id ?? "";
          if (!id) return;
          const candidate = row.decided_at || row.updated_at || row.created_at || new Date().toISOString();
          const prev = acceptedTripUpdatedAtById[id];
          if (!prev || toTime(candidate) > toTime(prev)) acceptedTripUpdatedAtById[id] = candidate;
        });

        const [eventMembershipsRes, groupMembershipsRes, hostedEventsRes, hostedGroupsRes] = await Promise.all([
          supabase
            .from("event_members")
            .select("event_id,status")
            .eq("user_id", user.id)
            .in("status", ["host", "going", "waitlist"]),
          supabase
            .from("group_members")
            .select("group_id")
            .eq("user_id", user.id)
            .limit(300),
          supabase
            .from("events")
            .select("id")
            .eq("host_user_id", user.id)
            .limit(300),
          supabase
            .from("groups")
            .select("id")
            .eq("host_user_id", user.id)
            .limit(300),
        ]);

        const joinedEventIds = Array.from(
          new Set(
            [
              ...((eventMembershipsRes.data ?? []) as Array<Record<string, unknown>>).map((row) =>
                typeof row.event_id === "string" ? row.event_id : ""
              ),
              ...((hostedEventsRes.data ?? []) as Array<Record<string, unknown>>).map((row) =>
                typeof row.id === "string" ? row.id : ""
              ),
            ]
              .filter(Boolean)
          )
        );
        const joinedGroupIds = Array.from(
          new Set(
            [
              ...((groupMembershipsRes.data ?? []) as Array<Record<string, unknown>>).map((row) =>
                typeof row.group_id === "string" ? row.group_id : ""
              ),
              ...((hostedGroupsRes.data ?? []) as Array<Record<string, unknown>>).map((row) =>
                typeof row.id === "string" ? row.id : ""
              ),
            ]
              .filter(Boolean)
          )
        );

        if (joinedEventIds.length || joinedGroupIds.length) {
          await Promise.all([
            ...joinedEventIds.slice(0, 50).map((eventId) =>
              supabase
                .rpc("cx_ensure_event_thread", { p_event_id: eventId, p_actor: user.id, p_requester: user.id })
                .then(() => null, () => null)
            ),
            ...joinedGroupIds.slice(0, 50).map((groupId) =>
              supabase
                .rpc("cx_ensure_group_thread", { p_group_id: groupId, p_actor: user.id })
                .then(() => null, () => null)
            ),
          ]);
        }

        const threadsRes = await supabase
          .from("threads")
          .select("id,thread_type,connection_id,trip_id,event_id,group_id,direct_user_low,direct_user_high,last_message_at,created_at")
          .in("thread_type", ["connection", "trip", "direct", "event", "group"])
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(500);

        const threadsRelationMissing =
          Boolean(threadsRes.error) &&
          (threadsRes.error?.message.toLowerCase().includes("relation") ||
            threadsRes.error?.message.toLowerCase().includes("does not exist") ||
            threadsRes.error?.message.toLowerCase().includes("schema cache") ||
            threadsRes.error?.message.toLowerCase().includes("could not find the table"));

        let mergedThreads: ThreadRow[] = [];

        if (!threadsRes.error && Array.isArray(threadsRes.data) && threadsRes.data.length > 0) {
          const threadRows = (threadsRes.data ?? []) as ThreadDbRow[];
          const threadIds = threadRows.map((row) => row.id ?? "").filter(Boolean);
          const connectionThreadIds = Array.from(
            new Set(threadRows.filter((row) => row.thread_type === "connection").map((row) => row.connection_id ?? "").filter(Boolean))
          );
          const tripThreadIds = Array.from(
            new Set(threadRows.filter((row) => row.thread_type === "trip").map((row) => row.trip_id ?? "").filter(Boolean))
          );
          const eventThreadIds = Array.from(
            new Set(threadRows.filter((row) => row.thread_type === "event").map((row) => row.event_id ?? "").filter(Boolean))
          );
          const groupThreadIds = Array.from(
            new Set(threadRows.filter((row) => row.thread_type === "group").map((row) => row.group_id ?? "").filter(Boolean))
          );
          const directCounterpartIds = Array.from(
            new Set(
              threadRows
                .filter((row) => row.thread_type === "direct")
                .flatMap((row) => [row.direct_user_low ?? "", row.direct_user_high ?? ""])
                .filter((id) => id && id !== user.id)
            )
          );
          const threadOtherUserIds = Array.from(
            new Set(
              [...otherUserIds, ...connectionThreadIds, ...directCounterpartIds]
                .map((connectionId) => connectionsById[connectionId]?.other_user_id ?? "")
                .concat(directCounterpartIds)
                .filter((value): value is string => Boolean(value))
            )
          );
          const allTripIds = Array.from(new Set([...tripIds, ...tripThreadIds, ...acceptedTripIds]));

          const [profilesRes, tripsRes, eventsRes, groupsRes, threadMessagesRes, threadParticipantsRes, threadContextsRes, threadParticipantsAllRes] = await Promise.all([
            threadOtherUserIds.length
              ? supabase
                  .from("profiles")
                  .select("user_id,display_name,avatar_url,city,country")
                  .in("user_id", threadOtherUserIds)
              : Promise.resolve({ data: [], error: null }),
            allTripIds.length
              ? supabase
                  .from("trips")
                  .select("id,destination_city,destination_country,start_date,end_date")
                  .in("id", allTripIds)
              : Promise.resolve({ data: [], error: null }),
            eventThreadIds.length
              ? supabase
                  .from("events")
                  .select("*")
                  .in("id", eventThreadIds)
              : Promise.resolve({ data: [], error: null }),
            groupThreadIds.length
              ? supabase
                  .from("groups")
                  .select("id,host_user_id,title,description,chat_mode,city,country,cover_url,cover_status,max_members,invite_token,status,created_at,updated_at")
                  .in("id", groupThreadIds)
              : Promise.resolve({ data: [], error: null }),
            threadIds.length
              ? supabase
                  .from("thread_messages")
                  .select("id,thread_id,sender_id,body,created_at,message_type")
                  .in("thread_id", threadIds)
                  .order("created_at", { ascending: false })
                  .limit(1000)
              : Promise.resolve({ data: [], error: null }),
            threadIds.length
              ? supabase
                  .from("thread_participants")
                  .select("thread_id,last_read_at,archived_at,muted_until,pinned_at,messaging_state,activated_at,activation_cycle_start,activation_cycle_end")
                  .eq("user_id", user.id)
                  .in("thread_id", threadIds)
              : Promise.resolve({ data: [], error: null }),
            threadIds.length
              ? supabase
                  .from("thread_contexts")
                  .select("id,thread_id,source_table,source_id,context_tag,status_tag,title,city,start_date,end_date,requester_id,recipient_id,metadata,created_at,updated_at")
                  .in("thread_id", threadIds)
                  .order("updated_at", { ascending: false })
                  .limit(1500)
              : Promise.resolve({ data: [], error: null }),
            threadIds.length
              ? supabase
                  .from("thread_participants")
                  .select("thread_id,user_id")
                  .in("thread_id", threadIds)
              : Promise.resolve({ data: [], error: null }),
          ]);

          const profilesById: Record<string, { displayName: string; avatarUrl: string | null; city: string; country: string }> = {};
          ((profilesRes.data ?? []) as ProfileRow[]).forEach((row) => {
            const key = row.user_id ?? "";
            if (!key) return;
            profilesById[key] = {
              displayName: row.display_name ?? "Unknown",
              avatarUrl: row.avatar_url ?? null,
              city: row.city ?? "",
              country: row.country ?? "",
            };
          });
          setComposeConnectionTargets(
            buildComposeTargets(
              visibleConnections.map((row) => ({
                id: row.id,
                other_user_id: row.other_user_id,
                trip_id: row.trip_id ?? null,
                connect_context: row.connect_context ?? null,
              })),
              profilesById
            )
          );

          const tripsById: Record<string, TripRow> = {};
          ((tripsRes.data ?? []) as TripRow[]).forEach((row) => {
            const key = row.id ?? "";
            if (!key) return;
            tripsById[key] = row;
          });
          const eventsById: Record<
            string,
            { title: string; city: string; country: string; startsAt: string | null; coverUrl: string | null; eventType: string; description: string | null }
          > = {};
          mapEventRows((eventsRes.data ?? []) as unknown[]).forEach((row) => {
            eventsById[row.id] = {
              title: row.title,
              city: row.city ?? "",
              country: row.country ?? "",
              startsAt: row.startsAt,
              coverUrl: pickEventHeroUrl(row) || pickEventFallbackHeroUrl(row) || null,
              eventType: row.eventType,
              description: row.description ?? null,
            };
          });
          const groupsById: Record<string, ActiveGroupThreadRecord> = {};
          mapGroupRows((groupsRes.data ?? []) as unknown[]).forEach((row) => {
            groupsById[row.id] = {
              ...row,
              isHost: row.hostUserId === user.id,
            };
          });
          setComposeTripTargets(buildTripComposeTargets(acceptedTripIds, tripsById, acceptedTripUpdatedAtById));

          const lastByThread: Record<string, { body: string; senderId: string; createdAt: string }> = {};
          const threadMessagesByThread: Record<string, Array<{ senderId: string; createdAt: string }>> = {};
          ((threadMessagesRes.data ?? []) as ThreadMessageDbRow[]).forEach((row) => {
            const key = row.thread_id ?? "";
            if (!key) return;
            const messageType = normalizeMessageType(typeof row.message_type === "string" ? row.message_type : null);
            if (messageType !== "text") return;
            if (!lastByThread[key]) {
              const parsedBody = parseReplyPayload(row.body ?? "");
              lastByThread[key] = {
                body: parsedBody.text,
                senderId: row.sender_id ?? "",
                createdAt: row.created_at ?? "",
              };
            }
            if (!threadMessagesByThread[key]) threadMessagesByThread[key] = [];
            threadMessagesByThread[key].push({
              senderId: row.sender_id ?? "",
              createdAt: row.created_at ?? "",
            });
          });

          const lastReadByThread: Record<string, string> = {};
          const messagingStateByThread: Record<
            string,
            { messagingState: MessagingState; activatedAt: string | null; activationCycleStart: string | null; activationCycleEnd: string | null }
          > = {};
          const participantUserIdsByThread: Record<string, string[]> = {};
          const archivedByToken: Record<string, true> = {};
          const mutedUntilByToken: Record<string, string> = {};
          const pinnedByToken: Record<string, true> = {};
          const tokenByDbThreadId: Record<string, string> = {};
          threadRows.forEach((row) => {
            const dbThreadId = row.id ?? "";
            if (!dbThreadId) return;
            if (row.thread_type === "connection" && row.connection_id) {
              tokenByDbThreadId[dbThreadId] = `conn:${row.connection_id}`;
              return;
            }
            if (row.thread_type === "trip" && row.trip_id) {
              tokenByDbThreadId[dbThreadId] = `trip:${row.trip_id}`;
              return;
            }
            if (row.thread_type === "direct") {
              tokenByDbThreadId[dbThreadId] = `direct:${dbThreadId}`;
              return;
            }
            if (row.thread_type === "event" && row.event_id) {
              tokenByDbThreadId[dbThreadId] = `event:${row.event_id}`;
              return;
            }
            if (row.thread_type === "group" && row.group_id) {
              tokenByDbThreadId[dbThreadId] = `group:${row.group_id}`;
            }
          });

          ((threadParticipantsAllRes.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
            const threadId = typeof row.thread_id === "string" ? row.thread_id : "";
            const participantId = typeof row.user_id === "string" ? row.user_id : "";
            if (!threadId || !participantId) return;
            if (!participantUserIdsByThread[threadId]) participantUserIdsByThread[threadId] = [];
            participantUserIdsByThread[threadId].push(participantId);
          });

          ((threadParticipantsRes.data ?? []) as ThreadParticipantDbRow[]).forEach((row) => {
            const threadId = row.thread_id ?? "";
            const lastReadAt = row.last_read_at ?? "";
            if (threadId) lastReadByThread[threadId] = lastReadAt;

            if (threadId) {
              messagingStateByThread[threadId] = {
                messagingState: normalizeMessagingState(row.messaging_state, row.archived_at ? "archived" : "inactive"),
                activatedAt: row.activated_at ?? null,
                activationCycleStart: row.activation_cycle_start ?? null,
                activationCycleEnd: row.activation_cycle_end ?? null,
              };
            }

            const token = tokenByDbThreadId[threadId] ?? "";
            if (!token) return;
            const archivedAt = row.archived_at ?? "";
            const mutedUntil = row.muted_until ?? "";
            const pinnedAt = row.pinned_at ?? "";
            if (archivedAt) archivedByToken[token] = true;
            if (mutedUntil && toTime(mutedUntil) > Date.now()) mutedUntilByToken[token] = mutedUntil;
            if (pinnedAt) pinnedByToken[token] = true;
          });

          archivedFromDb = archivedByToken;
          mutedFromDb = mutedUntilByToken;
          pinnedFromDb = pinnedByToken;

          const contextsByThread: Record<string, ThreadContextItem[]> = {};
          if (!threadContextsRes.error) {
            ((threadContextsRes.data ?? []) as ThreadContextRow[]).forEach((row) => {
              const normalized = normalizeThreadContextRow(row);
              if (!normalized) return;
              if (!contextsByThread[normalized.threadId]) contextsByThread[normalized.threadId] = [];
              contextsByThread[normalized.threadId].push(normalized);
            });
          }
          localContextsByThreadId = contextsByThread;

          const unreadCountByThread: Record<string, number> = {};
          Object.entries(threadMessagesByThread).forEach(([threadId, rows]) => {
            const lastReadAt = lastReadByThread[threadId];
            const lastReadTime = lastReadAt ? Date.parse(lastReadAt) : 0;
            const count = rows.filter((row) => {
              if (!row.createdAt) return false;
              if (row.senderId === user.id) return false;
              const createdAtTime = Date.parse(row.createdAt);
              if (!Number.isFinite(createdAtTime)) return false;
              return createdAtTime > lastReadTime;
            }).length;
            unreadCountByThread[threadId] = count;
          });

          const mappedFromThreadsUnfiltered: Array<ThreadRow | null> = threadRows
            .map((row) => {
              const threadId = row.id ?? "";
              if (!threadId) return null;
              const last = lastByThread[threadId];
              const updatedAt = last?.createdAt || row.last_message_at || row.created_at || new Date().toISOString();

              if (row.thread_type === "connection") {
                const connectionId = row.connection_id ?? "";
                const connection = connectionsById[connectionId];
                if (!connection) return null;
                const other = profilesById[connection.other_user_id];
                const participantState = messagingStateByThread[threadId];
                return {
                  threadId: `conn:${connection.id}`,
                  dbThreadId: threadId,
                  kind: "connection",
                  title: other?.displayName ?? "Connection",
                  subtitle: [other?.city ?? "", other?.country ?? ""].filter(Boolean).join(", ") || "Connection",
                  avatarUrl: other?.avatarUrl ?? null,
                  preview: last?.body || "No messages yet.",
                  updatedAt,
                  unreadCount: unreadCountByThread[threadId] ?? (last && last.senderId !== user.id ? 1 : 0),
                  badge: "Connection",
                  otherUserId: connection.other_user_id,
                  eventId: null,
                  groupId: null,
                  messagingState: participantState?.messagingState ?? "inactive",
                  activatedAt: participantState?.activatedAt ?? null,
                  activationCycleStart: participantState?.activationCycleStart ?? null,
                  activationCycleEnd: participantState?.activationCycleEnd ?? null,
                } satisfies ThreadRow;
              }

              if (row.thread_type === "trip") {
                const id = row.trip_id ?? "";
                if (!id) return null;
                const trip = tripsById[id];
                const participantState = messagingStateByThread[threadId];
                return {
                  threadId: `trip:${id}`,
                  dbThreadId: threadId,
                  kind: "trip",
                  title: trip?.destination_city ? `Trip to ${trip.destination_city}` : "Trip chat",
                  subtitle: parseTripLabel(trip ?? null),
                  avatarUrl: null,
                  preview: last?.body || "Trip thread",
                  updatedAt,
                  unreadCount: unreadCountByThread[threadId] ?? (last && last.senderId !== user.id ? 1 : 0),
                  badge: "Trip",
                  otherUserId: null,
                  eventId: null,
                  groupId: null,
                  messagingState: participantState?.messagingState ?? "inactive",
                  activatedAt: participantState?.activatedAt ?? null,
                  activationCycleStart: participantState?.activationCycleStart ?? null,
                  activationCycleEnd: participantState?.activationCycleEnd ?? null,
                } satisfies ThreadRow;
              }
              if (row.thread_type === "direct") {
                const participantIds = (participantUserIdsByThread[threadId] ?? []).filter((id) => id !== user.id);
                const otherUserId = participantIds[0] ?? "";
                const other = profilesById[otherUserId];
                const participantState = messagingStateByThread[threadId];
                return {
                  threadId: `direct:${threadId}`,
                  dbThreadId: threadId,
                  kind: "direct",
                  title: other?.displayName ?? "Direct chat",
                  subtitle: [other?.city ?? "", other?.country ?? ""].filter(Boolean).join(", ") || "Member chat",
                  avatarUrl: other?.avatarUrl ?? null,
                  preview: last?.body || "",
                  updatedAt,
                  unreadCount: unreadCountByThread[threadId] ?? (last && last.senderId !== user.id ? 1 : 0),
                  badge: "Chat",
                  otherUserId,
                  eventId: null,
                  groupId: null,
                  messagingState: participantState?.messagingState ?? "inactive",
                  activatedAt: participantState?.activatedAt ?? null,
                  activationCycleStart: participantState?.activationCycleStart ?? null,
                  activationCycleEnd: participantState?.activationCycleEnd ?? null,
                } satisfies ThreadRow;
              }
              if (row.thread_type === "event") {
                const eventId = row.event_id ?? "";
                const event = eventsById[eventId];
                const location = [event?.city ?? "", event?.country ?? ""].filter(Boolean).join(", ");
                const date = event?.startsAt ? formatDateShort(event.startsAt) : "";
                const participantState = messagingStateByThread[threadId];
                return {
                  threadId: `event:${eventId}`,
                  dbThreadId: threadId,
                  kind: "event",
                  title: event?.title || "Event",
                  subtitle: [location, date].filter(Boolean).join(" • ") || "Event",
                  avatarUrl: event?.coverUrl ?? null,
                  preview: last?.body || [event?.eventType ?? "", location, date].filter(Boolean).join(" • ") || "No messages yet.",
                  updatedAt,
                  unreadCount: unreadCountByThread[threadId] ?? (last && last.senderId !== user.id ? 1 : 0),
                  badge: "Event",
                  otherUserId: null,
                  eventId,
                  groupId: null,
                  messagingState: participantState?.messagingState ?? "inactive",
                  activatedAt: participantState?.activatedAt ?? null,
                  activationCycleStart: participantState?.activationCycleStart ?? null,
                  activationCycleEnd: participantState?.activationCycleEnd ?? null,
                } satisfies ThreadRow;
              }
              if (row.thread_type === "group") {
                const groupId = row.group_id ?? "";
                const group = groupsById[groupId];
                const location = [group?.city ?? "", group?.country ?? ""].filter(Boolean).join(", ");
                const participantState = messagingStateByThread[threadId];
                return {
                  threadId: `group:${groupId}`,
                  dbThreadId: threadId,
                  kind: "group",
                  title: group?.title || "Group",
                  subtitle: location || "Private Group",
                  avatarUrl: group?.coverUrl ?? null,
                  preview: last?.body || group?.description || location || "No messages yet.",
                  updatedAt,
                  unreadCount: unreadCountByThread[threadId] ?? (last && last.senderId !== user.id ? 1 : 0),
                  badge: "Group",
                  otherUserId: null,
                  eventId: null,
                  groupId,
                  messagingState: participantState?.messagingState ?? "inactive",
                  activatedAt: participantState?.activatedAt ?? null,
                  activationCycleStart: participantState?.activationCycleStart ?? null,
                  activationCycleEnd: participantState?.activationCycleEnd ?? null,
                } satisfies ThreadRow;
              }
              return null;
            });

          const mappedFromThreads: ThreadRow[] = mappedFromThreadsUnfiltered
            .filter((row): row is ThreadRow => row !== null)
            .map((row) => enrichThreadWithContext(row, contextsByThread[row.dbThreadId ?? ""] ?? []))
            .filter(shouldIncludeInboxThread)
            .sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt));

          mergedThreads = collapseDuplicateInboxThreads(
            mappedFromThreads
            .map((thread) => enrichThreadWithContext(thread, thread.dbThreadId ? localContextsByThreadId[thread.dbThreadId] ?? [] : []))
            .filter(shouldIncludeInboxThread)
            .sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt))
          );
        } else if (threadsRes.error && !threadsRelationMissing) {
          throw new Error(threadsRes.error.message);
        }

        if (mergedThreads.length === 0) {
          const fallbackConnectionRows = allConnections.filter(
            (row) => row.is_visible_in_messages || row.is_incoming_pending || row.is_outgoing_pending
          );

          if (fallbackConnectionRows.length > 0 || acceptedTripIds.length > 0) {
            const fallbackOtherUserIds = Array.from(
              new Set(fallbackConnectionRows.map((row) => row.other_user_id).filter(Boolean))
            );
            const fallbackTripIds = Array.from(
              new Set([...acceptedTripIds, ...fallbackConnectionRows.map((row) => row.trip_id ?? "").filter(Boolean)])
            );
            const fallbackConnectionIds = fallbackConnectionRows.map((row) => row.id).filter(Boolean);

            const [fallbackProfilesRes, fallbackTripsRes, fallbackMessagesRes] = await Promise.all([
              fallbackOtherUserIds.length
                ? supabase
                    .from("profiles")
                    .select("user_id,display_name,avatar_url,city,country")
                    .in("user_id", fallbackOtherUserIds)
                : Promise.resolve({ data: [], error: null }),
              fallbackTripIds.length
                ? supabase
                    .from("trips")
                    .select("id,destination_city,destination_country,start_date,end_date")
                    .in("id", fallbackTripIds)
                : Promise.resolve({ data: [], error: null }),
              fallbackConnectionIds.length
                ? supabase
                    .from("messages")
                    .select("connection_id,sender_id,body,created_at")
                    .in("connection_id", fallbackConnectionIds)
                    .order("created_at", { ascending: false })
                    .limit(2000)
                : Promise.resolve({ data: [], error: null }),
            ]);

            const fallbackProfilesById: Record<
              string,
              { displayName: string; avatarUrl: string | null; city: string; country: string }
            > = {};
            ((fallbackProfilesRes.data ?? []) as ProfileRow[]).forEach((row) => {
              const key = row.user_id ?? "";
              if (!key) return;
              fallbackProfilesById[key] = {
                displayName: row.display_name ?? "Connection",
                avatarUrl: row.avatar_url ?? null,
                city: row.city ?? "",
                country: row.country ?? "",
              };
            });

            const fallbackTripsById: Record<string, TripRow> = {};
            ((fallbackTripsRes.data ?? []) as TripRow[]).forEach((row) => {
              const key = row.id ?? "";
              if (!key) return;
              fallbackTripsById[key] = row;
            });

            const latestMessageByConnection: Record<string, { body: string; senderId: string; createdAt: string }> = {};
            ((fallbackMessagesRes.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
              const connectionId = typeof row.connection_id === "string" ? row.connection_id : "";
              if (!connectionId || latestMessageByConnection[connectionId]) return;
              latestMessageByConnection[connectionId] = {
                body: typeof row.body === "string" ? row.body : "",
                senderId: typeof row.sender_id === "string" ? row.sender_id : "",
                createdAt: typeof row.created_at === "string" ? row.created_at : "",
              };
            });

            const mapConnectionStatus = (value: string): ThreadStatusTag => {
              const normalized = value.trim().toLowerCase();
              if (normalized === "pending") return "pending";
              if (normalized === "accepted") return "accepted";
              if (normalized === "declined") return "declined";
              if (normalized === "cancelled") return "cancelled";
              return "active";
            };

            const fallbackConnections: ThreadRow[] = fallbackConnectionRows.map((row) => {
              const profile = fallbackProfilesById[row.other_user_id];
              const latest = latestMessageByConnection[row.id];
              const statusTag = mapConnectionStatus(row.status ?? "");
              const contextTag: ThreadContextTag = statusTag === "active" ? "regular_chat" : "connection_request";
              return {
                threadId: `conn:${row.id}`,
                dbThreadId: null,
                kind: "connection",
                contextTag,
                statusTag,
                hasPendingRequest: statusTag === "pending",
                title: profile?.displayName ?? "Connection",
                metaLabel: "",
                subtitle: [profile?.city ?? "", profile?.country ?? ""].filter(Boolean).join(", ") || "Connection",
                avatarUrl: profile?.avatarUrl ?? null,
                preview: latest?.body
                  ? parseReplyPayload(latest.body).text
                  : statusTag === "pending"
                  ? row.is_incoming_pending
                    ? "Request pending. Open to respond."
                    : "Awaiting response."
                  : statusTag === "declined"
                  ? "Request declined."
                  : statusTag === "cancelled"
                  ? "Request cancelled."
                  : "No messages yet.",
                updatedAt: latest?.createdAt || row.created_at || new Date().toISOString(),
                unreadCount: latest && latest.senderId && latest.senderId !== user.id ? 1 : 0,
                badge: "Connection",
                otherUserId: row.other_user_id,
                eventId: null,
                groupId: null,
              } satisfies ThreadRow;
            });

            const fallbackTrips: ThreadRow[] = acceptedTripIds.map((tripId) => {
              const trip = fallbackTripsById[tripId];
              return {
                threadId: `trip:${tripId}`,
                dbThreadId: null,
                kind: "trip",
                contextTag: "trip_join_request",
                statusTag: "active",
                hasPendingRequest: false,
                metaLabel: "",
                title: trip?.destination_city ? `Trip to ${trip.destination_city}` : "Trip chat",
                subtitle: parseTripLabel(trip ?? null),
                avatarUrl: null,
                preview: "Trip thread",
                updatedAt: acceptedTripUpdatedAtById[tripId] || trip?.start_date || new Date().toISOString(),
                unreadCount: 0,
                badge: "Trip",
                otherUserId: null,
                eventId: null,
                groupId: null,
              } satisfies ThreadRow;
            });

            mergedThreads = collapseDuplicateInboxThreads(
              [...fallbackConnections, ...fallbackTrips].sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt))
            );
          }
        }

        if (!cancelled) {
          setArchivedThreads((prev) => ({ ...prev, ...archivedFromDb }));
          setMutedUntilByThread((prev) => {
            const merged = { ...prev, ...mutedFromDb };
            const now = Date.now();
            return Object.fromEntries(Object.entries(merged).filter(([, until]) => toTime(until) > now));
          });
          setPinnedThreads((prev) => ({ ...prev, ...pinnedFromDb }));
          setThreadContextsByDbId(localContextsByThreadId);
          setThreads(mergedThreads);
          setActiveThreadToken((prev) => {
            const validPrev = prev && mergedThreads.some((row) => row.threadId === prev);
            if (validPrev) return prev;
            return mergedThreads[0]?.threadId ?? null;
          });
          setThreadsHydrated(true);
          setLoading(false);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load inbox.");
          setThreads([]);
          setThreadContextsByDbId({});
          setComposeConnectionTargets([]);
          setComposeTripTargets([]);
          setThreadsHydrated(true);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadTick, router]);

  useEffect(() => {
    if (!requestedThreadToken) return;
    const parsed = parseThreadToken(requestedThreadToken);
    const knownThread = threads.some((thread) => thread.threadId === requestedThreadToken);
    if (!knownThread && !parsed) return;
    if (parsed && !searchParams.get("kind")) {
      setKindFilter((prev) => {
        const nextKind = normalizeThreadKindFilter(parsed.kind);
        return prev === nextKind ? prev : nextKind;
      });
    }
    setActiveThreadToken((prev) => (prev === requestedThreadToken ? prev : requestedThreadToken));
  }, [requestedThreadToken, searchParams, threads]);

  useEffect(() => {
    const requestedTab = parseFilterTab(searchParams.get("tab"));
    const nextTab = requestedTab ?? "all";
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [searchParams]);

  useEffect(() => {
    const requestedKind = parseInboxKindFilter(searchParams.get("kind"));
    const nextKind = requestedKind ?? "all";
    setKindFilter((prev) => (prev === nextKind ? prev : nextKind));
  }, [searchParams]);

  const selectFilterTab = useCallback(
    (tab: FilterTab) => {
      setActiveTab(tab);
      setInboxFilterMenuOpen(false);
      router.replace(buildInboxUrl({ tab }), { scroll: false });
    },
    [buildInboxUrl, router]
  );

  const selectKindFilter = useCallback(
    (kind: InboxKindFilter) => {
      setKindFilter(kind);
      setInboxFilterMenuOpen(false);
      const nextTab = normalizeInboxTabForKind(kind, activeTab === "archived" ? "all" : activeTab);
      setActiveTab(nextTab);
      router.replace(buildInboxUrl({ kind, tab: nextTab }), { scroll: false });
    },
    [activeTab, buildInboxUrl, router]
  );

  const selectArchivedFilter = useCallback(() => {
    setInboxFilterMenuOpen(false);
    setActiveTab("archived");
    router.replace(buildInboxUrl({ tab: "archived" }), { scroll: false });
  }, [buildInboxUrl, router]);

  const mobileThreadOpen = Boolean(requestedThreadToken);

  useEffect(() => {
    if (!meId || !activeThreadToken) {
      setActiveMeta(null);
      setContactSidebar(null);
      setContactSidebarError(null);
      setChatBookingOpen(false);
      setChatBookingAvailable(false);
      setActiveMessages([]);
      setConnectionEventsFeed([]);
      setConnectionEventsFeedLoading(false);
      setFeedLightboxUrl(null);
      setThreadError(null);
      setActiveLastReadAt(null);
      setActivePeerLastReadAt(null);
      setActiveFallbackContext(null);
      setOpenMessageMenuId(null);
      setOpenThreadRowMenuId(null);
      setThreadActionsOpen(false);
      setReplyTo(null);
      setHighlightedMessageId(null);
      setComposerEmojiOpen(false);
      setThreadBody("");
      setMessageReactions({});
      return;
    }
    setOpenMessageMenuId(null);
    setOpenThreadRowMenuId(null);
    setThreadActionsOpen(false);
    setChatBookingOpen(false);
    setReplyTo(null);
    setHighlightedMessageId(null);
    setComposerEmojiOpen(false);
    setThreadBody(threadDraftsRef.current[activeThreadToken] ?? "");
    void loadThreadByToken(activeThreadToken, meId);
  }, [activeThreadToken, loadThreadByToken, meId, reloadTick]);

  useEffect(() => {
    let cancelled = false;
    const targetUserId = activeMeta?.otherUserId;
    if (!targetUserId) {
      setContactSidebar(null);
      setContactSidebarError(null);
      setContactSidebarLoading(false);
      return;
    }

    setContactSidebarLoading(true);
    setContactSidebar(null);
    setContactSidebarError(null);

    (async () => {
      try {
        const fullProfileRes = await supabase
          .from("profiles")
          .select(
            [
              "user_id",
              "display_name",
              "avatar_url",
              "city",
              "country",
              "roles",
              "languages",
              "dance_styles",
              "dance_skills",
              "interests",
              "availability",
              "verified",
              "verified_label",
              "connections_count",
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
            ].join(",")
          )
          .eq("user_id", targetUserId)
          .maybeSingle();

        let profileRecord: Record<string, unknown> | null = null;
        if (fullProfileRes.error) {
          if (!isSchemaMissingMessage(fullProfileRes.error.message)) {
            throw new Error(fullProfileRes.error.message);
          }
          const fallbackProfileRes = await supabase
            .from("profiles")
            .select(
              [
                "user_id",
                "display_name",
                "avatar_url",
                "city",
                "country",
                "roles",
                "languages",
                "dance_styles",
                "dance_skills",
                "interests",
                "availability",
                "verified",
                "verified_label",
                "connections_count",
              ].join(",")
            )
            .eq("user_id", targetUserId)
            .maybeSingle();
          if (fallbackProfileRes.error) throw new Error(fallbackProfileRes.error.message);
          profileRecord = fallbackProfileRes.data ? asRecord(fallbackProfileRes.data) : null;
        } else {
          profileRecord = fullProfileRes.data ? asRecord(fullProfileRes.data) : null;
        }

        if (!profileRecord) throw new Error("Member profile not found.");

        const fetchReferenceRowsForRecipient = async (columns: Array<"recipient_id" | "to_user_id" | "target_id">) => {
          const merged: Array<Record<string, unknown>> = [];
          const seen = new Set<string>();
          for (const column of columns) {
            const res = await supabase
              .from("references")
              .select(`id,sentiment,rating,context_tag,entity_type,context,${column}`)
              .eq(column, targetUserId)
              .limit(800);
            if (res.error) {
              if (isSchemaMissingMessage(res.error.message)) continue;
              throw new Error(res.error.message);
            }
            for (const row of (res.data ?? []) as Array<Record<string, unknown>>) {
              const id = asString(row.id);
              if (!id || seen.has(id)) continue;
              seen.add(id);
              merged.push(row);
            }
          }
          return merged;
        };

        const [refsRows, tripsJoinedRes, hostingRes, mediaItems] = await Promise.all([
          fetchReferenceRowsForRecipient(["recipient_id", "to_user_id", "target_id"]),
          supabase.from("trip_requests").select("id", { count: "exact", head: true }).eq("requester_id", targetUserId).eq("status", "accepted"),
          supabase
            .from("hosting_requests")
            .select("id", { count: "exact", head: true })
            .eq("status", "accepted")
            .or(
              `and(request_type.eq.request_hosting,recipient_user_id.eq.${targetUserId}),and(request_type.eq.offer_to_host,sender_user_id.eq.${targetUserId})`
            ),
          fetchProfileMedia(supabase, { userId: targetUserId }).catch(() => [] as ProfileMediaItem[]),
        ]);
        const referencesByContext: Record<ReferenceContextTag, number> = emptyReferenceContextCounts();
        let referencesTotal = 0;
        let referencesPositive = 0;

        refsRows.forEach((row) => {
          referencesTotal += 1;
          const sentimentRaw = asString(row.sentiment ?? row.rating).toLowerCase();
          if (sentimentRaw === "positive" || sentimentRaw === "4" || sentimentRaw === "5") {
            referencesPositive += 1;
          }
          const ctxRaw = asString(row.context_tag ?? row.entity_type ?? row.context ?? "collaborate");
          const context = normalizeReferenceContext(ctxRaw);
          referencesByContext[context] += 1;
        });

        let tripsJoinedAccepted = 0;
        if (!tripsJoinedRes.error) {
          tripsJoinedAccepted = tripsJoinedRes.count ?? 0;
        } else if (!isSchemaMissingMessage(tripsJoinedRes.error.message)) {
          throw new Error(tripsJoinedRes.error.message);
        }

        let hostingAccepted = 0;
        if (!hostingRes.error) {
          hostingAccepted = hostingRes.count ?? 0;
        } else if (!isSchemaMissingMessage(hostingRes.error.message)) {
          throw new Error(hostingRes.error.message);
        }

        if (cancelled) return;

        setContactSidebar({
          userId: targetUserId,
          displayName: asString(profileRecord.display_name || "Member") || "Member",
          avatarUrl: typeof profileRecord.avatar_url === "string" ? profileRecord.avatar_url : null,
          city: asString(profileRecord.city),
          country: asString(profileRecord.country),
          roles: asStringArrayLoose(profileRecord.roles),
          danceStyles: parseDanceStyleKeys(profileRecord.dance_skills, profileRecord.dance_styles),
          interests: asStringArrayLoose(profileRecord.interests),
          availability: asStringArrayLoose(profileRecord.availability),
          languages: asStringArrayLoose(profileRecord.languages),
          referencesTotal,
          referencesPositive,
          referencesByContext,
          tripsJoinedAccepted,
          hostingAccepted,
          connectionsCount:
            typeof profileRecord.connections_count === "number" && Number.isFinite(profileRecord.connections_count)
              ? profileRecord.connections_count
              : 0,
          canHost: profileRecord.can_host === true,
          hostingStatus:
            typeof profileRecord.hosting_status === "string" && profileRecord.hosting_status.trim().length > 0
              ? profileRecord.hosting_status
              : "inactive",
          maxGuests:
            typeof profileRecord.max_guests === "number" && Number.isFinite(profileRecord.max_guests)
              ? profileRecord.max_guests
              : null,
          hostingLastMinuteOk: profileRecord.hosting_last_minute_ok === true,
          hostingPreferredGuestGender: normalizeHostingPreferredGuestGender(profileRecord.hosting_preferred_guest_gender),
          hostingKidFriendly: profileRecord.hosting_kid_friendly === true,
          hostingPetFriendly: profileRecord.hosting_pet_friendly === true,
          hostingSmokingAllowed: profileRecord.hosting_smoking_allowed === true,
          hostingSleepingArrangement: normalizeHostingSleepingArrangement(profileRecord.hosting_sleeping_arrangement),
          hostingGuestShare:
            typeof profileRecord.hosting_guest_share === "string" && profileRecord.hosting_guest_share.trim().length > 0
              ? profileRecord.hosting_guest_share
              : null,
          hostingTransitAccess:
            typeof profileRecord.hosting_transit_access === "string" && profileRecord.hosting_transit_access.trim().length > 0
              ? profileRecord.hosting_transit_access
              : null,
          verified: profileRecord.verified === true,
          verifiedLabel:
            typeof profileRecord.verified_label === "string" && profileRecord.verified_label.trim().length > 0
              ? profileRecord.verified_label
              : null,
          mediaItems,
        });
      } catch (e: unknown) {
        if (cancelled) return;
        setContactSidebar(null);
        setContactSidebarError(e instanceof Error ? e.message : "Failed to load member details.");
      } finally {
        if (!cancelled) setContactSidebarLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeMeta?.otherUserId]);

  useEffect(() => {
    let cancelled = false;
    const targetUserId = activeMeta?.otherUserId;
    const roles = contactSidebar?.roles ?? [];

    if (!targetUserId || targetUserId === meId || !contactSidebar || !hasTeacherBadgeRole(roles)) {
      setChatBookingAvailable(false);
      return;
    }

    (async () => {
      try {
        const [teacherProfileRes, availabilityRes] = await Promise.all([
          supabase
            .from("teacher_profiles")
            .select("teacher_profile_enabled,is_public,teacher_profile_trial_ends_at")
            .eq("user_id", targetUserId)
            .maybeSingle(),
          supabase
            .from("teacher_session_availability")
            .select("id", { count: "exact", head: true })
            .eq("teacher_id", targetUserId)
            .eq("is_available", true)
            .gte("availability_date", new Date().toISOString().slice(0, 10)),
        ]);

        if (teacherProfileRes.error) throw new Error(teacherProfileRes.error.message);

        const teacherProfile = teacherProfileRes.data as {
          teacher_profile_enabled?: boolean;
          teacher_profile_trial_ends_at?: string | null;
          is_public?: boolean;
        } | null;

        const canBook = Boolean(
          teacherProfile?.is_public === true &&
            !availabilityRes.error &&
            (availabilityRes.count ?? 0) > 0 &&
            canUseTeacherProfile({
              roles,
              teacherProfileEnabled: teacherProfile?.teacher_profile_enabled === true,
              trialEndsAt:
                typeof teacherProfile?.teacher_profile_trial_ends_at === "string"
                  ? teacherProfile.teacher_profile_trial_ends_at
                  : null,
              isVerified: isPaymentVerified({
                verified: contactSidebar.verified,
                verified_label: contactSidebar.verifiedLabel,
              }),
            })
        );

        if (!cancelled) setChatBookingAvailable(canBook);
      } catch {
        if (!cancelled) setChatBookingAvailable(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeMeta?.otherUserId, contactSidebar, meId]);

  useEffect(() => {
    let cancelled = false;
    const targetUserId = activeMeta?.otherUserId;
    if (!meId || !targetUserId) {
      setActiveReferencePrompt(null);
      setSubmittedReferenceState({ contextTags: new Set<ReferenceContextTag>(), latestSubmittedAt: null });
      return;
    }

    (async () => {
      try {
        const accessToken = await resolveAccessToken();

        const syncRes = await fetch("/api/references/prompts/sync", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const syncPayload = (await syncRes.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!syncRes.ok || !syncPayload?.ok) {
          const errorMessage = syncPayload?.error ?? "Failed to sync reference prompts.";
          if (!isSchemaMissingMessage(errorMessage)) {
            throw new Error(errorMessage);
          }
        }

        const nowIso = new Date().toISOString();
        const [promptRes, authoredRefsRes] = await Promise.all([
          supabase
            .from("reference_requests")
            .select("id,peer_user_id,context_tag,source_table,source_id,due_at,expires_at,status")
            .eq("user_id", meId)
            .eq("peer_user_id", targetUserId)
            .eq("status", "pending")
            .lte("due_at", nowIso)
            .gte("expires_at", nowIso)
            .order("due_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("references")
            .select("id,created_at,context_tag,context,entity_type")
            .eq("author_id", meId)
            .eq("recipient_id", targetUserId)
            .order("created_at", { ascending: false })
            .limit(100),
        ]);

        if (promptRes.error) {
          if (isSchemaMissingMessage(promptRes.error.message)) {
            if (!cancelled) {
              setActiveReferencePrompt(null);
              setSubmittedReferenceState({ contextTags: new Set<ReferenceContextTag>(), latestSubmittedAt: null });
            }
            return;
          }
          throw new Error(promptRes.error.message);
        }

        if (authoredRefsRes.error && !isSchemaMissingMessage(authoredRefsRes.error.message)) {
          throw new Error(authoredRefsRes.error.message);
        }

        const submittedTags = new Set<ReferenceContextTag>();
        let latestSubmittedAt: string | null = null;
        for (const rawRow of ((authoredRefsRes.data ?? []) as Array<Record<string, unknown>>)) {
          const row = asRecord(rawRow);
          const context = normalizeReferenceContext(
            asString(row.context_tag ?? row.context ?? row.entity_type ?? "collaborate")
          );
          submittedTags.add(context);
          const createdAt = asString(row.created_at);
          if (createdAt && (!latestSubmittedAt || createdAt > latestSubmittedAt)) {
            latestSubmittedAt = createdAt;
          }
        }

        const row = promptRes.data ? asRecord(promptRes.data) : null;
        if (!row) {
          if (!cancelled) {
            setActiveReferencePrompt(null);
            setSubmittedReferenceState({ contextTags: submittedTags, latestSubmittedAt });
          }
          return;
        }

        const id = asString(row.id);
        const peerUserId = asString(row.peer_user_id);
        const sourceTable = asString(row.source_table);
        const sourceId = asString(row.source_id);
        const dueAt = asString(row.due_at);
        const expiresAt = asString(row.expires_at);
        if (!id || !peerUserId || !sourceTable || !sourceId || !dueAt || !expiresAt) {
          if (!cancelled) {
            setActiveReferencePrompt(null);
            setSubmittedReferenceState({ contextTags: submittedTags, latestSubmittedAt });
          }
          return;
        }

        if (!cancelled) {
          setSubmittedReferenceState({ contextTags: submittedTags, latestSubmittedAt });
          setActiveReferencePrompt({
            id,
            peerUserId,
            contextTag: normalizeReferenceContext(asString(row.context_tag || "collaborate")),
            sourceTable,
            sourceId,
            dueAt,
            expiresAt,
          });
        }
      } catch {
        if (!cancelled) {
          setActiveReferencePrompt(null);
          setSubmittedReferenceState({ contextTags: new Set<ReferenceContextTag>(), latestSubmittedAt: null });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeMeta?.otherUserId, meId, resolveAccessToken]);

  useEffect(() => {
    if (!activeThreadToken) return;
    setThreadDrafts((prev) => {
      const current = prev[activeThreadToken] ?? "";
      if (current === threadBody) return prev;
      const next = { ...prev };
      if (threadBody.trim().length === 0) {
        delete next[activeThreadToken];
      } else {
        next[activeThreadToken] = threadBody;
      }
      return next;
    });
  }, [activeThreadToken, threadBody]);

  useEffect(() => {
    setActivityComposerOpen(false);
    setActivityDraft(DEFAULT_ACTIVITY_DRAFT);
    setActivityBusy(false);
    setActivityNoteOpen(false);
  }, [activeThreadToken]);

  const sendActiveMessage = useCallback(async () => {
    const text = threadBody.trim();
    if (!text || !meId || !activeMeta) return;
    const currentComposerLockReason = composerLockReasonRef.current;
    if (currentComposerLockReason) {
      return;
    }
    const currentCanSendFreeServiceInquiryFollowup = Boolean(
      activeMeta.contextTag === "service_inquiry" &&
        activeMeta.statusTag === "info_shared" &&
        activeMeta.serviceInquiryId &&
        activeMeta.serviceInquiryRequesterId === meId &&
        !activeMeta.serviceInquiryFollowupUsed
    );
    const isServiceInquiryFollowup = Boolean(
      currentCanSendFreeServiceInquiryFollowup && activeMeta.serviceInquiryId
    );
    const outboundText = replyTo ? `[[reply:${replyTo.id}]]\n${text}` : text;
    setSending(true);
    setThreadError(null);
    const optimisticId = `local-${crypto.randomUUID()}`;
    const optimisticCreatedAt = new Date().toISOString();
    const optimisticMessage: MessageItem = {
      id: optimisticId,
      senderId: meId,
      body: outboundText,
      createdAt: optimisticCreatedAt,
      messageType: "text",
      contextTag: isServiceInquiryFollowup ? "service_inquiry" : "regular_chat",
      statusTag: isServiceInquiryFollowup ? "inquiry_followup_pending" : "active",
      metadata: {},
      status: "sending",
      localOnly: true,
    };
    setActiveMessages((prev) => [...prev, optimisticMessage]);
    if (activeThreadToken) {
      const previewText = parseReplyPayload(outboundText).text;
      setThreads((prev) =>
        [...prev.map((thread) => (thread.threadId === activeThreadToken ? { ...thread, preview: previewText, updatedAt: optimisticCreatedAt } : thread))].sort(
          (a, b) => toTime(b.updatedAt) - toTime(a.updatedAt)
        )
      );
    }
    setThreadBody("");

    try {
      if (isServiceInquiryFollowup && activeMeta.serviceInquiryId) {
        const token = await resolveAccessToken();
        const response = await fetch(`/api/service-inquiries/${encodeURIComponent(activeMeta.serviceInquiryId)}/followup`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ body: outboundText }),
        });
        const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!response.ok || !result?.ok) {
          throw new Error(result?.error ?? "Failed to send follow-up.");
        }
        if (activeThreadToken && meId) {
          await loadThreadByToken(activeThreadToken, meId);
          setReloadTick((value) => value + 1);
        }
        await refreshMessagingSummary();
      } else {
        const rpc = await supabase.rpc("cx_send_inbox_message", {
          p_thread_id: activeMeta.threadId ?? null,
          p_connection_id: activeMeta.connectionId ?? null,
          p_body: outboundText,
        });
      if (rpc.error) throw rpc.error;
      const payload = asRecord(rpc.data);
      const returnedThreadId = asString(payload.threadId) || activeMeta.threadId || null;
      const returnedMessagingState = normalizeMessagingState(asString(payload.messagingState), "active");
      const returnedCycleStart = asString(payload.cycleStart) || null;
      const returnedCycleEnd = asString(payload.cycleEnd) || null;
      const returnedActivationStart =
        asString(payload.activationStart) || asString(payload.activationCycleStart) || returnedCycleStart;
      const returnedActivationEnd =
        asString(payload.activationEnd) || asString(payload.activationCycleEnd) || addOneMonthIso(returnedActivationStart);
      const nextSummary: MessagingSummary = {
        plan: asString(payload.plan) === "premium" ? "premium" : "free",
        activeCount: Number(payload.activeCount) || 0,
        activeLimit: Number(payload.activeLimit) || 10,
        monthlyUsed: Number(payload.monthlyUsed) || 0,
          monthlyLimit: Number(payload.monthlyLimit) || 10,
          pendingCount: messagingSummary?.pendingCount ?? 0,
          cycleStart: returnedCycleStart,
          cycleEnd: returnedCycleEnd,
        };
        setMessagingSummary(nextSummary);
        if (activeThreadToken && returnedMessagingState === "active" && returnedActivationStart && returnedActivationEnd) {
          setOptimisticActivatedByThread((prev) => ({
            ...prev,
            [activeThreadToken]: {
              activatedAt: returnedActivationStart,
              activationEnd: returnedActivationEnd,
            },
          }));
        }
        setActiveMeta((prev) =>
          prev
            ? {
                ...prev,
                threadId: returnedThreadId,
                messagingState: returnedMessagingState,
                activatedAt: returnedActivationStart || optimisticCreatedAt,
                activationCycleStart: returnedActivationStart,
                activationCycleEnd: returnedActivationEnd,
              }
            : prev
        );
        if (activeThreadToken) {
          setThreads((prev) =>
            [...prev.map((thread) =>
              thread.threadId === activeThreadToken
                ? {
                    ...thread,
                    dbThreadId: returnedThreadId,
                    preview: parseReplyPayload(outboundText).text,
                    updatedAt: optimisticCreatedAt,
                    messagingState: returnedMessagingState,
                    activatedAt: returnedActivationStart || optimisticCreatedAt,
                    activationCycleStart: returnedActivationStart,
                    activationCycleEnd: returnedActivationEnd,
                  }
                : thread
            )].sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt))
          );
        }
      }
      setActiveMessages((prev) =>
        prev.map((message) => (message.id === optimisticId ? { ...message, status: "sent", localOnly: false } : message))
      );
      setReplyTo(null);
      setThreadInfo(null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to send message.";
      if (
        message.toLowerCase().includes("monthly_activation_limit_reached") ||
        message.toLowerCase().includes("monthly activation") ||
        message.toLowerCase().includes("concurrent_active_limit_reached") ||
        message.toLowerCase().includes("concurrent active")
      ) {
        await refreshMessagingSummary();
        if (
          message.toLowerCase().includes("concurrent_active_limit_reached") ||
          message.toLowerCase().includes("concurrent active")
        ) {
          setArchiveToContinueOpen(true);
        }
        setThreadError(message);
        setActiveMessages((prev) =>
          prev.map((item) => (item.id === optimisticId ? { ...item, status: "failed" } : item))
        );
        setThreads((prev) =>
          prev.map((thread) =>
            thread.threadId === activeThreadToken ? { ...thread, preview: "Failed to send message." } : thread
          )
        );
      } else {
        setThreadError(message);
        setActiveMessages((prev) =>
          prev.map((item) => (item.id === optimisticId ? { ...item, status: "failed" } : item))
        );
        setThreads((prev) =>
          prev.map((thread) =>
            thread.threadId === activeThreadToken ? { ...thread, preview: "Failed to send message." } : thread
          )
        );
      }
    } finally {
      setSending(false);
    }
  }, [
    activeMeta,
    activeThreadToken,
    loadThreadByToken,
    meId,
    messagingSummary?.pendingCount,
    refreshMessagingSummary,
    replyTo,
    resolveAccessToken,
    threadBody,
  ]);

  const submitActivityInvite = useCallback(async () => {
    if ((!activeMeta?.threadId && !activeMeta?.connectionId) || !activeMeta?.otherUserId || !meId) return;
    setActivityBusy(true);
    setActivityComposerError(null);
    setThreadInfo(null);
    try {
      const usesDateRange = activityUsesDateRange(activityDraft.activityType);
      const startAt = activityDraft.dateMode === "set" ? activityDraft.startAt || null : null;
      const endAt = activityDraft.dateMode === "set" && usesDateRange ? activityDraft.endAt || null : null;
      if (activityDraft.dateMode === "set" && !startAt) {
        throw new Error(usesDateRange ? "Choose a start date." : "Choose a date.");
      }
      if (activityDraft.dateMode === "set" && usesDateRange && !endAt) {
        throw new Error("Choose an end date.");
      }

      const accessToken = await resolveAccessToken();

      const response = await fetch("/api/activities", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          threadId: activeMeta.threadId || undefined,
          connectionId: activeMeta.connectionId || undefined,
          recipientUserId: activeMeta.otherUserId,
          activityType: activityDraft.activityType,
          note: activityDraft.note || null,
          startAt,
          endAt,
          linkedMemberUserId: activitySupportsLinkedMember ? activityDraft.linkedMemberUserId || null : null,
        }),
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; id?: string; threadId?: string | null } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error ?? "Failed to create activity.");
      }

      const resolvedThreadId = typeof result?.threadId === "string" && result.threadId ? result.threadId : activeMeta.threadId;
      if (!resolvedThreadId) throw new Error("Missing thread for activity.");

      setActivityComposerOpen(false);
      setActivityDraft(DEFAULT_ACTIVITY_DRAFT);
      setActivityLinkedPickerOpen(false);
      setActivityLinkedMemberQuery("");
      setActiveMeta((prev) => (prev ? { ...prev, threadId: resolvedThreadId } : prev));
      const nowIso = new Date().toISOString();
      const optimisticContextId = typeof result?.id === "string" && result.id ? `activity:${result.id}` : `activity:optimistic:${Date.now()}`;
      const optimisticContext: ThreadContextItem = {
        id: optimisticContextId,
        threadId: resolvedThreadId,
        sourceTable: "activities",
        sourceId: typeof result?.id === "string" && result.id ? result.id : optimisticContextId,
        contextTag: "activity",
        statusTag: "pending",
        title: activityTypeLabel(activityDraft.activityType),
        city: null,
        startDate: startAt ? startAt.slice(0, 10) : null,
        endDate: endAt ? endAt.slice(0, 10) : null,
        requesterId: meId,
        recipientId: activeMeta.otherUserId,
        metadata: {
          activity_type: activityDraft.activityType,
          title: activityTypeLabel(activityDraft.activityType),
          note: activityDraft.note || null,
          start_at: startAt,
          end_at: endAt,
          activity_id: typeof result?.id === "string" ? result.id : null,
        },
        updatedAt: nowIso,
        createdAt: nowIso,
      };
      setThreadContextsByDbId((prev) => {
        const current = prev[resolvedThreadId] ?? [];
        const next = [optimisticContext, ...current.filter((item) => !(item.sourceTable === optimisticContext.sourceTable && item.sourceId === optimisticContext.sourceId))];
        return { ...prev, [resolvedThreadId]: next };
      });
      setThreads((prev) =>
        prev.map((thread) =>
          thread.threadId === activeThreadToken || thread.dbThreadId === resolvedThreadId
            ? {
                ...thread,
                dbThreadId: resolvedThreadId,
                hasPendingRequest: true,
                statusTag: "pending",
                contextTag: "activity",
                preview: threadPreviewFromContext(optimisticContext),
                metaLabel: describeContextMeta(optimisticContext),
                updatedAt: nowIso,
              }
            : thread
        )
      );
      setThreadInfo(`${activityTypeLabel(activityDraft.activityType)} request sent.`);
    } catch (e: unknown) {
      setActivityComposerError(e instanceof Error ? e.message : "Failed to create activity.");
    } finally {
      setActivityBusy(false);
    }
  }, [activeMeta, activityDraft, activeThreadToken, activitySupportsLinkedMember, meId, resolveAccessToken]);

  const submitReport = useCallback(async () => {
    if (!activeMeta?.connectionId) return;
    setReportBusy(true);
    setReportError(null);
    try {
      const accessToken = await resolveAccessToken();

      const response = await fetch("/api/connections/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          connId: activeMeta.connectionId,
          action: "report",
          reason: reportReason,
          note: [reportNote.trim(), reportFromMessageId ? `Message ID: ${reportFromMessageId}` : ""].filter(Boolean).join("\n") || undefined,
          context: "message",
          contextId: reportFromMessageId ?? activeMeta.connectionId,
        }),
      });

      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Failed to submit report");
      }

      setReportOpen(false);
      setReportNote("");
      setReportReason("Scam or fraud");
      setReportFromMessageId(null);
      setThreadInfo("Report sent. Our moderation team will review it.");
    } catch (e: unknown) {
      setReportError(e instanceof Error ? e.message : "Failed to submit report.");
    } finally {
      setReportBusy(false);
    }
  }, [activeMeta?.connectionId, reportFromMessageId, reportNote, reportReason, resolveAccessToken]);

  const upsertThreadPrefs = useCallback(
    async (dbThreadId: string | null, patch: ThreadPrefsPatch) => {
      if (!meId) return false;
      if (!dbThreadId) {
        setThreadPrefsInLocalMode(true);
        return false;
      }

      const payload: Record<string, string | null> = {
        thread_id: dbThreadId,
        user_id: meId,
        role: "member",
      };
      if (patch.archived_at !== undefined) payload.archived_at = patch.archived_at;
      if (patch.muted_until !== undefined) payload.muted_until = patch.muted_until;
      if (patch.pinned_at !== undefined) payload.pinned_at = patch.pinned_at;
      if (patch.last_read_at !== undefined) payload.last_read_at = patch.last_read_at;

      const res = await supabase.from("thread_participants").upsert(payload, {
        onConflict: "thread_id,user_id",
      });
      if (!res.error) {
        setThreadPrefsInLocalMode(false);
        return true;
      }

      if (shouldFallbackPrefs(res.error.message)) {
        setThreadPrefsInLocalMode(true);
        return false;
      }

      throw new Error(res.error.message);
    },
    [meId]
  );

  const archiveThread = useCallback(
    async (threadToken: string, dbThreadId: string | null) => {
      setThreadError(null);
      try {
        if (dbThreadId) {
          const rpc = await supabase.rpc("cx_set_thread_messaging_state", {
            p_thread_id: dbThreadId,
            p_next_state: "archived",
          });
          if (rpc.error) throw rpc.error;
          const payload = asRecord(rpc.data);
          setMessagingSummary((prev) => ({
            plan: asString(payload.plan) === "premium" ? "premium" : prev?.plan ?? "free",
            activeCount: Number(payload.activeCount) || 0,
            activeLimit: Number(payload.activeLimit) || prev?.activeLimit || 10,
            monthlyUsed: Number(payload.monthlyUsed) || prev?.monthlyUsed || 0,
            monthlyLimit: Number(payload.monthlyLimit) || prev?.monthlyLimit || 10,
            pendingCount: prev?.pendingCount ?? 0,
            cycleStart: asString(payload.cycleStart) || prev?.cycleStart || null,
            cycleEnd: asString(payload.cycleEnd) || prev?.cycleEnd || null,
          }));
        } else {
          await upsertThreadPrefs(dbThreadId, { archived_at: new Date().toISOString() });
        }
        setArchivedThreads((prev) => ({ ...prev, [threadToken]: true }));
        setThreads((prev) =>
          prev.map((thread) =>
            thread.threadId === threadToken ? { ...thread, messagingState: "archived" } : thread
          )
        );
        setActiveMeta((prev) =>
          prev && activeThreadToken === threadToken ? { ...prev, messagingState: "archived" } : prev
        );
        setThreadInfo("Thread archived. Use thread actions to unarchive.");

        if (activeThreadToken === threadToken) {
          const next = threads.find((item) => item.threadId !== threadToken && !archivedThreads[item.threadId]);
          if (next) {
            setActiveThreadToken(next.threadId);
            router.replace(buildInboxUrl({ threadToken: next.threadId }));
          } else {
            setActiveThreadToken(null);
            router.replace(buildInboxUrl({ threadToken: null }));
          }
        }
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to archive thread.");
      }
    },
    [activeThreadToken, archivedThreads, buildInboxUrl, router, threads, upsertThreadPrefs]
  );

  const unarchiveThread = useCallback(
    async (threadToken: string, dbThreadId: string | null) => {
      setThreadError(null);
      try {
        if (dbThreadId) {
          const rpc = await supabase.rpc("cx_set_thread_messaging_state", {
            p_thread_id: dbThreadId,
            p_next_state: "inactive",
          });
          if (rpc.error) throw rpc.error;
          const payload = asRecord(rpc.data);
          setMessagingSummary((prev) => ({
            plan: asString(payload.plan) === "premium" ? "premium" : prev?.plan ?? "free",
            activeCount: Number(payload.activeCount) || 0,
            activeLimit: Number(payload.activeLimit) || prev?.activeLimit || 10,
            monthlyUsed: Number(payload.monthlyUsed) || prev?.monthlyUsed || 0,
            monthlyLimit: Number(payload.monthlyLimit) || prev?.monthlyLimit || 10,
            pendingCount: prev?.pendingCount ?? 0,
            cycleStart: asString(payload.cycleStart) || prev?.cycleStart || null,
            cycleEnd: asString(payload.cycleEnd) || prev?.cycleEnd || null,
          }));
        } else {
          await upsertThreadPrefs(dbThreadId, { archived_at: null });
        }
        setArchivedThreads((prev) => {
          if (!prev[threadToken]) return prev;
          const copy = { ...prev };
          delete copy[threadToken];
          return copy;
        });
        setThreads((prev) =>
          prev.map((thread) =>
            thread.threadId === threadToken ? { ...thread, messagingState: "inactive" } : thread
          )
        );
        setActiveMeta((prev) =>
          prev && activeThreadToken === threadToken ? { ...prev, messagingState: "inactive" } : prev
        );
        setThreadInfo("Thread restored.");
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to restore thread.");
      }
    },
    [activeThreadToken, upsertThreadPrefs]
  );

  const muteThreadForHours = useCallback(
    async (threadToken: string, dbThreadId: string | null, hours: number) => {
      setThreadError(null);
      try {
        const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        await upsertThreadPrefs(dbThreadId, { muted_until: until });
        setMutedUntilByThread((prev) => ({ ...prev, [threadToken]: until }));
        setThreadInfo(`Notifications muted for ${hours}h.`);
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to mute thread.");
      }
    },
    [upsertThreadPrefs]
  );

  const unmuteThread = useCallback(
    async (threadToken: string, dbThreadId: string | null) => {
      setThreadError(null);
      try {
        await upsertThreadPrefs(dbThreadId, { muted_until: null });
        setMutedUntilByThread((prev) => {
          if (!prev[threadToken]) return prev;
          const copy = { ...prev };
          delete copy[threadToken];
          return copy;
        });
        setThreadInfo("Notifications unmuted.");
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to unmute thread.");
      }
    },
    [upsertThreadPrefs]
  );

  const pinThread = useCallback(
    async (threadToken: string, dbThreadId: string | null) => {
      setThreadError(null);
      try {
        await upsertThreadPrefs(dbThreadId, { pinned_at: new Date().toISOString() });
        setPinnedThreads((prev) => ({ ...prev, [threadToken]: true }));
        setThreadInfo("Thread pinned to top.");
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to pin thread.");
      }
    },
    [upsertThreadPrefs]
  );

  const unpinThread = useCallback(
    async (threadToken: string, dbThreadId: string | null) => {
      setThreadError(null);
      try {
        await upsertThreadPrefs(dbThreadId, { pinned_at: null });
        setPinnedThreads((prev) => {
          if (!prev[threadToken]) return prev;
          const copy = { ...prev };
          delete copy[threadToken];
          return copy;
        });
        setThreadInfo("Thread unpinned.");
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to unpin thread.");
      }
    },
    [upsertThreadPrefs]
  );

  const setThreadUnreadState = useCallback(
    async (thread: ThreadRow, unread: boolean) => {
      const timestamp = new Date().toISOString();
      const nextCount = unread ? thread.unreadCount : 0;

      setThreads((prev) => prev.map((row) => (row.threadId === thread.threadId ? { ...row, unreadCount: nextCount } : row)));
      setManualUnreadByThread((prev) => {
        if (unread) {
          if (thread.unreadCount > 0) {
            if (!prev[thread.threadId]) return prev;
            const copy = { ...prev };
            delete copy[thread.threadId];
            return copy;
          }
          return { ...prev, [thread.threadId]: true };
        }
        if (!prev[thread.threadId]) return prev;
        const copy = { ...prev };
        delete copy[thread.threadId];
        return copy;
      });
      if (thread.threadId === activeThreadToken) {
        setActiveLastReadAt(timestamp);
      }
      if (unread) {
        setRecentlyUpdatedThreadIds((prev) => ({ ...prev, [thread.threadId]: true }));
        window.setTimeout(() => {
          setRecentlyUpdatedThreadIds((prev) => {
            if (!prev[thread.threadId]) return prev;
            const copy = { ...prev };
            delete copy[thread.threadId];
            return copy;
          });
        }, 1400);
      }

      try {
        if (!unread) {
          await upsertThreadPrefs(thread.dbThreadId, { last_read_at: timestamp });
        }
        setThreadInfo(unread ? "Thread marked as unread." : "Thread marked as read.");
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to update unread state.");
      } finally {
        setOpenThreadRowMenuId(null);
      }
    },
    [activeThreadToken, upsertThreadPrefs]
  );

  const activeDbThreadId = useMemo(() => {
    if (activeMeta?.threadId) return activeMeta.threadId;
    if (!activeThreadToken) return null;
    return threads.find((thread) => thread.threadId === activeThreadToken)?.dbThreadId ?? null;
  }, [activeMeta?.threadId, activeThreadToken, threads]);

  const activeThreadContexts = useMemo(() => {
    const contexts = activeDbThreadId ? [...(threadContextsByDbId[activeDbThreadId] ?? [])] : [];
    if (activeFallbackContext) {
      const exists = contexts.some((item) => item.sourceTable === activeFallbackContext.sourceTable && item.sourceId === activeFallbackContext.sourceId);
      if (!exists) contexts.push(activeFallbackContext);
    }
    return collapseDuplicateThreadContexts(contexts);
  }, [activeDbThreadId, activeFallbackContext, threadContextsByDbId]);

  const activePendingContext = useMemo(
    () => activeThreadContexts.find((context) => isPendingLikeStatus(context.statusTag)) ?? null,
    [activeThreadContexts]
  );
  const pinnedPendingContexts = useMemo(
    () => (activePendingContext ? [activePendingContext] : []),
    [activePendingContext]
  );
  const activePrimaryContext = activePendingContext ?? activeThreadContexts[0] ?? null;
  const chatBookingContextLabel = useMemo(() => {
    const activityContext =
      activePrimaryContext?.contextTag === "activity"
        ? activePrimaryContext
        : activeThreadContexts.find((context) => context.contextTag === "activity") ?? null;
    if (!activityContext) return null;
    const activityType = asString(activityContext.metadata.activity_type);
    return activityType ? `From ${activityTypeLabel(activityType)}` : "From activity";
  }, [activePrimaryContext, activeThreadContexts]);
  const historicalThreadContexts = useMemo(
    () =>
      activeThreadContexts
        .filter((context) => context.contextTag !== "regular_chat" && !isPendingLikeStatus(context.statusTag))
        .sort((a, b) => toTime(a.updatedAt) - toTime(b.updatedAt)),
    [activeThreadContexts]
  );
  const latestCompletedActivityReferenceTag = useMemo(() => {
    const completedActivities = [...historicalThreadContexts]
      .filter((context) => context.contextTag === "activity" && context.statusTag === "completed")
      .sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt));
    const latest = completedActivities[0];
    if (!latest) return null;
    const activityType = asString(latest.metadata.activity_type);
    return activityType ? normalizeReferenceContext(activityType) : null;
  }, [historicalThreadContexts]);

  const showThreadPlaceholderSkeleton =
    loading ||
    !threadsHydrated ||
    threadLoading ||
    (Boolean(activeThreadToken) && !activeMeta) ||
    (!activeMeta && threads.length === 0 && !error);
  const hasSubmittedLatestCompletedActivityReference = useMemo(() => {
    if (!latestCompletedActivityReferenceTag) return false;
    return submittedReferenceState.contextTags.has(latestCompletedActivityReferenceTag);
  }, [latestCompletedActivityReferenceTag, submittedReferenceState]);
  const activeReferencePromptTag = activeReferencePrompt?.contextTag ?? null;
  const activeReferencePromptCtaLabel = activeReferencePrompt
    ? `Add ${referenceContextLabel(activeReferencePrompt.contextTag)} reference`
    : null;
  const activeServiceInquiryContext = useMemo(
    () => activeThreadContexts.find((context) => context.contextTag === "service_inquiry") ?? null,
    [activeThreadContexts]
  );
  const viewerIsServiceInquiryRequester = Boolean(
    meId && activeServiceInquiryContext && activeServiceInquiryContext.requesterId === meId
  );
  const viewerIsServiceInquiryRecipient = Boolean(
    meId && activeServiceInquiryContext && activeServiceInquiryContext.recipientId === meId
  );
  const serviceInquiryFollowupUsed = Boolean(activeServiceInquiryContext?.metadata.requester_followup_used);
  const canSendFreeServiceInquiryFollowup = Boolean(
    activeServiceInquiryContext &&
      activeServiceInquiryContext.statusTag === "info_shared" &&
      viewerIsServiceInquiryRequester &&
      !serviceInquiryFollowupUsed
  );
  const acceptedInteractionContexts = useMemo(
    () =>
      activeThreadContexts.filter(
        (context) => CHAT_UNLOCK_CONTEXT_TAGS.includes(context.contextTag) && isChatUnlockingContext(context)
      ),
    [activeThreadContexts]
  );
  const serviceInquiryOwnFlowState = useMemo<ServiceInquiryOwnFlowState | null>(() => {
    if (!activeServiceInquiryContext || acceptedInteractionContexts.length > 0) return null;
    if (activeServiceInquiryContext.statusTag === "pending") return "pending";
    if (activeServiceInquiryContext.statusTag === "inquiry_followup_pending") return "followup_pending";
    if (activeServiceInquiryContext.statusTag === "info_shared" && canSendFreeServiceInquiryFollowup) {
      return "followup_available";
    }
    return null;
  }, [acceptedInteractionContexts.length, activeServiceInquiryContext, canSendFreeServiceInquiryFollowup]);
  const hasAcceptedConnectionContext = useMemo(
    () =>
      acceptedInteractionContexts.some(
        (context) => context.contextTag === "connection_request"
      ),
    [acceptedInteractionContexts]
  );
  const hasAcceptedNonConnectionContext = useMemo(
    () =>
      acceptedInteractionContexts.some(
        (context) => context.contextTag !== "connection_request"
      ),
    [acceptedInteractionContexts]
  );
  const hasHistoricalFreeText = useMemo(
    () => activeMessages.some((message) => (message.messageType ?? "text") === "text"),
    [activeMessages]
  );
  const [interactionBlocked, setInteractionBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const connectionSourceIds = activeThreadContexts
        .filter((context) => context.sourceTable === "connections")
        .map((context) => context.sourceId)
        .filter(Boolean);
      if (connectionSourceIds.length === 0) {
        setInteractionBlocked(false);
        return;
      }
      const res = await supabase
        .from("connections")
        .select("id,status,blocked_by")
        .in("id", connectionSourceIds);
      if (cancelled) return;
      if (res.error) {
        setInteractionBlocked(false);
        return;
      }
      const blocked = ((res.data ?? []) as Array<Record<string, unknown>>).some((row) => {
        const status = typeof row.status === "string" ? row.status.toLowerCase() : "";
        const blockedBy = row.blocked_by;
        return status === "blocked" || Boolean(blockedBy);
      });
      setInteractionBlocked(blocked);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [activeThreadContexts]);

  const updateRequestContext = useCallback(
    async (contextId: string, action: "accept" | "decline" | "cancel") => {
      if (!meId) return;
      const context = activeThreadContexts.find((item) => item.id === contextId);
      if (!context || context.statusTag !== "pending") return;

      if (context.contextTag === "service_inquiry" && action === "accept") {
        setRequestActionBusyId(`${context.id}:${action}`);
        setThreadError(null);
        setThreadInfo(null);
        setShareInquiryError(null);
        try {
          await loadOwnTeacherInquiryBlocks();
          setShareInquiryContext(context);
        } catch (loadError) {
          setThreadError(loadError instanceof Error ? loadError.message : "Could not load your teacher info blocks.");
        } finally {
          setRequestActionBusyId(null);
        }
        return;
      }

      setRequestActionBusyId(`${context.id}:${action}`);
      setThreadError(null);
      setThreadInfo(null);
      try {
        const token = await resolveAccessToken();

        if (context.contextTag === "connection_request") {
          const actionPayload = action === "accept" ? "accept" : action === "decline" ? "decline" : "cancel";
          const response = await fetch("/api/connections/action", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              connId: context.sourceId,
              action: actionPayload,
              context: "message",
              contextId: context.sourceId,
            }),
          });
          const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Failed to update request.");
        } else if (context.contextTag === "trip_join_request") {
          const response = await fetch(`/api/trips/requests/${encodeURIComponent(context.sourceId)}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action }),
          });
          const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Failed to update trip request.");
        } else if (context.contextTag === "hosting_request") {
          if (action === "cancel") {
            const response = await fetch(`/api/hosting/requests/${encodeURIComponent(context.sourceId)}/cancel`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
            });
            const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
            if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Failed to cancel hosting request.");
          } else {
            const response = await fetch(`/api/hosting/requests/${encodeURIComponent(context.sourceId)}/respond`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ action: action === "accept" ? "accepted" : "declined" }),
            });
            const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
            if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Failed to update hosting request.");
          }
        } else if (context.contextTag === "event_chat") {
          if (action === "cancel") {
            const eventId = typeof context.metadata.event_id === "string" ? context.metadata.event_id : "";
            if (!eventId) throw new Error("Missing event id for cancellation.");
            const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/join`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ action: "cancel_request" }),
            });
            const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
            if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Failed to cancel event request.");
          } else {
            const response = await fetch("/api/events/requests", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                requestId: context.sourceId,
                action,
              }),
            });
            const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
            if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Failed to update event request.");
          }
        } else if (context.contextTag === "activity") {
          const response = await fetch(`/api/activities/${encodeURIComponent(context.sourceId)}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action }),
          });
          const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Failed to update activity.");
        } else if (context.contextTag === "service_inquiry") {
          const endpoint =
            action === "decline"
              ? `/api/service-inquiries/${encodeURIComponent(context.sourceId)}/decline`
              : null;
          if (!endpoint) {
            throw new Error("Service inquiries do not support this action.");
          }
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Failed to update service inquiry.");
        }

      const nextStatus: ThreadStatusTag = action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled";
      const resolvedContextStatus: ThreadStatusTag =
        context.contextTag === "service_inquiry" && action === "accept" ? "info_shared" : nextStatus;
      const nowIso = new Date().toISOString();
      const activeThreadId = context.threadId || activeDbThreadId || activeMeta?.threadId || null;
      const nextContexts = collapseDuplicateThreadContexts(
        activeThreadContexts.map((item) =>
          item.id === context.id
            ? {
                ...item,
                statusTag: resolvedContextStatus,
                updatedAt: nowIso,
                metadata: {
                  ...item.metadata,
                  accepted_at: action === "accept" ? nowIso : item.metadata.accepted_at ?? null,
                },
              }
            : item
        )
      );
      const nextPrimaryContext = nextContexts.find((item) => isPendingLikeStatus(item.statusTag)) ?? nextContexts[0] ?? null;
      const nextHasAcceptedInteraction = nextContexts.some(
        (item) => CHAT_UNLOCK_CONTEXT_TAGS.includes(item.contextTag) && isAcceptedInteractionStatus(item.statusTag)
      );
      if (activeThreadId) {
        setThreadContextsByDbId((prev) => {
          const current = prev[activeThreadId] ?? [];
          const next = current.map((item) =>
            item.id === context.id
              ? {
                    ...item,
                    statusTag: resolvedContextStatus,
                    updatedAt: nowIso,
                    metadata: {
                      ...item.metadata,
                      accepted_at: action === "accept" ? nowIso : item.metadata.accepted_at ?? null,
                    },
                  }
                : item
            );
            return { ...prev, [activeThreadId]: next };
          });
        }

        setActiveMeta((prev) =>
          prev
            ? {
                ...prev,
                contextTag: nextPrimaryContext?.contextTag ?? prev.contextTag,
                statusTag: nextPrimaryContext?.statusTag ?? prev.statusTag,
                hasAcceptedInteraction: nextHasAcceptedInteraction,
                isRelationshipPending: Boolean(
                  isPendingLikeStatus(nextPrimaryContext?.statusTag ?? "active") && !nextHasAcceptedInteraction
                ),
              }
            : prev
        );

        if (context.contextTag === "activity") {
          setActiveMessages((prev) =>
            prev.filter(
              (message) =>
                !(
                  message.contextTag === "activity" &&
                  asString(message.metadata?.activity_id) === context.sourceId
                )
            )
          );
        }

        setThreads((prev) =>
          prev.map((thread) => {
            if (thread.threadId !== activeThreadToken) return thread;
            const remainingPending = nextContexts.some((item) => isPendingLikeStatus(item.statusTag));
            const primaryContext = nextContexts.find((item) => isPendingLikeStatus(item.statusTag)) ?? nextContexts[0] ?? null;
            return {
              ...thread,
              hasPendingRequest: remainingPending,
              statusTag:
                primaryContext?.statusTag ??
                (remainingPending ? "pending" : thread.statusTag === "pending" ? "active" : thread.statusTag),
              contextTag: primaryContext?.contextTag ?? thread.contextTag,
              metaLabel:
                remainingPending && primaryContext ? describeContextMeta(primaryContext) : thread.kind === "connection" || thread.kind === "direct" ? "" : thread.metaLabel,
              preview: deriveThreadPreviewFromState({
                thread,
                contexts: nextContexts,
                messages: activeMessages,
              }),
              updatedAt: nowIso,
              hasAcceptedInteraction: nextHasAcceptedInteraction,
              isRelationshipPending: remainingPending && !nextHasAcceptedInteraction,
            };
          })
        );

        await refreshMessagingSummary();

        setThreadInfo(
          context.contextTag === "activity"
            ? action === "accept"
              ? "Activity accepted."
              : action === "decline"
              ? "Activity declined."
              : "Activity cancelled."
            : action === "accept"
            ? "Request accepted."
            : action === "decline"
            ? "Request declined."
            : "Request cancelled."
        );
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to update request.");
      } finally {
        setRequestActionBusyId(null);
      }
    },
    [
      activeDbThreadId,
      activeMessages,
      activeMeta?.threadId,
      activeThreadContexts,
      activeThreadToken,
      loadOwnTeacherInquiryBlocks,
      meId,
      refreshMessagingSummary,
      resolveAccessToken,
    ]
  );

  const refreshActiveInquiryThread = useCallback(async () => {
    if (!activeThreadToken || !meId) return;
    await loadThreadByToken(activeThreadToken, meId);
    setReloadTick((value) => value + 1);
  }, [activeThreadToken, loadThreadByToken, meId]);

  const acceptServiceInquiryShare = useCallback(
    async (payload: { selectedBlockIds: string[]; introNote: string | null }) => {
      if (!shareInquiryContext) return;
      setShareInquiryBusy(true);
      setShareInquiryError(null);
      setThreadError(null);
      setThreadInfo(null);
      try {
        const token = await resolveAccessToken();
        const response = await fetch(`/api/service-inquiries/${encodeURIComponent(shareInquiryContext.sourceId)}/accept`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!response.ok || !result?.ok) {
          throw new Error(result?.error ?? "Could not share the selected information.");
        }

        setShareInquiryContext(null);
        setShareInquiryBlocks([]);
        setThreadInfo("Information shared.");
        await refreshActiveInquiryThread();
      } catch (shareError) {
        setShareInquiryError(shareError instanceof Error ? shareError.message : "Could not share the selected information.");
      } finally {
        setShareInquiryBusy(false);
      }
    },
    [refreshActiveInquiryThread, resolveAccessToken, shareInquiryContext]
  );

  const convertServiceInquiryConversation = useCallback(async () => {
    const context =
      activeThreadContexts.find(
        (item) => item.contextTag === "service_inquiry" && item.statusTag === "inquiry_followup_pending"
      ) ?? null;
    if (!context) return;

    setRequestActionBusyId(`${context.id}:convert`);
    setThreadError(null);
    setThreadInfo(null);
    try {
      const token = await resolveAccessToken();
      const response = await fetch(`/api/service-inquiries/${encodeURIComponent(context.sourceId)}/convert`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error ?? "Could not activate the conversation.");
      }
      setThreadInfo("Conversation activated.");
      await refreshActiveInquiryThread();
      await refreshMessagingSummary();
    } catch (convertError) {
      setThreadError(convertError instanceof Error ? convertError.message : "Could not activate the conversation.");
    } finally {
      setRequestActionBusyId(null);
    }
  }, [activeThreadContexts, refreshActiveInquiryThread, refreshMessagingSummary, resolveAccessToken]);

  const declineServiceInquiryConversation = useCallback(async () => {
    const context =
      activeThreadContexts.find(
        (item) =>
          item.contextTag === "service_inquiry" &&
          (item.statusTag === "info_shared" || item.statusTag === "inquiry_followup_pending")
      ) ?? null;
    if (!context) return;

    setRequestActionBusyId(`${context.id}:decline`);
    setThreadError(null);
    setThreadInfo(null);
    try {
      const token = await resolveAccessToken();
      const response = await fetch(`/api/service-inquiries/${encodeURIComponent(context.sourceId)}/decline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error ?? "Could not decline this inquiry.");
      }
      setThreadInfo("Service inquiry declined.");
      const nowIso = new Date().toISOString();
      const nextContexts = collapseDuplicateThreadContexts(
        activeThreadContexts.map((item) =>
          item.id === context.id
            ? {
                ...item,
                statusTag: "declined",
                updatedAt: nowIso,
                metadata: {
                  ...item.metadata,
                  declined_at: nowIso,
                },
              }
            : item
        )
      );
      const nextPrimaryContext = nextContexts.find((item) => isPendingLikeStatus(item.statusTag)) ?? nextContexts[0] ?? null;
      const nextHasAcceptedInteraction = nextContexts.some(
        (item) => CHAT_UNLOCK_CONTEXT_TAGS.includes(item.contextTag) && isAcceptedInteractionStatus(item.statusTag)
      );
      const activeThreadId = context.threadId || activeDbThreadId || activeMeta?.threadId || null;
      if (activeThreadId) {
        setThreadContextsByDbId((prev) => ({ ...prev, [activeThreadId]: nextContexts }));
      }
      setActiveMeta((prev) =>
        prev
          ? {
              ...prev,
              contextTag: nextPrimaryContext?.contextTag ?? prev.contextTag,
              statusTag: nextPrimaryContext?.statusTag ?? "declined",
              hasAcceptedInteraction: nextHasAcceptedInteraction,
              isRelationshipPending: Boolean(
                isPendingLikeStatus(nextPrimaryContext?.statusTag ?? "active") && !nextHasAcceptedInteraction
              ),
            }
          : prev
      );
      setThreads((prev) =>
        prev.map((thread) =>
          thread.threadId === activeThreadToken
            ? {
                ...thread,
                hasPendingRequest: nextContexts.some((item) => isPendingLikeStatus(item.statusTag)),
                statusTag: nextPrimaryContext?.statusTag ?? "declined",
              }
            : thread
        )
      );
      await Promise.allSettled([refreshActiveInquiryThread(), refreshMessagingSummary()]);
    } catch (declineError) {
      setThreadError(declineError instanceof Error ? declineError.message : "Could not decline this inquiry.");
    } finally {
      setRequestActionBusyId(null);
    }
  }, [activeDbThreadId, activeMeta?.threadId, activeThreadContexts, activeThreadToken, refreshActiveInquiryThread, refreshMessagingSummary, resolveAccessToken]);

  const pendingActionsForContext = useCallback(
    (context: ThreadContextItem): Array<{ key: "accept" | "decline" | "cancel"; label: string }> => {
      if (!meId) return [];
      const isRequester = context.requesterId === meId;
      const isRecipient = context.recipientId === meId;
      if (isRequester) {
        if (contextSupportsCancel(context.contextTag, context.metadata)) {
          return [{ key: "cancel", label: "Cancel request" }];
        }
        return [];
      }
      if (isRecipient) {
        if (context.contextTag === "service_inquiry") {
          return [
            { key: "accept", label: "Accept & share" },
            { key: "decline", label: "Decline" },
          ];
        }
        return [
          { key: "accept", label: "Accept" },
          { key: "decline", label: "Decline" },
        ];
      }
      return [];
    },
    [meId]
  );

  const openConnectRequestFromThread = useCallback(() => {
    if (!activeMeta?.otherUserId) return;

    const connectContextRaw =
      asString(activePrimaryContext?.metadata.connect_context) ||
      (activeMeta.tripId || activeMeta.kind === "trip" ? "traveller" : "member");
    const connectContext = connectContextRaw === "traveller" || connectContextRaw === "trip" ? "traveller" : "member";
    const tripIdFromContext = asString(activePrimaryContext?.metadata.trip_id) || activeMeta.tripId || null;

    setThreadError(null);
    setThreadInfo(null);
    setConnectRequestModal({
      open: true,
      targetUserId: activeMeta.otherUserId,
      targetName: activeMeta.title || "Member",
      targetPhotoUrl: activeMeta.avatarUrl ?? null,
      connectContext,
      tripId: connectContext === "traveller" ? tripIdFromContext : null,
    });
  }, [
    activeMeta?.avatarUrl,
    activeMeta?.kind,
    activeMeta?.otherUserId,
    activeMeta?.title,
    activeMeta?.tripId,
    activePrimaryContext?.metadata.connect_context,
    activePrimaryContext?.metadata.trip_id,
  ]);

  const activateConversationFromThread = useCallback(async () => {
    if (!activeMeta?.threadId) return;

    setChatFooterBusy("activate");
    setThreadError(null);
    setThreadInfo(null);

    try {
      const nowIso = new Date().toISOString();
      const rpc = await supabase.rpc("cx_set_thread_messaging_state", {
        p_thread_id: activeMeta.threadId,
        p_next_state: "active",
      });
      if (rpc.error) throw rpc.error;

      const payload = asRecord(rpc.data);
      const returnedCycleStart = asString(payload.cycleStart) || messagingSummary?.cycleStart || null;
      const returnedCycleEnd = asString(payload.cycleEnd) || messagingSummary?.cycleEnd || null;
      const returnedActivationStart =
        asString(payload.activationStart) || asString(payload.activationCycleStart) || nowIso;
      const returnedActivationEnd =
        asString(payload.activationEnd) || asString(payload.activationCycleEnd) || addOneMonthIso(returnedActivationStart);

      setMessagingSummary((prev) => ({
        plan: asString(payload.plan) === "premium" ? "premium" : prev?.plan ?? "free",
        activeCount: Number(payload.activeCount) || 0,
        activeLimit: Number(payload.activeLimit) || prev?.activeLimit || 10,
        monthlyUsed: Number(payload.monthlyUsed) || 0,
        monthlyLimit: Number(payload.monthlyLimit) || prev?.monthlyLimit || 10,
        pendingCount: prev?.pendingCount ?? 0,
        cycleStart: returnedCycleStart,
        cycleEnd: returnedCycleEnd,
      }));
      if (activeThreadToken) {
        setOptimisticActivatedByThread((prev) => ({
          ...prev,
          [activeThreadToken]: {
            activatedAt: returnedActivationStart,
            activationEnd: returnedActivationEnd,
          },
        }));
        setArchivedThreads((prev) => {
          if (!prev[activeThreadToken]) return prev;
          const next = { ...prev };
          delete next[activeThreadToken];
          return next;
        });
        setThreads((prev) =>
          prev.map((thread) =>
            thread.threadId === activeThreadToken
              ? {
                  ...thread,
                  messagingState: "active",
                  activatedAt: returnedActivationStart,
                  activationCycleStart: returnedActivationStart,
                  activationCycleEnd: returnedActivationEnd,
                }
              : thread
          )
        );
      }
      setActiveMeta((prev) =>
        prev
          ? {
              ...prev,
              messagingState: "active",
              activatedAt: returnedActivationStart,
              activationCycleStart: returnedActivationStart,
              activationCycleEnd: returnedActivationEnd,
            }
          : prev
      );
      if (activeThreadToken && meId) {
        void loadThreadByToken(activeThreadToken, meId);
      }
      setThreadInfo("Conversation activated.");
      window.setTimeout(() => composerTextareaRef.current?.focus(), 20);
    } catch (activationError) {
      const message = activationError instanceof Error ? activationError.message : "Could not activate the conversation.";
      if (
        message.toLowerCase().includes("monthly_activation_limit_reached") ||
        message.toLowerCase().includes("monthly activation") ||
        message.toLowerCase().includes("concurrent_active_limit_reached") ||
        message.toLowerCase().includes("concurrent active")
      ) {
        await refreshMessagingSummary();
        if (
          message.toLowerCase().includes("concurrent_active_limit_reached") ||
          message.toLowerCase().includes("concurrent active")
        ) {
          setArchiveToContinueOpen(true);
        }
      }
      setThreadError(message);
    } finally {
      setChatFooterBusy(null);
    }
  }, [activeMeta?.threadId, activeThreadToken, loadThreadByToken, meId, messagingSummary?.cycleEnd, messagingSummary?.cycleStart, refreshMessagingSummary]);

  const blockConnection = useCallback(async () => {
    if (!activeMeta?.connectionId) return;

    setBlockBusy(true);
    setThreadError(null);
    try {
      const accessToken = await resolveAccessToken();

      const response = await fetch("/api/connections/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          connId: activeMeta.connectionId,
          action: "block",
          reason: blockReason,
          note: blockNote.trim() || "User blocked from inbox quick action",
        }),
      });

      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Failed to block connection");
      }

      if (activeThreadToken) {
        await upsertThreadPrefs(activeDbThreadId, { archived_at: new Date().toISOString() });
        setArchivedThreads((prev) => ({ ...prev, [activeThreadToken]: true }));
      }
      setBlockOpen(false);
      setBlockReason("Safety concern");
      setBlockNote("");
      setThreadInfo("Member blocked. Conversation archived.");
      setReloadTick((v) => v + 1);
    } catch (e: unknown) {
      setThreadError(e instanceof Error ? e.message : "Failed to block member.");
    } finally {
      setBlockBusy(false);
    }
  }, [activeDbThreadId, activeMeta?.connectionId, activeThreadToken, blockNote, blockReason, resolveAccessToken, upsertThreadPrefs]);

  const updateGroupChatMode = useCallback(
    async (nextMode: GroupChatMode) => {
      if (!activeCurrentGroup?.id || !activeCurrentGroup.isHost) return;
      setGroupSettingsBusy(true);
      setThreadError(null);
      setThreadInfo(null);
      try {
        const updateRes = await supabase
          .from("groups")
          .update({ chat_mode: nextMode })
          .eq("id", activeCurrentGroup.id)
          .eq("host_user_id", meId)
          .select("id,host_user_id,title,description,chat_mode,city,country,cover_url,cover_status,max_members,invite_token,status,created_at,updated_at")
          .maybeSingle();
        if (updateRes.error) throw updateRes.error;
        const updatedGroup = mapGroupRows(updateRes.data ? [updateRes.data] : [])[0] ?? null;
        if (!updatedGroup) throw new Error("Failed to update group chat mode.");
        const isHost = updatedGroup.hostUserId === meId;
        const canPost = isHost || updatedGroup.chatMode === "discussion";
        const nextGroup: ActiveGroupThreadRecord = { ...updatedGroup, isHost };
        setActiveCurrentGroup(nextGroup);
        setActiveMeta((prev) =>
          prev && prev.kind === "group"
            ? {
                ...prev,
                avatarUrl: updatedGroup.coverUrl,
                groupChatMode: updatedGroup.chatMode,
                canPostToGroupThread: canPost,
                isGroupHost: isHost,
              }
            : prev
        );
        setThreads((prev) =>
          prev.map((thread) =>
            thread.groupId === updatedGroup.id
              ? {
                  ...thread,
                  avatarUrl: updatedGroup.coverUrl,
                  preview: thread.preview || updatedGroup.description || [updatedGroup.city ?? "", updatedGroup.country ?? ""].filter(Boolean).join(", ") || "No messages yet.",
                }
              : thread
          )
        );
        setThreadInfo(
          nextMode === "discussion"
            ? "Group chat now allows members to write."
            : "Group chat switched to organisers-only broadcast."
        );
      } catch (error) {
        setThreadError(error instanceof Error ? error.message : "Failed to update group chat settings.");
      } finally {
        setGroupSettingsBusy(false);
      }
    },
    [activeCurrentGroup, meId]
  );

  const activeIsArchived = Boolean(activeMeta?.messagingState === "archived" || (activeThreadToken && archivedThreads[activeThreadToken]));
  const activeIsPinned = Boolean(activeThreadToken && pinnedThreads[activeThreadToken]);
  const activeMuteUntil = activeThreadToken ? mutedUntilByThread[activeThreadToken] : undefined;
  const activeIsMuted = Boolean(activeMuteUntil && toTime(activeMuteUntil) > clockMs);
  const activeMuteRemaining = activeIsMuted ? formatRemaining(toTime(activeMuteUntil) - clockMs) : "";
  const monthlyActivationRemaining = useMemo(() => {
    if (!messagingSummary) return null;
    return Math.max(0, messagingSummary.monthlyLimit - messagingSummary.monthlyUsed);
  }, [messagingSummary]);
  const activeMessagingState: MessagingState = normalizeMessagingState(activeMeta?.messagingState, activeIsArchived ? "archived" : "inactive");
  const optimisticActivation = activeThreadToken ? optimisticActivatedByThread[activeThreadToken] ?? null : null;
  const chatActivationRecorded = Boolean(
    activeMeta?.activatedAt || activeMeta?.activationCycleStart || activeMeta?.activationCycleEnd || optimisticActivation?.activatedAt
  );
  const optimisticActivationLive = Boolean(
    optimisticActivation &&
      (!optimisticActivation.activationEnd || toTime(optimisticActivation.activationEnd) > clockMs)
  );
  const activationWindowLive = Boolean(
    optimisticActivationLive ||
      (chatActivationRecorded && (!activeMeta?.activationCycleEnd || toTime(activeMeta.activationCycleEnd) > clockMs))
  );
  const effectiveMessagingState: MessagingState =
    activeMessagingState === "archived" ? "archived" : optimisticActivationLive ? "active" : activeMessagingState;
  const chatActivated =
    effectiveMessagingState === "active" &&
    (optimisticActivationLive || (chatActivationRecorded ? activationWindowLive : hasHistoricalFreeText));
  const activeActivationEnd = optimisticActivation?.activationEnd || activeMeta?.activationCycleEnd || null;
  const activeActivationStart =
    optimisticActivation?.activatedAt || activeMeta?.activationCycleStart || activeMeta?.activatedAt || null;
  const activeConversationDaysLeft = useMemo(() => {
    if (!activeActivationEnd) return null;
    const endMs = toTime(activeActivationEnd);
    if (!endMs) return null;
    return Math.max(0, Math.ceil((endMs - clockMs) / DAY_MS));
  }, [activeActivationEnd, clockMs]);
  const activeConversationDaysLeftText = useMemo(() => {
    if (!chatActivated || activeConversationDaysLeft === null) return "";
    return `Active chat: ${formatDaysLeft(activeConversationDaysLeft)}`;
  }, [activeConversationDaysLeft, chatActivated]);
  const activeConversationNoticeBody = useMemo(() => {
    if (!chatActivated) return "";
    const startText = activeActivationStart ? ` started ${formatDateShort(activeActivationStart)}` : "";
    return `You started an active conversation${startText}. It stays active for 1 month.`;
  }, [activeActivationStart, chatActivated]);
  const hasUnlockedChatHistory = useMemo(
    () =>
      acceptedInteractionContexts.length > 0 ||
      ((activePrimaryContext?.contextTag ?? activeMeta?.contextTag ?? "regular_chat") === "regular_chat" && hasHistoricalFreeText),
    [acceptedInteractionContexts.length, activeMeta?.contextTag, activePrimaryContext?.contextTag, hasHistoricalFreeText]
  );
  const interactionStatus = useMemo<InteractionStatus>(() => {
    if (hasUnlockedChatHistory) return "accepted";
    if (activePendingContext && activePendingContext.contextTag !== "service_inquiry") return "pending";
    return "none";
  }, [activePendingContext, hasUnlockedChatHistory]);
  const requestLimitReached = Boolean(
    requestQuotaSummary && requestQuotaSummary.remaining !== null && requestQuotaSummary.remaining <= 0
  );
  const needsConversationActivation = Boolean(
    activeMeta &&
      !serviceInquiryOwnFlowState &&
      !interactionBlocked &&
      interactionStatus === "accepted" &&
      !chatActivated &&
      activeMeta.threadId
  );
  const activationRequiredToStart = Boolean(needsConversationActivation && !activationWindowLive);
  const concurrentLimitReachedForStart = Boolean(
    messagingSummary && needsConversationActivation && messagingSummary.activeCount >= messagingSummary.activeLimit
  );
  const monthlyLimitReachedForStart = Boolean(
    messagingSummary && activationRequiredToStart && monthlyActivationRemaining !== null && monthlyActivationRemaining <= 0
  );
  const chatFooterCtaState = useMemo<ChatFooterCtaState | null>(() => {
    if (!activeMeta || serviceInquiryOwnFlowState || interactionBlocked) return null;
    if (activeMeta.kind === "event" || activeMeta.kind === "group") return null;
    if (interactionStatus === "pending") return "pending";
    if (interactionStatus === "accepted" && !chatActivated && activeMeta.threadId) return "start_conversation";
    if (interactionStatus === "none" && activeMeta.otherUserId) return "request_connect";
    return null;
  }, [activeMeta, chatActivated, interactionBlocked, interactionStatus, serviceInquiryOwnFlowState]);
  const composerLockReason = useMemo(() => {
    if (!activeMeta) return null;
    if (interactionBlocked) {
      return "Messaging is disabled for this thread.";
    }
    if (activeMeta.kind === "group") {
      return activeMeta.canPostToGroupThread === false ? "Only organisers can post in this group thread." : null;
    }
    if (activeMeta.kind === "event" && activeMeta.canPostToEventThread === false) {
      return activeMeta.eventChatMode === "broadcast"
        ? "Only organisers can post in this event thread."
        : "You need to be a member of this event to post.";
    }
    if (acceptedInteractionContexts.length > 0) {
      return activeMeta.threadId && !chatActivated
        ? "Start conversation to activate chat."
        : null;
    }
    if (serviceInquiryOwnFlowState) {
      if (serviceInquiryOwnFlowState === "followup_available") {
        return null;
      }
      if (serviceInquiryOwnFlowState === "followup_pending") {
        return viewerIsServiceInquiryRecipient
          ? "Accept the conversation to open normal chat."
          : "Waiting for the teacher to accept your follow-up.";
      }
      return viewerIsServiceInquiryRecipient
        ? "Review the inquiry and choose what information to share."
        : "Waiting for the teacher to review this professional inquiry.";
    }
    if (
      (activePrimaryContext?.contextTag ?? activeMeta.contextTag ?? "regular_chat") === "regular_chat" &&
      hasHistoricalFreeText
    ) {
      return activeMeta.threadId && !chatActivated
        ? "Start conversation to reactivate chat."
        : null;
    }

    const context = activePendingContext ?? activePrimaryContext;
    const contextTag = context?.contextTag ?? activeMeta.contextTag ?? "regular_chat";
    const statusTag = context?.statusTag ?? activeMeta.statusTag ?? "active";
    if (statusTag === "pending") {
      if (contextTag === "service_inquiry") {
        return viewerIsServiceInquiryRecipient
          ? "Review the inquiry and choose what information to share."
          : "Waiting for the teacher to review this professional inquiry.";
      }
      if (contextTag === "connection_request") return "Messaging unlocks once this connection request is accepted.";
      if (contextTag === "trip_join_request") return "Messaging unlocks after the trip request is accepted.";
      if (contextTag === "hosting_request") return "Messaging unlocks after the hosting request is accepted.";
      if (contextTag === "event_chat") return "Messaging unlocks after this event request is accepted.";
      if (contextTag === "activity") return "Messaging unlocks after at least one interaction in this thread is accepted.";
      return "Messaging unlocks once at least one request is accepted.";
    }
    if (statusTag === "declined" || statusTag === "cancelled") {
      if (activeMeta.kind === "event") return null;
      return "Messaging is locked until one interaction is accepted.";
    }
    if (activeMeta.kind === "event") return null;
    return "Messaging is locked until one interaction is accepted.";
  }, [
    acceptedInteractionContexts.length,
    activeMeta,
    activePendingContext,
    activePrimaryContext,
    chatActivated,
    hasHistoricalFreeText,
    interactionBlocked,
    serviceInquiryOwnFlowState,
    viewerIsServiceInquiryRecipient,
  ]);
  const showReadOnlyBroadcastFooter = Boolean(
    (activeMeta?.kind === "event" && activeMeta.canPostToEventThread === false) ||
      (activeMeta?.kind === "group" && activeMeta.canPostToGroupThread === false)
  );
  useEffect(() => {
    composerLockReasonRef.current = composerLockReason;
  }, [composerLockReason]);
  const composerDisabled = Boolean(composerLockReason || concurrentLimitReachedForStart || monthlyLimitReachedForStart);
  const canCreateActivity = Boolean(
    activeMeta?.otherUserId &&
      !interactionBlocked &&
      chatActivated &&
      meId &&
      (
        (activeMeta?.connectionId &&
          isChatUnlockingContext({
            contextTag: activePrimaryContext?.contextTag ?? activeMeta.contextTag ?? "regular_chat",
            statusTag: activePrimaryContext?.statusTag ?? activeMeta.statusTag ?? "active",
          })) ||
        acceptedInteractionContexts.some((context) => context.contextTag !== "activity")
      )
  );
  const memberUnavailableForConnection = Boolean(
    activeMeta?.otherUserId &&
      !contactSidebarLoading &&
      (!contactSidebar || Boolean(contactSidebarError))
  );
  const chatFooterCta = useMemo<{
    state: ChatFooterCtaState;
    label: string;
    helper: string;
    disabled: boolean;
  } | null>(() => {
    if (!chatFooterCtaState) return null;
    if (memberUnavailableForConnection) {
      return {
        state: "unavailable",
        label: "Not available in chat",
        helper: "This member is not available for chat right now",
        disabled: true,
      };
    }

    if (chatFooterCtaState === "pending") {
      return {
        state: "pending",
        label: "Request pending",
        helper: "You’ll be able to chat once accepted",
        disabled: true,
      };
    }

    if (chatFooterCtaState === "request_connect") {
      return {
        state: "request_connect",
        label: chatFooterBusy === "request" ? "Sending request..." : "Request to connect",
        helper: requestLimitReached ? "No requests left this month" : "Use 1 request to start a conversation",
        disabled: chatFooterBusy === "request" || requestLimitReached,
      };
    }

    return {
      state: "start_conversation",
      label: chatFooterBusy === "activate" ? "Starting..." : "Start conversation",
      helper:
        concurrentLimitReachedForStart
          ? `You have ${messagingSummary?.activeLimit ?? 10} active conversations. Archive one to continue.`
          : monthlyLimitReachedForStart
          ? "No conversations left this month"
          : "",
      disabled: chatFooterBusy === "activate" || concurrentLimitReachedForStart || monthlyLimitReachedForStart,
    };
  }, [
    chatFooterBusy,
    chatFooterCtaState,
    concurrentLimitReachedForStart,
    memberUnavailableForConnection,
    messagingSummary?.activeLimit,
    monthlyLimitReachedForStart,
    requestLimitReached,
  ]);
  const showChatFooterCta = Boolean(chatFooterCta);
  const acceptedStarterContext = useMemo(() => {
    const acceptedPrimary =
      activePrimaryContext && isChatUnlockingContext(activePrimaryContext)
        ? activePrimaryContext
        : null;
    if (acceptedPrimary?.contextTag === "trip_join_request" || acceptedPrimary?.contextTag === "hosting_request") {
      return acceptedPrimary;
    }

    return (
      acceptedInteractionContexts.find(
        (context) => context.contextTag === "trip_join_request" || context.contextTag === "hosting_request"
      ) ??
      acceptedInteractionContexts.find((context) => context.contextTag === "connection_request") ??
      acceptedPrimary ??
      null
    );
  }, [acceptedInteractionContexts, activePrimaryContext]);
  const acceptedStarterMessage = useMemo(
    () => buildAcceptedStarterMessage(acceptedStarterContext),
    [acceptedStarterContext]
  );
  useEffect(() => {
    if (!activeThreadToken || !chatActivated) return;
    if (!acceptedStarterContext) return;
    if (activeMessages.some((message) => (message.messageType ?? "text") === "text")) return;

    const existingDraft = threadDraftsRef.current[activeThreadToken] ?? "";
    if (existingDraft.trim() || threadBody.trim()) return;

    setThreadBody(acceptedStarterMessage);
  }, [
    acceptedStarterContext,
    acceptedStarterMessage,
    activeMessages,
    activeThreadToken,
    chatActivated,
    threadBody,
  ]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = threads.filter((thread) => {
      const isArchived = thread.messagingState === "archived" || Boolean(archivedThreads[thread.threadId]);
      const isUnread = thread.unreadCount > 0 || Boolean(manualUnreadByThread[thread.threadId]);
      const contextTag = thread.contextTag ?? (thread.kind === "event" ? "event_chat" : thread.kind === "trip" ? "trip_join_request" : "regular_chat");
      const isPendingRelationship = Boolean(thread.isRelationshipPending);
      const isActiveThread = thread.messagingState === "active" || thread.kind === "event" || thread.kind === "group";
      const kindMatches =
        kindFilter === "all"
          ? true
          : kindFilter === "event"
            ? thread.kind === "event"
          : kindFilter === "group"
            ? thread.kind === "group"
            : thread.kind !== "event" && thread.kind !== "group";

      if (activeTab === "all" && isArchived) return false;
      if (activeTab === "archived" && !isArchived) return false;
      if (activeTab === "pending" && (!isPendingRelationship || isArchived)) return false;
      if (activeTab === "active" && (isArchived || isPendingRelationship || !isActiveThread)) return false;
      if (!kindMatches && thread.threadId !== activeThreadToken) return false;

      if (!q) return true;
      const haystack = [
        thread.title,
        thread.subtitle,
        thread.preview,
        thread.badge,
        thread.metaLabel ?? "",
        CONTEXT_LABELS[contextTag],
        STATUS_LABELS[thread.statusTag ?? "active"],
        isUnread ? "unread" : "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    return rows.sort((a, b) => {
      if (activeTab === "active") {
        const aUnread = a.unreadCount > 0 || Boolean(manualUnreadByThread[a.threadId]);
        const bUnread = b.unreadCount > 0 || Boolean(manualUnreadByThread[b.threadId]);
        if (aUnread !== bUnread) return aUnread ? -1 : 1;
      }
      const aPinned = Boolean(pinnedThreads[a.threadId]);
      const bPinned = Boolean(pinnedThreads[b.threadId]);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return toTime(b.updatedAt) - toTime(a.updatedAt);
    });
  }, [activeTab, activeThreadToken, archivedThreads, kindFilter, manualUnreadByThread, pinnedThreads, query, threads]);
  const kindScopedThreads = useMemo(() => {
    return threads.filter((thread) => {
      if (kindFilter === "all") return true;
      if (kindFilter === "event") return thread.kind === "event";
      if (kindFilter === "group") return thread.kind === "group";
      return thread.kind !== "event" && thread.kind !== "group";
    });
  }, [kindFilter, threads]);
  const tabCounts = useMemo(() => {
    const counts = { all: 0, active: 0, pending: 0, archived: 0 };
    for (const thread of kindScopedThreads) {
      const isArchived = thread.messagingState === "archived" || Boolean(archivedThreads[thread.threadId]);
      const isPendingRelationship = Boolean(thread.isRelationshipPending);
      const isActiveThread = thread.messagingState === "active" || thread.kind === "event" || thread.kind === "group";
      if (isArchived) {
        counts.archived += 1;
      } else if (isPendingRelationship) {
        counts.pending += 1;
        counts.all += 1;
      } else if (isActiveThread) {
        counts.active += 1;
        counts.all += 1;
      } else {
        counts.all += 1;
      }
    }
    return counts;
  }, [archivedThreads, kindScopedThreads]);
  const kindCounts = useMemo(
    () => ({
      all: threads.length,
      connection: threads.filter((thread) => thread.kind !== "event" && thread.kind !== "group").length,
      event: threads.filter((thread) => thread.kind === "event").length,
      group: threads.filter((thread) => thread.kind === "group").length,
    }),
    [threads]
  );
  const inboxViewTabs = useMemo(() => {
    if (kindFilter === "event") {
    return [
      { key: "all", label: "All" },
      { key: "active", label: "Joined" },
      { key: "pending", label: "Requests" },
    ] as const;
    }
    if (kindFilter === "group") {
    return [
      { key: "all", label: "All" },
      { key: "active", label: "Joined" },
    ] as const;
  }
  return [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "pending", label: "Pending" },
  ] as const;
}, [kindFilter]);
  const inboxSectionLabel = useMemo(() => {
    if (activeTab === "archived") return "Archived";
    if (kindFilter === "all") return "";
    return inboxKindLabel(kindFilter);
  }, [activeTab, kindFilter]);
  useEffect(() => {
    const normalizedTab = normalizeInboxTabForKind(kindFilter, activeTab);
    if (normalizedTab === activeTab) return;
    setActiveTab(normalizedTab);
    router.replace(buildInboxUrl({ tab: normalizedTab, kind: kindFilter }), { scroll: false });
  }, [activeTab, buildInboxUrl, kindFilter, router]);

  const archivableActiveThreads = useMemo(
    () =>
      threads.filter(
        (thread) =>
          thread.threadId !== activeThreadToken &&
          !thread.isRelationshipPending &&
          thread.messagingState === "active" &&
          !archivedThreads[thread.threadId]
      ),
    [activeThreadToken, archivedThreads, threads]
  );

  useEffect(() => {
    if (activeMeta?.kind === "event") return;
    setConnectionEventsFeed([]);
    setConnectionEventsFeedLoading(false);
    setActiveCurrentEvent(null);
    setFeedLightboxUrl(null);
  }, [activeMeta?.kind]);

  useEffect(() => {
    if (activeMeta?.kind !== "event" || !meId || !activeCurrentEvent?.id) return;

    let cancelled = false;

    void (async () => {
      setConnectionEventsFeedLoading(true);
      try {
        const connRes = await supabase
          .from("connections")
          .select("requester_id,target_id")
          .or(`requester_id.eq.${meId},target_id.eq.${meId}`)
          .eq("status", "accepted")
          .is("blocked_by", null)
          .limit(200);
        if (connRes.error) throw new Error(connRes.error.message);

        const connUserIds = Array.from(
          new Set(
            ((connRes.data ?? []) as Array<{ requester_id?: string; target_id?: string }>)
              .map((row) => (row.requester_id === meId ? row.target_id ?? "" : row.requester_id ?? ""))
              .filter(Boolean)
          )
        );
        if (!connUserIds.length) {
          if (!cancelled) setConnectionEventsFeed([]);
          return;
        }

        const membersRes = await supabase
          .from("event_members")
          .select("event_id,user_id")
          .in("user_id", connUserIds)
          .in("status", ["host", "going", "waitlist"])
          .limit(1000);
        if (membersRes.error) throw new Error(membersRes.error.message);

        const eventIdToConnUsers: Record<string, string[]> = {};
        for (const rawRow of (membersRes.data ?? []) as Array<Record<string, unknown>>) {
          const eventId = asString(rawRow.event_id);
          const userId = asString(rawRow.user_id);
          if (!eventId || !userId || eventId === activeCurrentEvent.id) continue;
          if (!eventIdToConnUsers[eventId]) eventIdToConnUsers[eventId] = [];
          if (!eventIdToConnUsers[eventId].includes(userId)) eventIdToConnUsers[eventId].push(userId);
        }

        const feedEventIds = Object.keys(eventIdToConnUsers);
        if (!feedEventIds.length) {
          if (!cancelled) setConnectionEventsFeed([]);
          return;
        }

        const nowIso = new Date().toISOString();
        const eventsRes = await supabase
          .from("events")
          .select("*")
          .in("id", feedEventIds)
          .eq("status", "published")
          .gte("starts_at", nowIso)
          .order("starts_at", { ascending: true })
          .limit(24);
        if (eventsRes.error) throw new Error(eventsRes.error.message);

        const feedEvents = mapEventRows((eventsRes.data ?? []) as unknown[]);
        if (!feedEvents.length) {
          if (!cancelled) setConnectionEventsFeed([]);
          return;
        }

        const allConnUserIdsInFeed = Array.from(new Set(Object.values(eventIdToConnUsers).flat()));
        const profilesRes =
          allConnUserIdsInFeed.length > 0
            ? await supabase.from("profiles").select("user_id,display_name,avatar_url").in("user_id", allConnUserIdsInFeed).limit(200)
            : { data: [], error: null };
        if (profilesRes.error) throw new Error(profilesRes.error.message);

        const nameById: Record<string, string> = {};
        const avatarById: Record<string, string | null> = {};
        for (const rawProfile of (profilesRes.data ?? []) as Array<Record<string, unknown>>) {
          const userId = asString(rawProfile.user_id);
          if (!userId) continue;
          nameById[userId] = asString(rawProfile.display_name) || "Member";
          avatarById[userId] = typeof rawProfile.avatar_url === "string" && rawProfile.avatar_url.trim().length > 0 ? rawProfile.avatar_url : null;
        }

        const feed = feedEvents
          .map((eventRow) => {
            const connUsers = eventIdToConnUsers[eventRow.id] ?? [];
            return {
              id: eventRow.id,
              title: eventRow.title,
              city: eventRow.city ?? null,
              country: eventRow.country ?? null,
              startsAt: eventRow.startsAt ?? null,
              coverUrl: pickEventHeroUrl(eventRow) || pickEventFallbackHeroUrl(eventRow) || null,
              attendeeCount: connUsers.length,
              connectionNames: connUsers.slice(0, 3).map((uid) => nameById[uid] ?? "Member"),
              connectionAvatars: connUsers.slice(0, 3).map((uid) => avatarById[uid] ?? null),
            };
          })
          .filter((row) => row.attendeeCount > 0);

        if (!cancelled) setConnectionEventsFeed(feed);
      } catch {
        if (!cancelled) setConnectionEventsFeed([]);
      } finally {
        if (!cancelled) setConnectionEventsFeedLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeCurrentEvent?.id, activeMeta?.kind, meId]);

  useEffect(() => {
    const el = connectionFeedRef.current;
    if (!el || connectionEventsFeed.length === 0) return;

    const SPEED = 0.6;
    let raf = 0;
    let isDragging = false;
    let dragMoved = false;
    let dragStartX = 0;
    let dragScrollLeft = 0;
    let half = 0;

    raf = requestAnimationFrame(() => {
      half = el.scrollWidth / 4;
      const canScroll = el.scrollWidth > el.clientWidth + 10;

      const tick = () => {
        const canScrollNow = el.scrollWidth > el.clientWidth + 10;
        if (!isDragging && canScrollNow) {
          el.scrollLeft += SPEED;
          if (half > 0 && el.scrollLeft >= half) el.scrollLeft -= half;
        }
        raf = requestAnimationFrame(tick);
      };

      raf = requestAnimationFrame(tick);
    });

    const onPointerDown = (event: PointerEvent) => {
      isDragging = true;
      dragMoved = false;
      dragStartX = event.clientX;
      dragScrollLeft = el.scrollLeft;
      el.dataset.dragged = "0";
      el.style.cursor = "grabbing";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!isDragging) return;
      const delta = event.clientX - dragStartX;
      if (Math.abs(delta) > 6) {
        dragMoved = true;
        el.dataset.dragged = "1";
      }
      el.scrollLeft = dragScrollLeft - delta;
      if (half > 0) {
        if (el.scrollLeft < 0) el.scrollLeft += half;
        if (el.scrollLeft >= half) el.scrollLeft -= half;
      }
    };

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      el.style.cursor = "grab";
      window.setTimeout(() => {
        el.dataset.dragged = dragMoved ? "0" : el.dataset.dragged ?? "0";
      }, 0);
    };

    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    el.style.cursor = "grab";

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      el.style.cursor = "";
      delete el.dataset.dragged;
    };
  }, [connectionEventsFeed]);

  useEffect(() => {
    if (activeMeta?.kind === "group") return;
    setActiveCurrentGroup(null);
  }, [activeMeta?.kind]);

  useEffect(() => {
    if (loading) return;
    const activeStillVisible = activeThreadToken ? filtered.some((thread) => thread.threadId === activeThreadToken) : false;
    if (activeStillVisible) return;
    const nextThreadToken = filtered[0]?.threadId ?? null;
    if (nextThreadToken === activeThreadToken) return;
    setActiveThreadToken(nextThreadToken);
    router.replace(buildInboxUrl({ threadToken: nextThreadToken }), { scroll: false });
  }, [activeThreadToken, buildInboxUrl, filtered, loading, router]);

  useEffect(() => {
    if (searchParams.get("activity") !== "1") return;
    if (!canCreateActivity || activityComposerOpen) return;

    setActivityComposerOpen(true);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("activity");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `/messages?${nextQuery}` : "/messages", { scroll: false });
  }, [activityComposerOpen, canCreateActivity, router, searchParams]);

  useEffect(() => {
    if (!activityComposerOpen || !meId) return;
    (async () => {
      try {
        const [authData, countRes] = await Promise.all([
          supabase.auth.getUser(),
          supabase
            .from("activities")
            .select("id", { count: "exact", head: true })
            .eq("requester_id", meId)
            .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
        ]);
        setActivityRequestsUsed(countRes.count ?? 0);
        const meta = authData.data.user?.user_metadata ?? {};
        const profileRes = await supabase.from("profiles").select("verified").eq("user_id", meId).maybeSingle();
        const isVerified = (profileRes.data as { verified?: boolean } | null)?.verified === true;
        const { getPlanIdFromMeta, getPlanLimits } = await import("@/lib/billing/limits");
        const planId = getPlanIdFromMeta(meta, isVerified);
        setActivityRequestsLimit(getPlanLimits(planId).initiatedChatsPerMonth);
      } catch {}
    })();
  }, [activityComposerOpen, meId]);

  const filteredComposeConnections = useMemo(() => {
    const needle = composeQuery.trim().toLowerCase();
    if (!needle) return composeConnectionTargets;
    return composeConnectionTargets.filter((item) => `${item.displayName} ${item.subtitle}`.toLowerCase().includes(needle));
  }, [composeConnectionTargets, composeQuery]);

  const filteredComposeTrips = useMemo(() => {
    const needle = composeQuery.trim().toLowerCase();
    if (!needle) return composeTripTargets;
    return composeTripTargets.filter((item) => `${item.displayName} ${item.subtitle}`.toLowerCase().includes(needle));
  }, [composeQuery, composeTripTargets]);

  const threadStateBanner = useMemo<{
    tone: string;
    title: string;
    body: string;
    discrete?: boolean;
    ctaLabel?: string;
    ctaHref?: string;
    ctaAction?: () => void;
  } | null>(() => {
    if (!activeMeta) return null;
    if (showChatFooterCta) return null;

    if (activeServiceInquiryContext?.statusTag === "info_shared") {
      const followupBody = viewerIsServiceInquiryRequester
        ? canSendFreeServiceInquiryFollowup
          ? "You have 1 free follow-up available before this becomes a normal chat."
          : "Your free follow-up has already been used."
        : serviceInquiryFollowupUsed
        ? "The requester already used the free follow-up."
        : "The requester can still send 1 free follow-up message.";
      return {
        tone: "",
        discrete: true,
        title: "Details shared",
        body: followupBody,
      };
    }

    if (activeServiceInquiryContext?.statusTag === "inquiry_followup_pending") {
      if (viewerIsServiceInquiryRecipient) {
        return {
          tone: "border-amber-300/25 bg-amber-400/10 text-amber-50",
          title: "Follow-up waiting",
          body: "Accept the conversation to convert this inquiry into a normal active chat.",
          ctaLabel: requestActionBusyId === `${activeServiceInquiryContext.id}:convert` ? "Activating..." : "Accept conversation",
          ctaAction: () => void convertServiceInquiryConversation(),
        };
      }

      return {
        tone: "",
        discrete: true,
        title: "Waiting for teacher approval",
        body: "Your free follow-up has been sent. The teacher can now accept the conversation.",
      };
    }

    if (activeMeta.isRelationshipPending && activePendingContext) {
      if (activePendingContext.contextTag === "service_inquiry") {
        return null;
      }
      const expiresInDays = daysUntilPendingExpiry(activePendingContext);
      return {
        tone: "",
        discrete: true,
        title: "Pending request",
        body:
          expiresInDays !== null
            ? `Expires in ${expiresInDays} day${expiresInDays === 1 ? "" : "s"}.`
            : "Waiting for the other member to respond.",
      };
    }

    if (monthlyLimitReachedForStart) {
      const limit = messagingSummary?.monthlyLimit ?? 10;
      return {
        tone: "border-fuchsia-300/30 bg-fuchsia-500/10 text-fuchsia-100",
        title: `You've used all ${limit} conversation starts this month`,
        body: "Upgrade to continue activating new conversations.",
        ctaLabel: "Upgrade to continue",
        ctaHref: "/pricing",
      };
    }

    if (concurrentLimitReachedForStart) {
      const limit = messagingSummary?.activeLimit ?? 10;
      return {
        tone: "border-rose-300/25 bg-rose-500/10 text-rose-100",
        title: `You have ${limit} active conversations`,
        body: "Archive one to continue.",
        ctaLabel: "View active threads",
        ctaAction: () => setArchiveToContinueOpen(true),
      };
    }

    if (activeMessagingState === "archived") {
      return {
        tone: "",
        discrete: true,
        title: "Archived conversation",
        body: "Start conversation to reactivate chat.",
      };
    }

    if (!composerLockReason) return null;

    return null;
  }, [
    activeMessagingState,
    activeMeta,
    activePendingContext,
    composerLockReason,
    concurrentLimitReachedForStart,
    messagingSummary?.activeLimit,
    messagingSummary?.monthlyLimit,
    monthlyLimitReachedForStart,
    activeServiceInquiryContext,
    convertServiceInquiryConversation,
    requestActionBusyId,
    canSendFreeServiceInquiryFollowup,
    serviceInquiryFollowupUsed,
    showChatFooterCta,
    viewerIsServiceInquiryRecipient,
    viewerIsServiceInquiryRequester,
  ]);

  const visibleActiveMessages = useMemo(
    () =>
      activeMessages.filter((message) => {
        const messageType = message.messageType ?? "text";
        if (messageType === "text") return true;
        // Include non-text messages that have renderable card content
        const meta = message.metadata ?? {};
        if (typeof meta.card_type === "string") return true; // e.g. teacher_inquiry_share
        const ctag = message.contextTag ?? "";
        if (ctag === "activity" || ctag === "service_inquiry") return true;
        if (messageType === "request") return true; // request lifecycle events
        return false;
      }),
    [activeMessages]
  );

  const chatRows = useMemo(() => {
    const rows: Array<
      { type: "day"; key: string; label: string } | { type: "unread"; key: string } | { type: "message"; key: string; message: MessageItem }
    > = [];
    let lastDay = "";
    let unreadInserted = false;
    const unreadAfterTime = activeLastReadAt ? toTime(activeLastReadAt) : 0;

    visibleActiveMessages.forEach((message) => {
      const date = new Date(message.createdAt);
      const dayKey = Number.isNaN(date.getTime())
        ? ""
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      if (dayKey && dayKey !== lastDay) {
        rows.push({
          type: "day",
          key: `day-${dayKey}`,
          label: formatChatDayLabel(message.createdAt),
        });
        lastDay = dayKey;
      }

      if (
        !unreadInserted &&
        unreadAfterTime > 0 &&
        message.senderId !== meId &&
        toTime(message.createdAt) > unreadAfterTime
      ) {
        rows.push({ type: "unread", key: `unread-${message.id}` });
        unreadInserted = true;
      }

      rows.push({
        type: "message",
        key: message.id,
        message,
      });
    });

    return rows;
  }, [activeLastReadAt, meId, visibleActiveMessages]);

  const parsedMessagesById = useMemo(() => {
    const map: Record<string, { replyToId: string | null; text: string }> = {};
    activeMessages.forEach((message) => {
      map[message.id] = parseReplyPayload(message.body);
    });
    return map;
  }, [activeMessages]);

  const messageById = useMemo(() => {
    const map: Record<string, MessageItem> = {};
    activeMessages.forEach((message) => {
      map[message.id] = message;
    });
    return map;
  }, [activeMessages]);

  const latestReadOutgoingMessageId = useMemo(() => {
    if (!meId || activeMeta?.kind !== "direct") return null;
    const peerReadTime = toTime(activePeerLastReadAt);
    if (peerReadTime <= 0) return null;

    let latestId: string | null = null;
    let latestTime = 0;

    activeMessages.forEach((message) => {
      if (message.senderId !== meId) return;
      if (message.status === "sending" || message.status === "failed" || message.localOnly) return;
      const createdAtMs = toTime(message.createdAt);
      if (createdAtMs <= 0 || createdAtMs > peerReadTime) return;
      if (createdAtMs >= latestTime) {
        latestTime = createdAtMs;
        latestId = message.id;
      }
    });

    return latestId;
  }, [activeMessages, activeMeta?.kind, activePeerLastReadAt, meId]);

  const scrollToLatest = useCallback((smooth = false) => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJumpToLatest(distance > 260);
    };
    onScroll();
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeThreadToken, activeMessages.length]);

  useEffect(() => {
    if (!activeThreadToken) return;
    const timer = window.setTimeout(() => scrollToLatest(false), 10);
    return () => window.clearTimeout(timer);
  }, [activeThreadToken, scrollToLatest]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el || activeMessages.length === 0) return;
    const last = activeMessages[activeMessages.length - 1];
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 180 || last?.senderId === meId) {
      scrollToLatest(true);
    }
  }, [activeMessages, meId, scrollToLatest]);

  useEffect(() => {
    if (!activeMeta?.threadId || !activeMeta.otherUserId || activeMeta.kind !== "direct") {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      const res = await supabase
        .from("thread_participants")
        .select("last_read_at")
        .eq("thread_id", activeMeta.threadId as string)
        .eq("user_id", activeMeta.otherUserId as string)
        .maybeSingle();
      if (cancelled || res.error) return;
      const row = res.data as { last_read_at?: string | null } | null;
      setActivePeerLastReadAt(row?.last_read_at ?? null);
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeMeta?.kind, activeMeta?.otherUserId, activeMeta?.threadId]);

  useEffect(() => {
    setPeerTyping(false);
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    const threadScopeId = activeMeta ? (activeMeta.kind === "connection" ? activeMeta.connectionId : activeMeta.threadId) : null;
    if (!meId || !activeMeta || !threadScopeId || !activeThreadToken) {
      if (typingChannelRef.current) {
        void supabase.removeChannel(typingChannelRef.current);
        typingChannelRef.current = null;
      }
      return;
    }

    if (typingChannelRef.current) {
      void supabase.removeChannel(typingChannelRef.current);
      typingChannelRef.current = null;
    }

    const channel = supabase.channel(`messages-typing-${activeMeta.kind}-${threadScopeId}`);
    channel.on("broadcast", { event: "typing" }, (payload) => {
      const actorId = typeof payload.payload?.userId === "string" ? payload.payload.userId : "";
      if (!actorId || actorId === meId) return;
      setPeerTyping(true);
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = window.setTimeout(() => {
        setPeerTyping(false);
        typingTimeoutRef.current = null;
      }, 2400);
    });
    channel.subscribe();
    typingChannelRef.current = channel;

    return () => {
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      void supabase.removeChannel(channel);
      if (typingChannelRef.current === channel) {
        typingChannelRef.current = null;
      }
    };
  }, [activeMeta, activeThreadToken, meId]);

  useEffect(() => {
    if (!meId || !activeMeta || !typingChannelRef.current) return;
    const trimmed = threadBody.trim();
    if (!trimmed) return;

    const now = Date.now();
    if (now - typingLastSentAtRef.current < 1200) return;
    typingLastSentAtRef.current = now;

    void typingChannelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: meId, at: now },
    });
  }, [activeMeta, meId, threadBody]);

  useEffect(() => {
    if (
      reactionsServerSupported ||
      !meId ||
      !activeMeta ||
      !activeThreadToken ||
      !supportsSyncedMessageReactions(activeMeta.kind)
    ) {
      return;
    }
    const threadScopeId = activeMeta.kind === "connection" ? activeMeta.connectionId : activeMeta.threadId;
    if (!threadScopeId) return;

    const timer = window.setTimeout(() => {
      void loadThreadReactions({
        kind: activeMeta.kind,
        threadScopeId,
        viewerId: meId,
        threadToken: activeThreadToken,
      });
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [activeMeta, activeThreadToken, loadThreadReactions, meId, reactionsServerSupported]);

  const copyMessageBody = useCallback(async (body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      setThreadInfo("Message copied.");
    } catch {
      setThreadError("Clipboard is unavailable in this browser.");
    }
  }, []);

  const toggleMessageReaction = useCallback(
    async (message: MessageItem, emoji: string) => {
      if (!meId || !activeMeta) return;

      const threadKind = activeMeta.kind;
      const threadScopeId = activeMeta.kind === "connection" ? activeMeta.connectionId : activeMeta.threadId;
      if (!threadScopeId) return;

      const current = messageReactions[message.id] ?? [];
      const existing = current.find((item) => item.emoji === emoji);
      const hasMine = Boolean(existing?.mine);

      const applyLocalToggle = () =>
        setMessageReactions((prev) => {
          const list = [...(prev[message.id] ?? [])];
          const index = list.findIndex((item) => item.emoji === emoji);

        if (hasMine) {
          if (index >= 0) {
            const item = list[index];
            const nextCount = Math.max(0, item.count - 1);
            if (nextCount === 0) {
              list.splice(index, 1);
            } else {
              list[index] = { ...item, count: nextCount, mine: false };
            }
          }
        } else if (index >= 0) {
          const item = list[index];
          list[index] = { ...item, count: item.count + 1, mine: true };
        } else {
          list.push({ emoji, count: 1, mine: true });
        }

        const next = { ...prev };
        if (list.length === 0) {
          delete next[message.id];
        } else {
          next[message.id] = list;
        }
          if (activeThreadToken) {
            setLocalReactionsByThread((prevStore) => ({ ...prevStore, [activeThreadToken]: next }));
          }
          return next;
        });

      applyLocalToggle();

      if (!supportsSyncedMessageReactions(threadKind)) {
        setThreadInfo("Reactions on this chat stay on this device for now.");
        return;
      }

      if (!reactionsServerSupported || message.localOnly) {
        return;
      }

      try {
        if (hasMine) {
          const res = await supabase
            .from("message_reactions")
            .delete()
            .eq("message_id", message.id)
            .eq("thread_kind", threadKind)
            .eq("thread_id", threadScopeId)
            .eq("reactor_id", meId)
            .eq("emoji", emoji);
          if (res.error) throw new Error(res.error.message);
        } else {
          const res = await supabase.from("message_reactions").insert({
            message_id: message.id,
            thread_kind: threadKind,
            thread_id: threadScopeId,
            reactor_id: meId,
            emoji,
          });
          if (res.error && !res.error.message.toLowerCase().includes("duplicate")) {
            throw new Error(res.error.message);
          }
        }

        await loadThreadReactions({
          kind: threadKind,
          threadScopeId,
          viewerId: meId,
          threadToken: activeThreadToken ?? undefined,
        });
      } catch (e: unknown) {
        const messageText = e instanceof Error ? e.message : "Failed to update reaction.";
        const lower = messageText.toLowerCase();
        if (
          lower.includes("relation") ||
          lower.includes("schema cache") ||
          lower.includes("does not exist") ||
          lower.includes("permission denied")
        ) {
          setReactionsServerSupported(false);
          setThreadInfo("Reactions are saved locally for now. Server sync will resume automatically.");
          return;
        }
        setThreadInfo("Reaction saved locally. Server sync is temporarily unavailable.");
      }
    },
    [activeMeta, activeThreadToken, loadThreadReactions, meId, messageReactions, reactionsServerSupported]
  );

  const focusMessageTarget = useCallback((messageId: string) => {
    const target = messageRefs.current[messageId];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    window.setTimeout(() => {
      setHighlightedMessageId((prev) => (prev === messageId ? null : prev));
    }, 1400);
  }, []);

  const onMessagePointerDown = useCallback((messageId: string, event: ReactPointerEvent) => {
    if (event.pointerType !== "touch") return;
    swipeGestureRef.current = {
      messageId,
      startX: event.clientX,
      startY: event.clientY,
      endX: event.clientX,
      endY: event.clientY,
    };
  }, []);

  const onMessagePointerMove = useCallback((messageId: string, event: ReactPointerEvent) => {
    if (event.pointerType !== "touch") return;
    if (!swipeGestureRef.current || swipeGestureRef.current.messageId !== messageId) return;
    swipeGestureRef.current.endX = event.clientX;
    swipeGestureRef.current.endY = event.clientY;
  }, []);

  const onMessagePointerUp = useCallback(
    (message: MessageItem, event: ReactPointerEvent) => {
      if (event.pointerType !== "touch") return;
      if (!swipeGestureRef.current || swipeGestureRef.current.messageId !== message.id) return;

      const { startX, startY, endX, endY } = swipeGestureRef.current;
      swipeGestureRef.current = null;

      const deltaX = endX - startX;
      const deltaY = endY - startY;
      if (Math.abs(deltaX) < 72 || Math.abs(deltaY) > 28) return;

      const parsed = parseReplyPayload(message.body);
      setReplyTo({
        id: message.id,
        senderId: message.senderId,
        body: parsed.text,
        createdAt: message.createdAt,
      });
    },
    []
  );

  const openReportFromMessage = useCallback((messageId: string) => {
    setReportFromMessageId(messageId);
    setReportOpen(true);
  }, []);

  const deleteOwnMessage = useCallback(
    async (message: MessageItem) => {
      if (!meId || message.senderId !== meId) return;
      if (message.localOnly) {
        setActiveMessages((prev) => prev.filter((item) => item.id !== message.id));
        setThreadInfo("Message removed.");
        return;
      }

      try {
        if (activeMeta?.kind === "connection" && activeMeta.connectionId) {
          const res = await supabase
            .from("messages")
            .delete()
            .eq("id", message.id)
            .eq("connection_id", activeMeta.connectionId)
            .eq("sender_id", meId);
          if (res.error) throw new Error(res.error.message);
        } else if ((activeMeta?.kind === "trip" || activeMeta?.kind === "direct" || activeMeta?.kind === "event" || activeMeta?.kind === "group") && activeMeta.threadId) {
          const res = await supabase
            .from("thread_messages")
            .delete()
            .eq("id", message.id)
            .eq("thread_id", activeMeta.threadId)
            .eq("sender_id", meId);
          if (res.error) throw new Error(res.error.message);
        } else {
          throw new Error("Delete is unavailable for this message.");
        }

        setActiveMessages((prev) => prev.filter((item) => item.id !== message.id));
        setThreadInfo("Message deleted.");
        setReloadTick((v) => v + 1);
      } catch (e: unknown) {
        setThreadError(e instanceof Error ? e.message : "Failed to delete message.");
      }
    },
    [activeMeta, meId]
  );

  return (
    <div className="font-sans flex h-[100dvh] max-h-[100svh] min-h-[100svh] flex-col overflow-hidden overscroll-none bg-[#08090c] text-white">
      <Nav />

      <main className="flex min-h-0 flex-1 overflow-hidden overscroll-none">
        <aside
          className={[
            "z-10 w-full min-h-0 flex-col overflow-hidden border-r border-white/10 bg-[linear-gradient(180deg,rgba(11,12,16,0.98),rgba(8,9,12,0.99))] md:w-[420px] lg:w-[440px] md:flex",
            mobileThreadOpen ? "hidden" : "flex",
          ].join(" ")}
        >
          <div className="flex flex-col gap-4 px-3 pt-4 pb-2 sm:px-4 sm:pt-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-baseline gap-2">
                  <h1 className="text-2xl font-bold leading-tight">Inbox</h1>
                  {inboxSectionLabel ? (
                    <span className="truncate bg-gradient-to-r from-[#6ee7f9] to-[#d946ef] bg-clip-text text-[11px] font-black uppercase tracking-[0.18em] text-transparent">
                      {inboxSectionLabel}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {messagingSummary ? (
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">Active chats</span>
                      <span className="text-[11px] font-bold tabular-nums text-white">{messagingSummary.monthlyUsed} / {messagingSummary.monthlyLimit}</span>
                    </div>
                  ) : null}
                  <button
                    aria-label="New Message"
                    onClick={() => setComposeOpen(true)}
                    className="flex size-10 items-center justify-center rounded-full bg-[#0df2f2]/10 text-[#0df2f2] transition-colors hover:bg-[#0df2f2]/20"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                      edit_square
                    </span>
                  </button>
                </div>
              </div>

            <div className="relative w-full h-11">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-[#90cbcb]">
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                  search
                </span>
              </div>
              <input
                ref={searchInputRef}
                className="block h-full w-full rounded-full border-none bg-black/30 py-2 pl-10 pr-3 text-sm text-white placeholder-[#90cbcb] transition-shadow focus:outline-none focus:ring-2 focus:ring-[#0df2f2]/50"
                placeholder="Search messages..."
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-1.5">
              {inboxViewTabs.map((tab) => {
                const selected = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => selectFilterTab(tab.key)}
                    data-testid={`thread-filter-${tab.key}`}
                    className={[
                      "min-h-8 shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                      selected
                        ? "border-[#0df2f2]/40 bg-[#0df2f2]/20 text-[#0df2f2]"
                        : "border-transparent bg-transparent text-[#90cbcb] hover:text-white",
                    ].join(" ")}
                  >
                    {tab.label}
                    <span
                      className={[
                        "ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums",
                        selected ? "bg-white/10" : "bg-transparent text-current/70",
                      ].join(" ")}
                    >
                      {tabCounts[tab.key]}
                    </span>
                  </button>
                );
              })}
              <div className="relative ml-auto" ref={inboxFilterMenuRef}>
                <button
                  type="button"
                  onClick={() => setInboxFilterMenuOpen((prev) => !prev)}
                  data-testid="thread-filter-menu-button"
                  className={[
                    "inline-flex min-h-8 shrink-0 items-center justify-center rounded-full border px-3 py-1 transition-colors",
                    inboxFilterMenuOpen || kindFilter !== "all" || activeTab === "archived"
                      ? "border-[#a855f7]/45 bg-[#24182f] text-[#f2d9ff]"
                      : "border-white/15 bg-white/[0.04] text-[#90cbcb] hover:text-white",
                  ].join(" ")}
                  aria-label="Open inbox filters"
                >
                  <span className="material-symbols-outlined text-[16px]">tune</span>
                </button>
                {inboxFilterMenuOpen ? (
                  <div
                    data-testid="thread-filter-menu"
                    className="absolute right-0 top-full z-40 mt-2 w-56 rounded-2xl border border-white/10 bg-[#11161d] p-2 shadow-2xl"
                  >
                    <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Thread type</p>
                    {([
                      { key: "all", label: "All types", count: kindCounts.all },
                      { key: "connection", label: "Connections", count: kindCounts.connection },
                      { key: "event", label: "Events", count: kindCounts.event },
                      { key: "group", label: "Groups", count: kindCounts.group },
                    ] as const).map((option) => {
                      const selected = kindFilter === option.key && activeTab !== "archived";
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => selectKindFilter(option.key)}
                          className={[
                            "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors",
                            selected ? "bg-[#24182f] text-[#f2d9ff]" : "text-slate-200 hover:bg-white/[0.05]",
                          ].join(" ")}
                        >
                          <span>{option.label}</span>
                          <span className="text-[11px] font-bold tabular-nums text-inherit/70">{option.count}</span>
                        </button>
                      );
                    })}
                    <div className="my-2 h-px bg-white/10" />
                    <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">View</p>
                    <button
                      type="button"
                      onClick={selectArchivedFilter}
                      className={[
                        "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors",
                        activeTab === "archived" ? "bg-[#24182f] text-[#f2d9ff]" : "text-slate-200 hover:bg-white/[0.05]",
                      ].join(" ")}
                    >
                      <span>Archived</span>
                      <span className="text-[11px] font-bold tabular-nums text-inherit/70">{tabCounts.archived}</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-1.5 overflow-y-auto overscroll-y-contain p-2">
            {error ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
            ) : null}
            {loading ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="flex min-h-[98px] items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-3 animate-pulse">
                    <div className="h-12 w-12 rounded-full bg-white/10" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="h-4 w-28 rounded bg-white/10" />
                        <div className="h-3 w-12 rounded bg-white/10" />
                      </div>
                      <div className="h-3 w-24 rounded bg-white/10" />
                      <div className="h-3 w-3/4 rounded bg-white/10" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-3 text-sm text-[#90cbcb]">No threads found for this filter.</div>
            ) : (
              <div className="animate-fade-in space-y-1.5">
              {filtered.map((thread) => {
                const mutedUntil = mutedUntilByThread[thread.threadId];
                const isMuted = Boolean(mutedUntil && toTime(mutedUntil) > clockMs);
                const isPinned = Boolean(pinnedThreads[thread.threadId]);
                const rowMenuOpen = openThreadRowMenuId === thread.threadId;
                const isUnread = thread.unreadCount > 0 || Boolean(manualUnreadByThread[thread.threadId]);
                const rowPreview = toSingleLineText(thread.preview.trim() || thread.subtitle.trim() || "No messages yet.", 84);
                const threadUsesCoverAvatar = thread.kind === "event" || thread.kind === "group";
                const activateThread = () => {
                  const nextKind = normalizeThreadKindFilter(thread.kind);
                  if (activeThreadToken === thread.threadId && typeof window !== "undefined" && !window.matchMedia("(max-width: 767px)").matches) {
                    setOpenThreadRowMenuId(null);
                    return;
                  }
                  setOpenThreadRowMenuId(null);
                  setKindFilter(nextKind);
                  setManualUnreadByThread((prev) => {
                    if (!prev[thread.threadId]) return prev;
                    const copy = { ...prev };
                    delete copy[thread.threadId];
                    return copy;
                  });
                  setThreads((prev) => prev.map((row) => (row.threadId === thread.threadId ? { ...row, unreadCount: 0 } : row)));
                  if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
                    router.push(buildInboxUrl({ threadToken: thread.threadId, kind: nextKind }), { scroll: false });
                    return;
                  }
                  setActiveThreadToken(thread.threadId);
                  router.replace(buildInboxUrl({ threadToken: thread.threadId, kind: nextKind }), { scroll: false });
                };
                return (
                  <div
                    key={thread.threadId}
                    className="relative group"
                    data-thread-token={thread.threadId}
                    onMouseEnter={() => {
                      if (isUnread) setHoveredUnreadThreadId(thread.threadId);
                    }}
                    onMouseLeave={() => {
                      setHoveredUnreadThreadId((prev) => (prev === thread.threadId ? null : prev));
                    }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      data-testid="thread-row"
                      data-thread-token={thread.threadId}
                      className={[
                        "w-full min-h-[86px] text-left group flex items-center gap-3 rounded-xl border bg-black/25 px-3 py-3 transition-colors",
                        activeThreadToken === thread.threadId
                          ? "border-[#db2777]/45 bg-[#241723]"
                          : "border-white/10 hover:border-[#25d1f4]/30 hover:bg-[#1c2224]",
                        recentlyUpdatedThreadIds[thread.threadId] ? "shadow-[0_0_0_1px_rgba(219,39,119,0.5),0_0_18px_rgba(219,39,119,0.18)]" : "",
                      ].join(" ")}
                      onClick={activateThread}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          activateThread();
                        }
                      }}
                    >
                      <div
                        className={[
                          "relative z-10 h-12 w-12 shrink-0 overflow-hidden border border-white/10 bg-[#223838]",
                          threadUsesCoverAvatar ? "rounded-2xl" : "rounded-full",
                        ].join(" ")}
                      >
                        {thread.avatarUrl ? (
                          <Image
                            src={thread.avatarUrl}
                            alt={thread.title}
                            fill
                            sizes="48px"
                            loader={remoteImageLoader}
                            unoptimized
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-cyan-100/80">
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                              {thread.kind === "event" ? "event" : thread.kind === "group" ? "groups" : "person"}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className={`truncate text-[15px] leading-tight ${isUnread ? "font-semibold text-white" : "font-medium text-[#e8f4f4]"}`}>
                              {thread.title}
                            </p>
                            <p className={`mt-1 truncate text-[13px] leading-snug ${isUnread ? "text-[#f5e6f0]" : "text-[#c3dddd]"}`}>
                              {rowPreview}
                            </p>
                          </div>
                          <div className="relative flex shrink-0 items-start gap-2 pl-1" data-thread-row-menu="true">
                            <div className="flex min-w-[36px] items-center justify-end gap-1">
                              <p className={`text-[11px] leading-tight ${isUnread ? "text-[#f472b6]" : "text-[#7fd8e0]"}`}>
                                {formatRelative(thread.updatedAt)}
                              </p>
                              {isUnread ? <span data-testid="thread-unread-dot" className="h-2 w-2 rounded-full bg-[#db2777]" /> : null}
                            </div>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenThreadRowMenuId((prev) => (prev === thread.threadId ? null : thread.threadId));
                              }}
                              data-testid="thread-row-menu-button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/5 hover:text-[#f5a5cf]"
                              aria-label="Thread row actions"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 13, lineHeight: 1 }}>
                                more_vert
                              </span>
                            </button>
                            {rowMenuOpen ? (
                              <div
                                className="absolute right-0 top-full z-40 mt-1 w-40 rounded-xl border border-white/10 bg-[#101616] p-1 shadow-xl"
                                onClick={(event) => event.stopPropagation()}
                                data-thread-row-menu="true"
                                data-testid="thread-row-menu"
                              >
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void setThreadUnreadState(thread, !isUnread);
                                  }}
                                  data-testid={isUnread ? "thread-mark-read" : "thread-mark-unread"}
                                  className="flex w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-xs text-slate-200 hover:border-[#f39acb]/35 hover:bg-[#f39acb]/10"
                                >
                                  <span className="material-symbols-outlined text-sm">
                                    {isUnread ? "drafts" : "mark_email_unread"}
                                  </span>
                                  {isUnread ? "Mark as read" : "Mark as unread"}
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (archivedThreads[thread.threadId]) {
                                      void unarchiveThread(thread.threadId, thread.dbThreadId);
                                    } else {
                                      void archiveThread(thread.threadId, thread.dbThreadId);
                                    }
                                    setOpenThreadRowMenuId(null);
                                  }}
                                  data-testid={archivedThreads[thread.threadId] ? "thread-unarchive" : "thread-archive"}
                                  className="mt-1 flex w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-xs text-slate-200 hover:border-[#f39acb]/35 hover:bg-[#f39acb]/10"
                                >
                                  <span className="material-symbols-outlined text-sm">
                                    {archivedThreads[thread.threadId] ? "unarchive" : "archive"}
                                  </span>
                                  {archivedThreads[thread.threadId] ? "Unarchive" : "Archive"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                          {isPinned ? (
                            <span
                              data-testid="thread-pinned-indicator"
                              className="material-symbols-outlined shrink-0 text-fuchsia-200/90"
                              style={{ fontSize: 12 }}
                              title="Pinned"
                            >
                              keep
                            </span>
                          ) : null}
                          {isMuted ? (
                            <span
                              data-testid="thread-muted-indicator"
                              className="material-symbols-outlined shrink-0 text-slate-300/90"
                              style={{ fontSize: 12 }}
                              title="Muted"
                            >
                              notifications_off
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {hoveredUnreadThreadId === thread.threadId && isUnread ? (
                      <div className="absolute left-12 right-10 top-full z-50 mt-1.5 rounded-xl border border-white/10 bg-[#101616]/95 p-2.5 shadow-2xl backdrop-blur-sm">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#f39acb]">Unread preview</p>
                        <p
                          className="mt-1 text-[12px] leading-snug text-[#f1dde8]"
                          style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                        >
                          {rowPreview || "New activity in this chat."}
                        </p>
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void setThreadUnreadState(thread, false);
                              setHoveredUnreadThreadId(null);
                            }}
                            className="rounded-full border border-[#db2777]/40 bg-[#db2777]/15 px-2.5 py-1 text-[10px] font-semibold text-[#ffd9ee] hover:bg-[#db2777]/25"
                          >
                            Mark read
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              </div>
            )}
	          </div>
        </aside>

        <section
          className={[
            mobileThreadOpen ? "flex" : "hidden md:flex",
            "min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(10,11,15,0.99),rgba(7,8,11,0.99))]",
          ].join(" ")}
        >
          {showThreadPlaceholderSkeleton ? (
            <div className="flex h-full flex-col animate-pulse">
              {/* Header skeleton — matches real header */}
              <div className="flex min-h-[72px] items-center gap-4 border-b border-white/10 px-4 py-3 sm:px-6 md:min-h-[88px]">
                <div className="h-10 w-10 shrink-0 rounded-full bg-white/10" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-36 rounded bg-white/10" />
                  <div className="h-3 w-24 rounded bg-white/[0.07]" />
                </div>
                <div className="flex gap-2">
                  <div className="h-8 w-8 rounded-full bg-white/[0.06]" />
                  <div className="h-8 w-8 rounded-full bg-white/[0.06]" />
                </div>
              </div>
              {/* Messages area skeleton */}
              <div className="flex flex-1 flex-col gap-3 px-4 py-5 sm:px-6">
                <div className="flex justify-start"><div className="h-10 w-48 rounded-2xl bg-white/[0.07]" /></div>
                <div className="flex justify-end"><div className="h-10 w-40 rounded-2xl bg-white/[0.07]" /></div>
                <div className="flex justify-start"><div className="h-16 w-64 rounded-2xl bg-white/[0.07]" /></div>
                <div className="flex justify-end"><div className="h-10 w-52 rounded-2xl bg-white/[0.07]" /></div>
                <div className="flex justify-start"><div className="h-10 w-36 rounded-2xl bg-white/[0.07]" /></div>
              </div>
              {/* Input area skeleton */}
              <div className="border-t border-white/10 px-4 py-3 sm:px-6">
                <div className="h-11 w-full rounded-full bg-white/[0.07]" />
              </div>
            </div>
          ) : !activeMeta ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="max-w-md flex flex-col items-center">
                <div className="mb-6 rounded-full bg-[#162a2a] p-8">
                  <span className="material-symbols-outlined text-[#224949]" style={{ fontSize: 64 }}>
                    forum
                  </span>
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Thread Inbox</h2>
                <p className="text-[#90cbcb] mb-8">Select a connection or trip thread to start chatting.</p>
                <button
                  type="button"
                  onClick={() => setComposeOpen(true)}
                  className="flex items-center gap-2 rounded-full bg-[#0df2f2] px-6 py-3 font-bold text-[#052328] transition-all hover:bg-[#0be0e0]"
                >
                  <span className="material-symbols-outlined">add_comment</span>
                  <span>Start new thread</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <header className="flex min-h-[72px] items-center justify-between border-b border-white/10 bg-[linear-gradient(180deg,rgba(15,16,20,0.98),rgba(11,12,16,0.98))] px-4 py-3 sm:px-6 sm:py-4 md:h-[88px]">
                <div className="flex items-center gap-4 min-w-0">
                  {mobileThreadOpen ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveThreadToken(null);
                        router.replace(buildInboxUrl({ threadToken: null }));
                      }}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/20 text-slate-200 hover:border-cyan-300/35 hover:text-cyan-100 md:hidden"
                      aria-label="Back to inbox"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        arrow_back
                      </span>
                    </button>
                  ) : null}
                  {activeMeta.otherUserId ? (
                    <Link href={`/profile/${activeMeta.otherUserId}`} className="shrink-0">
                      <div className="relative h-10 w-10 overflow-hidden rounded-full border border-white/10 bg-[#223838] transition-colors hover:border-cyan-300/40">
                        {activeMeta.avatarUrl ? (
                          <Image
                            src={activeMeta.avatarUrl}
                            alt={activeMeta.title}
                            fill
                            sizes="40px"
                            loader={remoteImageLoader}
                            unoptimized
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-cyan-100/80">
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                              person
                            </span>
                          </div>
                        )}
                      </div>
                    </Link>
                  ) : (
                    <div
                      className={[
                        "relative h-10 w-10 shrink-0 overflow-hidden border border-white/10 bg-[#223838]",
                        activeMeta.kind === "event" || activeMeta.kind === "group" ? "rounded-2xl" : "rounded-full",
                      ].join(" ")}
                    >
                      {activeMeta.avatarUrl ? (
                        <Image
                          src={activeMeta.avatarUrl}
                          alt={activeMeta.title}
                          fill
                          sizes="40px"
                          loader={remoteImageLoader}
                          unoptimized
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-cyan-100/80">
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                            {activeMeta.kind === "event" ? "event" : activeMeta.kind === "group" ? "groups" : "person"}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {activeMeta.otherUserId ? (
                        <Link href={`/profile/${activeMeta.otherUserId}`} className="truncate text-base font-bold text-white hover:text-cyan-200 sm:text-lg">
                          {activeMeta.title}
                        </Link>
                      ) : (
                        <h2 className="truncate text-base font-bold text-white sm:text-lg">{activeMeta.title}</h2>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-[#90cbcb] sm:text-xs">{activeMeta.subtitle}</p>
                  </div>
                </div>

                <div className="relative flex items-center gap-2" ref={threadActionsRef}>
                  {canCreateActivity ? (
                    <button
                      type="button"
                      onClick={() => setActivityComposerOpen(true)}
                      aria-label="Invite to activity"
                      className="select-none bg-gradient-to-r from-[#00F5FF] via-[#58E9FF] to-[#FF00FF] bg-clip-text text-[22px] font-black uppercase leading-none tracking-[-0.07em] text-transparent opacity-[0.18] transition-opacity hover:opacity-40 sm:text-[28px]"
                    >
                      Activity
                    </button>
                  ) : null}
                  {activeMeta.otherUserId && chatBookingAvailable ? (
                    <button
                      type="button"
                      onClick={() => setChatBookingOpen(true)}
                      className="inline-flex items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100 transition-colors hover:bg-cyan-300/16"
                    >
                      Book session
                    </button>
                  ) : null}
                  {threadPrefsInLocalMode ? (
                    <span className="hidden rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100 sm:inline-flex">
                      Local prefs mode
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setThreadActionsOpen((prev) => !prev)}
                    data-testid="thread-actions-button"
                    className="rounded-full border border-white/15 bg-black/20 p-2 text-slate-200 hover:border-cyan-300/35 hover:text-cyan-100"
                    aria-label="Thread actions"
                    title="Thread actions"
	                  >
	                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
	                      more_vert
	                    </span>
	                  </button>

                  {threadActionsOpen ? (
                    <div
                      className="absolute top-full right-0 mt-2 z-[80] w-56 rounded-xl border border-white/10 bg-[#111818] p-1 shadow-2xl"
                      data-testid="thread-actions-menu"
                    >
                      {activeThreadToken ? (
                        activeIsPinned ? (
                          <button
                            type="button"
                            onClick={() => {
                              void unpinThread(activeThreadToken, activeDbThreadId);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-unpin"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                          >
                            <span className="material-symbols-outlined text-base">keep_off</span>
                            Unpin
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              void pinThread(activeThreadToken, activeDbThreadId);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-pin"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                          >
                            <span className="material-symbols-outlined text-base">keep</span>
                            Pin to top
                          </button>
                        )
                      ) : null}

                      {activeThreadToken ? (
                        activeIsMuted ? (
                          <button
                            type="button"
                            onClick={() => {
                              void unmuteThread(activeThreadToken, activeDbThreadId);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-unmute"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                          >
                            <span className="material-symbols-outlined text-base">notifications_active</span>
                            Unmute ({activeMuteRemaining})
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                void muteThreadForHours(activeThreadToken, activeDbThreadId, 8);
                                setThreadActionsOpen(false);
                              }}
                              data-testid="thread-action-mute-8h"
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                            >
                              <span className="material-symbols-outlined text-base">notifications_off</span>
                              Mute for 8h
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void muteThreadForHours(activeThreadToken, activeDbThreadId, 24);
                                setThreadActionsOpen(false);
                              }}
                              data-testid="thread-action-mute-24h"
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                            >
                              <span className="material-symbols-outlined text-base">notifications_paused</span>
                              Mute for 24h
                            </button>
                          </>
                        )
                      ) : null}

                      {activeThreadToken ? (
                        activeIsArchived ? (
                          <button
                            type="button"
                            onClick={() => {
                              void unarchiveThread(activeThreadToken, activeDbThreadId);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-unarchive"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                          >
                            <span className="material-symbols-outlined text-base">unarchive</span>
                            Unarchive
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              void archiveThread(activeThreadToken, activeDbThreadId);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-archive"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                          >
                            <span className="material-symbols-outlined text-base">archive</span>
                            Archive
                          </button>
                        )
                      ) : null}

                      {activeMeta.kind === "group" && activeCurrentGroup?.isHost ? (
                        <>
                          <div className="my-1 h-px bg-white/10" />
                          <button
                            type="button"
                            onClick={() => {
                              void updateGroupChatMode(activeCurrentGroup.chatMode === "discussion" ? "broadcast" : "discussion");
                              setThreadActionsOpen(false);
                            }}
                            disabled={groupSettingsBusy}
                            data-testid="thread-action-toggle-group-chat-mode"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-base">
                              {activeCurrentGroup.chatMode === "discussion" ? "campaign" : "forum"}
                            </span>
                            {groupSettingsBusy
                              ? "Updating…"
                              : activeCurrentGroup.chatMode === "discussion"
                              ? "Switch to broadcast only"
                              : "Allow members to write"}
                          </button>
                        </>
                      ) : null}

                      {activeMeta.connectionId ? (
                        <>
                          <div className="my-1 h-px bg-white/10" />
                          <button
                            type="button"
                            onClick={() => {
                              setReportFromMessageId(null);
                              setReportOpen(true);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-report"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                          >
                            <span className="material-symbols-outlined text-base">flag</span>
                            Report
                          </button>
                          <button
                            type="button"
                            disabled={blockBusy}
                            onClick={() => {
                              setBlockOpen(true);
                              setThreadActionsOpen(false);
                            }}
                            data-testid="thread-action-block"
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-200 hover:bg-rose-500/15 disabled:opacity-60"
                          >
                            <span className="material-symbols-outlined text-base">block</span>
                            {blockBusy ? "Blocking..." : "Block"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </header>

              <div className="relative flex min-h-0 flex-1 flex-col">
                {pinnedPendingContexts.length > 0 ? (
                  <div
                    data-testid="thread-pending-contexts"
                    className="z-20 border-b border-cyan-300/12 bg-[linear-gradient(180deg,rgba(7,10,14,0.98),rgba(9,12,16,0.98))] px-4 py-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.22)] sm:px-6 sm:py-3"
                  >
                    <div className="space-y-2">
                      {pinnedPendingContexts.map((pendingContext) => {
                        const pendingContextActions = pendingActionsForContext(pendingContext);
                        const serviceInquiryDetails = describeServiceInquiryRequest(pendingContext);
                        const tripJoinDetails = describeTripJoinRequest(pendingContext);
                        const hostingRequestDetails = describeHostingRequest(pendingContext);
                        const allDetails = [...serviceInquiryDetails, ...tripJoinDetails, ...hostingRequestDetails];
                        const expiryDays = daysUntilPendingExpiry(pendingContext);
                        const metaDesc = describeContextMeta(pendingContext);
                        return (
                          <div
                            key={pendingContext.id}
                            data-testid="thread-pending-context-card"
                            className="rounded-xl px-3 py-2.5"
                            style={{ background: "linear-gradient(90deg, rgba(13,204,242,0.07) 0%, rgba(217,59,255,0.05) 100%)" }}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs text-slate-300">
                                  <span className="font-semibold text-slate-100">
                                    {pendingContext.title || CONTEXT_LABELS[pendingContext.contextTag]}
                                  </span>
                                  {metaDesc ? <span className="text-slate-500"> · {metaDesc}</span> : null}
                                  {expiryDays !== null ? (
                                    <span className="text-slate-500"> · expires in {expiryDays} day{expiryDays === 1 ? "" : "s"}</span>
                                  ) : null}
                                </p>
                                {allDetails.length > 0 ? (
                                  <p className="mt-0.5 text-[11px] text-slate-500">
                                    {allDetails.map((d) => `${d.label}: ${d.value}`).join(" · ")}
                                  </p>
                                ) : null}
                              </div>
                              {pendingContextActions.length > 0 ? (
                                <div className="flex shrink-0 items-center gap-2">
                                  {pendingContextActions.map((action) => {
                                    const busy = requestActionBusyId === `${pendingContext.id}:${action.key}`;
                                    const isAccept = action.key === "accept";
                                    const isDecline = action.key === "decline";
                                    return (
                                      <button
                                        key={`${pendingContext.id}:${action.key}`}
                                        type="button"
                                        onClick={() => void updateRequestContext(pendingContext.id, action.key)}
                                        disabled={Boolean(requestActionBusyId)}
                                        className={[
                                          "text-xs font-semibold transition-opacity disabled:opacity-50 hover:opacity-80",
                                          isAccept ? "text-emerald-300" : isDecline ? "text-rose-300" : "text-slate-300",
                                        ].join(" ")}
                                      >
                                        {busy ? "…" : action.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div
                  ref={chatScrollRef}
                  className="cx-scroll h-full overflow-y-auto overscroll-y-contain p-4 space-y-3 sm:p-6 sm:space-y-4"
                  onClick={() => {
                    setOpenMessageMenuId(null);
                    setComposerEmojiOpen(false);
                  }}
                >
                  {threadLoading ? (
                    <div className="text-sm text-[#90cbcb]">Loading conversation...</div>
                  ) : null}
                  {historicalThreadContexts.length > 0 ? (
                    <div className="divide-y divide-white/[0.05]">
                        {historicalThreadContexts.map((context) => {
                          const metaLabel = describeContextMeta(context);
                          const note = asString(context.metadata.note).trim();
                          const tripJoinReasonRaw =
                            context.contextTag === "trip_join_request"
                              ? asString(context.metadata.trip_join_reason).trim() ||
                                asString(context.metadata.reason).trim()
                              : "";
                          const tripJoinReason = tripJoinReasonRaw ? tripJoinReasonLabel(tripJoinReasonRaw) : "";
                          const hostingReasonRaw =
                            context.contextTag === "hosting_request"
                              ? asString(context.metadata.reason).trim()
                              : "";
                          const hostingReason =
                            hostingReasonRaw && asString(context.metadata.request_type).trim() === "request_hosting"
                              ? travelIntentReasonLabel(hostingReasonRaw)
                              : hostingReasonRaw;
                          const noteIsDuplicateTripJoinReason = Boolean(
                            tripJoinReasonRaw &&
                              note &&
                              note.localeCompare(tripJoinReasonRaw, undefined, { sensitivity: "accent" }) === 0
                          );
                          const noteIsDuplicateHostingReason = Boolean(
                            hostingReasonRaw &&
                              note &&
                              note.localeCompare(hostingReasonRaw, undefined, { sensitivity: "accent" }) === 0
                          );
                          const loggedAt = formatActivityDateTime(context.updatedAt || context.createdAt);
                          const activityType = asString(context.metadata.activity_type);
                          const contextReferenceTag =
                            context.contextTag === "activity" && activityType
                              ? normalizeReferenceContext(activityType)
                              : null;
                          const canReferenceFromCard =
                            context.statusTag === "completed" &&
                            context.contextTag === "activity" &&
                            Boolean(contextReferenceTag);
                          const cardHasPrompt = Boolean(
                            canReferenceFromCard && contextReferenceTag && activeReferencePromptTag === contextReferenceTag
                          );
                          const cardAlreadySubmitted = Boolean(
                            canReferenceFromCard &&
                              contextReferenceTag &&
                              submittedReferenceState.contextTags.has(contextReferenceTag)
                          );
                          return (
                            <div
                              key={context.id}
                              className="py-2.5"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <p className="text-[12px] font-medium text-slate-300">{contextHistoryTitle(context)}</p>
                                    <span className="text-[10px] uppercase tracking-[0.08em] text-slate-600">
                                      {STATUS_LABELS[context.statusTag]}
                                    </span>
                                    {metaLabel ? <span className="text-[10px] text-slate-600">{metaLabel}</span> : null}
                                  </div>
                                  {tripJoinReason ? (
                                    <p className="mt-0.5 text-[11px] leading-5 text-slate-600">Reason: {tripJoinReason}</p>
                                  ) : null}
                                  {!tripJoinReason && hostingReason ? (
                                    <p className="mt-0.5 text-[11px] leading-5 text-slate-600">Reason: {hostingReason}</p>
                                  ) : null}
                                  {note && !noteIsDuplicateTripJoinReason && !noteIsDuplicateHostingReason ? (
                                    <p className="mt-0.5 text-[11px] leading-5 text-slate-600">Note: {note}</p>
                                  ) : null}
                                  {cardHasPrompt ? (
                                    <p className="mt-0.5 text-[11px] text-cyan-300/70">Reference available</p>
                                  ) : cardAlreadySubmitted ? (
                                    <p className="mt-0.5 text-[11px] text-slate-600">Reference submitted</p>
                                  ) : null}
                                </div>
                                {loggedAt ? <span className="shrink-0 text-[10px] text-slate-600">{loggedAt}</span> : null}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ) : null}
                  {activeReferencePrompt ? (
                    <div
                      className="flex items-center justify-between gap-4 rounded-xl px-3 py-2.5"
                      style={{ background: "linear-gradient(90deg, rgba(13,204,242,0.07) 0%, rgba(217,59,255,0.05) 100%)" }}
                    >
                      <p className="text-xs text-slate-400">
                        <span className="font-medium text-slate-200">{referenceContextLabel(activeReferencePrompt.contextTag)}</span>
                        {" "}completed {formatDateShort(activeReferencePrompt.dueAt)}
                        {activeReferencePrompt.expiresAt ? <span className="text-slate-500"> · expires {formatDateShort(activeReferencePrompt.expiresAt)}</span> : null}
                      </p>
                      <Link
                        href={meId ? `/profile/${encodeURIComponent(meId)}?tab=references&userId=${encodeURIComponent(activeReferencePrompt.peerUserId)}` : `/references?userId=${encodeURIComponent(activeReferencePrompt.peerUserId)}`}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20 hover:border-cyan-300/60 transition-all"
                      >
                        <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>rate_review</span>
                        Leave reference
                      </Link>
                    </div>
                  ) : hasSubmittedLatestCompletedActivityReference && latestCompletedActivityReferenceTag ? (
                    <div
                      className="flex items-center justify-between gap-4 rounded-xl px-3 py-2.5"
                      style={{ background: "linear-gradient(90deg, rgba(16,185,129,0.06) 0%, rgba(13,204,242,0.04) 100%)" }}
                    >
                      <p className="text-xs text-slate-500">
                        <span className="font-medium text-emerald-300/80">{referenceContextLabel(latestCompletedActivityReferenceTag)}</span>
                        {" "}reference submitted
                        {submittedReferenceState.latestSubmittedAt ? <span> {formatDateShort(submittedReferenceState.latestSubmittedAt)}</span> : null}
                      </p>
                      <Link
                        href={meId ? `/profile/${encodeURIComponent(meId)}?tab=references` : "/references"}
                        className="shrink-0 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        View →
                      </Link>
                    </div>
                  ) : null}
                  {activeMeta?.otherUserId && hasAcceptedNonConnectionContext && !hasAcceptedConnectionContext && !interactionBlocked ? (
                    <div
                      className="flex items-center justify-between gap-4 rounded-xl px-3 py-2.5"
                      style={{ background: "linear-gradient(90deg, rgba(13,204,242,0.07) 0%, rgba(13,204,242,0.03) 100%)" }}
                    >
                      <p className="text-xs text-slate-400">Chat unlocked from an accepted request.</p>
                      <Link
                        href={`/profile/${activeMeta.otherUserId}`}
                        className="shrink-0 text-xs font-semibold text-cyan-300 hover:text-cyan-100 transition-colors"
                      >
                        Connect →
                      </Link>
                    </div>
                  ) : null}
                  <DismissibleBanner message={threadInfo} tone="info" onDismiss={() => setThreadInfo(null)} />
                  <DismissibleBanner message={threadError} tone="error" onDismiss={() => setThreadError(null)} />
                  {threadStateBanner ? (
                    threadStateBanner.discrete ? (
                      <div className="px-1 py-0.5">
                        <p className="text-xs font-semibold text-white/40">{threadStateBanner.title} <span className="font-normal">— {threadStateBanner.body}</span></p>
                      </div>
                    ) : (() => {
                      const toneGradient =
                        threadStateBanner.tone.includes("fuchsia") ? "linear-gradient(90deg, rgba(217,59,255,0.08) 0%, rgba(217,59,255,0.03) 100%)" :
                        threadStateBanner.tone.includes("rose") ? "linear-gradient(90deg, rgba(244,63,94,0.08) 0%, rgba(244,63,94,0.03) 100%)" :
                        threadStateBanner.tone.includes("amber") ? "linear-gradient(90deg, rgba(251,191,36,0.08) 0%, rgba(251,191,36,0.03) 100%)" :
                        "linear-gradient(90deg, rgba(13,204,242,0.07) 0%, rgba(13,204,242,0.03) 100%)";
                      const toneText =
                        threadStateBanner.tone.includes("fuchsia") ? "text-fuchsia-200" :
                        threadStateBanner.tone.includes("rose") ? "text-rose-200" :
                        threadStateBanner.tone.includes("amber") ? "text-amber-200" :
                        "text-cyan-200";
                      return (
                        <div
                          className="flex items-center justify-between gap-4 rounded-xl px-3 py-2.5"
                          style={{ background: toneGradient }}
                        >
                          <div className="min-w-0">
                            <p className={`text-xs font-semibold ${toneText}`}>{threadStateBanner.title}</p>
                            <p className="mt-0.5 text-[11px] text-slate-500">{threadStateBanner.body}</p>
                          </div>
                          {threadStateBanner.ctaHref ? (
                            <Link
                              href={threadStateBanner.ctaHref}
                              className={`shrink-0 text-xs font-semibold ${toneText} hover:opacity-80 transition-opacity`}
                            >
                              {threadStateBanner.ctaLabel} →
                            </Link>
                          ) : threadStateBanner.ctaAction ? (
                            <button
                              type="button"
                              onClick={threadStateBanner.ctaAction}
                              className={`shrink-0 text-xs font-semibold ${toneText} hover:opacity-80 transition-opacity`}
                            >
                              {threadStateBanner.ctaLabel} →
                            </button>
                          ) : null}
                        </div>
                      );
                    })()
                  ) : null}
                  {activeServiceInquiryContext &&
                  viewerIsServiceInquiryRecipient &&
                  (activeServiceInquiryContext.statusTag === "info_shared" ||
                    activeServiceInquiryContext.statusTag === "inquiry_followup_pending") ? (
                    <div className="flex flex-wrap items-center justify-end gap-4">
                      {activeServiceInquiryContext.statusTag === "inquiry_followup_pending" ? (
                        <button
                          type="button"
                          onClick={() => void convertServiceInquiryConversation()}
                          disabled={Boolean(requestActionBusyId)}
                          className="text-xs font-semibold text-emerald-300 transition-opacity hover:opacity-80 disabled:opacity-50"
                        >
                          {requestActionBusyId === `${activeServiceInquiryContext.id}:convert` ? "Activating…" : "Accept conversation"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void declineServiceInquiryConversation()}
                        disabled={Boolean(requestActionBusyId)}
                        className="text-xs font-semibold text-rose-300 transition-opacity hover:opacity-80 disabled:opacity-50"
                      >
                        {requestActionBusyId === `${activeServiceInquiryContext.id}:decline` ? "Declining…" : "Decline inquiry"}
                      </button>
                    </div>
                  ) : null}
                  {!threadDbSupported && activeMeta.kind === "trip" ? (
                    <div className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 p-3 text-sm text-cyan-50">
                      Trip chat needs thread migration enabled.
                    </div>
                  ) : null}
                  {!threadLoading && activeMessages.length === 0 ? (
                    activeMeta.kind === "event" ? (
                      <div className="py-12 text-center text-[#90cbcb] text-sm">No messages yet.</div>
                    ) : composerLockReason ? (
                      <div className="py-12 text-center text-[#90cbcb] text-sm">No messages yet.</div>
                    ) : (
                      <div className="py-10 space-y-4">
                        <div className="text-center text-[#90cbcb] text-sm">No messages yet. Start with a quick text:</div>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {QUICK_STARTERS.map((starter) => (
                            <button
                              key={starter}
                              type="button"
                              onClick={() => setThreadBody(starter)}
                              className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs text-slate-200 hover:border-cyan-300/35 hover:text-cyan-100"
                            >
                              {starter}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  ) : (
                    chatRows.map((row) => {
                      if (row.type === "day") {
                        return (
                          <div key={row.key} className="flex items-center justify-center py-2">
                            <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold tracking-wide text-slate-300">
                              {row.label}
                            </span>
                          </div>
                        );
                      }

                      if (row.type === "unread") {
                        return (
                          <div key={row.key} className="flex items-center gap-3 py-1.5">
                            <div className="h-px flex-1 bg-cyan-300/20" />
                            <span className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100">
                              Unread
                            </span>
                            <div className="h-px flex-1 bg-cyan-300/20" />
                          </div>
                        );
                      }

                      const message = row.message;
                      const mine = message.senderId === meId;
                      const showMenu = openMessageMenuId === message.id;
                      const showReportOption = Boolean(activeMeta.connectionId) && !mine;
                      const parsedMessage = parsedMessagesById[message.id] ?? parseReplyPayload(message.body);
                      const replyTarget = parsedMessage.replyToId ? messageById[parsedMessage.replyToId] ?? null : null;
                      const parsedReplyTarget = replyTarget ? parseReplyPayload(replyTarget.body) : null;
                      const isHighlightedTarget = highlightedMessageId === message.id;
                      const reactions = messageReactions[message.id] ?? [];
                      const showSeenByRecipient =
                        mine &&
                        activeMeta.kind === "direct" &&
                        Boolean(activePeerLastReadAt) &&
                        latestReadOutgoingMessageId === message.id;
                      const messageType = message.messageType ?? "text";
                      const messageContextTag = message.contextTag ?? activeMeta.contextTag ?? "regular_chat";
                      const messageStatusTag = message.statusTag ?? "active";

                      if (messageType !== "text") {
                        const teacherInquirySnapshot = parseTeacherInquiryShareSnapshot(message.metadata ?? {});
                        if (teacherInquirySnapshot) {
                          return (
                            <div
                              key={row.key}
                              ref={(node) => {
                                messageRefs.current[message.id] = node;
                              }}
                              className="mx-auto w-full max-w-3xl"
                            >
                              <TeacherInquiryCard snapshot={teacherInquirySnapshot} createdAt={message.createdAt} />
                            </div>
                          );
                        }

                        if (messageContextTag === "activity") {
                          const activityMeta = asRecord(message.metadata);
                          const activityTypeRaw = asString(activityMeta.activity_type);
                          const activityLabel = activityTypeRaw ? activityTypeLabel(activityTypeRaw) : "Activity";
                          const activityNote = asString(activityMeta.note).trim();
                          const activityWindow = formatActivityWindow(
                            asString(activityMeta.start_at) || undefined,
                            asString(activityMeta.end_at) || undefined
                          );
                          const actorLabel = mine ? "You" : activeMeta.title;
                          const statusLabel = STATUS_LABELS[messageStatusTag];
                          const summaryText =
                            messageStatusTag === "pending"
                              ? `${actorLabel} invited ${mine ? activeMeta.title : "you"} to ${activityLabel.toLowerCase()}.`
                              : messageStatusTag === "accepted"
                              ? `${activityLabel} accepted.`
                              : messageStatusTag === "declined"
                              ? `${activityLabel} declined.`
                              : messageStatusTag === "cancelled"
                              ? `${activityLabel} cancelled.`
                              : messageStatusTag === "completed"
                              ? `${activityLabel} completed.`
                              : parsedMessage.text;

                          return (
                            <div
                              key={row.key}
                              ref={(node) => {
                                messageRefs.current[message.id] = node;
                              }}
                              className="mx-auto w-full max-w-2xl"
                            >
                              <div className="overflow-hidden rounded-2xl border border-cyan-300/20 bg-[linear-gradient(145deg,rgba(10,29,34,0.72),rgba(32,12,37,0.42),rgba(14,17,23,0.94))]">
                                <div className="flex items-start gap-3 border-b border-white/10 px-4 py-3">
                                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(0,245,255,0.12),rgba(255,0,255,0.10))] text-cyan-100">
                                    <span className="material-symbols-outlined text-[20px]">{activityTypeIcon(activityTypeRaw)}</span>
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="text-base font-semibold text-white">{activityLabel}</p>
                                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusToneClasses(messageStatusTag)}`}>
                                        {statusLabel}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-sm text-slate-300">{summaryText}</p>
                                  </div>
                                  <span className="text-[11px] text-slate-400">{formatTime(message.createdAt)}</span>
                                </div>
                                <div className="space-y-3 px-4 py-3">
                                  <div className="flex flex-wrap gap-2">
                                    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-200">
                                      {referenceContextLabel(activityTypeRaw || "collaborate")}
                                    </span>
                                    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-300">
                                      {activityWindow}
                                    </span>
                                  </div>
                                  {activityNote ? (
                                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/45">Note</p>
                                      <p className="mt-1.5 text-sm leading-6 text-slate-200">{activityNote}</p>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        }

                        const timelineAction =
                          messageType === "request"
                            ? messageStatusTag === "pending"
                              ? "request_created"
                              : messageStatusTag === "accepted"
                              ? "request_accepted"
                              : messageStatusTag === "declined"
                              ? "request_declined"
                              : messageStatusTag === "cancelled"
                              ? "request_cancelled"
                              : "request_updated"
                            : "system_event";

                        return (
                          <div
                            key={row.key}
                            ref={(node) => {
                              messageRefs.current[message.id] = node;
                            }}
                            className="mx-auto w-full max-w-2xl"
                          >
                            <div className="rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center rounded-full border border-white/20 bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-200">
                                  {timelineAction}
                                </span>
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${contextToneClasses(messageContextTag)}`}
                                >
                                  {CONTEXT_LABELS[messageContextTag]}
                                </span>
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusToneClasses(messageStatusTag)}`}
                                >
                                  {STATUS_LABELS[messageStatusTag]}
                                </span>
                                <span className="ml-auto text-[10px] text-slate-400">{formatTime(message.createdAt)}</span>
                              </div>
                              <p className="mt-1.5 text-sm text-slate-200">{parsedMessage.text}</p>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={row.key}
                          ref={(node) => {
                            messageRefs.current[message.id] = node;
                          }}
                          className={`group relative flex items-end gap-2 w-full ${mine ? "justify-end" : ""}`}
                        >
                          {!mine ? (
                            activeMeta.avatarUrl ? (
                              <div className="relative mb-1 h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/10 bg-[#223838]">
                                <Image
                                  src={activeMeta.avatarUrl}
                                  alt={activeMeta.title}
                                  fill
                                  sizes="36px"
                                  loader={remoteImageLoader}
                                  unoptimized
                                  className="object-cover"
                                />
                              </div>
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-[#224949] shrink-0 mb-1 flex items-center justify-center text-cyan-100/80">
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                                  person
                                </span>
                              </div>
                            )
                          ) : null}

                          <div
                            className={`relative flex max-w-[82%] flex-col gap-1 sm:max-w-[74%] md:max-w-[66%] ${mine ? "items-end" : "items-start"}`}
                            onPointerDown={(event) => onMessagePointerDown(message.id, event)}
                            onPointerMove={(event) => onMessagePointerMove(message.id, event)}
                            onPointerUp={(event) => onMessagePointerUp(message, event)}
                            onPointerCancel={() => {
                              swipeGestureRef.current = null;
                            }}
                          >
                            {replyTarget ? (
                              <button
                                type="button"
                                onClick={() => focusMessageTarget(replyTarget.id)}
                                onMouseEnter={() => setHighlightedMessageId(replyTarget.id)}
                                onMouseLeave={() =>
                                  setHighlightedMessageId((prev) => (prev === replyTarget.id ? null : prev))
                                }
                                className={[
                                  "max-w-full rounded-xl border px-2.5 py-1 text-left text-[11px] transition-colors",
                                  mine
                                    ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/15"
                                    : "border-white/15 bg-white/[0.03] text-slate-200 hover:bg-white/[0.06]",
                                ].join(" ")}
                                title="Jump to replied message"
                              >
                                <span className="block font-semibold text-[10px] uppercase tracking-wide opacity-80">
                                  Reply to {replyTarget.senderId === meId ? "you" : activeMeta?.title ?? "member"}
                                </span>
                                <span className="mt-0.5 block truncate">
                                  {toSingleLineText(parsedReplyTarget?.text ?? replyTarget.body, 84)}
                                </span>
                              </button>
                            ) : null}

                            <div className={`flex w-full items-center gap-1 ${mine ? "justify-end" : "justify-start"}`}>
                              <div
                                className={[
                                  "inline-flex w-fit max-w-full px-2.5 py-1 rounded-2xl text-[13px] leading-snug transition-shadow",
                                  mine
                                    ? "bg-[#0df2f2] text-[#102323] rounded-br-none font-medium"
                                    : "bg-[#224949] text-white rounded-bl-none",
                                  isHighlightedTarget ? "ring-2 ring-cyan-300/70 shadow-[0_0_0_4px_rgba(34,211,238,0.12)]" : "",
                                ].join(" ")}
                              >
                                {parsedMessage.text}
                              </div>
                              <div className={`relative flex items-center ${mine ? "order-first" : ""}`}>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setOpenMessageMenuId((prev) => (prev === message.id ? null : message.id));
                                  }}
                                  className="px-1 text-white/25 transition-colors hover:text-white/60"
                                  aria-label="Message actions"
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>
                                    more_horiz
                                  </span>
                                </button>

                                {showMenu ? (
                                  <div
                                    className={`absolute z-[70] bottom-full mb-2 w-52 rounded-xl border border-white/10 bg-[#101616] p-1 shadow-xl ${
                                      mine ? "right-0" : "left-0"
                                    }`}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <div className="rounded-lg px-2 py-2">
                                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">React</p>
                                      <div className="flex flex-wrap items-center gap-1">
                                        {QUICK_REACTIONS.map((emoji) => (
                                          <button
                                            key={`${message.id}-${emoji}-menu`}
                                            type="button"
                                            disabled={message.localOnly}
                                            onClick={() => {
                                              void toggleMessageReaction(message, emoji);
                                              setOpenMessageMenuId(null);
                                            }}
                                            className={`rounded-full px-1.5 py-1 text-sm disabled:opacity-40 ${
                                              reactions.some((item) => item.emoji === emoji && item.mine) ? "bg-white/10" : "hover:bg-white/10"
                                            }`}
                                            title={
                                              reactions.some((item) => item.emoji === emoji && item.mine) ? `Remove ${emoji}` : `Add ${emoji}`
                                            }
                                          >
                                            {emoji}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="my-1 h-px bg-white/10" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void copyMessageBody(parsedMessage.text);
                                        setOpenMessageMenuId(null);
                                      }}
                                      className="flex w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-xs text-slate-200 hover:border-cyan-300/35 hover:bg-cyan-300/10"
                                    >
                                      <span className="material-symbols-outlined text-sm">content_copy</span>
                                      Copy
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReplyTo({
                                          id: message.id,
                                          senderId: message.senderId,
                                          body: parsedMessage.text,
                                          createdAt: message.createdAt,
                                        });
                                        setOpenMessageMenuId(null);
                                      }}
                                      className="mt-1 flex w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-xs text-slate-200 hover:border-cyan-300/35 hover:bg-cyan-300/10"
                                    >
                                      <span className="material-symbols-outlined text-sm">reply</span>
                                      Reply
                                    </button>
                                    {mine ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void deleteOwnMessage(message);
                                          setOpenMessageMenuId(null);
                                        }}
                                        className="mt-1 flex w-full items-center gap-2 rounded-full border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-left text-xs text-rose-100 hover:bg-rose-500/15"
                                      >
                                        <span className="material-symbols-outlined text-sm">delete</span>
                                        Delete
                                      </button>
                                    ) : null}
                                    {showReportOption ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          openReportFromMessage(message.id);
                                          setOpenMessageMenuId(null);
                                        }}
                                        className="mt-1 flex w-full items-center gap-2 rounded-full border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-left text-xs text-rose-100 hover:bg-rose-500/15"
                                      >
                                        <span className="material-symbols-outlined text-sm">flag</span>
                                        Report
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            {reactions.length > 0 ? (
                              <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : "justify-start"}`}>
                                {reactions.map((emoji) => (
                                  <button
                                    key={`${message.id}-${emoji.emoji}`}
                                    type="button"
                                    onClick={() => {
                                      void toggleMessageReaction(message, emoji.emoji);
                                    }}
                                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] hover:border-cyan-300/35 ${
                                      emoji.mine ? "border-cyan-300/45 bg-cyan-300/15 text-cyan-50" : "border-white/20 bg-black/25"
                                    }`}
                                    title={emoji.mine ? "Remove your reaction" : "Toggle reaction"}
                                  >
                                    <span>{emoji.emoji}</span>
                                    {emoji.count > 1 ? <span className="text-[10px] font-semibold">{emoji.count}</span> : null}
                                  </button>
                                ))}
                              </div>
                            ) : null}

                            <div className={`flex items-center gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                              <span className="text-[10px] text-slate-400">{formatTime(message.createdAt)}</span>
                              {mine && message.status === "sending" ? (
                                <span className="text-[10px] text-cyan-100/90" title="Sending">
                                  Sending…
                                </span>
                              ) : null}
                              {mine && message.status === "failed" ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const failedParsed = parseReplyPayload(message.body);
                                    if (failedParsed.replyToId && messageById[failedParsed.replyToId]) {
                                      const target = messageById[failedParsed.replyToId];
                                      const targetParsed = parseReplyPayload(target.body);
                                      setReplyTo({
                                        id: target.id,
                                        senderId: target.senderId,
                                        body: targetParsed.text,
                                        createdAt: target.createdAt,
                                      });
                                    }
                                    setThreadBody(failedParsed.text);
                                    setActiveMessages((prev) => prev.filter((item) => item.id !== message.id));
                                  }}
                                  className="text-[10px] text-rose-200 hover:text-rose-100 underline underline-offset-2"
                                  title="Failed to send. Click to retry"
                                >
                                  Retry
                                </button>
                              ) : null}
                              {mine && message.status !== "sending" && message.status !== "failed" ? (
                                (() => {
                                  const peerReadTime = toTime(activePeerLastReadAt);
                                  const isRead =
                                    activeMeta.kind === "direct" &&
                                    peerReadTime > 0 &&
                                    toTime(message.createdAt) > 0 &&
                                    toTime(message.createdAt) <= peerReadTime;
                                  const isDelivered = !message.localOnly;

                                  if (!isDelivered) {
                                    return (
                                      <span
                                        className="material-symbols-outlined text-slate-400"
                                        style={{ fontSize: 13 }}
                                        title="Sent"
                                        aria-label="Sent"
                                      >
                                        done
                                      </span>
                                    );
                                  }

                                  return (
                                    <span
                                      className={`material-symbols-outlined ${isRead ? "text-[#0df2f2]" : "text-slate-400"}`}
                                      style={{ fontSize: 14 }}
                                      title={isRead ? "Read" : "Delivered"}
                                      aria-label={isRead ? "Read" : "Delivered"}
                                    >
                                      done_all
                                    </span>
                                  );
                                })()
                              ) : null}
                            </div>

                            {showSeenByRecipient ? (
                              <div
                                className={`mt-0.5 flex items-center gap-1.5 text-[10px] ${mine ? "justify-end text-cyan-100/85" : "justify-start text-slate-400"}`}
                                title={`Seen by ${activeMeta.title}${activePeerLastReadAt ? ` at ${formatTime(activePeerLastReadAt)}` : ""}`}
                              >
                                <div className="relative h-4 w-4 overflow-hidden rounded-full border border-cyan-300/30 bg-[#204242]">
                                  {activeMeta.avatarUrl ? (
                                    <Image
                                      src={activeMeta.avatarUrl}
                                      alt={activeMeta.title}
                                      fill
                                      sizes="16px"
                                      loader={remoteImageLoader}
                                      unoptimized
                                      className="object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[9px] text-cyan-100/90">
                                      <span className="material-symbols-outlined" style={{ fontSize: 10 }}>
                                        person
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <span>Seen{activePeerLastReadAt ? ` • ${formatTime(activePeerLastReadAt)}` : ""}</span>
                              </div>
                            ) : null}

                          </div>

                          {mine ? (
                            meAvatarUrl ? (
                              <div className="relative mb-1 h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/10 bg-[#223838]">
                                <Image
                                  src={meAvatarUrl}
                                  alt="You"
                                  fill
                                  sizes="36px"
                                  loader={remoteImageLoader}
                                  unoptimized
                                  className="object-cover"
                                />
                              </div>
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-[#224949] shrink-0 mb-1 flex items-center justify-center text-cyan-100/80">
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                                  person
                                </span>
                              </div>
                            )
                          ) : null}
                        </div>
                      );
                    })
                  )}
                  {activeConversationNoticeBody ? (
                    <p className="px-2 py-2 text-center text-[11px] leading-5 text-slate-500">
                      {activeConversationNoticeBody}
                    </p>
                  ) : null}
                </div>

                {showJumpToLatest ? (
                  <button
                    type="button"
                    onClick={() => scrollToLatest(true)}
                    className="absolute bottom-4 right-4 rounded-full border border-cyan-300/35 bg-[#0d2324]/95 px-4 py-2 text-xs font-semibold text-cyan-100 shadow-[0_10px_25px_rgba(0,0,0,0.35)] hover:bg-[#123133] sm:right-6"
                  >
                    Jump to latest
                  </button>
                ) : null}
              </div>

                {activeMeta?.kind === "event" && (connectionEventsFeed.length > 0 || connectionEventsFeedLoading) ? (
                  <div className="shrink-0 overflow-hidden border-t border-white/[0.06] bg-[rgba(8,9,12,0.97)] pt-2.5 pb-2">
                    <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/25">Events your connections are attending</p>
                    {connectionEventsFeedLoading ? (
                      <div className="flex gap-2.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {[1, 2, 3, 4].map((i) => (
                          <div key={i} className="h-[120px] w-[130px] shrink-0 animate-pulse rounded-xl bg-white/[0.04]" />
                        ))}
                      </div>
                    ) : (
                      <div className="relative">
                        <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-12 bg-gradient-to-r from-[rgba(8,9,12,1)] to-transparent" />
                        <div className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-12 bg-gradient-to-l from-[rgba(8,9,12,1)] to-transparent" />
                        <div
                          data-feed
                          ref={connectionFeedRef}
                          className="flex cursor-grab gap-3 overflow-x-scroll px-4 pb-1 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                          style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
                        >
                          {[...connectionEventsFeed, ...connectionEventsFeed, ...connectionEventsFeed, ...connectionEventsFeed].map((ev, idx) => (
                            <a
                              key={`${ev.id}-${idx}`}
                              href={`/events/${ev.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              draggable={false}
                              onClick={(e) => {
                                if (connectionFeedRef.current?.dataset.dragged === "1") e.preventDefault();
                              }}
                              className="group relative w-[168px] shrink-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0b10] shadow-[0_4px_20px_rgba(0,0,0,0.5)] transition-all duration-300 hover:border-cyan-300/30 hover:shadow-[0_4px_24px_rgba(13,242,242,0.12)]"
                            >
                              <div className="relative h-[152px] w-full">
                                {ev.coverUrl ? (
                                  <button
                                    type="button"
                                    className="absolute inset-0 h-full w-full"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (connectionFeedRef.current?.dataset.dragged !== "1") setFeedLightboxUrl(ev.coverUrl);
                                    }}
                                  >
                                    <img src={ev.coverUrl} alt={ev.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                                      <span className="material-symbols-outlined rounded-full bg-black/50 p-1 text-white/80 backdrop-blur-sm" style={{ fontSize: 18 }}>
                                        open_in_full
                                      </span>
                                    </div>
                                  </button>
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center bg-[#0e0e1c]">
                                    <span className="material-symbols-outlined text-fuchsia-300/30" style={{ fontSize: 28 }}>
                                      calendar_month
                                    </span>
                                  </div>
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                                {ev.startsAt ? (
                                  <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/80 backdrop-blur-sm">
                                    {formatDateShort(ev.startsAt)}
                                  </span>
                                ) : null}
                                <div className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5 pt-6">
                                  <p className="line-clamp-2 text-[11px] font-bold leading-tight text-white drop-shadow-sm">{ev.title}</p>
                                  {ev.connectionNames.length > 0 ? (
                                    <div className="mt-1.5 flex items-center gap-1.5">
                                      <div className="flex -space-x-1.5">
                                        {ev.connectionAvatars.slice(0, 3).map((avatar, i) => (
                                          <div key={i} className="h-4 w-4 overflow-hidden rounded-full border border-black/60 bg-[#1a2030] ring-1 ring-black/40">
                                            {avatar ? (
                                              <img src={avatar} alt="" className="h-full w-full object-cover" />
                                            ) : (
                                              <div className="flex h-full w-full items-center justify-center text-[7px] font-bold text-cyan-100">
                                                {(ev.connectionNames[i] ?? "?").slice(0, 1).toUpperCase()}
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                      <p className="min-w-0 truncate text-[9px] font-medium text-cyan-300/70">
                                        {ev.connectionNames[0]}
                                        {ev.attendeeCount > 1 ? ` +${ev.attendeeCount - 1}` : ""}
                                      </p>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                {activeMeta?.kind !== "event" ? (
                <footer className="shrink-0 border-t border-white/10 bg-[linear-gradient(180deg,rgba(14,15,19,0.98),rgba(10,11,14,0.98))] p-2.5 sm:p-3">
                {replyTo ? (
                  <div className="mx-auto mb-2 max-w-4xl rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-cyan-100/90">
                        Replying to {replyTo.senderId === meId ? "you" : activeMeta?.title ?? "message"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-cyan-50/90">{replyTo.body.replace(/\s+/g, " ").trim()}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      className="shrink-0 rounded-full border border-white/20 p-1 text-slate-200 hover:border-cyan-300/35 hover:text-cyan-100"
                      aria-label="Cancel reply"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                        close
                      </span>
                    </button>
                  </div>
                ) : null}
                {showReadOnlyBroadcastFooter ? (
                  <div className="mx-auto max-w-4xl rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-3">
                    <p className="text-center text-[11px] uppercase tracking-[0.16em] text-cyan-300/70">
                      Group settings
                    </p>
                    <p className="mt-1 text-center text-sm text-slate-300">
                      {composerLockReason}
                    </p>
                  </div>
                ) : showChatFooterCta && chatFooterCta ? (
                  <div className="mx-auto max-w-4xl">
                    <div className="rounded-[26px] border border-white/10 bg-white/[0.03] px-3 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
                      <button
                        type="button"
                        onClick={() => {
                          if (chatFooterCta.state === "request_connect") {
                            openConnectRequestFromThread();
                            return;
                          }
                          if (chatFooterCta.state === "start_conversation") {
                            setShowActivateConfirm(true);
                          }
                        }}
                        disabled={chatFooterCta.disabled}
                        className={`inline-flex min-h-12 w-full items-center justify-center rounded-full px-4 text-sm font-semibold transition ${
                          chatFooterCta.disabled
                            ? "cursor-not-allowed border border-white/10 bg-white/[0.04] text-white/45"
                            : "bg-[linear-gradient(135deg,#0df2f2,#d93bff)] text-[#041316] shadow-[0_14px_28px_rgba(13,242,242,0.18)] hover:brightness-105"
                        }`}
                      >
                        {chatFooterCta.label}
                      </button>
                      <p className={`mt-2 text-center text-[11px] ${chatFooterCta.disabled ? "text-slate-400" : "text-[#90cbcb]"}`}>
                        {chatFooterCta.helper}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mx-auto flex max-w-4xl items-end gap-2">
                      <div className="relative mb-1 shrink-0">
                        <button
                          type="button"
                          disabled={composerDisabled}
                          onClick={() => setComposerEmojiOpen((prev) => !prev)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/25 text-slate-300 transition-colors hover:border-cyan-300/35 hover:text-cyan-100 disabled:opacity-50"
                          aria-label="Open emoji picker"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
                            sentiment_satisfied
                          </span>
                        </button>
                        {composerEmojiOpen ? (
                          <div className="absolute left-0 bottom-11 z-[80] w-44 rounded-xl border border-white/10 bg-[#101616] p-2 shadow-xl">
                            <div className="grid grid-cols-4 gap-1">
                              {QUICK_EMOJIS.map((emoji) => (
                                <button
                                  key={`composer-${emoji}`}
                                  type="button"
                                  onClick={() => {
                                    setThreadBody((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${emoji}`);
                                    setComposerEmojiOpen(false);
                                  }}
                                  className="rounded-lg px-1 py-1.5 text-lg transition-colors hover:bg-white/10"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="relative flex flex-1 items-end gap-1.5 rounded-full border border-slate-700/90 bg-black/35 px-2 py-1">
                        <textarea
                          ref={composerTextareaRef}
                          className="flex-1 resize-none border-none bg-transparent px-2 py-1.5 text-[14px] leading-5 text-white placeholder-slate-500 focus:ring-0 max-h-28"
                          placeholder={
                            composerLockReason
                              ? composerLockReason
                              : monthlyLimitReachedForStart
                              ? "Upgrade to activate more conversations."
                              : concurrentLimitReachedForStart
                              ? "Archive one active conversation to continue."
                              : "Type a message..."
                          }
                          rows={1}
                          disabled={composerDisabled}
                          value={threadBody}
                          onChange={(e) => setThreadBody(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              if (!sending) void sendActiveMessage();
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void sendActiveMessage()}
                          disabled={sending || composerDisabled || !threadBody.trim()}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0df2f2] text-[#052328] transition-colors hover:bg-[#0be0e0] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                            send
                          </span>
                        </button>
                      </div>
                    </div>
                    <div className="mx-auto mt-1 min-h-[16px] max-w-4xl">
                      {composerLockReason ? (
                        <p className="text-[10px] text-slate-300/85">
                          {composerLockReason}
                        </p>
                      ) : monthlyLimitReachedForStart ? (
                        <p className="text-[10px] text-fuchsia-200/90">
                          You&apos;ve used all {messagingSummary?.monthlyLimit ?? 10} conversation starts this month.
                        </p>
                      ) : concurrentLimitReachedForStart ? (
                        <p className="text-[10px] text-rose-200/90">
                          You have {messagingSummary?.activeLimit ?? 10} active conversations. Archive one to continue.
                        </p>
                      ) : activeConversationDaysLeftText ? (
                        <p className="text-[10px] text-slate-500">
                          {activeConversationDaysLeftText}
                        </p>
                      ) : threadPrefsInLocalMode ? (
                        <p className="text-[10px] text-slate-400">
                          Archive, mute, and pin are currently stored locally on this device.
                        </p>
                      ) : null}
                    </div>
                  </>
                )}
                </footer>
                ) : null}
              </div>

              <aside className="hidden xl:flex w-[340px] shrink-0 flex-col border-l border-white/10 bg-[linear-gradient(180deg,rgba(14,15,19,0.98),rgba(10,11,14,0.98))]">
                <div className="cx-scroll h-full overflow-y-auto py-0 space-y-0">
                  {activeMeta?.kind === "event" ? (
                    <div className="flex flex-col">
                      {activeCurrentEvent ? (
                        <Link href={`/events/${activeCurrentEvent.id}`} className="block shrink-0">
                          {pickEventHeroUrl(activeCurrentEvent) ? (
                            <img
                              src={pickEventHeroUrl(activeCurrentEvent)!}
                              alt={activeCurrentEvent.title}
                              className="h-44 w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-44 w-full items-center justify-center bg-gradient-to-br from-[#0e2a2f] to-[#1a0d2e]">
                              <span className="material-symbols-outlined text-[48px] text-cyan-200/20">event</span>
                            </div>
                          )}
                        </Link>
                      ) : (
                        <div className="h-44 w-full animate-pulse bg-white/[0.05]" />
                      )}

                      <div className="border-b border-white/[0.07] px-4 pt-3 pb-4">
                        {activeCurrentEvent ? (
                          <>
                            <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-cyan-300/70">{activeCurrentEvent.eventType}</p>
                            <Link href={`/events/${activeCurrentEvent.id}`} className="block text-[15px] font-bold leading-snug text-white hover:text-cyan-100 transition-colors">
                              {activeCurrentEvent.title}
                            </Link>
                            <div className="mt-2 space-y-1">
                              {(activeCurrentEvent.city || activeCurrentEvent.country) && (
                                <div className="flex items-center gap-1.5 text-[12px] text-white/50">
                                  <span className="material-symbols-outlined text-[13px] text-cyan-300/60">location_on</span>
                                  {[activeCurrentEvent.city, activeCurrentEvent.country].filter(Boolean).join(", ")}
                                </div>
                              )}
                              {activeCurrentEvent.startsAt && (
                                <div className="flex items-center gap-1.5 text-[12px] text-white/50">
                                  <span className="material-symbols-outlined text-[13px] text-cyan-300/60">calendar_month</span>
                                  {new Date(activeCurrentEvent.startsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                </div>
                              )}
                              {activeCurrentEvent.venueName && (
                                <div className="flex items-center gap-1.5 text-[12px] text-white/50">
                                  <span className="material-symbols-outlined text-[13px] text-cyan-300/60">place</span>
                                  {activeCurrentEvent.venueName}
                                </div>
                              )}
                            </div>
                            {activeCurrentEvent.description && (
                              <p className="mt-2.5 text-[12px] leading-relaxed text-white/40 line-clamp-3">{activeCurrentEvent.description}</p>
                            )}
                            <Link
                              href={`/events/${activeCurrentEvent.id}`}
                              className="mt-3 inline-flex items-center gap-1 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 transition hover:bg-cyan-300/15"
                            >
                              View event page
                              <span className="material-symbols-outlined text-[12px]">arrow_forward</span>
                            </Link>
                          </>
                        ) : (
                          <div className="space-y-2 animate-pulse">
                            <div className="h-3 w-16 rounded bg-white/[0.06]" />
                            <div className="h-5 w-3/4 rounded bg-white/[0.08]" />
                            <div className="h-3 w-1/2 rounded bg-white/[0.05]" />
                          </div>
                        )}
                      </div>
                      {activeCurrentEvent ? (
                        <div className="space-y-3 px-4 py-4">
                          <SidebarAccordion title="Thread mode">
                            <p className="mt-1 text-sm text-white">
                              {activeMeta.eventChatMode === "discussion" ? "Members can write in chat." : "Broadcast only. Organisers post updates."}
                            </p>
                            <p className="mt-1 text-[11px] text-white/45">
                              {activeMeta.canPostToEventThread
                                ? activeMeta.isEventHost
                                  ? "You can post updates in this thread."
                                  : "You can write here because this event is open for discussion."
                                : "Guests read updates here and browse related events below."}
                            </p>
                          </SidebarAccordion>
                          <SidebarAccordion title="Event settings">
                            <div className="mt-2 space-y-2 text-[12px] text-white/70">
                              <div className="flex items-center justify-between gap-3">
                                <span>Guest list visible</span>
                                <span className="font-semibold text-white">{activeCurrentEvent.showGuestList ? "Yes" : "No"}</span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span>Guests can invite</span>
                                <span className="font-semibold text-white">{activeCurrentEvent.guestsCanInvite ? "Yes" : "No"}</span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span>Messages need approval</span>
                                <span className="font-semibold text-white">{activeCurrentEvent.approveMessages ? "Yes" : "No"}</span>
                              </div>
                              {activeCurrentEvent.maxMembers ? (
                                <div className="flex items-center justify-between gap-3">
                                  <span>Capacity</span>
                                  <span className="font-semibold text-white">{activeCurrentEvent.maxMembers}</span>
                                </div>
                              ) : null}
                            </div>
                          </SidebarAccordion>
                          <SidebarAccordion title="Thread actions">
                            <div className="mt-3 flex flex-col gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!activeThreadToken) return;
                                  if (activeIsMuted) {
                                    void unmuteThread(activeThreadToken, activeDbThreadId);
                                  } else {
                                    void muteThreadForHours(activeThreadToken, activeDbThreadId, 8);
                                  }
                                }}
                                className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-300/15"
                              >
                                <span className="material-symbols-outlined text-[14px]">
                                  {activeIsMuted ? "notifications_active" : "notifications_off"}
                                </span>
                                {activeIsMuted ? `Unmute (${activeMuteRemaining})` : "Mute for 8h"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setReportOpen(true)}
                                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-white/80 transition hover:border-cyan-300/25 hover:text-cyan-100"
                              >
                                <span className="material-symbols-outlined text-[14px]">flag</span>
                                Report
                              </button>
                              {activeThreadToken ? (
                                <button
                                  type="button"
                                  onClick={() => void archiveThread(activeThreadToken, activeDbThreadId)}
                                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-white/80 transition hover:border-cyan-300/25 hover:text-cyan-100"
                                >
                                  <span className="material-symbols-outlined text-[14px]">archive</span>
                                  Archive thread
                                </button>
                              ) : null}
                            </div>
                          </SidebarAccordion>
                        </div>
                      ) : null}
                    </div>
                  ) : activeMeta?.kind === "group" ? (
                    <div className="flex flex-col">
                      {activeCurrentGroup ? (
                        <>
                          {activeCurrentGroup.coverUrl ? (
                            <img
                              src={activeCurrentGroup.coverUrl}
                              alt={activeCurrentGroup.title}
                              className="h-44 w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-44 w-full items-center justify-center bg-gradient-to-br from-[#0e2a2f] to-[#1a0d2e]">
                              <span className="material-symbols-outlined text-[48px] text-cyan-200/20">groups</span>
                            </div>
                          )}
                          <div className="border-b border-white/[0.07] px-4 pt-3 pb-4">
                            <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-cyan-300/70">Private group</p>
                            <p className="text-[15px] font-bold leading-snug text-white">{activeCurrentGroup.title}</p>
                            {(activeCurrentGroup.city || activeCurrentGroup.country) ? (
                              <div className="mt-2 flex items-center gap-1.5 text-[12px] text-white/50">
                                <span className="material-symbols-outlined text-[13px] text-cyan-300/60">location_on</span>
                                {[activeCurrentGroup.city, activeCurrentGroup.country].filter(Boolean).join(", ")}
                              </div>
                            ) : null}
                            {activeCurrentGroup.description ? (
                              <p className="mt-2.5 text-[12px] leading-relaxed text-white/40">{activeCurrentGroup.description}</p>
                            ) : null}
                          </div>
                          <div className="space-y-3 px-4 py-4">
                            <SidebarAccordion title="Chat mode">
                              <p className="mt-1 text-sm text-white">
                                {activeCurrentGroup.chatMode === "discussion" ? "Members can write in chat." : "Only organisers can post updates."}
                              </p>
                              {activeCurrentGroup.isHost ? (
                                <button
                                  type="button"
                                  onClick={() => void updateGroupChatMode(activeCurrentGroup.chatMode === "discussion" ? "broadcast" : "discussion")}
                                  disabled={groupSettingsBusy}
                                  className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:opacity-50"
                                >
                                  <span className="material-symbols-outlined text-[14px]">
                                    {activeCurrentGroup.chatMode === "discussion" ? "campaign" : "forum"}
                                  </span>
                                  {groupSettingsBusy
                                    ? "Updating…"
                                    : activeCurrentGroup.chatMode === "discussion"
                                    ? "Block member posting"
                                    : "Enable member posting"}
                                </button>
                              ) : null}
                            </SidebarAccordion>
                            <SidebarAccordion title="Members">
                              <p className="mt-1 text-sm text-white">{activeCurrentGroup.maxMembers} max members</p>
                            </SidebarAccordion>
                            <SidebarAccordion title="Thread actions">
                              <div className="mt-3 flex flex-col gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!activeThreadToken) return;
                                    if (activeIsMuted) {
                                      void unmuteThread(activeThreadToken, activeDbThreadId);
                                    } else {
                                      void muteThreadForHours(activeThreadToken, activeDbThreadId, 8);
                                    }
                                  }}
                                  className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-300/15"
                                >
                                  <span className="material-symbols-outlined text-[14px]">
                                    {activeIsMuted ? "notifications_active" : "notifications_off"}
                                  </span>
                                  {activeIsMuted ? `Unmute (${activeMuteRemaining})` : "Mute for 8h"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setReportOpen(true)}
                                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-white/80 transition hover:border-cyan-300/25 hover:text-cyan-100"
                                >
                                  <span className="material-symbols-outlined text-[14px]">flag</span>
                                  Report
                                </button>
                                {activeThreadToken ? (
                                  <button
                                    type="button"
                                    onClick={() => void archiveThread(activeThreadToken, activeDbThreadId)}
                                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-white/80 transition hover:border-cyan-300/25 hover:text-cyan-100"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">archive</span>
                                    Archive thread
                                  </button>
                                ) : null}
                              </div>
                            </SidebarAccordion>
                          </div>
                        </>
                      ) : (
                        <div className="space-y-2 px-4 py-5 animate-pulse">
                          <div className="h-44 rounded-2xl bg-white/[0.05]" />
                          <div className="h-4 w-20 rounded bg-white/[0.06]" />
                          <div className="h-5 w-3/4 rounded bg-white/[0.08]" />
                          <div className="h-3 w-1/2 rounded bg-white/[0.05]" />
                        </div>
                      )}
                    </div>
                  ) : contactSidebarLoading || contactSidebarError || contactSidebar ? (
                    <div className="px-4 py-5">
                      <ContactSidebarPanel
                        loading={contactSidebarLoading}
                        error={contactSidebarError}
                        contact={contactSidebar}
                      />
                    </div>
                  ) : (
                    <div className="px-4 py-5">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300">
                        Member details are available for 1:1 chats.
                      </div>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          )}
        </section>
      </main>

      {reportOpen ? (
        <ReportDialog
          reportBusy={reportBusy}
          reportError={reportError}
          reportFromMessageId={reportFromMessageId}
          reportReason={reportReason}
          reportNote={reportNote}
          reportReasonOptions={REPORT_REASON_OPTIONS}
          setReportReason={setReportReason}
          setReportNote={setReportNote}
          onClose={() => {
            if (reportBusy) return;
            setReportOpen(false);
            setReportError(null);
            setReportFromMessageId(null);
          }}
          onSubmit={() => void submitReport()}
        />
      ) : null}

      {archiveToContinueOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#101216] shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-lg font-semibold text-white">Archive one to continue</p>
                <p className="mt-1 text-sm text-slate-300">You have reached your active conversation limit.</p>
              </div>
              <button
                type="button"
                onClick={() => setArchiveToContinueOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-slate-300 hover:border-cyan-300/35 hover:text-cyan-100"
                aria-label="Close archive selector"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
              {archivableActiveThreads.length === 0 ? (
                <p className="text-sm text-slate-300">No other active conversations are available to archive right now.</p>
              ) : (
                <div className="space-y-3">
                  {archivableActiveThreads.map((thread) => (
                    <div
                      key={`archive-choice-${thread.threadId}`}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{thread.title}</p>
                        <p className="truncate text-xs text-slate-400">{thread.subtitle || thread.preview || "Conversation"}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void archiveThread(thread.threadId, thread.dbThreadId);
                          setArchiveToContinueOpen(false);
                        }}
                        className="inline-flex shrink-0 items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                      >
                        Archive
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {blockOpen ? (
        <BlockDialog
          blockBusy={blockBusy}
          blockReason={blockReason}
          blockNote={blockNote}
          setBlockReason={setBlockReason}
          setBlockNote={setBlockNote}
          onClose={() => {
            if (blockBusy) return;
            setBlockOpen(false);
          }}
          onConfirm={() => void blockConnection()}
        />
      ) : null}

      {composeOpen ? (
        <ComposeDialog
          composeQuery={composeQuery}
          filteredComposeConnections={filteredComposeConnections}
          filteredComposeTrips={filteredComposeTrips}
          setComposeQuery={setComposeQuery}
          onClose={() => {
            setComposeOpen(false);
            setComposeQuery("");
          }}
          onSelectConnection={(target) => {
            void (async () => {
              if (!meId || !target.otherUserId) return;
              try {
                const { data, error } = await supabase.rpc("cx_ensure_pair_thread", {
                  p_user_a: meId,
                  p_user_b: target.otherUserId,
                  p_actor: meId,
                });
                if (error) throw error;
                const threadId = typeof data === "string" ? data : null;
                if (!threadId) throw new Error("Failed to open direct thread.");
                const token = `direct:${threadId}`;
                setKindFilter("connection");
                setComposeOpen(false);
                setComposeQuery("");
                if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
                  router.push(buildInboxUrl({ threadToken: token, kind: "connection" }), { scroll: false });
                  return;
                }
                setActiveThreadToken(token);
                router.replace(buildInboxUrl({ threadToken: token, kind: "connection" }), { scroll: false });
              } catch (error) {
                setThreadError(error instanceof Error ? error.message : "Failed to open thread.");
              }
            })();
          }}
          onSelectTrip={(target) => {
            const token = `trip:${target.tripId}`;
            setKindFilter("connection");
            setComposeOpen(false);
            setComposeQuery("");
            if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
              router.push(buildInboxUrl({ threadToken: token, kind: "connection" }), { scroll: false });
              return;
            }
            setActiveThreadToken(token);
            router.replace(buildInboxUrl({ threadToken: token, kind: "connection" }), { scroll: false });
          }}
        />
      ) : null}

      {feedLightboxUrl ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={() => setFeedLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setFeedLightboxUrl(null)}
            className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
          <img
            src={feedLightboxUrl}
            alt=""
            className="max-h-[90dvh] max-w-full rounded-2xl object-contain shadow-[0_20px_60px_rgba(0,0,0,0.8)]"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}

      <DarkConnectModal
        open={connectRequestModal.open}
        onClose={() => setConnectRequestModal(EMPTY_CONNECT_REQUEST_MODAL)}
        targetUserId={connectRequestModal.targetUserId ?? ""}
        targetName={connectRequestModal.targetName}
        targetPhotoUrl={connectRequestModal.targetPhotoUrl}
        connectContext={connectRequestModal.connectContext}
        tripId={connectRequestModal.tripId}
      />

      {chatBookingOpen && activeMeta?.otherUserId ? (
        <BookSessionModal
          open={chatBookingOpen}
          mode="chat"
          teacherUserId={activeMeta.otherUserId}
          teacherName={activeMeta.title}
          teacherPhotoUrl={activeMeta.avatarUrl}
          initialServiceType="private_class"
          contextLabel={chatBookingContextLabel}
          onClose={() => setChatBookingOpen(false)}
          onSubmitted={(message) => {
            setThreadInfo(message);
            setChatBookingOpen(false);
          }}
        />
      ) : null}

      {activityComposerOpen && activeMeta?.otherUserId ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 px-3 py-3 backdrop-blur-md sm:items-center">
          <div
            data-testid="activity-composer-modal"
            className="relative w-full max-w-[520px] overflow-hidden rounded-[28px] border border-white/[0.08] shadow-[0_32px_80px_rgba(0,0,0,0.6)] sm:rounded-[32px]"
            style={{ background: "radial-gradient(circle at 15% 0%, rgba(13,204,242,0.08), transparent 45%), radial-gradient(circle at 85% 100%, rgba(217,59,255,0.08), transparent 45%), #080e14" }}
          >
            {/* Top-right cluster: [counter | close] then add member below */}
            <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-1.5">
                {activityRequestsLimit !== null && activityRequestsUsed !== null && (
                  <div className="flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-1 text-[10px]">
                    <span className={activityRequestsUsed >= activityRequestsLimit ? "font-bold text-rose-400" : activityRequestsUsed >= activityRequestsLimit * 0.8 ? "font-bold text-amber-400" : "font-semibold text-[#0df2f2]"}>
                      {activityRequestsUsed}/{activityRequestsLimit}
                    </span>
                    <span className="text-white/30">req/mo</span>
                  </div>
                )}
                <button type="button" disabled={activityBusy} onClick={() => { setActivityComposerOpen(false); setActivityNoteOpen(false); }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/40 hover:text-white transition-colors disabled:opacity-40" aria-label="Close">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
              {activitySupportsLinkedMember && (
                <button type="button" onClick={() => setActivityLinkedPickerOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/45 hover:text-white/80 transition-colors">
                  <span className="material-symbols-outlined text-[13px]">group_add</span>
                  Add member
                </button>
              )}
            </div>

            {/* Header */}
            <div className="flex items-center gap-4 px-6 pt-6 pb-5 border-b border-white/[0.07]">
              <div className="h-14 w-14 shrink-0 rounded-2xl border border-white/10 bg-cover bg-center"
                style={{ backgroundImage: activeMeta.avatarUrl ? `url(${activeMeta.avatarUrl})` : "linear-gradient(135deg, rgba(13,204,242,0.25), rgba(217,59,255,0.25))" }} />
              <div className="min-w-0 pr-24">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Invite to Activity</p>
                <h3 className="truncate text-xl font-extrabold tracking-tight text-white leading-tight">{activeMeta.title}</h3>
                <p className="text-[11px] text-white/35 mt-0.5">What would you like to do?</p>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="max-h-[min(65svh,520px)] overflow-y-auto overscroll-contain px-5 pt-5 pb-4 space-y-4">

              {activityPendingWarning ? <PendingRequestBanner message={activityPendingWarning} className="mb-1" /> : null}

              {activityComposerError ? (
                <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">
                  {activityComposerError}
                </p>
              ) : null}

              {/* Activity type icon grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ACTIVITY_TYPES.map((type) => {
                  const sel = activityDraft.activityType === type;
                  const icon = ACTIVITY_TYPE_ICONS[type] ?? "star";
                  return (
                    <button
                      key={type}
                      type="button"
                      data-testid={type === activityDraft.activityType ? "activity-type-select" : undefined}
                      onClick={() => setActivityDraft((prev) => ({ ...prev, activityType: type }))}
                      className={`group relative flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-center transition-all duration-150 ${
                        sel
                          ? "border-[#0df2f2]/40 bg-gradient-to-br from-[#0df2f2]/10 to-[#d93bff]/10 shadow-[0_0_16px_rgba(13,204,242,0.12)]"
                          : "border-white/[0.07] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]"
                      }`}
                    >
                      {sel && <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-[#0df2f2]/30" />}
                      <span
                        className={`material-symbols-outlined text-[20px] transition-colors ${sel ? "text-[#0df2f2]" : "text-white/40 group-hover:text-white/60"}`}
                        style={{ fontVariationSettings: sel ? "'FILL' 1" : "'FILL' 0" }}
                      >
                        {icon}
                      </span>
                      <span className={`text-[10px] font-semibold leading-tight transition-colors ${sel ? "text-white" : "text-white/55 group-hover:text-white/80"}`}>
                        {activityTypeLabel(type)}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Travel companion picker */}
              {activitySupportsLinkedMember && (activityDraft.linkedMemberUserId || activityLinkedPickerOpen) ? (
                <div className="space-y-2">
                  {activityDraft.linkedMemberUserId ? (
                    <p className="text-xs text-[#0df2f2]/70">
                      + {activityLinkedConnectionOptions.find((o) => o.userId === activityDraft.linkedMemberUserId)?.displayName ?? "Connection"}
                    </p>
                  ) : null}
                  {activityLinkedPickerOpen ? (
                    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 space-y-2">
                      <input type="text" value={activityLinkedMemberQuery}
                        onChange={(e) => setActivityLinkedMemberQuery(e.target.value)}
                        placeholder="Search connection…"
                        className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-[#0df2f2]/30 transition" />
                      <div className="max-h-40 space-y-1.5 overflow-y-auto">
                        <button type="button" onClick={() => setActivityDraft((prev) => ({ ...prev, linkedMemberUserId: "" }))}
                          className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${!activityDraft.linkedMemberUserId ? "border-[#0df2f2]/30 bg-[#0df2f2]/8 text-white" : "border-white/[0.07] bg-transparent text-white/60 hover:text-white"}`}>
                          <span>No companion</span>
                          {!activityDraft.linkedMemberUserId ? <span className="material-symbols-outlined text-[15px] text-[#0df2f2]">check</span> : null}
                        </button>
                        {filteredActivityLinkedConnectionOptions.map((option) => {
                          const isSelected = activityDraft.linkedMemberUserId === option.userId;
                          return (
                            <button key={option.userId} type="button"
                              onClick={() => { setActivityDraft((prev) => ({ ...prev, linkedMemberUserId: option.userId })); setActivityLinkedPickerOpen(false); setActivityLinkedMemberQuery(""); }}
                              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition ${isSelected ? "border-[#0df2f2]/30 bg-[#0df2f2]/8 text-white" : "border-white/[0.07] bg-transparent text-white/70 hover:text-white"}`}>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold">{option.displayName}</span>
                                {[option.city, option.country].filter(Boolean).join(", ") ? <span className="block truncate text-xs text-white/35">{[option.city, option.country].filter(Boolean).join(", ")}</span> : null}
                              </span>
                              {isSelected ? <span className="material-symbols-outlined text-[15px] text-[#0df2f2]">check</span> : null}
                            </button>
                          );
                        })}
                        {filteredActivityLinkedConnectionOptions.length === 0 ? (
                          <p className="px-3 py-3 text-sm text-white/35">No matching connections.</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Date */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setActivityDraft((prev) => ({ ...prev, dateMode: "set" }))}
                    className={`rounded-xl border px-3 py-2 text-[12px] font-semibold transition ${activityDraft.dateMode === "set" ? "border-[#0df2f2]/40 bg-[#0df2f2]/10 text-white" : "border-white/[0.07] bg-white/[0.03] text-white/55 hover:border-white/15"}`}>
                    Set date
                  </button>
                  <button type="button" onClick={() => setActivityDraft((prev) => ({ ...prev, dateMode: "none", startAt: "", endAt: "" }))}
                    className={`rounded-xl border px-3 py-2 text-[12px] font-semibold transition ${activityDraft.dateMode === "none" ? "border-[#0df2f2]/40 bg-[#0df2f2]/10 text-white" : "border-white/[0.07] bg-white/[0.03] text-white/55 hover:border-white/15"}`}>
                    No date
                  </button>
                </div>
                {activityDraft.dateMode === "set" && (
                  <div className={`grid gap-3 ${activityDraftUsesDateRange ? "grid-cols-2" : "grid-cols-1"}`}>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-white/40">calendar_today</span>
                      <input data-testid="activity-composer-start" type="date" value={activityDraft.startAt}
                        onChange={(e) => setActivityDraft((prev) => ({ ...prev, startAt: e.target.value }))}
                        className="dark-calendar-input w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-2.5 pl-9 pr-3 text-sm text-white outline-none focus:border-[#0df2f2]/30 transition" />
                    </div>
                    {activityDraftUsesDateRange && (
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-white/40">calendar_today</span>
                        <input data-testid="activity-composer-end" type="date" value={activityDraft.endAt}
                          onChange={(e) => setActivityDraft((prev) => ({ ...prev, endAt: e.target.value }))}
                          className="dark-calendar-input w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-2.5 pl-9 pr-3 text-sm text-white outline-none focus:border-[#0df2f2]/30 transition" />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Note — collapsible */}
              {!activityNoteOpen ? (
                <button type="button" onClick={() => setActivityNoteOpen(true)} className="flex items-center gap-1.5 text-xs text-white/35 hover:text-white/60 transition-colors">
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  Add a note
                </button>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Note (optional)</label>
                    <span className="text-[10px] text-white/25">{activityDraft.note.length}/600</span>
                  </div>
                  <textarea data-testid="activity-composer-note" autoFocus rows={3} maxLength={600}
                    value={activityDraft.note}
                    onChange={(e) => setActivityDraft((prev) => ({ ...prev, note: e.target.value }))}
                    placeholder="Add context, timing, or what you want to do together."
                    className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-white/25 outline-none focus:border-[#0df2f2]/30 focus:bg-white/[0.06] transition" />
                </div>
              )}
            </div>

            {/* Flush footer */}
            <div className="flex flex-col gap-2 border-t border-white/[0.07] px-5 py-4">
              <button type="button" disabled={activityBusy || Boolean(activityPendingWarning)}
                onClick={() => void submitActivityInvite()}
                data-testid="activity-composer-submit"
                className="h-12 w-full rounded-2xl text-sm font-bold tracking-wide text-[#040a0f] disabled:opacity-40 transition-all hover:brightness-110 hover:scale-[1.01] active:scale-[0.99]"
                style={{ backgroundImage: "linear-gradient(90deg, #0df2f2 0%, #7c3aff 50%, #ff00ff 100%)" }}>
                {activityBusy ? "Sending…" : "Send invite"}
              </button>
              <button type="button" disabled={activityBusy} onClick={() => { setActivityComposerOpen(false); setActivityNoteOpen(false); }}
                className="h-10 w-full rounded-2xl border border-white/[0.07] text-sm font-medium text-white/35 hover:border-white/15 hover:text-white/60 transition-colors disabled:opacity-40">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ShareInquiryInfoModal
        open={Boolean(shareInquiryContext)}
        inquiryLabel={
          shareInquiryContext && typeof shareInquiryContext.metadata.inquiry_kind === "string"
            ? SERVICE_INQUIRY_KIND_LABELS[shareInquiryContext.metadata.inquiry_kind as ServiceInquiryKind] ?? "Teaching services"
            : shareInquiryContext?.title || "Teaching services"
        }
        blocks={shareInquiryBlocks}
        busy={shareInquiryBusy}
        error={shareInquiryError}
        onClose={() => {
          if (shareInquiryBusy) return;
          setShareInquiryContext(null);
          setShareInquiryBlocks([]);
          setShareInquiryError(null);
        }}
        onConfirm={(payload) => void acceptServiceInquiryShare(payload)}
      />

      {/* Activate conversation confirmation modal */}
      {showActivateConfirm ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 backdrop-blur-md">
          <div
            className="relative w-full max-w-[400px] overflow-hidden rounded-[28px] border border-white/[0.08] p-6 shadow-[0_32px_80px_rgba(0,0,0,0.6)]"
            style={{ background: "radial-gradient(circle at 20% 0%, rgba(13,204,242,0.07), transparent 50%), radial-gradient(circle at 80% 100%, rgba(217,59,255,0.07), transparent 50%), #080e14" }}
          >
            <button
              type="button"
              onClick={() => setShowActivateConfirm(false)}
              className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/40 hover:text-white transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>

            <div className="mb-5 flex items-center gap-3">
              <div
                className="h-12 w-12 shrink-0 rounded-2xl border border-white/10 bg-cover bg-center"
                style={{ backgroundImage: activeMeta?.avatarUrl ? `url(${activeMeta.avatarUrl})` : "linear-gradient(135deg,rgba(13,204,242,0.25),rgba(217,59,255,0.25))" }}
              />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Activate chat with</p>
                <p className="text-lg font-bold text-white leading-tight">{activeMeta?.title ?? "this member"}</p>
              </div>
            </div>
            <p className="mb-5 text-center text-sm text-white/55">
              Active chats used: <span className="font-semibold text-white">{messagingSummary?.activeCount ?? "—"} / {messagingSummary?.activeLimit ?? "—"}</span>
            </p>

            <button
              type="button"
              disabled={chatFooterCta?.disabled ?? false}
              onClick={() => {
                setShowActivateConfirm(false);
                void activateConversationFromThread();
              }}
              className="h-12 w-full rounded-2xl text-sm font-bold tracking-wide text-[#040a0f] disabled:opacity-40 transition-all hover:brightness-110"
              style={{ backgroundImage: "linear-gradient(90deg, #0df2f2 0%, #7c3aff 50%, #ff00ff 100%)" }}
            >
              {chatFooterBusy === "activate" ? "Activating…" : "Start Conversation"}
            </button>
            <button
              type="button"
              onClick={() => setShowActivateConfirm(false)}
              className="mt-2 h-10 w-full rounded-2xl border border-white/[0.07] text-sm font-medium text-white/35 hover:text-white/60 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        .cx-scroll::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .cx-scroll::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.04);
          border-radius: 9999px;
        }
        .cx-scroll::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.45);
          border: 2px solid transparent;
          background-clip: padding-box;
          border-radius: 9999px;
        }
        .cx-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.72);
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .cx-scroll {
          scrollbar-color: rgba(148, 163, 184, 0.65) rgba(255, 255, 255, 0.04);
          scrollbar-width: thin;
        }
      `}</style>
    </div>
  );
}

function MessagesPageFallback() {
  return (
    <div className="font-sans flex h-[100dvh] flex-col overflow-hidden bg-[#0A0A0A] text-white">
      <Nav />
      <div className="flex-1 p-4 sm:p-6">
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
          Loading messages...
        </div>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<MessagesPageFallback />}>
      <MessagesPageContent />
    </Suspense>
  );
}
