import { getSupabaseServiceClient, type SupabaseServiceClient } from "@/lib/supabase/service-role";
import { buildUsernameSuggestionBase, normalizeUsername, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@/lib/username/normalize";
import { isReservedUsername } from "@/lib/username/reserved";
import { validateUsernameFormat } from "@/lib/username/validate";

export type UsernameAvailabilityResult = {
  normalizedUsername: string;
  available: boolean;
  error: string | null;
  suggestion: string | null;
};

type UsernameCheckParams = {
  username: string;
  currentUserId?: string | null;
  serviceClient?: SupabaseServiceClient;
};

type UsernameSuggestParams = {
  seed: string;
  currentUserId?: string | null;
  serviceClient?: SupabaseServiceClient;
};

async function usernameTakenInProfiles(client: SupabaseServiceClient, username: string, currentUserId?: string | null) {
  let query = client.from("profiles").select("user_id").eq("username", username).limit(1);
  if (currentUserId?.trim()) {
    query = query.neq("user_id", currentUserId.trim());
  }
  const result = await query.maybeSingle();
  if (result.error) {
    throw result.error;
  }
  return Boolean(result.data);
}

async function usernameBlockedInHistory(client: SupabaseServiceClient, username: string, currentUserId?: string | null) {
  let query = client.from("profile_username_history").select("user_id").eq("username", username).limit(1);
  if (currentUserId?.trim()) {
    query = query.neq("user_id", currentUserId.trim());
  }
  const result = await query.maybeSingle();
  if (result.error) {
    const message = String(result.error.message ?? "");
    if (message.toLowerCase().includes("does not exist")) return false;
    throw result.error;
  }
  return Boolean(result.data);
}

export async function isUsernameAvailable(params: UsernameCheckParams) {
  const serviceClient = params.serviceClient ?? getSupabaseServiceClient();
  const normalizedUsername = normalizeUsername(params.username);

  if (!normalizedUsername) return false;
  if (isReservedUsername(normalizedUsername)) return false;

  const [takenInProfiles, blockedInHistory] = await Promise.all([
    usernameTakenInProfiles(serviceClient, normalizedUsername, params.currentUserId),
    usernameBlockedInHistory(serviceClient, normalizedUsername, params.currentUserId),
  ]);

  return !takenInProfiles && !blockedInHistory;
}

export async function resolveAvailableUsernameSuggestion(params: UsernameSuggestParams) {
  const serviceClient = params.serviceClient ?? getSupabaseServiceClient();
  const base = buildUsernameSuggestionBase(params.seed);
  const fallbackSeed = base.length >= USERNAME_MIN_LENGTH ? base : "member";

  let suffix = 0;
  while (suffix <= 9999) {
    const candidate =
      suffix === 0
        ? fallbackSeed
        : `${fallbackSeed.slice(0, Math.max(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH - String(suffix).length))}${suffix}`;

    const normalizedCandidate = normalizeUsername(candidate).slice(0, USERNAME_MAX_LENGTH);
    const format = validateUsernameFormat(normalizedCandidate);
    if (format.valid) {
      const available = await isUsernameAvailable({
        username: normalizedCandidate,
        currentUserId: params.currentUserId,
        serviceClient,
      });
      if (available) return normalizedCandidate;
    }
    suffix += 1;
  }

  return null;
}

export async function checkUsernameAvailability(params: UsernameCheckParams): Promise<UsernameAvailabilityResult> {
  const serviceClient = params.serviceClient ?? getSupabaseServiceClient();
  const normalizedUsername = normalizeUsername(params.username);
  const format = validateUsernameFormat(normalizedUsername);

  if (!format.valid) {
    return {
      normalizedUsername: format.normalizedUsername,
      available: false,
      error: format.error ?? "Username must be between 3 and 20 characters.",
      suggestion: null,
    };
  }

  const available = await isUsernameAvailable({
    username: format.normalizedUsername,
    currentUserId: params.currentUserId,
    serviceClient,
  });

  if (available) {
    return {
      normalizedUsername: format.normalizedUsername,
      available: true,
      error: null,
      suggestion: format.normalizedUsername,
    };
  }

  const suggestion = await resolveAvailableUsernameSuggestion({
    seed: format.normalizedUsername,
    currentUserId: params.currentUserId,
    serviceClient,
  });

  return {
    normalizedUsername: format.normalizedUsername,
    available: false,
    error: "This username is already taken.",
    suggestion,
  };
}
