import Stripe from "stripe";
import { NextResponse } from "next/server";
import {
  getStripeClient,
  isProCheckout,
  isVerificationCheckout,
  syncProSubscriptionFromCheckoutSession,
  syncProSubscriptionToAuthMetadata,
} from "@/lib/billing/stripe";
import { markProfileVerifiedViaPayment } from "@/lib/verification-server";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const signature = req.headers.get("stripe-signature");
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      return NextResponse.json({ ok: false, error: "Missing Stripe webhook configuration." }, { status: 400 });
    }

    const stripe = getStripeClient();
    const payload = await req.text();
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id?.trim();

      if (userId && isVerificationCheckout(session)) {
        await markProfileVerifiedViaPayment(userId);
      }

      if (isProCheckout(session)) {
        await syncProSubscriptionFromCheckoutSession({ stripe, session });
        const proUserId = session.metadata?.user_id?.trim();
        if (proUserId) {
          void sendAppEmailBestEffort({ kind: "pro_upgrade", recipientUserId: proUserId });
        }
      }
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.user_id?.trim();
      if (userId) {
        await syncProSubscriptionToAuthMetadata({ userId, subscription });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Webhook error" },
      { status: 400 }
    );
  }
}
