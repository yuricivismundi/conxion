import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function getUserClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });

    const userClient = getUserClient(token);
    const { data: authData, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }
    const userId = authData.user.id;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const prefix = (formData.get("prefix") as string | null) ?? "cover";

    if (!file || !file.size) {
      return NextResponse.json({ ok: false, error: "No file provided." }, { status: 400 });
    }

    const fromName = file.name.split(".").pop()?.toLowerCase();
    const ext =
      fromName ?? (file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp");
    const path = `${userId}/${prefix}-${crypto.randomUUID()}.${ext}`;

    const service = getSupabaseServiceClient();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadErr } = await service.storage
      .from("avatars")
      .upload(path, buffer, { contentType: file.type, upsert: true });

    if (uploadErr) {
      return NextResponse.json({ ok: false, error: uploadErr.message }, { status: 500 });
    }

    const { data: urlData } = service.storage.from("avatars").getPublicUrl(path);
    return NextResponse.json({ ok: true, url: urlData.publicUrl });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Upload failed." },
      { status: 500 }
    );
  }
}
