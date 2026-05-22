import type { SupabaseClient } from "@supabase/supabase-js";

export type ProfileSummary = {
  userId: string;
  displayName: string | null;
  city: string | null;
  country: string | null;
  avatarUrl: string | null;
  roles?: string[] | null;
};

const BATCH_SIZE = 500; // Safe batch size for Supabase

export async function batchFetchProfiles(
  client: SupabaseClient,
  userIds: string[],
  options: { includeRoles?: boolean } = {}
): Promise<Map<string, ProfileSummary>> {
  if (userIds.length === 0) return new Map();

  const uniqueIds = Array.from(new Set(userIds)).filter((id): id is string => Boolean(id));
  if (uniqueIds.length === 0) return new Map();

  const columns = options.includeRoles ? "user_id,display_name,city,country,avatar_url,roles" : "user_id,display_name,city,country,avatar_url";
  const profileMap = new Map<string, ProfileSummary>();

  // Fetch in batches to avoid URL length limits
  for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + BATCH_SIZE);
    const { data, error } = await client.from("profiles").select(columns).in("user_id", batch);

    if (!error && Array.isArray(data)) {
      data.forEach((row: Record<string, unknown>) => {
        const userId = typeof row.user_id === "string" ? row.user_id : null;
        if (userId) {
          profileMap.set(userId, {
            userId,
            displayName: typeof row.display_name === "string" && row.display_name.trim() ? row.display_name : null,
            city: typeof row.city === "string" && row.city.trim() ? row.city : null,
            country: typeof row.country === "string" && row.country.trim() ? row.country : null,
            avatarUrl: typeof row.avatar_url === "string" && row.avatar_url.trim() ? row.avatar_url : null,
            roles: options.includeRoles && Array.isArray(row.roles) ? (row.roles as string[]) : undefined,
          });
        }
      });
    }
  }

  return profileMap;
}

export function resolveProfile(profileMap: Map<string, ProfileSummary>, userId: string | null): ProfileSummary | null {
  if (!userId) return null;
  return profileMap.get(userId) ?? null;
}
