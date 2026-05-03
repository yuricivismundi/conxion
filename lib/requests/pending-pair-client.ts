"use client";

import { supabase } from "@/lib/supabase/client";

type PendingPairConflictResponse = {
  ok?: boolean;
  error?: string;
  conflict?: {
    kind?: string | null;
    message?: string | null;
    requestId?: string | null;
  } | null;
};

export type PendingPairConflictDetails = {
  kind: string | null;
  message: string | null;
  requestId: string | null;
};

export async function fetchPendingPairConflictDetails(
  otherUserId: string | null | undefined
): Promise<PendingPairConflictDetails | null> {
  const targetUserId = otherUserId?.trim();
  if (!targetUserId) return null;

  const sessionRes = await supabase.auth.getSession();
  const accessToken = sessionRes.data.session?.access_token?.trim() ?? "";
  if (!accessToken) return null;

  const response = await fetch("/api/requests/pending-pair-conflict", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      otherUserId: targetUserId,
    }),
  });

  const result = (await response.json().catch(() => null)) as PendingPairConflictResponse | null;
  if (!response.ok || !result?.ok) return null;

  if (!result.conflict) return null;
  return {
    kind: result.conflict.kind?.trim() || null,
    message: result.conflict.message?.trim() || null,
    requestId: result.conflict.requestId?.trim() || null,
  };
}

export async function fetchPendingPairConflict(otherUserId: string | null | undefined): Promise<string | null> {
  const details = await fetchPendingPairConflictDetails(otherUserId);
  return details?.message ?? null;
}
