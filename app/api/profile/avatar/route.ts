import { NextResponse } from "next/server";
import { getAvatarStorageUrl } from "@/lib/avatar-storage";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

export const runtime = "nodejs";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const userClient = getSupabaseUserClient(token);
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ ok: false, error: "No image provided." }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "Please upload an image." }, { status: 400 });
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return NextResponse.json({ ok: false, error: "Max image size is 5MB." }, { status: 400 });
    }

    const service = getSupabaseServiceClient();
    const nextPath = `${user.id}/${crypto.randomUUID()}.jpg`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const currentProfileRes = await service
      .from("profiles" as never)
      .select("avatar_path")
      .eq("user_id", user.id)
      .maybeSingle();

    const previousAvatarPath =
      !currentProfileRes.error &&
      typeof (currentProfileRes.data as { avatar_path?: string | null } | null)?.avatar_path === "string"
        ? ((currentProfileRes.data as { avatar_path?: string | null } | null)?.avatar_path ?? "").trim()
        : "";

    const uploadRes = await service.storage.from("avatars").upload(nextPath, buffer, {
      contentType: "image/jpeg",
      upsert: false,
    });

    if (uploadRes.error) {
      return NextResponse.json({ ok: false, error: uploadRes.error.message }, { status: 400 });
    }

    const publicUrl = getAvatarStorageUrl(nextPath) ?? service.storage.from("avatars").getPublicUrl(nextPath).data.publicUrl;

    const updateRes = await service
      .from("profiles" as never)
      .update({
        avatar_url: publicUrl,
        avatar_path: nextPath,
        avatar_status: "pending",
      } as never)
      .eq("user_id", user.id);

    if (updateRes.error) {
      await service.storage.from("avatars").remove([nextPath]).catch(() => null);
      return NextResponse.json({ ok: false, error: updateRes.error.message }, { status: 400 });
    }

    if (previousAvatarPath && previousAvatarPath !== nextPath && previousAvatarPath.startsWith(`${user.id}/`)) {
      await service.storage.from("avatars").remove([previousAvatarPath]).catch(() => null);
    }

    return NextResponse.json({ ok: true, path: nextPath, url: publicUrl });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not upload avatar.",
      },
      { status: 500 }
    );
  }
}
