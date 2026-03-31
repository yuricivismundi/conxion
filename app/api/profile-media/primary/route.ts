import { NextResponse } from "next/server";
import { getOwnerProfileMediaById, jsonError, requireProfileMediaAuth } from "@/lib/profile-media/server";

export const runtime = "nodejs";

type PrimaryPayload = {
  mediaId?: unknown;
};

export async function POST(req: Request) {
  try {
    const auth = await requireProfileMediaAuth(req);
    if ("error" in auth) return auth.error;

    const body = (await req.json().catch(() => null)) as PrimaryPayload | null;
    const mediaId = typeof body?.mediaId === "string" ? body.mediaId.trim() : "";
    if (!mediaId) {
      return jsonError("mediaId is required.", 400);
    }

    const media = await getOwnerProfileMediaById(auth.serviceClient, auth.userId, mediaId);
    if (!media) {
      return jsonError("Media item not found.", 404);
    }
    if (media.status !== "ready") {
      return jsonError("Only ready media can be set as main.", 400);
    }

    const clearRes = await auth.serviceClient
      .from("profile_media" as never)
      .update({ is_primary: false } as never)
      .eq("user_id", auth.userId)
      .eq("is_primary", true);
    if (clearRes.error) throw clearRes.error;

    const setRes = await auth.serviceClient
      .from("profile_media" as never)
      .update({ is_primary: true } as never)
      .eq("id", mediaId)
      .eq("user_id", auth.userId);
    if (setRes.error) throw setRes.error;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not set the main media." },
      { status: 500 }
    );
  }
}
