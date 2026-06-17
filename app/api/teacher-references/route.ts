import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { validateCsrfOrigin, csrfError } from "@/lib/security/csrf";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const teacherUserId = url.searchParams.get("teacherUserId");
  if (!teacherUserId) return NextResponse.json({ ok: false, error: "teacherUserId required." }, { status: 400 });

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("teacher_references")
    .select("id,client_name,client_context,testimonial,rating,reference_year,sort_order")
    .eq("teacher_user_id", teacherUserId)
    .eq("is_public", true)
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, references: data ?? [] });
}

export async function POST(req: Request) {
  if (!validateCsrfOrigin(req)) return csrfError();

  const bearerToken = getBearerToken(req);
  if (!bearerToken) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });

  const userClient = getSupabaseUserClient(bearerToken);
  const { data: authData, error: authErr } = await userClient.auth.getUser(bearerToken);
  if (authErr || !authData.user) return NextResponse.json({ ok: false, error: "Invalid session." }, { status: 401 });

  const userId = authData.user.id;
  const service = getSupabaseServiceClient();

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const clientName = typeof body.clientName === "string" ? body.clientName.trim().slice(0, 80) : "";
  const clientContext = typeof body.clientContext === "string" ? body.clientContext.trim().slice(0, 80) : null;
  const testimonial = typeof body.testimonial === "string" ? body.testimonial.trim().slice(0, 500) : "";
  const rating = typeof body.rating === "number" && body.rating >= 1 && body.rating <= 5 ? body.rating : null;
  const referenceYear = typeof body.referenceYear === "number" ? body.referenceYear : null;
  const isPublic = body.isPublic !== false;

  if (!clientName) return NextResponse.json({ ok: false, error: "Client name is required." }, { status: 400 });
  if (testimonial.length < 10) return NextResponse.json({ ok: false, error: "Testimonial must be at least 10 characters." }, { status: 400 });

  // Get max sort_order
  const { data: maxRow } = await service
    .from("teacher_references")
    .select("sort_order")
    .eq("teacher_user_id", userId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = ((maxRow as { sort_order?: number } | null)?.sort_order ?? -1) + 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any)
    .from("teacher_references")
    .insert({ teacher_user_id: userId, client_name: clientName, client_context: clientContext || null, testimonial, rating, reference_year: referenceYear, is_public: isPublic, sort_order: sortOrder })
    .select("id,client_name,client_context,testimonial,rating,reference_year,is_public,status,sort_order")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, reference: data });
}
