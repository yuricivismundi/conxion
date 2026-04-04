import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeProfileMediaRow, sortProfileMedia, type ProfileMediaItem } from "@/lib/profile-media/types";

const PROFILE_MEDIA_SELECT = [
  "id",
  "user_id",
  "kind",
  "provider",
  "status",
  "position",
  "is_primary",
  "stream_uid",
  "source_stream_uid",
  "playback_url",
  "thumbnail_url",
  "duration_sec",
  "clip_start_sec",
  "clip_end_sec",
  "storage_path",
  "public_url",
  "width",
  "height",
  "blurhash",
  "created_at",
  "updated_at",
].join(",");

export async function fetchProfileMedia(
  supabase: SupabaseClient,
  params: {
    userId: string;
    viewerUserId?: string | null;
    includeAllOwn?: boolean;
    /** Pass false to hide showcase photos for non-Plus owners in public view. */
    ownerIsPlus?: boolean;
  }
) {
  const canReadAll = params.includeAllOwn === true || params.viewerUserId === params.userId;
  let query = supabase
    .from("profile_media")
    .select(PROFILE_MEDIA_SELECT)
    .eq("user_id", params.userId)
    .order("is_primary", { ascending: false })
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (!canReadAll) {
    query = query.eq("status", "ready");
  }

  const { data, error } = await query;
  if (error) throw error;

  let items = sortProfileMedia(
    ((data ?? []) as unknown[]).map(normalizeProfileMediaRow).filter((item): item is ProfileMediaItem => Boolean(item))
  );

  // In public view, hide showcase photos for non-Plus owners.
  // ownerIsPlus=undefined means unknown — treat as unlocked (safe default until
  // a billing column is available on the profiles table).
  if (!canReadAll && params.ownerIsPlus === false) {
    items = items.filter((item) => item.kind !== "photo");
  }

  return items;
}

export function deriveProfileMediaShowcase(items: ProfileMediaItem[]) {
  const ordered = sortProfileMedia(items);
  const readyMedia = ordered.filter((item) => item.status === "ready");
  const processingMedia = ordered.filter((item) => item.status === "processing");
  const failedMedia = ordered.filter((item) => item.status === "failed");

  const primaryVideo = readyMedia.find((item) => item.kind === "video" && item.isPrimary) ?? readyMedia.find((item) => item.kind === "video") ?? null;
  const primaryItem = readyMedia.find((item) => item.isPrimary) ?? primaryVideo ?? readyMedia[0] ?? null;
  const galleryItems = primaryItem ? readyMedia.filter((item) => item.id !== primaryItem.id) : readyMedia;

  return {
    ordered,
    readyMedia,
    processingMedia,
    failedMedia,
    primaryVideo,
    primaryItem,
    galleryItems,
  };
}
