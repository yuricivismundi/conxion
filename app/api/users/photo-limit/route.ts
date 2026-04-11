import { NextResponse } from "next/server";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getPlanIdFromMeta, getPlanLimits } from "@/lib/billing/limits";

/**
 * GET /api/users/photo-limit?userId=<uuid>
 * Returns the profile photo limit for the given user based on their billing plan.
 * Requires the caller to be authenticated.
 */
export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userClient = getSupabaseUserClient(token);
  const { data: authData } = await userClient.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  try {
    const serviceClient = getSupabaseServiceClient();

    // Fetch user auth metadata and profile verified status in parallel
    const [userRes, profileRes] = await Promise.all([
      serviceClient.auth.admin.getUserById(userId),
      serviceClient.from("profiles").select("verified").eq("user_id", userId).maybeSingle(),
    ]);

    if (userRes.error) return NextResponse.json({ profilePhotos: 0 });

    const profileData = profileRes.data as { verified?: boolean } | null;
    const isVerified = profileData?.verified === true;
    const planId = getPlanIdFromMeta(userRes.data.user?.user_metadata ?? {}, isVerified);
    const limits = getPlanLimits(planId);

    return NextResponse.json({ profilePhotos: limits.profilePhotos ?? 0, planId });
  } catch {
    return NextResponse.json({ profilePhotos: 0 });
  }
}
