import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { TEACHER_INFO_ATTACHMENTS_BUCKET, TEACHER_INFO_ATTACHMENT_MAX_BYTES, buildTeacherInfoAttachmentStoragePath, isAcceptedTeacherInfoAttachmentMimeType } from "@/lib/teacher-info/storage";
import { jsonError, requireServiceInquiryAuth } from "@/lib/service-inquiries/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const auth = await requireServiceInquiryAuth(req);
    if ("error" in auth) return auth.error;

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size <= 0) {
      return jsonError("Attachment file is required.", 400);
    }
    if (!isAcceptedTeacherInfoAttachmentMimeType(file.type)) {
      return jsonError("Attachments must be PDF, JPEG, PNG, or WebP.", 400);
    }
    if (file.size > TEACHER_INFO_ATTACHMENT_MAX_BYTES) {
      return jsonError("Attachments must stay under 8MB.", 400);
    }

    const path = buildTeacherInfoAttachmentStoragePath(auth.userId, randomUUID(), file.name || "attachment");
    const uploadRes = await auth.serviceClient.storage
      .from(TEACHER_INFO_ATTACHMENTS_BUCKET)
      .upload(path, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadRes.error) throw uploadRes.error;

    const publicUrl = auth.serviceClient.storage.from(TEACHER_INFO_ATTACHMENTS_BUCKET).getPublicUrl(path).data.publicUrl;

    return NextResponse.json({
      ok: true,
      attachment: {
        name: file.name || "attachment",
        url: publicUrl,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        storagePath: path,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not upload attachment." },
      { status: 500 }
    );
  }
}

type DeletePayload = {
  storagePath?: unknown;
};

export async function DELETE(req: Request) {
  try {
    const auth = await requireServiceInquiryAuth(req);
    if ("error" in auth) return auth.error;

    const body = (await req.json().catch(() => null)) as DeletePayload | null;
    const storagePath = typeof body?.storagePath === "string" ? body.storagePath.trim() : "";
    if (!storagePath) return jsonError("Attachment path is required.", 400);
    if (!storagePath.startsWith(`${auth.userId}/`)) {
      return jsonError("You do not have permission to delete this attachment.", 403);
    }

    const removeRes = await auth.serviceClient.storage.from(TEACHER_INFO_ATTACHMENTS_BUCKET).remove([storagePath]);
    if (removeRes.error) throw removeRes.error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not delete attachment." },
      { status: 500 }
    );
  }
}
