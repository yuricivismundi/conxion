import { NextResponse } from "next/server";
import {
  getCloudflareStreamVideo,
  getCloudflareStreamError,
  mapCloudflareStreamStatus,
} from "@/lib/cloudflare-stream";
import {
  getOwnerProfileMediaById,
  requireProfileMediaAuth,
} from "@/lib/profile-media/server";

export async function POST(req: Request) {
  try {
    const auth = await requireProfileMediaAuth(req);
    if ("error" in auth) return auth.error;

    const body = (await req.json().catch(() => null)) as { mediaId?: unknown } | null;
    const mediaId = typeof body?.mediaId === "string" ? body.mediaId.trim() : "";
    if (!mediaId) {
      return NextResponse.json({ ok: false, error: "mediaId is required." }, { status: 400 });
    }

    const media = await getOwnerProfileMediaById(auth.serviceClient, auth.userId, mediaId);
    if (!media) {
      return NextResponse.json({ ok: false, error: "Media not found." }, { status: 404 });
    }

    // Always check the clip/final UID (stream_uid), NOT the source.
    // After clipping: stream_uid = clip uid, source_stream_uid = original upload uid.
    const streamUid = media.streamUid;
    if (!streamUid) {
      return NextResponse.json({ ok: false, error: "No Cloudflare Stream UID for this item." }, { status: 400 });
    }

    // Ping Cloudflare directly for the latest status
    const cfVideo = await getCloudflareStreamVideo(streamUid);
    const status = mapCloudflareStreamStatus(cfVideo);
    const errorMessage = status === "failed" ? (getCloudflareStreamError(cfVideo) ?? "Processing failed.") : null;

    // Always update when status changes OR when the video is ready but playback_url is missing
    const needsUpdate = status !== media.status || (status === "ready" && !media.playbackUrl);
    if (needsUpdate) {
      const updateValues: Record<string, unknown> = { status };

      if (status === "ready") {
        updateValues.playback_url = cfVideo.playback?.hls ?? null;
        updateValues.thumbnail_url = cfVideo.thumbnail ?? media.thumbnailUrl ?? null;
        const durationRaw = typeof cfVideo.duration === "number" && Number.isFinite(cfVideo.duration)
          ? cfVideo.duration : null;
        if (durationRaw !== null) {
          updateValues.duration_sec = Math.ceil(durationRaw);
        }
        if (typeof cfVideo.input?.width === "number") updateValues.width = cfVideo.input.width;
        if (typeof cfVideo.input?.height === "number") updateValues.height = cfVideo.input.height;
      }

      await auth.serviceClient
        .from("profile_media")
        .update(updateValues as never)
        .eq("id", mediaId)
        .eq("user_id", auth.userId);
    }

    return NextResponse.json({
      ok: true,
      status,
      playbackUrl: status === "ready" ? (cfVideo.playback?.hls ?? null) : null,
      thumbnailUrl: cfVideo.thumbnail ?? null,
      error: errorMessage,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
