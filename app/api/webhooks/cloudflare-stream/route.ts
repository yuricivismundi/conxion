import { NextResponse } from "next/server";
import {
  createCloudflareStreamClip,
  deleteCloudflareStreamVideo,
  getCloudflareStreamVideo,
  mapCloudflareStreamStatus,
  verifyCloudflareStreamWebhookSignature,
} from "@/lib/cloudflare-stream";
import { PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC } from "@/lib/profile-media/limits";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

function getUid(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const row = payload as Record<string, unknown>;
  const candidates = [row.uid, row.video, row.data, row.result];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === "object" && typeof (candidate as Record<string, unknown>).uid === "string") {
      return ((candidate as Record<string, unknown>).uid as string).trim();
    }
  }

  return "";
}

type MediaWebhookRow = {
  id?: string;
  user_id?: string;
  stream_uid?: string | null;
  source_stream_uid?: string | null;
  clip_start_sec?: number | null;
  clip_end_sec?: number | null;
};

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("Webhook-Signature");

    if (!verifyCloudflareStreamWebhookSignature({ body: rawBody, header: signature })) {
      return NextResponse.json({ ok: false, error: "Invalid webhook signature." }, { status: 401 });
    }

    const body = JSON.parse(rawBody) as unknown;
    const uid = getUid(body);
    if (!uid) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const service = getSupabaseServiceClient();
    const { data: rows, error: rowError } = await service
      .from("profile_media" as never)
      .select("id,user_id,stream_uid,source_stream_uid,clip_start_sec,clip_end_sec")
      .or(`stream_uid.eq.${uid},source_stream_uid.eq.${uid}`);

    if (rowError) throw rowError;

    const mediaRow = ((rows ?? []) as MediaWebhookRow[]).find((row) => row.stream_uid === uid) ?? ((rows ?? [])[0] as MediaWebhookRow | undefined);
    if (!mediaRow?.id || !mediaRow?.user_id) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const clipStartSec = typeof mediaRow.clip_start_sec === "number" ? mediaRow.clip_start_sec : null;
    const clipEndSec = typeof mediaRow.clip_end_sec === "number" ? mediaRow.clip_end_sec : null;
    const hasClipWindow = clipStartSec !== null && clipEndSec !== null;
    const awaitingClipSource =
      hasClipWindow &&
      mediaRow.stream_uid === uid &&
      mediaRow.source_stream_uid === uid;

    if (mediaRow.source_stream_uid === uid && mediaRow.stream_uid && mediaRow.stream_uid !== uid) {
      return NextResponse.json({ ok: true, ignored: true, reason: "source webhook after clip creation" });
    }

    const video = await getCloudflareStreamVideo(uid);
    const durationRaw = typeof video.duration === "number" && Number.isFinite(video.duration) ? video.duration : null;
    const durationSec = durationRaw === null ? null : Math.ceil(durationRaw);
    const status = mapCloudflareStreamStatus(video);

    if (awaitingClipSource) {
      if (status === "failed") {
        const failedRes = await service
          .from("profile_media" as never)
          .update({
            status: "failed",
            playback_url: null,
            thumbnail_url: video.thumbnail ?? null,
            duration_sec: clipEndSec - clipStartSec,
            width: typeof video.input?.width === "number" ? video.input.width : null,
            height: typeof video.input?.height === "number" ? video.input.height : null,
          } as never)
          .eq("id", mediaRow.id)
          .eq("user_id", mediaRow.user_id);

        if (failedRes.error) throw failedRes.error;
        return NextResponse.json({ ok: true, uid, status: "failed" });
      }

      if (status !== "ready" || video.readyToStream !== true) {
        return NextResponse.json({ ok: true, uid, status: "processing", queuedClip: true });
      }

      try {
        const clip = await createCloudflareStreamClip({
          userId: mediaRow.user_id,
          sourceUid: uid,
          startTimeSeconds: clipStartSec,
          endTimeSeconds: clipEndSec,
          meta: {
            userId: mediaRow.user_id,
            scope: "profile_media",
            mediaId: mediaRow.id,
            sourceStreamUid: uid,
            clipStartSec: String(clipStartSec),
            clipEndSec: String(clipEndSec),
          },
        });

        const clipRes = await service
          .from("profile_media" as never)
          .update({
            status: "processing",
            stream_uid: clip.uid,
            source_stream_uid: uid,
            playback_url: null,
            thumbnail_url: video.thumbnail ?? clip.thumbnail ?? null,
            duration_sec: clipEndSec - clipStartSec,
            width: typeof video.input?.width === "number" ? video.input.width : null,
            height: typeof video.input?.height === "number" ? video.input.height : null,
          } as never)
          .eq("id", mediaRow.id)
          .eq("user_id", mediaRow.user_id);

        if (clipRes.error) throw clipRes.error;
        return NextResponse.json({ ok: true, uid: clip.uid, status: "processing", action: "clip_started" });
      } catch {
        const failedRes = await service
          .from("profile_media" as never)
          .update({
            status: "failed",
            playback_url: null,
            thumbnail_url: video.thumbnail ?? null,
            duration_sec: clipEndSec - clipStartSec,
            width: typeof video.input?.width === "number" ? video.input.width : null,
            height: typeof video.input?.height === "number" ? video.input.height : null,
          } as never)
          .eq("id", mediaRow.id)
          .eq("user_id", mediaRow.user_id);

        if (failedRes.error) throw failedRes.error;
        return NextResponse.json({ ok: true, uid, status: "failed", action: "clip_failed" });
      }
    }

    let nextStatus = status;
    if (durationRaw !== null && durationRaw > PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC && !hasClipWindow) {
      nextStatus = "failed";
      await deleteCloudflareStreamVideo(uid).catch(() => undefined);
    }

    if (nextStatus === "ready" && mediaRow.source_stream_uid && mediaRow.source_stream_uid !== uid) {
      await deleteCloudflareStreamVideo(mediaRow.source_stream_uid).catch(() => undefined);
    }

    const updateRes = await service
      .from("profile_media" as never)
      .update({
        status: nextStatus,
        playback_url: nextStatus === "ready" ? video.playback?.hls ?? null : null,
        thumbnail_url: video.thumbnail ?? null,
        duration_sec: hasClipWindow ? clipEndSec - clipStartSec : durationSec,
        source_stream_uid: nextStatus === "ready" ? null : mediaRow.source_stream_uid ?? null,
        clip_start_sec: nextStatus === "ready" ? null : clipStartSec,
        clip_end_sec: nextStatus === "ready" ? null : clipEndSec,
        width: typeof video.input?.width === "number" ? video.input.width : null,
        height: typeof video.input?.height === "number" ? video.input.height : null,
      } as never)
      .eq("id", mediaRow.id)
      .eq("user_id", mediaRow.user_id);

    if (updateRes.error) throw updateRes.error;

    return NextResponse.json({ ok: true, uid, status: nextStatus });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Webhook processing failed." },
      { status: 500 }
    );
  }
}
