export const TEACHER_INFO_ATTACHMENTS_BUCKET = "teacher-info-assets";
export const TEACHER_INFO_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
export const TEACHER_INFO_ATTACHMENT_ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

function sanitizeFileNameSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "attachment";
}

export function isAcceptedTeacherInfoAttachmentMimeType(
  value: string
): value is (typeof TEACHER_INFO_ATTACHMENT_ACCEPTED_MIME_TYPES)[number] {
  return TEACHER_INFO_ATTACHMENT_ACCEPTED_MIME_TYPES.includes(
    value as (typeof TEACHER_INFO_ATTACHMENT_ACCEPTED_MIME_TYPES)[number]
  );
}

export function buildTeacherInfoAttachmentStoragePath(userId: string, randomId: string, fileName: string) {
  const clean = sanitizeFileNameSegment(fileName || "attachment");
  return `${userId}/${randomId}-${clean}`;
}

