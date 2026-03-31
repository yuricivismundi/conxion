import type { TeacherInfoBlock, TeacherInfoProfileConfig } from "@/lib/teacher-info/types";

export const SERVICE_INQUIRY_KINDS = [
  "private_class",
  "group_class",
  "workshop",
  "show",
  "organizer_collab",
  "other",
] as const;

export const SERVICE_INQUIRY_REQUESTER_TYPES = ["individual", "organizer"] as const;

export const SERVICE_INQUIRY_STATUSES = ["pending", "accepted", "declined", "expired"] as const;

export const SERVICE_INQUIRY_THREAD_STATUSES = [
  "pending",
  "info_shared",
  "inquiry_followup_pending",
  "active",
  "declined",
  "archived",
  "expired",
] as const;

export type ServiceInquiryKind = (typeof SERVICE_INQUIRY_KINDS)[number];
export type ServiceInquiryRequesterType = (typeof SERVICE_INQUIRY_REQUESTER_TYPES)[number];
export type ServiceInquiryStatus = (typeof SERVICE_INQUIRY_STATUSES)[number];
export type ServiceInquiryThreadStatus = (typeof SERVICE_INQUIRY_THREAD_STATUSES)[number];

export type ServiceInquiryRecord = {
  id: string;
  requesterId: string;
  recipientId: string;
  inquiryKind: ServiceInquiryKind;
  requesterType: ServiceInquiryRequesterType | null;
  requesterMessage: string | null;
  city: string | null;
  requestedDatesText: string | null;
  status: ServiceInquiryStatus;
  acceptedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ServiceInquiryThreadRecord = {
  id: string;
  inquiryId: string;
  threadId: string;
  sharedBlockIds: string[];
  requesterFollowupUsed: boolean;
  teacherIntroNote: string | null;
  createdAt: string;
};

export type TeacherInquiryShareSnapshot = {
  inquiryId: string;
  inquiryKind: ServiceInquiryKind;
  headline: string | null;
  introText: string | null;
  teacherIntroNote: string | null;
  teacherSummary: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    city: string | null;
    country: string | null;
  };
  selectedBlocks: TeacherInfoBlock[];
  profileConfig: TeacherInfoProfileConfig | null;
  sharedAt: string;
};

export const SERVICE_INQUIRY_KIND_LABELS: Record<ServiceInquiryKind, string> = {
  private_class: "Private classes",
  group_class: "Group classes",
  workshop: "Workshop",
  show: "Show / performance",
  organizer_collab: "Organizer collaboration",
  other: "Other",
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown) {
  const text = asString(value).trim();
  return text ? text : null;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function isServiceInquiryKind(value: unknown): value is ServiceInquiryKind {
  return typeof value === "string" && (SERVICE_INQUIRY_KINDS as readonly string[]).includes(value);
}

export function isServiceInquiryRequesterType(value: unknown): value is ServiceInquiryRequesterType {
  return typeof value === "string" && (SERVICE_INQUIRY_REQUESTER_TYPES as readonly string[]).includes(value);
}

export function isServiceInquiryStatus(value: unknown): value is ServiceInquiryStatus {
  return typeof value === "string" && (SERVICE_INQUIRY_STATUSES as readonly string[]).includes(value);
}

export function normalizeServiceInquiryRow(row: unknown): ServiceInquiryRecord | null {
  const record = asRecord(row);
  const id = asString(record.id).trim();
  const requesterId = asString(record.requester_id ?? record.requesterId).trim();
  const recipientId = asString(record.recipient_id ?? record.recipientId).trim();
  const inquiryKind = asString(record.inquiry_kind ?? record.inquiryKind).trim();
  const status = asString(record.status).trim();
  if (!id || !requesterId || !recipientId || !isServiceInquiryKind(inquiryKind) || !isServiceInquiryStatus(status)) {
    return null;
  }

  const requesterTypeValue = record.requester_type ?? record.requesterType;

  return {
    id,
    requesterId,
    recipientId,
    inquiryKind,
    requesterType: isServiceInquiryRequesterType(requesterTypeValue) ? requesterTypeValue : null,
    requesterMessage: asNullableString(record.requester_message ?? record.requesterMessage),
    city: asNullableString(record.city),
    requestedDatesText: asNullableString(record.requested_dates_text ?? record.requestedDatesText),
    status,
    acceptedAt: asNullableString(record.accepted_at ?? record.acceptedAt),
    declinedAt: asNullableString(record.declined_at ?? record.declinedAt),
    createdAt: asString(record.created_at ?? record.createdAt) || new Date(0).toISOString(),
    updatedAt: asString(record.updated_at ?? record.updatedAt) || new Date(0).toISOString(),
  };
}

export function normalizeServiceInquiryThreadRow(row: unknown): ServiceInquiryThreadRecord | null {
  const record = asRecord(row);
  const id = asString(record.id).trim();
  const inquiryId = asString(record.inquiry_id ?? record.inquiryId).trim();
  const threadId = asString(record.thread_id ?? record.threadId).trim();
  if (!id || !inquiryId || !threadId) return null;

  const sharedValue = record.shared_block_ids ?? record.sharedBlockIds;
  const sharedBlockIds = Array.isArray(sharedValue)
    ? sharedValue.filter((item): item is string => typeof item === "string")
    : typeof sharedValue === "string"
    ? (() => {
        try {
          const parsed = JSON.parse(sharedValue) as unknown;
          return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
        } catch {
          return [];
        }
      })()
    : [];

  return {
    id,
    inquiryId,
    threadId,
    sharedBlockIds,
    requesterFollowupUsed: asBoolean(record.requester_followup_used ?? record.requesterFollowupUsed, false),
    teacherIntroNote: asNullableString(record.teacher_intro_note ?? record.teacherIntroNote),
    createdAt: asString(record.created_at ?? record.createdAt) || new Date(0).toISOString(),
  };
}
