import { getPlanLimits } from "@/lib/billing/limits";
import type { PlanId } from "@/lib/billing/plans";
import type { ProfileMediaItem, ProfileMediaKind } from "@/lib/profile-media/types";

const STARTER_MEDIA_LIMITS = getPlanLimits("starter");

export const PROFILE_MEDIA_MAX_TOTAL = (STARTER_MEDIA_LIMITS.profileVideos ?? 0) + (STARTER_MEDIA_LIMITS.profilePhotos ?? 0);
export const PROFILE_MEDIA_MAX_VIDEOS = STARTER_MEDIA_LIMITS.profileVideos ?? 1;
export const PROFILE_MEDIA_MAX_PHOTOS = STARTER_MEDIA_LIMITS.profilePhotos ?? 3;
export const PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC = 15;
export const PROFILE_MEDIA_MAX_SOURCE_VIDEO_DURATION_SEC = 300;
export const PROFILE_MEDIA_MAX_DIRECT_VIDEO_BYTES = 1024 * 1024 * 1024; // 1 GB — Cloudflare clips server-side, upload is free
export const PROFILE_MEDIA_TARGET_PHOTO_MIN_BYTES = 250 * 1024;
export const PROFILE_MEDIA_TARGET_PHOTO_MAX_BYTES = 400 * 1024;
export const PROFILE_MEDIA_TARGET_PHOTO_IDEAL_BYTES = 320 * 1024;
export const PROFILE_MEDIA_MAX_PHOTO_INPUT_BYTES = 10 * 1024 * 1024;

export const PROFILE_MEDIA_ACCEPTED_VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"] as const;
export const PROFILE_MEDIA_ACCEPTED_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

function totalProfileMediaLimit(planId: PlanId) {
  const limits = getPlanLimits(planId);
  if (limits.profileVideos === null || limits.profilePhotos === null) return null;
  return limits.profileVideos + limits.profilePhotos;
}

export function countProfileMedia(
  items: ProfileMediaItem[],
  planId: PlanId = "starter",
  options?: { avatarPhotoCount?: number }
) {
  const limits = getPlanLimits(planId);
  const totalLimit = totalProfileMediaLimit(planId);
  const videos = items.filter((item) => item.kind === "video").length;
  const photos = items.filter((item) => item.kind === "photo").length;
  const avatarPhotoCount = Math.max(0, Number(options?.avatarPhotoCount ?? 0) || 0);
  const effectivePhotoCount = photos + avatarPhotoCount;
  const effectiveTotalCount = items.length + avatarPhotoCount;

  return {
    total: effectiveTotalCount,
    videos,
    photos: effectivePhotoCount,
    videoLimit: limits.profileVideos,
    photoLimit: limits.profilePhotos,
    totalLimit,
    avatarPhotoCount,
    uploadedPhotos: photos,
    // Each type is gated only by its own per-type limit — the combined total limit is not used
    // here because it creates false blocks when types are mixed (e.g. 1 video + 1 photo + avatar).
    canAddVideo: limits.profileVideos === null || videos < limits.profileVideos,
    canAddPhoto: limits.profilePhotos === null || effectivePhotoCount < limits.profilePhotos,
  };
}

export function nextProfileMediaPosition(items: ProfileMediaItem[]) {
  return items.reduce((max, item) => Math.max(max, item.position), -1) + 1;
}

export function kindLabel(kind: ProfileMediaKind) {
  return kind === "video" ? "video" : "photo";
}
