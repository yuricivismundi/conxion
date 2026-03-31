import Stripe from "stripe";
import { NextResponse } from "next/server";
import { normalizeStripeEnvValue } from "@/lib/billing/stripe-env";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { markProfileVerifiedViaPayment } from "@/lib/verification-server";
import { VERIFICATION_PURPOSE } from "@/lib/verification";

export const runtime = "nodejs";

type FinalizePayload = {
  sessionId?: string | null;
};

function getStripeClient() {
  const secretKey = normalizeStripeEnvValue(process.env.STRIPE_SECRET_KEY);
  if (!secretKey) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(secretKey);
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as FinalizePayload | null;
    const sessionId = body?.sessionId?.trim();
    if (!sessionId) {
      return NextResponse.json({ ok: false, error: "Missing Stripe session id." }, { status: 400 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const sessionUserId = session.metadata?.user_id?.trim() || session.client_reference_id?.trim() || "";
    const purpose = session.metadata?.purpose?.trim() || "";

    if (!sessionUserId || sessionUserId !== authData.user.id) {
      return NextResponse.json({ ok: false, error: "Checkout session does not belong to this user." }, { status: 403 });
    }

    if (purpose !== VERIFICATION_PURPOSE) {
      return NextResponse.json({ ok: false, error: "Stripe session purpose mismatch." }, { status: 400 });
    }

    if (session.status !== "complete" || session.payment_status !== "paid") {
      return NextResponse.json({ ok: false, error: "Stripe payment is not completed yet." }, { status: 409 });
    }

    await markProfileVerifiedViaPayment(authData.user.id);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not finalize verification." },
      { status: 500 }
    );
  }
}
