import type { SupabaseServiceClient } from "@/lib/supabase/service-role";
import type { PlanId } from "@/lib/billing/plans";

export type BillingAccountState = {
  currentPlanId: PlanId;
  isVerified: boolean;
  proRenewalLabel?: string | null;
};

export type ProBillingMetadata = {
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  subscriptionId: string | null;
  customerId: string | null;
  priceId: string | null;
};

const PRO_STATUS_KEY = "billing_pro_status";
const PRO_CURRENT_PERIOD_END_KEY = "billing_pro_current_period_end";
const PRO_CANCEL_AT_PERIOD_END_KEY = "billing_pro_cancel_at_period_end";
const PRO_SUBSCRIPTION_ID_KEY = "billing_pro_subscription_id";
const PRO_CUSTOMER_ID_KEY = "billing_pro_customer_id";
const PRO_PRICE_ID_KEY = "billing_pro_price_id";

// Temporary persistence layer until the app has dedicated billing tables and entitlements.

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readBoolean(value: unknown) {
  return value === true;
}

function formatRenewalDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

export function getMockBillingAccountState(): BillingAccountState {
  return {
    currentPlanId: "starter",
    isVerified: false,
    proRenewalLabel: null,
  };
}

export function readProBillingMetadata(metadata: unknown): ProBillingMetadata {
  const record = asRecord(metadata);
  return {
    status: readString(record[PRO_STATUS_KEY]),
    currentPeriodEnd: readString(record[PRO_CURRENT_PERIOD_END_KEY]),
    cancelAtPeriodEnd: readBoolean(record[PRO_CANCEL_AT_PERIOD_END_KEY]),
    subscriptionId: readString(record[PRO_SUBSCRIPTION_ID_KEY]),
    customerId: readString(record[PRO_CUSTOMER_ID_KEY]),
    priceId: readString(record[PRO_PRICE_ID_KEY]),
  };
}

export function getProSubscriptionStatusLabel(status: string | null | undefined) {
  if (!status) return "No monthly subscription";
  if (status === "trialing") return "Trialing";
  if (status === "active") return "Active";
  if (status === "past_due") return "Past due";
  if (status === "canceled") return "Canceled";
  if (status === "unpaid") return "Unpaid";
  if (status === "incomplete") return "Incomplete";
  if (status === "incomplete_expired") return "Incomplete expired";
  return status;
}

export function isProPlanActive(status: string | null | undefined) {
  return status === "trialing" || status === "active" || status === "past_due";
}

export function buildProRenewalLabel(metadata: ProBillingMetadata) {
  if (!isProPlanActive(metadata.status) || !metadata.currentPeriodEnd) return null;
  const formatted = formatRenewalDate(metadata.currentPeriodEnd);
  if (!formatted) return null;
  return metadata.cancelAtPeriodEnd ? `Access until ${formatted}` : `Renews ${formatted}`;
}

export function getBillingAccountState(params: {
  userMetadata?: unknown;
  isVerified?: boolean;
}): BillingAccountState {
  const isVerified = params.isVerified === true;
  const proMetadata = readProBillingMetadata(params.userMetadata);

  if (isProPlanActive(proMetadata.status)) {
    return {
      currentPlanId: "pro",
      isVerified,
      proRenewalLabel: buildProRenewalLabel(proMetadata),
    };
  }

  return {
    currentPlanId: isVerified ? "verified" : "starter",
    isVerified,
    proRenewalLabel: null,
  };
}

export function buildProBillingMetadataUpdate(params: {
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  subscriptionId: string | null;
  customerId: string | null;
  priceId: string | null;
}) {
  return {
    [PRO_STATUS_KEY]: params.status,
    [PRO_CURRENT_PERIOD_END_KEY]: params.currentPeriodEnd,
    [PRO_CANCEL_AT_PERIOD_END_KEY]: params.cancelAtPeriodEnd,
    [PRO_SUBSCRIPTION_ID_KEY]: params.subscriptionId,
    [PRO_CUSTOMER_ID_KEY]: params.customerId,
    [PRO_PRICE_ID_KEY]: params.priceId,
  };
}

export function mergeBillingMetadata(existingMetadata: unknown, nextFields: Record<string, unknown>) {
  return {
    ...asRecord(existingMetadata),
    ...nextFields,
  };
}

export async function getBillingAccountStateForUserId(
  serviceClient: SupabaseServiceClient,
  userId: string,
  options?: { isVerified?: boolean }
) {
  const userRes = await serviceClient.auth.admin.getUserById(userId);
  if (userRes.error) throw userRes.error;
  return getBillingAccountState({
    userMetadata: userRes.data.user?.user_metadata,
    isVerified: options?.isVerified,
  });
}
