import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { validateCsrfOrigin, csrfError } from "@/lib/security/csrf";

export const runtime = "nodejs";

async function getAuthUserId(req: Request): Promise<string | null> {
  const token = getBearerToken(req);
  if (!token) return null;
  const userClient = getSupabaseUserClient(token);
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!validateCsrfOrigin(req)) return csrfError();
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });

  const { id } = await params;
  const service = getSupabaseServiceClient();

  const { data: existing } = await service.from("teacher_references").select("teacher_user_id").eq("id", id).maybeSingle();
  if (!existing || (existing as { teacher_user_id: string }).teacher_user_id !== userId) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.clientName === "string") updates.client_name = body.clientName.trim().slice(0, 80);
  if (body.clientContext !== undefined) updates.client_context = typeof body.clientContext === "string" ? body.clientContext.trim().slice(0, 80) || null : null;
  if (typeof body.testimonial === "string") updates.testimonial = body.testimonial.trim().slice(0, 500);
  if (body.rating !== undefined) updates.rating = typeof body.rating === "number" && body.rating >= 1 && body.rating <= 5 ? body.rating : null;
  if (body.referenceYear !== undefined) updates.reference_year = typeof body.referenceYear === "number" ? body.referenceYear : null;
  if (typeof body.isPublic === "boolean") updates.is_public = body.isPublic;
  if (typeof body.status === "string" && ["published", "hidden"].includes(body.status)) updates.status = body.status;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any).from("teacher_references").update(updates).eq("id", id).select("id,client_name,client_context,testimonial,rating,reference_year,is_public,status,sort_order").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, reference: data });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!validateCsrfOrigin(req)) return csrfError();
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });

  const { id } = await params;
  const service = getSupabaseServiceClient();

  const { data: existing } = await service.from("teacher_references").select("teacher_user_id").eq("id", id).maybeSingle();
  if (!existing || (existing as { teacher_user_id: string }).teacher_user_id !== userId) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const { error } = await service.from("teacher_references").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
