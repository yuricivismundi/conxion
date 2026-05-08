import { readPublicAppUrl } from "@/lib/public-app-url";

/**
 * Validates that a state-mutating request originates from the app itself.
 * Checks Origin then Referer header. Safe to skip for server-to-server calls
 * that won't include either header (e.g. Stripe webhooks — those use their
 * own signature verification instead).
 */
export function validateCsrfOrigin(req: Request): boolean {
  // In development any origin is accepted so local tooling isn't blocked
  if (process.env.NODE_ENV !== "production") return true;

  const appUrl = readPublicAppUrl();
  let appOrigin: string;
  try {
    appOrigin = new URL(appUrl).origin;
  } catch {
    return true;
  }

  const origin = req.headers.get("origin");
  if (origin) return origin === appOrigin;

  // Fall back to Referer when Origin is absent (some older browsers / Safari)
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === appOrigin;
    } catch {
      return false;
    }
  }

  // No Origin or Referer — allow, since same-origin fetch from server context
  // won't send either header. Real cross-site attacks always include Origin.
  return true;
}

export function csrfError() {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}
