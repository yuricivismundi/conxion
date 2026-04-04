import { NextResponse } from "next/server";
import { countServiceInquiriesThisMonth, SERVICE_INQUIRY_MONTHLY_LIMIT } from "@/lib/service-inquiries/read-model";
import { requireServiceInquiryAuth } from "@/lib/service-inquiries/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const auth = await requireServiceInquiryAuth(req);
    if ("error" in auth) return auth.error;

    const used = await countServiceInquiriesThisMonth(auth.serviceClient, auth.userId);
    const limit = SERVICE_INQUIRY_MONTHLY_LIMIT;

    return NextResponse.json({
      ok: true,
      used,
      limit,
      remaining: Math.max(0, limit - used),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not load inquiry usage." },
      { status: 500 }
    );
  }
}
