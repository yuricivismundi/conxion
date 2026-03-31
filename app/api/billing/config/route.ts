import { NextResponse } from "next/server";
import { normalizeStripeEnvValue } from "@/lib/billing/stripe-env";

export const runtime = "nodejs";

function readStripePublishableKey() {
  const candidates = [
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    process.env.STRIPE_PUBLISHABLE_KEY,
  ];

  return candidates.map((value) => normalizeStripeEnvValue(value)).find(Boolean) ?? "";
}

export async function GET() {
  const publishableKey = readStripePublishableKey();

  if (!publishableKey) {
    return NextResponse.json(
      { ok: false, error: "Secure checkout is unavailable right now." },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true, publishableKey });
}
