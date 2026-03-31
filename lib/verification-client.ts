import { supabase } from "@/lib/supabase/client";
import { appendQueryParam, sanitizeReturnTo } from "@/lib/verification";

export type VerificationResumePayload =
  | {
      kind: "request_hosting";
      targetUserId: string;
      targetName?: string;
      targetPhotoUrl?: string | null;
      targetMaxGuests?: number | null;
      tripId?: string | null;
      prefillArrivalDate?: string | null;
      prefillDepartureDate?: string | null;
    }
  | {
      kind: "profile_hosting_request";
      profileId: string;
    };

const STORAGE_KEY = "conxion.verification.resume";
export const VERIFICATION_COMPLETE_MESSAGE = "conxion:verification-complete";

type CheckoutSessionResult =
  | { status: "ready"; clientSecret: string; sessionId: string; successDestination: string }
  | { status: "already_verified"; returnTo: string };

function getResolvedReturnTo(returnTo?: string | null) {
  return sanitizeReturnTo(
    returnTo || (typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}${window.location.hash}` : "/my-space"),
    "/my-space"
  );
}

async function getAccessToken() {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? "";
  if (!accessToken) throw new Error("Missing auth session.");
  return accessToken;
}

export function saveVerificationResume(payload: VerificationResumePayload | null | undefined) {
  if (!payload || typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function loadVerificationResume() {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VerificationResumePayload;
  } catch {
    return null;
  }
}

export function clearVerificationResume() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}

export async function createVerificationCheckoutSession({
  returnTo,
  resumePayload,
}: {
  returnTo?: string | null;
  resumePayload?: VerificationResumePayload | null;
}): Promise<CheckoutSessionResult> {
  const resolvedReturnTo = getResolvedReturnTo(returnTo);
  const accessToken = await getAccessToken();

  const response = await fetch("/api/verification/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      returnTo: resolvedReturnTo,
    }),
  });

  const result = (await response.json().catch(() => null)) as
    | { ok?: boolean; clientSecret?: string; sessionId?: string; error?: string; alreadyVerified?: boolean }
    | null;

  if (!response.ok || !result?.ok) {
    throw new Error(result?.error ?? "Could not start verification checkout.");
  }

  if (result.alreadyVerified) {
    return { status: "already_verified", returnTo: appendQueryParam(resolvedReturnTo, "verification", "success") };
  }

  if (!result.clientSecret || !result.sessionId) {
    throw new Error("Stripe checkout client secret missing.");
  }

  if (resumePayload) {
    saveVerificationResume(resumePayload);
  }

  return {
    status: "ready",
    clientSecret: result.clientSecret,
    sessionId: result.sessionId,
    successDestination: `/verification/complete?session_id=${encodeURIComponent(result.sessionId)}&returnTo=${encodeURIComponent(resolvedReturnTo)}`,
  };
}
