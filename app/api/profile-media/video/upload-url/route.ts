import { NextResponse } from "next/server";
import { getBillingAccountState } from "@/lib/billing/account-state";
import {
  PROFILE_MEDIA_MAX_SOURCE_VIDEO_DURATION_SEC,
  countProfileMedia,
  nextProfileMediaPosition,
} from "@/lib/profile-media/limits";
import { createCloudflareStreamDirectUpload, deleteCloudflareStreamVideo } from "@/lib/cloudflare-stream";
import { getOwnerAvatarPhotoCount, jsonError, listOwnerProfileMedia, requireProfileMediaAuth } from "@/lib/profile-media/server";
import type { SupabaseServiceClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const STALE_PENDING_VIDEO_UPLOAD_MS = 6 * 60 * 60 * 1000;

function getMediaTimestampMs(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function cleanupStalePendingVideoUploads(params: {
  serviceClient: SupabaseServiceClient;
  userId: string;
}) {
  const media = await listOwnerProfileMedia(params.serviceClient, params.userId);
  const staleItems = media.filter((item) => {
    if (item.kind !== "video" || item.status !== "processing") return false;
    if (item.playbackUrl) return false;
    const updatedAtMs = getMediaTimestampMs(item.updatedAt) ?? getMediaTimestampMs(item.createdAt);
    if (updatedAtMs === null) return false;
    return Date.now() - updatedAtMs >= STALE_PENDING_VIDEO_UPLOAD_MS;
  });

  for (const item of staleItems) {
    if (item.streamUid) {
      await deleteCloudflareStreamVideo(item.streamUid).catch(() => undefined);
    }
    if (item.sourceStreamUid && item.sourceStreamUid !== item.streamUid) {
      await deleteCloudflareStreamVideo(item.sourceStreamUid).catch(() => undefined);
    }

    const deleteRes = await params.serviceClient
      .from("profile_media" as never)
      .delete()
      .eq("id", item.id)
      .eq("user_id", params.userId);

    if (deleteRes.error) {
      throw deleteRes.error;
    }
  }

  if (staleItems.length === 0) return media;
  return listOwnerProfileMedia(params.serviceClient, params.userId);
}

export async function POST(req: Request) {
  try {
    const auth = await requireProfileMediaAuth(req);
    if ("error" in auth) return auth.error;

    const media = await cleanupStalePendingVideoUploads({
      serviceClient: auth.serviceClient,
      userId: auth.userId,
    });
    const billingState = getBillingAccountState({
      userMetadata: auth.authUser.user_metadata,
      isVerified: false,
    });
    const avatarPhotoCount = await getOwnerAvatarPhotoCount(auth.serviceClient, auth.userId);
    const counts = countProfileMedia(media, billingState.currentPlanId, { avatarPhotoCount });
    if (!counts.canAddVideo) {
      return jsonError("You already reached the showcase video limit.", 400);
    }

    const upload = await createCloudflareStreamDirectUpload({
      userId: auth.userId,
      maxDurationSeconds: PROFILE_MEDIA_MAX_SOURCE_VIDEO_DURATION_SEC,
      meta: {
        userId: auth.userId,
        scope: "profile_media",
      },
    });

    try {
      const insertRes = await auth.serviceClient
        .from("profile_media" as never)
        .insert({
          user_id: auth.userId,
          kind: "video",
          provider: "cloudflare_stream",
          status: "processing",
          position: nextProfileMediaPosition(media),
          is_primary: false,
          stream_uid: upload.uid,
        } as never)
        .select("id")
        .single();

      if (insertRes.error) {
        throw insertRes.error;
      }
      const inserted = (insertRes.data ?? null) as { id?: string } | null;

      return NextResponse.json({
        ok: true,
        mediaId: inserted?.id ?? null,
        streamUid: upload.uid,
        uploadUrl: upload.uploadUrl,
        maxDurationSeconds: PROFILE_MEDIA_MAX_SOURCE_VIDEO_DURATION_SEC,
      });
    } catch (error) {
      await deleteCloudflareStreamVideo(upload.uid).catch(() => undefined);
      throw error;
    }
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not prepare video upload." },
      { status: 500 }
    );
  }
}
