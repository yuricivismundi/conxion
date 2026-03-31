const DEFAULT_PUBLIC_APP_URL = "https://conxion.social";

export function normalizePublicAppUrl(value?: string | null) {
  const normalized = value?.replace(/\\n/g, "").trim().replace(/\/+$/, "");
  if (!normalized || !/^https?:\/\//i.test(normalized)) return "";

  try {
    return new URL(normalized).origin;
  } catch {
    return "";
  }
}

export function resolveClientPublicAppUrl(fallback = DEFAULT_PUBLIC_APP_URL) {
  if (typeof window !== "undefined" && window.location?.origin) {
    const currentOrigin = normalizePublicAppUrl(window.location.origin);
    if (currentOrigin) return currentOrigin;
  }

  return readPublicAppUrl(fallback);
}

export function readPublicAppUrl(fallback = DEFAULT_PUBLIC_APP_URL) {
  return normalizePublicAppUrl(process.env.NEXT_PUBLIC_APP_URL) || fallback;
}

export function absolutePublicAppUrl(path: string, fallback = DEFAULT_PUBLIC_APP_URL) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${readPublicAppUrl(fallback)}${normalizedPath}`;
}
