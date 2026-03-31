import { NextResponse } from "next/server";
import { jsonError, listOwnerProfileMedia, requireProfileMediaAuth } from "@/lib/profile-media/server";

export const runtime = "nodejs";

type OrderPayload = {
  orderedIds?: unknown;
};

export async function POST(req: Request) {
  try {
    const auth = await requireProfileMediaAuth(req);
    if ("error" in auth) return auth.error;

    const body = (await req.json().catch(() => null)) as OrderPayload | null;
    const orderedIds = Array.isArray(body?.orderedIds)
      ? body?.orderedIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];

    const media = await listOwnerProfileMedia(auth.serviceClient, auth.userId);
    const currentIds = media.map((item) => item.id);
    const orderedSet = new Set(orderedIds);

    if (
      orderedIds.length !== currentIds.length ||
      orderedSet.size !== currentIds.length ||
      orderedIds.some((id) => !currentIds.includes(id)) ||
      currentIds.some((id) => !orderedSet.has(id))
    ) {
      return jsonError("orderedIds must include every owned media item exactly once.", 400);
    }

    for (const [index, id] of orderedIds.entries()) {
      const updateRes = await auth.serviceClient
        .from("profile_media" as never)
        .update({ position: index } as never)
        .eq("id", id)
        .eq("user_id", auth.userId);

      if (updateRes.error) throw updateRes.error;
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not reorder media." },
      { status: 500 }
    );
  }
}
