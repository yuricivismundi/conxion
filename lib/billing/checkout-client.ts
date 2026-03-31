import { supabase } from "@/lib/supabase/client";
import type { PlanId } from "@/lib/billing/plans";
import { appendQueryParam, sanitizeReturnTo } from "@/lib/verification";

type BillingCheckoutResult =
  | { status: "ready"; clientSecret: string; sessionId: string; successDestination: string }
  | { status: "already_owned"; planId: PlanId; returnTo: string };

function getResolvedReturnTo(returnTo?: string | null) {
  return sanitizeReturnTo(
    returnTo || (typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}${window.location.hash}` : "/pricing"),
    "/pricing"
  );
}

function getBillingSuccessDestination(planId: PlanId, returnTo: string, sessionId: string) {
  if (planId === "pro") {
    return `/billing/complete?session_id=${encodeURIComponent(sessionId)}&returnTo=${encodeURIComponent(returnTo)}`;
  }

  return appendQueryParam(appendQueryParam(returnTo, "checkout", "success"), "plan", planId);
}

async function getAccessToken() {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? "";
  if (!accessToken) throw new Error("Missing auth session.");
  return accessToken;
}

export async function createBillingCheckoutSession(params: {
  planId: PlanId;
  returnTo?: string | null;
}): Promise<BillingCheckoutResult> {
  const accessToken = await getAccessToken();
  const resolvedReturnTo = getResolvedReturnTo(params.returnTo);

  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      planId: params.planId,
      returnTo: resolvedReturnTo,
    }),
  });

  const result = (await response.json().catch(() => null)) as
      | {
        ok?: boolean;
        error?: string;
        clientSecret?: string;
        sessionId?: string;
        alreadyOwned?: boolean;
        planId?: PlanId;
      }
    | null;

  if (!response.ok || !result?.ok) {
    throw new Error(result?.error ?? "Could not start checkout.");
  }

  if (result.alreadyOwned) {
    return {
      status: "already_owned",
      planId: result.planId ?? params.planId,
      returnTo: appendQueryParam(appendQueryParam(resolvedReturnTo, "checkout", "already-owned"), "plan", params.planId),
    };
  }

  if (!result.clientSecret || !result.sessionId) {
    throw new Error("Stripe checkout client secret missing.");
  }

  return {
    status: "ready",
    clientSecret: result.clientSecret,
    sessionId: result.sessionId,
    successDestination: getBillingSuccessDestination(params.planId, resolvedReturnTo, result.sessionId),
  };
}
