const AVATAR_BUCKET = "avatars";

function trimBaseUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

function encodeStoragePath(path: string) {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function getAvatarStorageUrl(path?: string | null) {
  const base = trimBaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const trimmedPath = typeof path === "string" ? path.trim().replace(/^\/+/, "") : "";

  if (!base || !trimmedPath) return null;
  return `${base}/storage/v1/object/public/${AVATAR_BUCKET}/${encodeStoragePath(trimmedPath)}`;
}

export function resolveAvatarUrl(params: {
  avatarUrl?: string | null;
  avatarPath?: string | null;
}) {
  const storageUrl = getAvatarStorageUrl(params.avatarPath);
  if (storageUrl) return storageUrl;

  const trimmedUrl = typeof params.avatarUrl === "string" ? params.avatarUrl.trim() : "";
  return trimmedUrl || null;
}
