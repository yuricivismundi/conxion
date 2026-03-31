import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { VERIFIED_VIA_PAYMENT_LABEL } from "@/lib/verification";

export async function markProfileVerifiedViaPayment(userId: string) {
  const service = getSupabaseServiceClient();
  const profileRes = await service
    .from("profiles")
    .select("user_id,verified,verified_label")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileRes.error) {
    throw new Error(profileRes.error.message);
  }

  const profile = (profileRes.data ?? null) as Record<string, unknown> | null;
  if (!profile) {
    throw new Error("Profile not found.");
  }

  const alreadyPaymentVerified = profile.verified === true && profile.verified_label === VERIFIED_VIA_PAYMENT_LABEL;
  if (alreadyPaymentVerified) return { alreadyVerified: true as const };

  const updateRes = await service
    .from("profiles")
    .update({
      verified_at: new Date().toISOString(),
      verified: true,
      verified_label: VERIFIED_VIA_PAYMENT_LABEL,
    } as never)
    .eq("user_id", userId);

  if (updateRes.error) {
    throw new Error(updateRes.error.message);
  }

  return { alreadyVerified: false as const };
}
