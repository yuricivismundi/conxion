import { createHmac, timingSafeEqual } from "crypto";

type CloudflareEnvelope<T> = {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
};

type CloudflareDirectUploadResult = {
  uploadURL?: string;
  uid?: string;
};

type CloudflareVideoStatus = {
  state?: string;
  pctComplete?: string;
  errorReasonCode?: string;
  errorReasonText?: string;
  errReasonCode?: string;
  errReasonText?: string;
};

export type CloudflareStreamVideo = {
  uid?: string;
  readyToStream?: boolean;
  thumbnail?: string;
  preview?: string;
  duration?: number;
  playback?: {
    hls?: string;
    dash?: string;
  };
  status?: CloudflareVideoStatus | string;
  input?: {
    width?: number;
    height?: number;
  };
  meta?: Record<string, unknown> | null;
};

type CloudflareStreamClipResult = CloudflareStreamVideo & {
  clippedFromVideoUID?: string;
};

function getCloudflareStreamConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_STREAM_TOKEN?.trim();

  if (!accountId) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
  if (!token) throw new Error("Missing CLOUDFLARE_STREAM_TOKEN");

  return {
    accountId,
    token,
    customerSubcode: process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBCODE?.trim() || "",
    webhookSecret: process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET?.trim() || "",
  };
}

async function cloudflareStreamFetch<T>(path: string, init?: RequestInit) {
  const config = getCloudflareStreamConfig();
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as CloudflareEnvelope<T> | null;
  if (!response.ok || payload?.success === false || !payload?.result) {
    const message =
      payload?.errors?.map((item) => item.message).filter(Boolean).join(", ") ||
      `Cloudflare Stream request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return payload.result;
}

export function buildCloudflareCreatorTag(userId: string) {
  const { customerSubcode } = getCloudflareStreamConfig();
  const raw = customerSubcode ? `${customerSubcode}:${userId}` : userId;
  return raw.slice(0, 64);
}

export async function createCloudflareStreamDirectUpload(params: {
  userId: string;
  maxDurationSeconds: number;
  meta?: Record<string, string>;
}) {
  const result = await cloudflareStreamFetch<CloudflareDirectUploadResult>("/stream/direct_upload", {
    method: "POST",
    body: JSON.stringify({
      maxDurationSeconds: params.maxDurationSeconds,
      creator: buildCloudflareCreatorTag(params.userId),
      meta: params.meta ?? {},
    }),
  });

  const uploadUrl = typeof result.uploadURL === "string" ? result.uploadURL : "";
  const uid = typeof result.uid === "string" ? result.uid : "";

  if (!uploadUrl || !uid) {
    throw new Error("Cloudflare Stream did not return an upload URL.");
  }

  return { uploadUrl, uid };
}

function extractCloudflareStreamUidFromUrl(value: string | undefined) {
  if (!value) return "";

  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const token = parts.find((part) => /^[a-f0-9]{32}$/i.test(part));
    return token ?? "";
  } catch {
    return "";
  }
}

export async function createCloudflareStreamClip(params: {
  userId: string;
  sourceUid: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  meta?: Record<string, string>;
}) {
  const result = await cloudflareStreamFetch<CloudflareStreamClipResult>("/stream/clip", {
    method: "POST",
    body: JSON.stringify({
      clippedFromVideoUID: params.sourceUid,
      startTimeSeconds: params.startTimeSeconds,
      endTimeSeconds: params.endTimeSeconds,
      creator: buildCloudflareCreatorTag(params.userId),
      meta: params.meta ?? {},
    }),
  });

  const uid =
    (typeof result.uid === "string" && result.uid.trim()) ||
    extractCloudflareStreamUidFromUrl(result.playback?.hls) ||
    extractCloudflareStreamUidFromUrl(result.playback?.dash) ||
    extractCloudflareStreamUidFromUrl(result.preview);

  if (!uid) {
    throw new Error("Cloudflare Stream did not return a clip UID.");
  }

  return {
    ...result,
    uid,
  };
}

export async function getCloudflareStreamVideo(uid: string) {
  return cloudflareStreamFetch<CloudflareStreamVideo>(`/stream/${encodeURIComponent(uid)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function deleteCloudflareStreamVideo(uid: string) {
  const config = getCloudflareStreamConfig();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream/${encodeURIComponent(uid)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok && response.status !== 404) {
    const payload = (await response.json().catch(() => null)) as CloudflareEnvelope<Record<string, never>> | null;
    const message =
      payload?.errors?.map((item) => item.message).filter(Boolean).join(", ") ||
      `Cloudflare Stream delete failed with status ${response.status}.`;
    throw new Error(message);
  }
}

export function mapCloudflareStreamStatus(video: CloudflareStreamVideo): "processing" | "ready" | "failed" {
  const state =
    typeof video.status === "string"
      ? video.status.toLowerCase()
      : (video.status?.state ?? "").toLowerCase();
  if (state === "error" || state === "failed") return "failed";
  if (video.readyToStream === true && (state === "ready" || state === "")) return "ready";
  if (state === "ready") return "ready";
  return "processing";
}

export function getCloudflareStreamError(video: CloudflareStreamVideo) {
  if (typeof video.status === "string") return null;
  return video.status?.errorReasonText || video.status?.errReasonText || null;
}

export function verifyCloudflareStreamWebhookSignature(params: {
  body: string;
  header: string | null;
  toleranceSec?: number;
}) {
  const { webhookSecret } = getCloudflareStreamConfig();
  if (!webhookSecret) return true;
  if (!params.header) return false;

  const parts = new Map(
    params.header
      .split(",")
      .map((part) => part.trim().split("="))
      .filter((entry): entry is [string, string] => entry.length === 2 && Boolean(entry[0]) && Boolean(entry[1]))
  );

  const time = parts.get("time") ?? "";
  const sig1 = parts.get("sig1") ?? "";
  if (!time || !sig1) return false;

  const timestamp = Number(time);
  const toleranceSec = params.toleranceSec ?? 300;
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSec) {
    return false;
  }

  const source = `${time}.${params.body}`;
  const expected = createHmac("sha256", webhookSecret).update(source).digest("hex");
  const actual = Buffer.from(sig1, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (actual.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actual, expectedBuffer);
}
