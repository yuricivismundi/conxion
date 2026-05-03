export const TEACHER_INFO_ROLE_TOKENS = ["teacher", "artist", "instructor", "organizer"] as const;

export const TEACHER_BADGE_ROLE = "teacher" as const;

export const TEACHER_INFO_BLOCK_KINDS = [
  "private_class",
  "group_class",
  "workshop",
  "organizer_collab",
  "other",
] as const;

export type TeacherInfoBlockKind = (typeof TEACHER_INFO_BLOCK_KINDS)[number];

export type TeacherInfoContent = {
  priceText?: string | null;
  packageText?: string | null;
  availabilityText?: string | null;
  travelText?: string | null;
  notesText?: string | null;
  conditionsText?: string | null;
  ctaText?: string | null;
  referencesText?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  attachmentMimeType?: string | null;
  attachmentSizeBytes?: number | null;
  attachmentStoragePath?: string | null;
};

export type TeacherInfoProfileConfig = {
  userId: string;
  headline: string | null;
  introText: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TeacherInfoBlock = {
  id: string;
  userId: string;
  kind: TeacherInfoBlockKind;
  title: string;
  shortSummary: string | null;
  contentJson: TeacherInfoContent;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export const TEACHER_INFO_KIND_LABELS: Record<TeacherInfoBlockKind, string> = {
  private_class: "Private classes",
  group_class: "Group classes",
  workshop: "Workshop",
  organizer_collab: "Collaboration",
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

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function isTeacherInfoBlockKind(value: unknown): value is TeacherInfoBlockKind {
  return typeof value === "string" && (TEACHER_INFO_BLOCK_KINDS as readonly string[]).includes(value);
}

export function normalizeTeacherInfoContent(value: unknown): TeacherInfoContent {
  const record = asRecord(value);
  return {
    priceText: asNullableString(record.price_text ?? record.priceText),
    packageText: asNullableString(record.package_text ?? record.packageText),
    availabilityText: asNullableString(record.availability_text ?? record.availabilityText),
    travelText: asNullableString(record.travel_text ?? record.travelText),
    notesText: asNullableString(record.notes_text ?? record.notesText),
    conditionsText: asNullableString(record.conditions_text ?? record.conditionsText),
    ctaText: asNullableString(record.cta_text ?? record.ctaText),
    referencesText: asNullableString(record.references_text ?? record.referencesText),
    attachmentName: asNullableString(record.attachment_name ?? record.attachmentName),
    attachmentUrl: asNullableString(record.attachment_url ?? record.attachmentUrl),
    attachmentMimeType: asNullableString(record.attachment_mime_type ?? record.attachmentMimeType),
    attachmentSizeBytes: (() => {
      const value = record.attachment_size_bytes ?? record.attachmentSizeBytes;
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
      if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
      }
      return null;
    })(),
    attachmentStoragePath: asNullableString(record.attachment_storage_path ?? record.attachmentStoragePath),
  };
}

export function serializeTeacherInfoContent(content: TeacherInfoContent) {
  return {
    price_text: content.priceText ?? null,
    package_text: content.packageText ?? null,
    availability_text: content.availabilityText ?? null,
    travel_text: content.travelText ?? null,
    notes_text: content.notesText ?? null,
    conditions_text: content.conditionsText ?? null,
    cta_text: content.ctaText ?? null,
    references_text: content.referencesText ?? null,
    attachment_name: content.attachmentName ?? null,
    attachment_url: content.attachmentUrl ?? null,
    attachment_mime_type: content.attachmentMimeType ?? null,
    attachment_size_bytes: typeof content.attachmentSizeBytes === "number" ? content.attachmentSizeBytes : null,
    attachment_storage_path: content.attachmentStoragePath ?? null,
  };
}

export function normalizeTeacherInfoProfileRow(row: unknown): TeacherInfoProfileConfig | null {
  const record = asRecord(row);
  const userId = asString(record.user_id ?? record.userId).trim();
  if (!userId) return null;

  return {
    userId,
    headline: asNullableString(record.headline),
    introText: asNullableString(record.intro_text ?? record.introText),
    isEnabled: asBoolean(record.is_enabled ?? record.isEnabled, false),
    createdAt: asString(record.created_at ?? record.createdAt) || new Date(0).toISOString(),
    updatedAt: asString(record.updated_at ?? record.updatedAt) || new Date(0).toISOString(),
  };
}

export function normalizeTeacherInfoBlockRow(row: unknown): TeacherInfoBlock | null {
  const record = asRecord(row);
  const id = asString(record.id).trim();
  const userId = asString(record.user_id ?? record.userId).trim();
  const kind = asString(record.kind).trim();
  const title = asString(record.title).trim();
  if (!id || !userId || !isTeacherInfoBlockKind(kind) || !title) return null;

  return {
    id,
    userId,
    kind,
    title,
    shortSummary: asNullableString(record.short_summary ?? record.shortSummary),
    contentJson: normalizeTeacherInfoContent(record.content_json ?? record.contentJson),
    isActive: asBoolean(record.is_active ?? record.isActive, true),
    position: Math.max(0, Math.round(asNumber(record.position, 0))),
    createdAt: asString(record.created_at ?? record.createdAt) || new Date(0).toISOString(),
    updatedAt: asString(record.updated_at ?? record.updatedAt) || new Date(0).toISOString(),
  };
}

export function sortTeacherInfoBlocks(items: TeacherInfoBlock[]) {
  return [...items].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function getTeacherInfoTemplateText(block: Pick<TeacherInfoBlock, "shortSummary" | "contentJson">) {
  const notesText = block.contentJson.notesText?.trim();
  if (notesText) return notesText;

  return [
    block.shortSummary,
    block.contentJson.priceText,
    block.contentJson.packageText,
    block.contentJson.availabilityText,
    block.contentJson.travelText,
    block.contentJson.conditionsText,
    block.contentJson.ctaText,
    block.contentJson.referencesText,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
}

export function getTeacherInfoAttachment(block: Pick<TeacherInfoBlock, "contentJson">) {
  const name = block.contentJson.attachmentName?.trim();
  const url = block.contentJson.attachmentUrl?.trim();
  if (!name || !url) return null;

  return {
    name,
    url,
    mimeType: block.contentJson.attachmentMimeType?.trim() || null,
    sizeBytes: typeof block.contentJson.attachmentSizeBytes === "number" ? block.contentJson.attachmentSizeBytes : null,
    storagePath: block.contentJson.attachmentStoragePath?.trim() || null,
  };
}
