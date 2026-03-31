import { NextResponse } from "next/server";
import { createVerifiedCheckoutLineItem, getRequestOrigin, getStripeClient } from "@/lib/billing/stripe";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import {
  VERIFICATION_PURPOSE,
  VERIFIED_VIA_PAYMENT_LABEL,
  sanitizeReturnTo,
} from "@/lib/verification";

export const runtime = "nodejs";

type CheckoutPayload = {
  returnTo?: string | null;
};

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as CheckoutPayload | null;
    const returnTo = sanitizeReturnTo(body?.returnTo, "/my-space");

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const profileRes = await supabase
      .from("profiles")
      .select("user_id,verified,verified_label")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (profileRes.error) {
      return NextResponse.json({ ok: false, error: profileRes.error.message }, { status: 400 });
    }

    const profile = (profileRes.data ?? null) as Record<string, unknown> | null;
    const alreadyVerified = profile?.verified === true && profile?.verified_label === VERIFIED_VIA_PAYMENT_LABEL;

    if (alreadyVerified) {
      return NextResponse.json({ ok: true, alreadyVerified: true });
    }

    const stripe = getStripeClient();
    const origin = getRequestOrigin(req);
    const returnUrl = `${origin}/verification/complete?returnTo=${encodeURIComponent(returnTo)}`;

    const session = await stripe.checkout.sessions.create({
      ui_mode: "custom",
      mode: "payment",
      return_url: returnUrl,
      client_reference_id: authData.user.id,
      customer_email: authData.user.email ?? undefined,
      payment_method_types: ["card"],
      metadata: {
        user_id: authData.user.id,
        purpose: VERIFICATION_PURPOSE,
      },
      payment_intent_data: {
        metadata: {
          user_id: authData.user.id,
          purpose: VERIFICATION_PURPOSE,
        },
      },
      line_items: [
        createVerifiedCheckoutLineItem(),
      ],
    });

    if (!session.client_secret) {
      return NextResponse.json({ ok: false, error: "Stripe checkout client secret missing." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, clientSecret: session.client_secret, sessionId: session.id });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
