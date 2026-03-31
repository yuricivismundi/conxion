export const PROFILE_MEDIA_BUCKET = "profile-media";

function trimBaseUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

function encodeStoragePath(path: string) {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function buildProfilePhotoStoragePath(userId: string, assetId: string, extension = "jpg") {
  return `profiles/${userId}/photos/${assetId}.${extension.replace(/^\./, "")}`;
}

export function getProfileMediaStorageUrl(path?: string | null) {
  const base = trimBaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const trimmedPath = typeof path === "string" ? path.trim().replace(/^\/+/, "") : "";

  if (!base || !trimmedPath) return null;
  return `${base}/storage/v1/object/public/${PROFILE_MEDIA_BUCKET}/${encodeStoragePath(trimmedPath)}`;
}
