export type UsernameCheckResponse = {
  ok: boolean;
  normalizedUsername: string;
  available: boolean;
  error: string | null;
  suggestion: string | null;
};

type CheckUsernamePayload = {
  username: string;
  currentUserId?: string | null;
  seed?: string | null;
};

export async function requestUsernameCheck(payload: CheckUsernamePayload): Promise<UsernameCheckResponse> {
  const response = await fetch("/api/username/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => null)) as Partial<UsernameCheckResponse> | null;

  if (!response.ok) {
    return {
      ok: false,
      normalizedUsername: typeof data?.normalizedUsername === "string" ? data.normalizedUsername : "",
      available: false,
      error: typeof data?.error === "string" ? data.error : "Could not check username right now.",
      suggestion: typeof data?.suggestion === "string" ? data.suggestion : null,
    };
  }

  return {
    ok: true,
    normalizedUsername: typeof data?.normalizedUsername === "string" ? data.normalizedUsername : "",
    available: data?.available === true,
    error: typeof data?.error === "string" ? data.error : null,
    suggestion: typeof data?.suggestion === "string" ? data.suggestion : null,
  };
}
