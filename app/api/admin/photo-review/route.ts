import { NextResponse } from "next/server";
import { sendAdminThreadNotice } from "@/lib/admin/communication";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type PhotoReviewAction = "approve" | "reject" | "request_update";

function isPhotoReviewAction(value: unknown): value is PhotoReviewAction {
  return value === "approve" || value === "reject" || value === "request_update";
}

function formatPhotoLabel(photoType: string) {
  return photoType === "cover" ? "cover photo" : "profile photo";
}

function buildPhotoThreadMessage(params: {
  action: PhotoReviewAction;
  photoLabel: string;
  note: string;
}) {
  if (params.action === "approve") {
    return params.note || `Your ${params.photoLabel} was approved by admin.`;
  }
  if (params.action === "reject") {
    const reason = params.note ? `\n\nReason: ${params.note}` : "";
    return `Your ${params.photoLabel} was rejected by admin.${reason}\n\nPlease upload a new photo that is clear, shows your face, and meets our community guidelines. Your profile will not appear in discovery until a new photo has been submitted.`;
  }
  return params.note || `Your ${params.photoLabel} needs changes before it can stay on your profile.`;
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });

    const supabaseUser = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
    if (authErr || !authData.user) return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });

    const actorId = authData.user.id;
    const service = getSupabaseServiceClient();

    // Verify caller is an admin
    const { data: adminRow } = await service.from("admins").select("user_id").eq("user_id", actorId).maybeSingle();
    if (!adminRow) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });

    const body = (await req.json().catch(() => null)) as {
      userId?: string;
      photoType?: string;
      action?: unknown;
      message?: string;
    } | null;

    const userId = body?.userId?.trim();
    const photoType = body?.photoType?.trim() || "photo";
    const action = isPhotoReviewAction(body?.action) ? body.action : "request_update";
    const message = body?.message?.trim() ?? "";

    if (!userId) {
      return NextResponse.json({ ok: false, error: "userId is required." }, { status: 400 });
    }

    if ((action === "reject" || action === "request_update") && !message) {
      return NextResponse.json({ ok: false, error: "A rejection note is required." }, { status: 400 });
    }

    const profileRes = await service
      .from("profiles")
      .select("user_id,display_name,avatar_url,avatar_path")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileRes.error) {
      return NextResponse.json({ ok: false, error: profileRes.error.message }, { status: 400 });
    }

    const profile = (profileRes.data ?? null) as
      | {
          user_id?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          avatar_path?: string | null;
        }
      | null;
    if (!profile?.user_id) {
      return NextResponse.json({ ok: false, error: "Profile not found." }, { status: 404 });
    }

    if (photoType !== "cover") {
      if (action === "reject" && profile.avatar_path) {
        // Delete the file from storage — ignore errors (file may already be gone)
        await service.storage.from("avatars").remove([profile.avatar_path]).catch(() => null);
      }

      // The DB constraint (profiles_avatar_not_blank) requires avatar_url >= 10 chars so
      // it cannot be set to null. On rejection we reset it to the system placeholder
      // so the storage file (already deleted) is no longer referenced and the profile
      // shows no custom photo. avatar_status = 'rejected' hides them from discovery.
      const updatePayload: Record<string, unknown> =
        action === "approve"
          ? { avatar_status: "approved" }
          : { avatar_status: "rejected", avatar_path: null, avatar_url: "https://i.pravatar.cc/300" };

      const profilesTable = service.from("profiles" as never) as unknown as {
        update: (values: Record<string, unknown>) => {
          eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }>;
        };
      };
      const updateRes = await profilesTable.update(updatePayload).eq("user_id", userId);
      if (updateRes.error) {
        return NextResponse.json({ ok: false, error: updateRes.error.message }, { status: 400 });
      }
    }

    const photoLabel = formatPhotoLabel(photoType);
    const title =
      action === "approve"
        ? `${photoLabel[0].toUpperCase()}${photoLabel.slice(1)} approved`
        : action === "reject"
          ? `${photoLabel[0].toUpperCase()}${photoLabel.slice(1)} rejected`
          : `${photoLabel[0].toUpperCase()}${photoLabel.slice(1)} needs changes`;

    let threadToken: string | null = null;
    let notificationWarning: string | null = null;
    try {
      const notice = await sendAdminThreadNotice({
        serviceClient: service,
        actorId,
        recipientUserId: userId,
        title,
        message: buildPhotoThreadMessage({
          action,
          photoLabel,
          note: message,
        }),
        notificationBody:
          action === "approve"
            ? `Admin approved your ${photoLabel}.`
            : `Admin sent you feedback about your ${photoLabel}.`,
        metadata: {
          source: "admin_photo_review",
          photo_type: photoType,
          moderation_action: action,
        },
      });
      threadToken = notice.threadToken;
      notificationWarning = notice.notificationError;
    } catch (noticeError: unknown) {
      notificationWarning = noticeError instanceof Error ? noticeError.message : "Could not deliver the admin message.";
    }

    return NextResponse.json({
      ok: true,
      action,
      threadToken,
      notificationWarning,
      displayName: profile.display_name ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}
