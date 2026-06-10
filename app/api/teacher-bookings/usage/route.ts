import { NextResponse } from "next/server";
import { requireServiceInquiryAuth } from "@/lib/service-inquiries/server";
import { getBillingAccountStateForUserId } from "@/lib/billing/account-state";
import { getPlanLimits } from "@/lib/billing/limits";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const auth = await requireServiceInquiryAuth(req);
    if ("error" in auth) return auth.error;

    const accountState = await getBillingAccountStateForUserId(auth.serviceClient, auth.userId);
    const planLimits = getPlanLimits(accountState.currentPlanId);
    const limit = planLimits.bookingRequestsPerMonth;

    const cycleStart = new Date();
    cycleStart.setUTCDate(1);
    cycleStart.setUTCHours(0, 0, 0, 0);
    const countRes = await auth.serviceClient
      .from("teacher_session_bookings")
      .select("id", { count: "exact", head: true })
      .eq("student_id", auth.userId)
      .gte("created_at", cycleStart.toISOString());
    if (countRes.error) throw countRes.error;
    const used = countRes.count ?? 0;

    return NextResponse.json({
      ok: true,
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not load booking usage." },
      { status: 500 }
    );
  }
}
