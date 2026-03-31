import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { getSupabaseServiceClient, type SupabaseServiceClient } from "@/lib/supabase/service-role";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function requireServiceInquiryAuth(req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    return { error: jsonError("Missing auth token.", 401) } as const;
  }

  const userClient = getSupabaseUserClient(token);
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) {
    return { error: jsonError("Invalid auth token.", 401) } as const;
  }

  return {
    token,
    userId: data.user.id,
    userClient,
    serviceClient: getSupabaseServiceClient(),
  } as const;
}

export function singleLineTrimmed(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const compact = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.slice(0, maxLength).trim();
}

export async function fetchTeacherProfileSummary(serviceClient: SupabaseServiceClient, userId: string) {
  const { data, error } = await serviceClient
    .from("profiles")
    .select("user_id,display_name,avatar_url,city,country")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const row = (data ?? null) as Record<string, unknown> | null;
  return {
    userId,
    displayName: typeof row?.display_name === "string" && row.display_name.trim() ? row.display_name : "Teacher",
    avatarUrl: typeof row?.avatar_url === "string" ? row.avatar_url : null,
    city: typeof row?.city === "string" && row.city.trim() ? row.city : null,
    country: typeof row?.country === "string" && row.country.trim() ? row.country : null,
  };
}
