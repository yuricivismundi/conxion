import { NextResponse } from "next/server";
import { deleteCloudflareStreamVideo } from "@/lib/cloudflare-stream";
import { PROFILE_MEDIA_BUCKET } from "@/lib/profile-media/storage";
import { getOwnerProfileMediaById, jsonError, requireProfileMediaAuth } from "@/lib/profile-media/server";

export const runtime = "nodejs";

export async function DELETE(req: Request, context: { params: Promise<{ mediaId: string }> }) {
  try {
    const auth = await requireProfileMediaAuth(req);
    if ("error" in auth) return auth.error;

    const { mediaId } = await context.params;
    const media = await getOwnerProfileMediaById(auth.serviceClient, auth.userId, mediaId);
    if (!media) {
      return jsonError("Media item not found.", 404);
    }

    if (media.kind === "photo" && media.storagePath) {
      await auth.serviceClient.storage.from(PROFILE_MEDIA_BUCKET).remove([media.storagePath]).catch(() => undefined);
    }

    if (media.kind === "video" && media.streamUid) {
      await deleteCloudflareStreamVideo(media.streamUid).catch(() => undefined);
    }

    const deleteRes = await auth.serviceClient
      .from("profile_media")
      .delete()
      .eq("id", mediaId)
      .eq("user_id", auth.userId);

    if (deleteRes.error) throw deleteRes.error;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not delete media." },
      { status: 500 }
    );
  }
}
