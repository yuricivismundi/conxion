import Stripe from "stripe";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { buildProBillingMetadataUpdate, mergeBillingMetadata } from "@/lib/billing/account-state";
import { normalizeStripeEnvValue } from "@/lib/billing/stripe-env";
import { VERIFICATION_PRICE_CENTS, VERIFIED_VIA_PAYMENT_LABEL, VERIFICATION_PURPOSE } from "@/lib/verification";

export const PRO_SUBSCRIPTION_PURPOSE = "pro_subscription";
export const PRO_PLAN_PRICE_CENTS = 699;
export const PRO_PLAN_PRICE_LABEL = "€6.99/month";

export function getStripeClient() {
  const secretKey = normalizeStripeEnvValue(process.env.STRIPE_SECRET_KEY);
  if (!secretKey) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(secretKey);
}

export function getRequestOrigin(req: Request) {
  const originHeader = req.headers.get("origin");
  if (originHeader) return originHeader;
  return new URL(req.url).origin;
}

export function createVerifiedCheckoutLineItem(): Stripe.Checkout.SessionCreateParams.LineItem {
  const verifiedPriceId = normalizeStripeEnvValue(process.env.STRIPE_VERIFIED_PRICE_ID);
  if (verifiedPriceId) {
    return {
      price: verifiedPriceId,
      quantity: 1,
    };
  }

  return {
    quantity: 1,
    price_data: {
      currency: "eur",
      unit_amount: VERIFICATION_PRICE_CENTS,
      product_data: {
        name: "ConXion Verified",
        description: VERIFIED_VIA_PAYMENT_LABEL,
      },
    },
  };
}

export function createProCheckoutLineItem(): Stripe.Checkout.SessionCreateParams.LineItem {
  const proPriceId = normalizeStripeEnvValue(process.env.STRIPE_PRO_PRICE_ID);
  if (proPriceId) {
    return {
      price: proPriceId,
      quantity: 1,
    };
  }

  return {
    quantity: 1,
    price_data: {
      currency: "eur",
      unit_amount: PRO_PLAN_PRICE_CENTS,
      recurring: {
        interval: "month",
      },
      product_data: {
        name: "ConXion Plus",
        description: "Monthly visibility and usage upgrade",
      },
    },
  };
}

function subscriptionPriceId(subscription: Stripe.Subscription) {
  const firstItem = subscription.items.data[0];
  return firstItem?.price?.id ?? null;
}

export async function syncProSubscriptionToAuthMetadata(params: {
  userId: string;
  subscription: Stripe.Subscription;
}) {
  const serviceClient = getSupabaseServiceClient();
  const userRes = await serviceClient.auth.admin.getUserById(params.userId);
  if (userRes.error) throw userRes.error;

  const subscriptionRecord = params.subscription as unknown as Record<string, unknown>;
  const currentPeriodEndEpoch =
    typeof subscriptionRecord.current_period_end === "number" ? subscriptionRecord.current_period_end : null;
  const currentPeriodEnd =
    currentPeriodEndEpoch !== null ? new Date(currentPeriodEndEpoch * 1000).toISOString() : null;

  const nextMetadata = mergeBillingMetadata(
    userRes.data.user?.user_metadata,
    buildProBillingMetadataUpdate({
      status: params.subscription.status,
      currentPeriodEnd,
      cancelAtPeriodEnd: params.subscription.cancel_at_period_end === true,
      subscriptionId: params.subscription.id,
      customerId: typeof params.subscription.customer === "string" ? params.subscription.customer : params.subscription.customer?.id ?? null,
      priceId: subscriptionPriceId(params.subscription),
    })
  );

  const updateRes = await serviceClient.auth.admin.updateUserById(params.userId, {
    user_metadata: nextMetadata,
  });
  if (updateRes.error) throw updateRes.error;
}

export async function syncProSubscriptionFromCheckoutSession(params: {
  stripe: Stripe;
  session: Stripe.Checkout.Session;
}) {
  const userId = params.session.metadata?.user_id?.trim();
  const subscriptionId =
    typeof params.session.subscription === "string"
      ? params.session.subscription
      : params.session.subscription?.id ?? null;

  if (!userId || !subscriptionId) return;

  const subscription = await params.stripe.subscriptions.retrieve(subscriptionId);
  await syncProSubscriptionToAuthMetadata({ userId, subscription });
}

export function isVerificationCheckout(session: Stripe.Checkout.Session) {
  return session.metadata?.purpose === VERIFICATION_PURPOSE;
}

export function isProCheckout(session: Stripe.Checkout.Session) {
  return session.metadata?.purpose === PRO_SUBSCRIPTION_PURPOSE;
}
