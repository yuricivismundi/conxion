import { NextResponse } from "next/server";
import { LEGAL_PROFILE } from "@/lib/legal-profile";

export async function POST(req: Request) {
  void req;
  return NextResponse.json(
    {
      ok: false,
      error: `In-app privacy request submission is disabled. Please send formal privacy requests to ${LEGAL_PROFILE.privacyEmail}.`,
      contact: LEGAL_PROFILE.privacyEmail,
    },
    { status: 410 }
  );
}
