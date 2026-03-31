export type ProfileMediaKind = "video" | "photo";
export type ProfileMediaProvider = "cloudflare_stream" | "storage";
export type ProfileMediaStatus = "processing" | "ready" | "failed";

export type ProfileMediaItem = {
  id: string;
  userId: string;
  kind: ProfileMediaKind;
  provider: ProfileMediaProvider;
  status: ProfileMediaStatus;
  position: number;
  isPrimary: boolean;
  streamUid: string | null;
  sourceStreamUid: string | null;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  clipStartSec: number | null;
  clipEndSec: number | null;
  storagePath: string | null;
  publicUrl: string | null;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  createdAt: string;
  updatedAt: string | null;
};

function pickString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0 ? value : "";
}

function pickNullableString(row: Record<string, unknown>, key: string) {
  const value = pickString(row, key);
  return value || null;
}

function pickNullableNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeProfileMediaRow(raw: unknown): ProfileMediaItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;

  const id = pickString(row, "id");
  const userId = pickString(row, "user_id");
  const kind = pickString(row, "kind");
  const provider = pickString(row, "provider");
  const status = pickString(row, "status");
  const createdAt = pickString(row, "created_at");

  if (!id || !userId || (kind !== "video" && kind !== "photo")) return null;
  if (provider !== "cloudflare_stream" && provider !== "storage") return null;
  if (status !== "processing" && status !== "ready" && status !== "failed") return null;

  return {
    id,
    userId,
    kind,
    provider,
    status,
    position: pickNullableNumber(row, "position") ?? 0,
    isPrimary: row.is_primary === true,
    streamUid: pickNullableString(row, "stream_uid"),
    sourceStreamUid: pickNullableString(row, "source_stream_uid"),
    playbackUrl: pickNullableString(row, "playback_url"),
    thumbnailUrl: pickNullableString(row, "thumbnail_url"),
    durationSec: pickNullableNumber(row, "duration_sec"),
    clipStartSec: pickNullableNumber(row, "clip_start_sec"),
    clipEndSec: pickNullableNumber(row, "clip_end_sec"),
    storagePath: pickNullableString(row, "storage_path"),
    publicUrl: pickNullableString(row, "public_url"),
    width: pickNullableNumber(row, "width"),
    height: pickNullableNumber(row, "height"),
    blurhash: pickNullableString(row, "blurhash"),
    createdAt: createdAt || new Date(0).toISOString(),
    updatedAt: pickNullableString(row, "updated_at"),
  };
}

export function sortProfileMedia(items: ProfileMediaItem[]) {
  return [...items].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    if (a.position !== b.position) return a.position - b.position;
    if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
    return a.id.localeCompare(b.id);
  });
}
