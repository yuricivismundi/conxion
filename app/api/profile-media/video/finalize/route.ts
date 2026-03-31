import { NextResponse } from "next/server";
import { getBillingAccountState } from "@/lib/billing/account-state";
import {
  createCloudflareStreamClip,
  deleteCloudflareStreamVideo,
  getCloudflareStreamError,
  getCloudflareStreamVideo,
  mapCloudflareStreamStatus,
} from "@/lib/cloudflare-stream";
import {
  PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC,
  countProfileMedia,
  nextProfileMediaPosition,
} from "@/lib/profile-media/limits";
import {
  getOwnerAvatarPhotoCount,
  getOwnerProfileMediaById,
  jsonError,
  listOwnerProfileMedia,
  requireProfileMediaAuth,
} from "@/lib/profile-media/server";
import type { SupabaseServiceClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type FinalizePayload = {
  mediaId?: unknown;
  streamUid?: unknown;
  clipStartSec?: unknown;
  clipEndSec?: unknown;
};

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeClipWindow(params: {
  durationSec: number | null;
  startSec: number | null;
  endSec: number | null;
}) {
  if (params.startSec === null && params.endSec === null) {
    return null;
  }

  const startSec = Math.max(0, Math.floor(params.startSec ?? 0));
  const requestedEnd = params.endSec === null ? startSec + PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC : Math.ceil(params.endSec);
  const durationLimit = params.durationSec === null ? requestedEnd : Math.ceil(params.durationSec);
  const endSec = Math.min(durationLimit, requestedEnd);

  if (endSec <= startSec) {
    throw new Error("Choose a valid clip range.");
  }

  if (endSec - startSec > PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC) {
    throw new Error(`Choose a clip that is ${PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC} seconds or shorter.`);
  }

  if (params.durationSec !== null && endSec > Math.ceil(params.durationSec)) {
    throw new Error("The selected clip ends after the video finishes.");
  }

  return { startSec, endSec };
}

async function updateVideoRow(params: {
  serviceClient: SupabaseServiceClient;
  userId: string;
  mediaId: string;
  values: Record<string, unknown>;
}) {
  const updateRes = await params.serviceClient
    .from("profile_media" as never)
    .update(params.values as never)
    .eq("id", params.mediaId)
    .eq("user_id", params.userId);

  if (updateRes.error) throw updateRes.error;
}

export async function POST(req: Request) {
  try {
    const auth = await requireProfileMediaAuth(req);
    if ("error" in auth) return auth.error;
    const billingState = getBillingAccountState({
      userMetadata: auth.authUser.user_metadata,
      isVerified: false,
    });

    const body = (await req.json().catch(() => null)) as FinalizePayload | null;
    const mediaId = typeof body?.mediaId === "string" ? body.mediaId.trim() : "";
    const streamUid = typeof body?.streamUid === "string" ? body.streamUid.trim() : "";

    if (!streamUid) {
      return jsonError("streamUid is required.", 400);
    }

    let media = mediaId ? await getOwnerProfileMediaById(auth.serviceClient, auth.userId, mediaId) : null;
    if (!media) {
      const { data, error } = await auth.serviceClient
        .from("profile_media" as never)
        .select("id")
        .eq("user_id", auth.userId)
        .eq("stream_uid", streamUid)
        .maybeSingle();

      if (error) throw error;
      const row = (data ?? null) as { id?: string } | null;
      if (row?.id) {
        media = await getOwnerProfileMediaById(auth.serviceClient, auth.userId, row.id);
      }
    }

    if (!media) {
      const ownerMedia = await listOwnerProfileMedia(auth.serviceClient, auth.userId);
      const avatarPhotoCount = await getOwnerAvatarPhotoCount(auth.serviceClient, auth.userId);
      const counts = countProfileMedia(ownerMedia, billingState.currentPlanId, { avatarPhotoCount });
      if (!counts.canAddVideo) {
        return jsonError("You already reached the showcase video limit.", 400);
      }

      const insertRes = await auth.serviceClient
        .from("profile_media" as never)
        .insert({
          user_id: auth.userId,
          kind: "video",
          provider: "cloudflare_stream",
          status: "processing",
          position: nextProfileMediaPosition(ownerMedia),
          is_primary: false,
          stream_uid: streamUid,
        } as never)
        .select("id")
        .single();

      if (insertRes.error) throw insertRes.error;
      const inserted = (insertRes.data ?? null) as { id?: string } | null;
      media = inserted?.id ? await getOwnerProfileMediaById(auth.serviceClient, auth.userId, inserted.id) : null;
    }

    if (!media) {
      return jsonError("Video record not found.", 404);
    }

    const sourceVideo = await getCloudflareStreamVideo(streamUid);
    const durationRaw = typeof sourceVideo.duration === "number" && Number.isFinite(sourceVideo.duration) ? sourceVideo.duration : null;
    const durationSec = durationRaw === null ? null : Math.ceil(durationRaw);
    const sourceStatus = mapCloudflareStreamStatus(sourceVideo);
    const clipWindow = normalizeClipWindow({
      durationSec: durationRaw,
      startSec: parseNumber(body?.clipStartSec) ?? media.clipStartSec,
      endSec: parseNumber(body?.clipEndSec) ?? media.clipEndSec,
    });
    const needsClip = durationRaw !== null ? durationRaw > PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC : clipWindow !== null;

    if (needsClip) {
      if (!clipWindow) {
        return NextResponse.json(
          { ok: false, error: `Select the ${PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC}-second clip you want to keep.` },
          { status: 400 }
        );
      }

      if (sourceStatus === "failed") {
        await updateVideoRow({
          serviceClient: auth.serviceClient,
          userId: auth.userId,
          mediaId: media.id,
          values: {
            status: "failed",
            stream_uid: streamUid,
            source_stream_uid: streamUid,
            playback_url: null,
            thumbnail_url: sourceVideo.thumbnail ?? null,
            duration_sec: clipWindow.endSec - clipWindow.startSec,
            clip_start_sec: clipWindow.startSec,
            clip_end_sec: clipWindow.endSec,
            width: typeof sourceVideo.input?.width === "number" ? sourceVideo.input.width : null,
            height: typeof sourceVideo.input?.height === "number" ? sourceVideo.input.height : null,
          },
        });

        return NextResponse.json(
          { ok: false, error: getCloudflareStreamError(sourceVideo) ?? "Cloudflare Stream could not process this upload." },
          { status: 400 }
        );
      }

      if (sourceStatus !== "ready" || sourceVideo.readyToStream !== true) {
        await updateVideoRow({
          serviceClient: auth.serviceClient,
          userId: auth.userId,
          mediaId: media.id,
          values: {
            status: "processing",
            stream_uid: streamUid,
            source_stream_uid: streamUid,
            playback_url: null,
            thumbnail_url: sourceVideo.thumbnail ?? null,
            duration_sec: clipWindow.endSec - clipWindow.startSec,
            clip_start_sec: clipWindow.startSec,
            clip_end_sec: clipWindow.endSec,
            width: typeof sourceVideo.input?.width === "number" ? sourceVideo.input.width : null,
            height: typeof sourceVideo.input?.height === "number" ? sourceVideo.input.height : null,
          },
        });

        return NextResponse.json({
          ok: true,
          mediaId: media.id,
          status: "processing",
          queuedClip: true,
          clipStartSec: clipWindow.startSec,
          clipEndSec: clipWindow.endSec,
          durationSec: clipWindow.endSec - clipWindow.startSec,
        });
      }

      const previousClipUid = media.streamUid && media.streamUid !== streamUid ? media.streamUid : "";
      const clip = await createCloudflareStreamClip({
        userId: auth.userId,
        sourceUid: streamUid,
        startTimeSeconds: clipWindow.startSec,
        endTimeSeconds: clipWindow.endSec,
        meta: {
          userId: auth.userId,
          scope: "profile_media",
          mediaId: media.id,
          sourceStreamUid: streamUid,
          clipStartSec: String(clipWindow.startSec),
          clipEndSec: String(clipWindow.endSec),
        },
      });

      await updateVideoRow({
        serviceClient: auth.serviceClient,
        userId: auth.userId,
        mediaId: media.id,
        values: {
          status: "processing",
          stream_uid: clip.uid,
          source_stream_uid: streamUid,
          playback_url: null,
          thumbnail_url: sourceVideo.thumbnail ?? clip.thumbnail ?? null,
          duration_sec: clipWindow.endSec - clipWindow.startSec,
          clip_start_sec: clipWindow.startSec,
          clip_end_sec: clipWindow.endSec,
          width: typeof sourceVideo.input?.width === "number" ? sourceVideo.input.width : null,
          height: typeof sourceVideo.input?.height === "number" ? sourceVideo.input.height : null,
        },
      });

      if (previousClipUid && previousClipUid !== clip.uid) {
        await deleteCloudflareStreamVideo(previousClipUid).catch(() => undefined);
      }

      return NextResponse.json({
        ok: true,
        mediaId: media.id,
        status: "processing",
        streamUid: clip.uid,
        queuedClip: true,
        clipStartSec: clipWindow.startSec,
        clipEndSec: clipWindow.endSec,
        durationSec: clipWindow.endSec - clipWindow.startSec,
      });
    }

    await updateVideoRow({
      serviceClient: auth.serviceClient,
      userId: auth.userId,
      mediaId: media.id,
      values: {
        status: sourceStatus,
        stream_uid: streamUid,
        source_stream_uid: null,
        playback_url: sourceVideo.playback?.hls ?? null,
        thumbnail_url: sourceVideo.thumbnail ?? null,
        duration_sec: durationSec,
        clip_start_sec: null,
        clip_end_sec: null,
        width: typeof sourceVideo.input?.width === "number" ? sourceVideo.input.width : null,
        height: typeof sourceVideo.input?.height === "number" ? sourceVideo.input.height : null,
      },
    });

    if (sourceStatus === "failed") {
      return NextResponse.json(
        { ok: false, error: getCloudflareStreamError(sourceVideo) ?? "Cloudflare Stream could not process this video." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      mediaId: media.id,
      status: sourceStatus,
      playbackUrl: sourceVideo.playback?.hls ?? null,
      thumbnailUrl: sourceVideo.thumbnail ?? null,
      durationSec,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not finalize video upload." },
      { status: 500 }
    );
  }
}
