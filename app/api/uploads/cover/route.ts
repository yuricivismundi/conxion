import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { EVENT_COVER_ACCEPT_MIME, MAX_UPLOADED_COVER_SIZE_BYTES } from "@/lib/events/cover-upload";
import { getAvatarStorageUrl } from "@/lib/avatar-storage";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

export const runtime = "nodejs";

function inferExtension(file: File) {
  const lowerType = file.type.toLowerCase();
  if (lowerType === "image/png") return "png";
  if (lowerType === "image/webp") return "webp";
  return "jpg";
}

function sanitizePrefix(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "event-cover";
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "group-cover") return "group-cover";
  return "event-cover";
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    const prefix = sanitizePrefix(formData.get("prefix"));

    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ ok: false, error: "Cover file is required." }, { status: 400 });
    }

    const mime = file.type.toLowerCase();
    if (!EVENT_COVER_ACCEPT_MIME.includes(mime as (typeof EVENT_COVER_ACCEPT_MIME)[number])) {
      return NextResponse.json({ ok: false, error: "Cover must be JPG, PNG, or WEBP." }, { status: 400 });
    }

    if (file.size > MAX_UPLOADED_COVER_SIZE_BYTES) {
      return NextResponse.json({ ok: false, error: "Cover image is too large after processing." }, { status: 400 });
    }

    const extension = inferExtension(file);
    const path = `${authData.user.id}/${prefix}-${randomUUID()}.${extension}`;
    const upload = await supabase.storage.from("avatars").upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
      cacheControl: "3600",
    });

    if (upload.error) {
      return NextResponse.json({ ok: false, error: upload.error.message }, { status: 500 });
    }

    const url = getAvatarStorageUrl(upload.data.path);
    if (!url) {
      return NextResponse.json({ ok: false, error: "Could not resolve cover URL." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, url, path: upload.data.path });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not upload cover." },
      { status: 500 }
    );
  }
}
