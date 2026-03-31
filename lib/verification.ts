export const VERIFICATION_PRICE_CENTS = 900;
export const VERIFICATION_PRICE_LABEL = "€9 one-time";
export const VERIFICATION_PURPOSE = "verification";
export const VERIFIED_BADGE_LABEL = "Verified";
export const VERIFIED_VIA_PAYMENT_LABEL = "Verified via payment";
export const VERIFICATION_SUCCESS_MESSAGE = "You are now verified. You can request hosting.";

type PaymentVerificationRow = {
  verified?: unknown;
  verified_label?: unknown;
};

export function sanitizeReturnTo(value: string | null | undefined, fallback = "/my-space") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return fallback;
  if (trimmed.startsWith("//")) return fallback;
  return trimmed || fallback;
}

export function appendQueryParam(path: string, key: string, value: string) {
  const [pathname, hash = ""] = path.split("#", 2);
  const [base, query = ""] = pathname.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(key, value);
  const nextQuery = params.toString();
  const nextHash = hash ? `#${hash}` : "";
  return `${base}${nextQuery ? `?${nextQuery}` : ""}${nextHash}`;
}

export function isPaymentVerified(row: PaymentVerificationRow | null | undefined) {
  if (!row || typeof row !== "object") return false;
  return (
    row.verified === true &&
    typeof row.verified_label === "string" &&
    row.verified_label.trim().toLowerCase() === VERIFIED_VIA_PAYMENT_LABEL.toLowerCase()
  );
}
