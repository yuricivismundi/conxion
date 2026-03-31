import { NextResponse } from "next/server";
import { getStripeClient, PRO_SUBSCRIPTION_PURPOSE, syncProSubscriptionFromCheckoutSession } from "@/lib/billing/stripe";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

export const runtime = "nodejs";

type FinalizePayload = {
  sessionId?: string | null;
};

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

    if (purpose !== PRO_SUBSCRIPTION_PURPOSE) {
      return NextResponse.json({ ok: false, error: "Stripe session purpose mismatch." }, { status: 400 });
    }

    if (session.status !== "complete") {
      return NextResponse.json({ ok: false, error: "Stripe checkout is not completed yet." }, { status: 409 });
    }

    if (!session.subscription) {
      return NextResponse.json({ ok: false, error: "Stripe subscription is not ready yet." }, { status: 409 });
    }

    await syncProSubscriptionFromCheckoutSession({ stripe, session });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not finalize Plus upgrade." },
      { status: 500 }
    );
  }
}
