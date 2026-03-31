import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import {
  isPrivacyRequestType,
  normalizePrivacyRequestScopeTags,
  type PrivacyRequestType,
} from "@/lib/privacy-requests";

type CreatePrivacyRequestPayload = {
  requestType?: unknown;
  subject?: unknown;
  description?: unknown;
  scopeTags?: unknown;
};

function asTrimmed(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as CreatePrivacyRequestPayload | null;
    const requestTypeRaw = body?.requestType;
    const subject = asTrimmed(body?.subject);
    const description = asTrimmed(body?.description);
    const scopeTags = normalizePrivacyRequestScopeTags(body?.scopeTags);

    if (!isPrivacyRequestType(requestTypeRaw)) {
      return NextResponse.json({ ok: false, error: "Choose a valid request type." }, { status: 400 });
    }
    if (subject.length < 6 || subject.length > 160) {
      return NextResponse.json({ ok: false, error: "Subject must be between 6 and 160 characters." }, { status: 400 });
    }
    if (description.length < 30 || description.length > 5000) {
      return NextResponse.json({ ok: false, error: "Description must be between 30 and 5000 characters." }, { status: 400 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const requestType = requestTypeRaw as PrivacyRequestType;
    const insertRes = await supabase
      .from("privacy_requests")
      .insert({
        requester_id: authData.user.id,
        requester_email: authData.user.email ?? null,
        request_type: requestType,
        subject,
        description,
        scope_tags: scopeTags,
      })
      .select("id,ticket_code,request_type,status,subject,description,scope_tags,admin_note,due_at,resolved_at,created_at,updated_at")
      .single();

    if (insertRes.error) {
      return NextResponse.json({ ok: false, error: insertRes.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, request: insertRes.data });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
