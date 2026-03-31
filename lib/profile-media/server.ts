import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { getSupabaseServiceClient, type SupabaseServiceClient } from "@/lib/supabase/service-role";
import { normalizeProfileMediaRow, sortProfileMedia, type ProfileMediaItem } from "@/lib/profile-media/types";

const PROFILE_MEDIA_ROUTE_SELECT = [
  "id",
  "user_id",
  "kind",
  "provider",
  "status",
  "position",
  "is_primary",
  "stream_uid",
  "source_stream_uid",
  "playback_url",
  "thumbnail_url",
  "duration_sec",
  "clip_start_sec",
  "clip_end_sec",
  "storage_path",
  "public_url",
  "width",
  "height",
  "blurhash",
  "created_at",
  "updated_at",
].join(",");

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function requireProfileMediaAuth(req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    return { error: jsonError("Missing auth token.", 401) } as const;
  }

  const supabase = getSupabaseUserClient(token);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return { error: jsonError("Invalid auth token.", 401) } as const;
  }

  return {
    userId: authData.user.id,
    authUser: authData.user,
    userClient: supabase,
    serviceClient: getSupabaseServiceClient(),
  } as const;
}

export async function listOwnerProfileMedia(serviceClient: SupabaseServiceClient, userId: string) {
  const { data, error } = await serviceClient
    .from("profile_media")
    .select(PROFILE_MEDIA_ROUTE_SELECT)
    .eq("user_id", userId)
    .order("is_primary", { ascending: false })
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return sortProfileMedia(((data ?? []) as unknown[]).map(normalizeProfileMediaRow).filter((item): item is ProfileMediaItem => Boolean(item)));
}

export async function getOwnerAvatarPhotoCount(serviceClient: SupabaseServiceClient, userId: string) {
  const { data, error } = await serviceClient
    .from("profiles")
    .select("avatar_url")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  const row = (data ?? null) as { avatar_url?: unknown } | null;
  const avatarUrl = typeof row?.avatar_url === "string" ? row.avatar_url.trim() : "";
  return avatarUrl ? 1 : 0;
}

export async function getOwnerProfileMediaById(serviceClient: SupabaseServiceClient, userId: string, mediaId: string) {
  const { data, error } = await serviceClient
    .from("profile_media")
    .select(PROFILE_MEDIA_ROUTE_SELECT)
    .eq("id", mediaId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return normalizeProfileMediaRow(data);
}
