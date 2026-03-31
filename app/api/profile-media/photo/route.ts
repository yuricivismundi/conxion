import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getBillingAccountState } from "@/lib/billing/account-state";
import { PROFILE_MEDIA_ACCEPTED_PHOTO_MIME_TYPES, countProfileMedia, nextProfileMediaPosition } from "@/lib/profile-media/limits";
import { PROFILE_MEDIA_BUCKET, buildProfilePhotoStoragePath, getProfileMediaStorageUrl } from "@/lib/profile-media/storage";
import { getOwnerAvatarPhotoCount, jsonError, listOwnerProfileMedia, requireProfileMediaAuth } from "@/lib/profile-media/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let uploadedPath: string | null = null;
  let authService: Awaited<ReturnType<typeof requireProfileMediaAuth>> | null = null;

  try {
    const auth = await requireProfileMediaAuth(req);
    if ("error" in auth) return auth.error;
    authService = auth;

    const formData = await req.formData();
    const file = formData.get("file");
    const widthRaw = Number(formData.get("width"));
    const heightRaw = Number(formData.get("height"));

    if (!(file instanceof File) || file.size <= 0) {
      return jsonError("Photo file is required.", 400);
    }

    if (!PROFILE_MEDIA_ACCEPTED_PHOTO_MIME_TYPES.includes(file.type as (typeof PROFILE_MEDIA_ACCEPTED_PHOTO_MIME_TYPES)[number])) {
      return jsonError("Photos must be JPEG, PNG, or WebP.", 400);
    }

    const media = await listOwnerProfileMedia(auth.serviceClient, auth.userId);
    const billingState = getBillingAccountState({
      userMetadata: auth.authUser.user_metadata,
      isVerified: false,
    });
    const avatarPhotoCount = await getOwnerAvatarPhotoCount(auth.serviceClient, auth.userId);
    const counts = countProfileMedia(media, billingState.currentPlanId, { avatarPhotoCount });
    if (!counts.canAddPhoto) {
      return jsonError("You already reached the showcase photo limit.", 400);
    }

    const extension = file.type === "image/webp" ? "webp" : file.type === "image/png" ? "png" : "jpg";
    const path = buildProfilePhotoStoragePath(auth.userId, randomUUID(), extension);
    const uploadRes = await auth.serviceClient.storage
      .from(PROFILE_MEDIA_BUCKET)
      .upload(path, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });

    if (uploadRes.error) throw uploadRes.error;
    uploadedPath = uploadRes.data.path;

    const insertRes = await auth.serviceClient
      .from("profile_media" as never)
      .insert({
        user_id: auth.userId,
        kind: "photo",
        provider: "storage",
        status: "ready",
        position: nextProfileMediaPosition(media),
        is_primary: false,
        storage_path: uploadedPath,
        public_url: getProfileMediaStorageUrl(uploadedPath),
        width: Number.isFinite(widthRaw) && widthRaw > 0 ? Math.round(widthRaw) : null,
        height: Number.isFinite(heightRaw) && heightRaw > 0 ? Math.round(heightRaw) : null,
      } as never)
      .select("id,public_url")
      .single();

    if (insertRes.error) throw insertRes.error;
    const inserted = (insertRes.data ?? null) as { id?: string; public_url?: string | null } | null;

    return NextResponse.json({
      ok: true,
      mediaId: inserted?.id ?? null,
      publicUrl: inserted?.public_url ?? null,
    });
  } catch (error: unknown) {
    if (uploadedPath && authService && !("error" in authService)) {
      await authService.serviceClient.storage.from(PROFILE_MEDIA_BUCKET).remove([uploadedPath]).catch(() => undefined);
    }

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not upload photo." },
      { status: 500 }
    );
  }
}
