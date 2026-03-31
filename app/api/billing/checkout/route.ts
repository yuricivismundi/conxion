import Stripe from "stripe";
import { NextResponse } from "next/server";
import { getBillingAccountState } from "@/lib/billing/account-state";
import { type PlanId } from "@/lib/billing/plans";
import {
  PRO_SUBSCRIPTION_PURPOSE,
  createProCheckoutLineItem,
  createVerifiedCheckoutLineItem,
  getRequestOrigin,
  getStripeClient,
} from "@/lib/billing/stripe";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { appendQueryParam, isPaymentVerified, sanitizeReturnTo, VERIFICATION_PURPOSE } from "@/lib/verification";

export const runtime = "nodejs";

type CheckoutPayload = {
  planId?: PlanId | null;
  returnTo?: string | null;
};

function isSelectablePlan(planId: PlanId | null | undefined): planId is "verified" | "pro" {
  return planId === "verified" || planId === "pro";
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as CheckoutPayload | null;
    const planId = body?.planId ?? null;
    if (!isSelectablePlan(planId)) {
      return NextResponse.json({ ok: false, error: "Choose a paid plan to continue." }, { status: 400 });
    }

    const returnTo = sanitizeReturnTo(body?.returnTo, "/pricing");
    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const profileRes = await supabase
      .from("profiles")
      .select("verified,verified_label")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (profileRes.error) {
      return NextResponse.json({ ok: false, error: profileRes.error.message }, { status: 400 });
    }

    const isVerified = isPaymentVerified((profileRes.data ?? null) as Record<string, unknown> | null);
    const billingState = getBillingAccountState({
      userMetadata: authData.user.user_metadata,
      isVerified,
    });

    if (planId === "verified" && isVerified) {
      return NextResponse.json({ ok: true, alreadyOwned: true, planId });
    }

    if (planId === "pro" && billingState.currentPlanId === "pro") {
      return NextResponse.json({ ok: true, alreadyOwned: true, planId });
    }

    const stripe = getStripeClient();
    const origin = getRequestOrigin(req);
    const paymentMethodTypes: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] = ["card"];
    const returnUrl =
      planId === "pro"
        ? `${origin}/billing/complete?session_id={CHECKOUT_SESSION_ID}&returnTo=${encodeURIComponent(returnTo)}`
        : `${origin}${appendQueryParam(appendQueryParam(returnTo, "checkout", "success"), "plan", planId)}`;

    const commonParams = {
      ui_mode: "custom" as const,
      return_url: returnUrl,
      client_reference_id: authData.user.id,
      customer_email: authData.user.email ?? undefined,
      payment_method_types: paymentMethodTypes,
      metadata: {
        user_id: authData.user.id,
        plan_id: planId,
        purpose: planId === "verified" ? VERIFICATION_PURPOSE : PRO_SUBSCRIPTION_PURPOSE,
      },
    };

    const session =
      planId === "verified"
        ? await stripe.checkout.sessions.create({
            ...commonParams,
            mode: "payment",
            payment_intent_data: {
              metadata: {
                user_id: authData.user.id,
                plan_id: planId,
                purpose: VERIFICATION_PURPOSE,
              },
            },
            line_items: [createVerifiedCheckoutLineItem()],
          })
        : await stripe.checkout.sessions.create({
            ...commonParams,
            mode: "subscription",
            line_items: [createProCheckoutLineItem()],
            subscription_data: {
              metadata: {
                user_id: authData.user.id,
                plan_id: planId,
                purpose: PRO_SUBSCRIPTION_PURPOSE,
              },
            },
          });

    if (!session.client_secret) {
      return NextResponse.json({ ok: false, error: "Stripe checkout client secret missing." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      clientSecret: session.client_secret,
      sessionId: session.id,
      planId,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
