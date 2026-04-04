"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import StripeCheckoutDialog from "@/components/billing/StripeCheckoutDialog";
import UpgradeModal from "@/components/billing/UpgradeModal";
import UsageLimitBanner from "@/components/billing/UsageLimitBanner";
import { useUpgradeModal } from "@/components/billing/useUpgradeModal";
import { getBillingAccountState } from "@/lib/billing/account-state";
import { createBillingCheckoutSession } from "@/lib/billing/checkout-client";
import type { PlanId } from "@/lib/billing/plans";
import {
  PROFILE_MEDIA_ACCEPTED_VIDEO_MIME_TYPES,
  PROFILE_MEDIA_MAX_DIRECT_VIDEO_BYTES,
  PROFILE_MEDIA_MAX_SOURCE_VIDEO_DURATION_SEC,
  PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC,
  countProfileMedia,
} from "@/lib/profile-media/limits";
import { compressProfilePhotoFile } from "@/lib/profile-media/photo-client";
import { fetchProfileMedia } from "@/lib/profile-media/read-model";
import { supabase } from "@/lib/supabase/client";
import type { ProfileMediaItem } from "@/lib/profile-media/types";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { cx } from "@/lib/cx";


function mediaPoster(item: ProfileMediaItem) {
  return item.kind === "photo" ? item.publicUrl : item.thumbnailUrl;
}

function describeStatus(item: ProfileMediaItem) {
  if (item.status === "ready") {
    return item.kind === "video" ? `Ready · ${item.durationSec ?? 0}s` : "Ready";
  }
  if (item.status === "processing") return "Processing";
  return "Failed";
}

function formatDurationClock(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.max(0, Math.floor(value % 60));
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

async function readVideoDuration(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      let settled = false;
      let timeoutId: number | null = null;

      const finish = (value: number, fallbackMessage?: string) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        if (Number.isFinite(value) && value > 0) {
          resolve(value);
          return;
        }
        reject(new Error(fallbackMessage ?? "Could not read video metadata."));
      };

      const resolveIfReady = () => {
        const duration = Number(video.duration);
        if (Number.isFinite(duration) && duration > 0) {
          finish(duration);
          return true;
        }
        return false;
      };

      const probeDuration = () => {
        if (settled || resolveIfReady()) return;
        try {
          video.currentTime = 10 ** 7;
        } catch {
          finish(0, "We couldn't read this video's length. Try an MP4 or MOV export.");
        }
      };

      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = () => {
        if (!resolveIfReady()) probeDuration();
      };
      video.ondurationchange = () => {
        resolveIfReady();
      };
      video.onloadeddata = () => {
        resolveIfReady();
      };
      video.ontimeupdate = () => {
        finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : video.currentTime);
      };
      video.onerror = () => finish(0, "Could not read video metadata.");
      video.src = objectUrl;
      video.load();
      timeoutId = window.setTimeout(() => {
        finish(0, "We couldn't read this video's length. Try an MP4 or MOV export.");
      }, 8000);
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function isAcceptedVideoFile(file: File) {
  const normalizedType = file.type.toLowerCase();
  if (PROFILE_MEDIA_ACCEPTED_VIDEO_MIME_TYPES.includes(normalizedType as (typeof PROFILE_MEDIA_ACCEPTED_VIDEO_MIME_TYPES)[number])) {
    return true;
  }
  if (!normalizedType) {
    return /\.(mp4|mov|m4v)$/i.test(file.name);
  }
  return false;
}

function parseUploadFailure(status: number, responseText: string) {
  try {
    const payload = JSON.parse(responseText) as
      | {
          error?: string;
          message?: string;
          errors?: Array<{ message?: string }>;
        }
      | null;
    const nestedMessage = payload?.errors?.map((item) => item.message).find(Boolean);
    if (payload?.error) return payload.error;
    if (payload?.message) return payload.message;
    if (nestedMessage) return nestedMessage;
  } catch {
    // fall through to plain text
  }

  const trimmed = responseText.trim();
  if (trimmed) return trimmed.slice(0, 220);
  return `Cloudflare Stream upload failed with status ${status}.`;
}

async function uploadCloudflareStreamFile(uploadUrl: string, file: File) {
  const runAttempt = (mode: "form-data" | "raw-file") =>
    new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", uploadUrl);
      request.responseType = "text";
      request.timeout = 180_000;

      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          resolve();
          return;
        }
        reject(new Error(parseUploadFailure(request.status, request.responseText || "")));
      };
      request.onerror = () => {
        reject(new Error("Cloudflare Stream upload failed. Check your connection and try again."));
      };
      request.ontimeout = () => {
        reject(new Error("Cloudflare Stream upload timed out. Try again on a stronger connection."));
      };

      if (mode === "form-data") {
        const formData = new FormData();
        formData.append("file", file, file.name || "profile-video");
        request.send(formData);
        return;
      }

      request.send(file);
    });

  try {
    await runAttempt("form-data");
  } catch (firstError) {
    try {
      await runAttempt("raw-file");
    } catch {
      throw firstError;
    }
  }
}

type PendingVideoDraft = {
  file: File;
  objectUrl: string;
  durationSec: number;
  clipStartSec: number;
  clipEndSec: number;
};

function openMediaAsset(url: string, filename?: string) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  if (filename) link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function ProfileMediaManager({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const trimVideoRef = useRef<HTMLVideoElement | null>(null);
  const clipTrackRef = useRef<HTMLDivElement | null>(null);
  const clipPointerDragRef = useRef<{ pointerId: number; grabOffsetSec: number } | null>(null);
  const mediaLoadRequestIdRef = useRef(0);

  const [meId, setMeId] = useState<string | null>(null);
  const [billingPlanId, setBillingPlanId] = useState<PlanId>("starter");
  const [avatarPhotoCount, setAvatarPhotoCount] = useState(0);
  const [media, setMedia] = useState<ProfileMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [videoDraft, setVideoDraft] = useState<PendingVideoDraft | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [checkoutPlanId, setCheckoutPlanId] = useState<"verified" | "pro" | null>(null);
  const { open, reason, openForReason, closeUpgradeModal } = useUpgradeModal("media_limit_reached");
  useBodyScrollLock(Boolean(videoDraft));

  const counts = useMemo(
    () => countProfileMedia(media, billingPlanId, { avatarPhotoCount }),
    [avatarPhotoCount, billingPlanId, media]
  );
  const clipStartMax = videoDraft ? Math.max(videoDraft.durationSec - PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC, 0) : 0;
  const clipDurationSec = videoDraft ? Math.max(videoDraft.clipEndSec - videoDraft.clipStartSec, 0) : 0;
  const clipWindowPercent = videoDraft && videoDraft.durationSec > 0 ? Math.min(100, (clipDurationSec / videoDraft.durationSec) * 100) : 0;
  const clipStartPercent = videoDraft && videoDraft.durationSec > 0 ? (videoDraft.clipStartSec / videoDraft.durationSec) * 100 : 0;
  const needsVideoTrim = Boolean(videoDraft && videoDraft.durationSec > PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC);

  // Auto-dismiss info messages after 3 seconds
  useEffect(() => {
    if (!info) return;
    const timer = window.setTimeout(() => setInfo(null), 3000);
    return () => window.clearTimeout(timer);
  }, [info]);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      try {
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id ?? null;
        if (!userId) {
          router.replace("/auth");
          return;
        }
        const profileRes = await supabase.from("profiles").select("avatar_url").eq("user_id", userId).maybeSingle();
        const hasAvatarPhoto =
          !profileRes.error &&
          typeof (profileRes.data as { avatar_url?: unknown } | null)?.avatar_url === "string" &&
          Boolean(((profileRes.data as { avatar_url?: string | null }).avatar_url ?? "").trim());
        if (!cancelled) {
          setMeId(userId);
          setAvatarPhotoCount(hasAvatarPhoto ? 1 : 0);
          setBillingPlanId(
            getBillingAccountState({
              userMetadata: data.user?.user_metadata,
              isVerified: false,
            }).currentPlanId
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load media settings.");
          setLoading(false);
        }
      }
    }

    void loadUser();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!meId) return;
    const ownerId = meId;
    let cancelled = false;

    async function loadMedia() {
      const requestId = mediaLoadRequestIdRef.current + 1;
      mediaLoadRequestIdRef.current = requestId;
      const isStale = () => mediaLoadRequestIdRef.current !== requestId;

      setLoading(true);
      try {
        const nextMedia = await fetchProfileMedia(supabase, {
          userId: ownerId,
          viewerUserId: ownerId,
          includeAllOwn: true,
        });
        if (!cancelled && !isStale()) {
          setMedia(nextMedia);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled && !isStale()) {
          setError(loadError instanceof Error ? loadError.message : "Could not load showcase media.");
        }
      } finally {
        if (!cancelled && !isStale()) setLoading(false);
      }
    }

    void loadMedia();
    return () => {
      cancelled = true;
    };
  }, [meId, refreshSeq]);

  useEffect(() => {
    if (!media.some((item) => item.status === "processing")) return;
    const timer = window.setTimeout(() => {
      setRefreshSeq((value) => value + 1);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [media]);

  useEffect(() => {
    const objectUrl = videoDraft?.objectUrl;
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [videoDraft?.objectUrl]);

  useEffect(() => {
    if (!activeMenuId) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const menuRoot = target.closest("[data-media-menu-root]");
      if (menuRoot instanceof HTMLElement && menuRoot.dataset.mediaMenuRoot === activeMenuId) {
        return;
      }
      setActiveMenuId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [activeMenuId]);

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    if (!token) throw new Error("Please sign in again.");
    return token;
  }

  async function authorizedFetch(url: string, init?: RequestInit) {
    const token = await getAccessToken();
    const headers = new Headers(init?.headers ?? {});
    headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(url, {
      ...init,
      headers,
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; [key: string]: unknown } | null;

    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error ?? "Request failed.");
    }

    return payload ?? { ok: true };
  }

  async function refreshNow(message?: string) {
    setRefreshSeq((value) => value + 1);
    setActiveMenuId(null);
    if (message) {
      setInfo(message);
      setError(null);
    }
  }

  async function handlePhotoPicked(file: File | null) {
    if (!file) return;
    setError(null);
    setInfo(null);

    try {
      if (!counts.canAddPhoto) {
        throw new Error("You already reached the photo limit for your current plan.");
      }

      setUploadingPhoto(true);
      const compressed = await compressProfilePhotoFile(file);
      const formData = new FormData();
      formData.append("file", new File([compressed.blob], "profile-photo.jpg", { type: compressed.contentType }));
      formData.append("width", String(compressed.width));
      formData.append("height", String(compressed.height));

      await authorizedFetch("/api/profile-media/photo", {
        method: "POST",
        body: formData,
      });

      await refreshNow("Photo uploaded.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload photo.");
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function uploadVideoFile(
    file: File,
    options?: { clipWindow?: { startSec: number; endSec: number }; needsTrim?: boolean }
  ) {
    let pendingMediaId = "";
    let streamUid = "";
    let cleanupPendingRecord = false;
    const clipWindow = options?.clipWindow;
    const needsTrim = options?.needsTrim === true;

    try {
      setUploadingVideo(true);
      const uploadPrep = await authorizedFetch("/api/profile-media/video/upload-url", {
        method: "POST",
      });
      pendingMediaId = typeof uploadPrep.mediaId === "string" ? uploadPrep.mediaId : "";
      streamUid = typeof uploadPrep.streamUid === "string" ? uploadPrep.streamUid : "";
      const uploadUrl = typeof uploadPrep.uploadUrl === "string" ? uploadPrep.uploadUrl : "";

      if (!pendingMediaId || !streamUid || !uploadUrl) {
        throw new Error("The server did not return a valid upload target.");
      }
      cleanupPendingRecord = true;

      await refreshNow(
        needsTrim
          ? `Uploading source video. Only ${PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC} seconds will be kept.`
          : "Uploading video to Cloudflare Stream..."
      );

      await uploadCloudflareStreamFile(uploadUrl, file);

      cleanupPendingRecord = false;
      const finalized = await authorizedFetch("/api/profile-media/video/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mediaId: pendingMediaId,
          streamUid,
          clipStartSec: clipWindow?.startSec,
          clipEndSec: clipWindow?.endSec,
        }),
      });

      const status = typeof finalized.status === "string" ? finalized.status : "";
      await refreshNow(
        needsTrim
          ? "Video uploaded. Your 15-second clip is processing now."
          : status === "ready"
            ? "Video uploaded and ready."
            : "Video uploaded. Stream is processing now."
      );

      return true;
    } catch (uploadError) {
      if (pendingMediaId && cleanupPendingRecord) {
        await authorizedFetch(`/api/profile-media/${pendingMediaId}`, { method: "DELETE" }).catch(() => undefined);
      }
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload video.");
      setRefreshSeq((value) => value + 1);
      return false;
    } finally {
      setUploadingVideo(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  async function handleVideoPicked(file: File | null) {
    if (!file) return;
    setError(null);
    setInfo(null);

    try {
      if (!counts.canAddVideo) {
        throw new Error("You already reached the video limit for your current plan.");
      }
      if (!isAcceptedVideoFile(file)) {
        throw new Error("Videos must be MP4 or QuickTime.");
      }
      if (file.size > PROFILE_MEDIA_MAX_DIRECT_VIDEO_BYTES) {
        throw new Error("Videos must stay under 200MB for direct upload.");
      }

      const duration = await readVideoDuration(file);
      if (duration > PROFILE_MEDIA_MAX_SOURCE_VIDEO_DURATION_SEC) {
        throw new Error(`Source videos must stay under ${Math.floor(PROFILE_MEDIA_MAX_SOURCE_VIDEO_DURATION_SEC / 60)} minutes.`);
      }

      setVideoDraft({
        file,
        objectUrl: URL.createObjectURL(file),
        durationSec: duration,
        clipStartSec: 0,
        clipEndSec: Math.min(duration, PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC),
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload video.");
    }
  }

  function closeVideoDraft() {
    setVideoDraft(null);
    if (videoInputRef.current) videoInputRef.current.value = "";
  }

  function previewVideoDraft() {
    if (!videoDraft || !trimVideoRef.current) return;
    trimVideoRef.current.currentTime = videoDraft.clipStartSec;
    void trimVideoRef.current.play();
  }

  function setVideoDraftStart(nextStart: number) {
    setVideoDraft((current) =>
      current
        ? (() => {
            const windowDuration = Math.max(
              Math.min(current.durationSec, PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC),
              current.clipEndSec - current.clipStartSec
            );
            const maxStart = Math.max(current.durationSec - windowDuration, 0);
            const safeStart = clamp(nextStart, 0, maxStart);
            return {
              ...current,
              clipStartSec: safeStart,
              clipEndSec: Math.min(current.durationSec, safeStart + windowDuration),
            };
          })()
        : current
    );

    if (trimVideoRef.current) {
      trimVideoRef.current.currentTime = Math.max(0, nextStart);
    }
  }

  function clipTimeFromPointer(clientX: number) {
    if (!videoDraft || !clipTrackRef.current) return null;
    const rect = clipTrackRef.current.getBoundingClientRect();
    if (!rect.width) return null;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return ratio * videoDraft.durationSec;
  }

  function startClipDrag(pointerId: number, clientX: number) {
    if (!videoDraft || clipStartMax <= 0) return;
    const pointerTime = clipTimeFromPointer(clientX);
    if (pointerTime === null) return;
    const selectionDuration = Math.max(videoDraft.clipEndSec - videoDraft.clipStartSec, 0);
    const selectionStart = videoDraft.clipStartSec;
    const selectionEnd = videoDraft.clipEndSec;
    const isInsideSelection = pointerTime >= selectionStart && pointerTime <= selectionEnd;
    const grabOffsetSec = isInsideSelection ? pointerTime - selectionStart : selectionDuration / 2;

    clipPointerDragRef.current = { pointerId, grabOffsetSec };
    setVideoDraftStart(pointerTime - grabOffsetSec);
  }

  function updateClipDrag(pointerId: number, clientX: number) {
    const drag = clipPointerDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const pointerTime = clipTimeFromPointer(clientX);
    if (pointerTime === null) return;
    setVideoDraftStart(pointerTime - drag.grabOffsetSec);
  }

  function finishClipDrag(pointerId: number) {
    if (clipPointerDragRef.current?.pointerId === pointerId) {
      clipPointerDragRef.current = null;
    }
  }

  function handleClipTrackPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!videoDraft || clipStartMax <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startClipDrag(event.pointerId, event.clientX);
  }

  function handleClipTrackPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!clipPointerDragRef.current) return;
    event.preventDefault();
    updateClipDrag(event.pointerId, event.clientX);
  }

  function handleClipTrackPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishClipDrag(event.pointerId);
  }

  async function confirmVideoDraft() {
    if (!videoDraft) return;
    const uploaded = await uploadVideoFile(videoDraft.file, {
      clipWindow:
        videoDraft.durationSec > PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC
          ? {
              startSec: videoDraft.clipStartSec,
              endSec: videoDraft.clipEndSec,
            }
          : undefined,
      needsTrim: videoDraft.durationSec > PROFILE_MEDIA_MAX_VIDEO_DURATION_SEC,
    });

    if (uploaded) {
      closeVideoDraft();
    }
  }

  async function setMainMedia(mediaId: string) {
    setBusyId(`primary:${mediaId}`);
    setError(null);
    try {
      await authorizedFetch("/api/profile-media/primary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mediaId }),
      });
      await refreshNow("Main media updated.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update the main media.");
    } finally {
      setBusyId(null);
    }
  }

  async function saveOrder(orderedIds: string[], mediaId: string) {
    setBusyId(`order:${mediaId}`);
    setError(null);
    try {
      await authorizedFetch("/api/profile-media/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderedIds }),
      });
      await refreshNow("Media order updated.");
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Could not reorder media.");
    } finally {
      setBusyId(null);
    }
  }

  async function moveItem(mediaId: string, direction: -1 | 1) {
    const currentIndex = media.findIndex((item) => item.id === mediaId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= media.length) return;

    const orderedIds = media.map((item) => item.id);
    [orderedIds[currentIndex], orderedIds[nextIndex]] = [orderedIds[nextIndex], orderedIds[currentIndex]];
    await saveOrder(orderedIds, mediaId);
  }

  async function moveItemToIndex(mediaId: string, targetIndex: number) {
    const currentIndex = media.findIndex((item) => item.id === mediaId);
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= media.length || targetIndex === currentIndex) return;

    const orderedIds = media.map((item) => item.id);
    const [moved] = orderedIds.splice(currentIndex, 1);
    orderedIds.splice(targetIndex, 0, moved);
    await saveOrder(orderedIds, mediaId);
  }

  async function makeProfilePicture(item: ProfileMediaItem) {
    if (!meId || item.kind !== "photo" || !item.publicUrl) return;

    setBusyId(`avatar:${item.id}`);
    setError(null);
    try {
      const updateRes = await supabase
        .from("profiles")
        .update({
          avatar_url: item.publicUrl,
          avatar_path: null,
          avatar_status: "pending",
        })
        .eq("user_id", meId);

      if (updateRes.error) throw updateRes.error;
      setAvatarPhotoCount(1);
      setInfo("Profile picture updated.");
      setActiveMenuId(null);
    } catch (avatarError) {
      setError(avatarError instanceof Error ? avatarError.message : "Could not update the profile picture.");
    } finally {
      setBusyId(null);
    }
  }

  function openOrDownload(item: ProfileMediaItem) {
    const url = item.kind === "photo" ? item.publicUrl : item.playbackUrl ?? item.thumbnailUrl;
    if (!url) return;
    const filename = item.kind === "photo" ? `profile-media-${item.id}.jpg` : undefined;
    openMediaAsset(url, filename);
    setActiveMenuId(null);
  }

  async function retryStatus(item: ProfileMediaItem) {
    const retryStreamUid = item.sourceStreamUid ?? item.streamUid;
    if (!retryStreamUid) return;
    setBusyId(`retry:${item.id}`);
    setError(null);
    try {
      const result = await authorizedFetch("/api/profile-media/video/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mediaId: item.id,
          streamUid: retryStreamUid,
        }),
      });

      const status = typeof result.status === "string" ? result.status : "";
      await refreshNow(status === "ready" ? "Video is ready." : "Processing status refreshed.");
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Could not refresh video status.");
      setRefreshSeq((value) => value + 1);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteItem(item: ProfileMediaItem) {
    const confirmed = window.confirm(`Delete this ${item.kind} from your showcase?`);
    if (!confirmed) return;

    setBusyId(`delete:${item.id}`);
    setError(null);
    try {
      await authorizedFetch(`/api/profile-media/${item.id}`, {
        method: "DELETE",
      });
      await refreshNow("Media item removed.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete media.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpgrade(planId: PlanId) {
    if (planId === "starter") return;
    setError(null);
    closeUpgradeModal();
    setCheckoutPlanId(planId);
  }

  const loadUpgradeCheckoutSession = useCallback(() => {
    if (!checkoutPlanId) {
      throw new Error("Choose an upgrade to continue.");
    }
    return createBillingCheckoutSession({
      planId: checkoutPlanId,
      returnTo: "/me/edit/media",
    });
  }, [checkoutPlanId]);

  if (loading) {
    return (
      <div className={embedded ? "min-w-0 space-y-4" : "space-y-6"}>
        <div className={cx("animate-pulse bg-white/6", embedded ? "h-20 rounded-[22px]" : "h-64 rounded-[30px]")} />
        <div className={cx("animate-pulse bg-white/6", embedded ? "h-56 rounded-[24px]" : "h-40 rounded-[30px]")} />
        {!embedded ? <div className="h-72 animate-pulse rounded-[30px] bg-white/6" /> : null}
      </div>
    );
  }

  return (
      <div className={embedded ? "space-y-4" : "space-y-6"}>
        {!embedded ? (
        <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <Link
            href="/me/edit"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.08] sm:w-auto"
          >
            Back to edit profile
          </Link>
        </div>
      ) : null}

      <section
        className={cx(
          "min-w-0 border border-white/10 bg-[linear-gradient(145deg,rgba(8,14,18,0.94),rgba(7,18,24,0.78))] shadow-[0_28px_80px_rgba(0,0,0,0.36)]",
          embedded ? "rounded-[22px] p-4" : "rounded-[26px] p-4 sm:rounded-[30px] sm:p-6"
        )}
      >
        {!embedded ? (
          <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Photos and Videos</h1>
        ) : null}

        {error ? <p className={cx("rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100", embedded ? "" : "mt-4")}>{error}</p> : null}
        {info ? <p className={cx("rounded-2xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100", embedded || error ? "mt-3" : "mt-4")}>{info}</p> : null}

        {embedded ? (
          <div className={cx("grid grid-cols-2 gap-3", error || info ? "mt-3" : "mt-4")}>
            {/* Video slot */}
            <div className="rounded-[20px] border border-white/10 bg-black/25 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-white">Videos</p>
                <span className="text-xs font-semibold text-slate-400">{counts.videos}/{counts.videoLimit ?? "∞"}</span>
              </div>
              <div className="mt-2 h-1 w-full rounded-full bg-white/[0.06]">
                <div
                  className="h-1 rounded-full bg-cyan-400 transition-all"
                  style={{ width: counts.videoLimit ? `${Math.min(100, (counts.videos / counts.videoLimit) * 100)}%` : "0%" }}
                />
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500">
                {billingPlanId === "pro" ? "Plus plan" : "Starter plan"} · MP4 / MOV · max 15s
              </p>
              <div className="mt-3">
                {counts.videoLimit === null || counts.videos < counts.videoLimit ? (
                  <button
                    type="button"
                    onClick={() => videoInputRef.current?.click()}
                    disabled={uploadingVideo}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white hover:bg-white/[0.1] disabled:opacity-60"
                  >
                    {uploadingVideo ? "Uploading…" : "Upload video"}
                  </button>
                ) : billingPlanId !== "pro" ? (
                  <button
                    type="button"
                    onClick={() => openForReason("media_limit_reached")}
                    className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-3 py-2 text-xs font-semibold text-[#06121a] hover:brightness-110"
                  >
                    Upgrade to Plus
                  </button>
                ) : (
                  <span className="block text-center text-xs text-slate-500">Limit reached</span>
                )}
              </div>
            </div>

            {/* Photo slot — showcase photos are Plus-only (3 slots); avatar is separate */}
            {(() => {
              const isPlus = billingPlanId === "pro";
              const showcaseLimit = isPlus ? 3 : 0;
              const showcaseUsed = counts.uploadedPhotos; // media photos only, avatar excluded
              const canUploadShowcase = isPlus && showcaseUsed < showcaseLimit;
              return (
                <div className="rounded-[20px] border border-white/10 bg-black/25 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">Photos</p>
                    <span className="text-xs font-semibold text-slate-400">
                      {isPlus ? `${showcaseUsed}/3` : "Plus only"}
                    </span>
                  </div>
                  <div className="mt-2 h-1 w-full rounded-full bg-white/[0.06]">
                    <div
                      className="h-1 rounded-full bg-fuchsia-400 transition-all"
                      style={{ width: isPlus ? `${Math.min(100, (showcaseUsed / showcaseLimit) * 100)}%` : "0%" }}
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] text-slate-500">
                    {isPlus ? "Plus plan · 3 showcase slots" : "Upgrade for 3 showcase photos"} · JPEG / PNG / WebP
                  </p>
                  <div className="mt-3">
                    {canUploadShowcase ? (
                      <button
                        type="button"
                        onClick={() => photoInputRef.current?.click()}
                        disabled={uploadingPhoto}
                        className="inline-flex w-full items-center justify-center rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white hover:bg-white/[0.1] disabled:opacity-60"
                      >
                        {uploadingPhoto ? "Uploading…" : "Upload photo"}
                      </button>
                    ) : isPlus ? (
                      <span className="block text-center text-xs text-slate-500">Limit reached</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openForReason("media_limit_reached")}
                        className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-3 py-2 text-xs font-semibold text-[#06121a] hover:brightness-110"
                      >
                        Upgrade to Plus
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Hidden inputs */}
            <input
              ref={videoInputRef}
              type="file"
              accept={PROFILE_MEDIA_ACCEPTED_VIDEO_MIME_TYPES.join(",")}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                void handleVideoPicked(file);
              }}
            />
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                void handlePhotoPicked(file);
              }}
            />
          </div>
        ) : (
          <div className={cx(error || info ? "mt-3" : "mt-5", "grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]")}>
            <div className="rounded-[24px] border border-white/10 bg-black/25 p-4">
              <p className="text-sm font-semibold text-white">Upload video</p>
              <p className="mt-1 text-sm leading-5 text-slate-300">MP4 or QuickTime. Every upload opens a mobile-friendly clip editor before it sends.</p>
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                disabled={!counts.canAddVideo || uploadingVideo}
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-[#06121a] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploadingVideo ? "Uploading video..." : counts.canAddVideo ? "Upload video" : "Video limit reached"}
              </button>
              <input
                ref={videoInputRef}
                type="file"
                accept={PROFILE_MEDIA_ACCEPTED_VIDEO_MIME_TYPES.join(",")}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void handleVideoPicked(file);
                }}
              />
            </div>

            <div className="rounded-[24px] border border-white/10 bg-black/25 p-4">
              <p className="text-sm font-semibold text-white">Upload photo</p>
              <p className="mt-1 text-sm leading-5 text-slate-300">
                JPEG, PNG, or WebP. Starter and Verified already count your main profile photo, so extra showcase photos need Plus.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={!counts.canAddPhoto || uploadingPhoto}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {uploadingPhoto ? "Uploading photo..." : counts.canAddPhoto ? "Upload photo" : "Photo limit reached"}
                </button>
                {!counts.canAddPhoto && billingPlanId !== "pro" ? (
                  <button
                    type="button"
                    onClick={() => openForReason("media_limit_reached")}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-[#06121a] hover:brightness-110"
                  >
                    Upgrade to Plus
                  </button>
                ) : null}
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void handlePhotoPicked(file);
                }}
              />
            </div>

            <div className="rounded-[24px] border border-white/10 bg-black/25 p-4 text-sm text-slate-200 md:col-span-2 xl:col-span-1">
              <p className="font-semibold text-white">Current media plan</p>
              <p className="mt-2 text-sm text-slate-200">{billingPlanId === "pro" ? "Plus" : "Starter / Verified"}</p>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                Verified keeps Starter media limits. Your avatar already uses the included photo slot. Plus unlocks extra showcase photos while keeping the same video count.
              </p>
              {checkoutPlanId ? (
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100/80">
                  Opening {checkoutPlanId === "pro" ? "Plus" : "Verified"} checkout…
                </p>
              ) : null}
            </div>
          </div>
        )}

        {!embedded ? (
        <div className="mt-4 grid gap-3">
          <UsageLimitBanner
            label="Showcase videos"
            current={counts.videos}
            limit={counts.videoLimit}
            upgradePlanId={billingPlanId === "pro" ? undefined : "pro"}
            onUpgrade={() => openForReason("media_limit_reached")}
          />
          <UsageLimitBanner
            label="Profile photos"
            current={counts.photos}
            limit={counts.photoLimit}
            upgradePlanId={billingPlanId === "pro" ? undefined : "pro"}
            onUpgrade={() => openForReason("media_limit_reached")}
          />
        </div>
        ) : null}
      </section>

      <section className={cx("min-w-0 border border-white/10 bg-[linear-gradient(145deg,rgba(8,14,18,0.94),rgba(7,18,24,0.78))] shadow-[0_28px_80px_rgba(0,0,0,0.34)]", embedded ? "rounded-[24px] p-4" : "rounded-[26px] p-4 sm:rounded-[30px] sm:p-6")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className={cx("font-bold text-white", embedded ? "text-base" : "mt-2 text-xl")}>{embedded ? "Your media" : "Arrange Order"}</h2>
          {embedded && media.length > 1 ? (
            <span className="text-[11px] text-slate-500">Drag to reorder</span>
          ) : null}
        </div>

        {media.length === 0 ? (
          <div className="mt-5 rounded-[24px] border border-dashed border-white/12 bg-black/20 px-4 py-10 text-center text-sm text-slate-400">
            Upload your first photo or video to start the row.
          </div>
        ) : (
          <div
            className={cx(
              "mt-4",
              embedded
                ? "grid grid-cols-3 gap-2"
                : "-mx-1 flex gap-3 overflow-x-auto overflow-y-visible px-1 pb-3"
            )}
          >
            {media.map((item, index) => {
              const poster = mediaPoster(item);
              const statusBusy = busyId?.endsWith(item.id);
              const menuOpen = activeMenuId === item.id;
              // Photos are locked (showcase is Plus-only) when user is not on Plus plan
              const photoLocked = embedded && item.kind === "photo" && billingPlanId !== "pro";
              const canSetProfilePicture = item.kind === "photo" && item.status === "ready" && Boolean(item.publicUrl) && !photoLocked;
              const canSetMain = item.status === "ready" && !item.isPrimary && !photoLocked;
              return (
                <div
                  key={item.id}
                  data-media-menu-root={item.id}
                  draggable={media.length > 1 && !Boolean(statusBusy) && !photoLocked}
                  onDragStart={(event) => {
                    if (statusBusy) {
                      event.preventDefault();
                      return;
                    }
                    setDraggingId(item.id);
                    setDragOverId(item.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.id);
                  }}
                  onDragOver={(event) => {
                    if (!draggingId || draggingId === item.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverId(item.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceId = event.dataTransfer.getData("text/plain") || draggingId;
                    setDraggingId(null);
                    setDragOverId(null);
                    if (sourceId && sourceId !== item.id) {
                      void moveItemToIndex(sourceId, index);
                    }
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDragOverId(null);
                  }}
                  className={cx(
                    "relative",
                    embedded ? "w-full min-w-0" : "w-[178px] shrink-0 snap-start sm:w-[206px]"
                  )}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveMenuId((current) => (current === item.id ? null : item.id));
                    }}
                    className={cx(
                      "absolute z-[4] inline-flex items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/90 backdrop-blur hover:bg-black/70",
                      embedded ? "right-1.5 top-1.5 h-7 w-7" : "right-3 top-3 h-10 w-10"
                    )}
                    aria-label="Open media options"
                  >
                    <span className={cx("material-symbols-outlined", embedded ? "text-[14px]" : "text-[18px]")}>edit</span>
                  </button>

                  <div
                    className={cx(
                      "overflow-hidden border bg-[linear-gradient(150deg,rgba(255,255,255,0.04),rgba(6,10,16,0.94))] shadow-[0_8px_20px_rgba(0,0,0,0.24)] transition",
                      embedded ? "rounded-[16px]" : "rounded-[24px] shadow-[0_16px_38px_rgba(0,0,0,0.24)]",
                      item.isPrimary ? "border-cyan-300/35" : "border-white/10",
                      dragOverId === item.id && draggingId !== item.id ? "border-cyan-300/45" : "",
                      draggingId === item.id ? "opacity-60" : ""
                    )}
                  >
                    <div className={cx("relative overflow-hidden bg-[#071018]", embedded ? "aspect-square" : "aspect-[4/5]")}>
                      {poster ? <img src={poster} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                      {!poster ? (
                        <div className="flex h-full items-center justify-center text-slate-500">
                          <span className="material-symbols-outlined text-[28px]">{item.kind === "video" ? "movie" : "image"}</span>
                        </div>
                      ) : null}

                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

                      {/* Locked overlay for non-Plus showcase photos */}
                      {photoLocked ? (
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 backdrop-blur-[2px]">
                          <span className="material-symbols-outlined text-[20px] text-white/70">lock</span>
                          <span className="text-[9px] font-semibold uppercase tracking-wider text-white/60">Locked</span>
                        </div>
                      ) : null}

                      {/* Position watermark */}
                      <div className={cx(
                        "pointer-events-none absolute left-1.5 top-1.5 flex items-center justify-center rounded-full bg-black/60 font-bold text-white/90 backdrop-blur-sm",
                        embedded ? "h-5 w-5 text-[10px]" : "h-7 w-7 text-xs"
                      )}>
                        {index + 1}
                      </div>

                      {item.kind === "video" ? (
                        <div className={cx("pointer-events-none absolute inline-flex items-center justify-center rounded-full bg-black/55 text-white", embedded ? "bottom-1.5 left-1.5 h-5 w-5" : "left-3 top-3 h-10 w-10 shadow-[0_10px_24px_rgba(0,0,0,0.3)]")}>
                          <span className={cx("material-symbols-outlined", embedded ? "text-[12px]" : "text-[18px]")}>play_arrow</span>
                        </div>
                      ) : null}

                      {item.isPrimary ? (
                        <div className={cx("absolute left-1.5 rounded-full bg-cyan-300/18 font-semibold text-cyan-50", embedded ? "bottom-1.5 px-1.5 py-0.5 text-[9px]" : "bottom-3 left-3 px-2.5 py-1 text-[11px]")}>
                          Main
                        </div>
                      ) : null}

                      {item.status !== "ready" ? (
                        <div
                          className={cx(
                            "absolute rounded-full font-semibold",
                            embedded ? "bottom-1 right-1 px-1.5 py-0.5 text-[9px]" : "bottom-3 right-3 px-2.5 py-1 text-[11px]",
                            item.status === "failed" ? "bg-rose-500/20 text-rose-100" : "bg-cyan-300/15 text-cyan-100"
                          )}
                        >
                          {embedded ? (item.status === "failed" ? "Failed" : "…") : describeStatus(item)}
                        </div>
                      ) : item.kind === "video" && item.durationSec ? (
                        <div className={cx("absolute right-1.5 rounded-full bg-black/60 font-semibold text-white/95", embedded ? "bottom-1.5 px-1.5 py-0.5 text-[9px]" : "bottom-3 px-2.5 py-1 text-[11px]")}>
                          {item.durationSec}s
                        </div>
                      ) : null}
                    </div>

                    {!embedded ? (
                    <div className="flex items-center justify-between gap-3 border-t border-white/8 px-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{item.kind === "video" ? "Video" : "Photo"}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {item.status === "ready" ? `${index + 1} in order` : describeStatus(item)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void moveItem(item.id, -1)}
                          disabled={index === 0 || Boolean(statusBusy)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/85 hover:bg-white/[0.08] disabled:opacity-40"
                          aria-label="Move left"
                        >
                          <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void moveItem(item.id, 1)}
                          disabled={index === media.length - 1 || Boolean(statusBusy)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/85 hover:bg-white/[0.08] disabled:opacity-40"
                          aria-label="Move right"
                        >
                          <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                        </button>
                      </div>
                    </div>
                    ) : null}
                  </div>

                  {menuOpen ? (
                    <div className="absolute right-2 top-14 z-[5] w-[min(15rem,calc(100vw-2.5rem))] rounded-[22px] border border-white/12 bg-[#10171d]/96 p-2 shadow-[0_18px_44px_rgba(0,0,0,0.4)] backdrop-blur">
                      {photoLocked ? (
                        <div className="space-y-1">
                          <p className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-slate-500">Locked · upgrade to unlock</p>
                          <button
                            type="button"
                            onClick={() => void deleteItem(item)}
                            disabled={Boolean(statusBusy)}
                            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-rose-300 hover:bg-white/[0.06] disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                            Delete photo
                          </button>
                        </div>
                      ) : null}
                      <div className={cx("space-y-1", photoLocked ? "hidden" : "")}>
                        {canSetMain ? (
                          <button
                            type="button"
                            onClick={() => void setMainMedia(item.id)}
                            disabled={Boolean(statusBusy)}
                            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-white/90 hover:bg-white/[0.06] disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[18px]">star</span>
                            Set as main
                          </button>
                        ) : null}

                        {canSetProfilePicture ? (
                          <button
                            type="button"
                            onClick={() => void makeProfilePicture(item)}
                            disabled={Boolean(statusBusy)}
                            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-white/90 hover:bg-white/[0.06] disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[18px]">account_circle</span>
                            Make Profile Picture
                          </button>
                        ) : null}

                        {item.status === "ready" ? (
                          <button
                            type="button"
                            onClick={() => openOrDownload(item)}
                            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-white/90 hover:bg-white/[0.06]"
                          >
                            <span className="material-symbols-outlined text-[18px]">{item.kind === "photo" ? "download" : "open_in_new"}</span>
                            {item.kind === "photo" ? "Download" : "Open"}
                          </button>
                        ) : null}

                        {item.kind === "video" && item.streamUid ? (
                          <button
                            type="button"
                            onClick={() => void retryStatus(item)}
                            disabled={Boolean(statusBusy)}
                            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-white/90 hover:bg-white/[0.06] disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[18px]">refresh</span>
                            {item.status === "ready" ? "Refresh status" : "Retry status"}
                          </button>
                        ) : null}

                        <div className="my-1 h-px bg-white/8" />

                        <button
                          type="button"
                          onClick={() => void moveItem(item.id, -1)}
                          disabled={index === 0 || Boolean(statusBusy)}
                          className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-white/90 hover:bg-white/[0.06] disabled:opacity-40"
                        >
                          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                          Move left
                        </button>

                        <button
                          type="button"
                          onClick={() => void moveItem(item.id, 1)}
                          disabled={index === media.length - 1 || Boolean(statusBusy)}
                          className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-white/90 hover:bg-white/[0.06] disabled:opacity-40"
                        >
                          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                          Move right
                        </button>

                        <button
                          type="button"
                          onClick={() => void deleteItem(item)}
                          disabled={Boolean(statusBusy)}
                          className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-rose-100 hover:bg-rose-500/10 disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex">
        <Link
          href="/me/edit"
          className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.08]"
        >
          Back to edit profile
        </Link>
      </div>

      {videoDraft ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/78 px-3 py-2 backdrop-blur-sm sm:items-center sm:px-6 sm:py-4">
          <div className="flex max-h-[calc(100dvh-0.75rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(155deg,rgba(7,13,18,0.98),rgba(7,17,24,0.94))] shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
              <div>
                <h2 className="text-xl font-bold text-white">{needsVideoTrim ? "Choose 15 seconds" : "Review video"}</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {needsVideoTrim ? "Drag the highlight with your finger to choose the part to keep." : "This video already fits the showcase limit."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeVideoDraft}
                disabled={uploadingVideo}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-white/85 hover:bg-white/[0.08] disabled:opacity-60"
                aria-label="Close clip selector"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="overflow-y-auto overscroll-contain">
              <div className="grid gap-4 px-4 py-4 sm:px-5 sm:py-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,360px)]">
              <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/30">
                <video
                  ref={trimVideoRef}
                  src={videoDraft.objectUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-[42dvh] w-full bg-black object-contain sm:max-h-[62dvh]"
                  onLoadedMetadata={(event) => {
                    event.currentTarget.currentTime = videoDraft.clipStartSec;
                  }}
                  onTimeUpdate={(event) => {
                    if (event.currentTarget.currentTime >= videoDraft.clipEndSec) {
                      event.currentTarget.pause();
                    }
                  }}
                />
              </div>

              <div className="space-y-4">
                <div className="rounded-[24px] border border-white/10 bg-black/25 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-sm font-semibold text-cyan-50">
                      {formatDurationClock(videoDraft.clipStartSec)} to {formatDurationClock(videoDraft.clipEndSec)}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-semibold text-slate-200">
                      {formatDurationClock(videoDraft.clipEndSec - videoDraft.clipStartSec)}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {formatDurationClock(videoDraft.durationSec)}
                    </span>
                  </div>

                  {needsVideoTrim ? (
                    <div className="mt-5">
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                        <span>Clip position</span>
                        <span>{formatDurationClock(videoDraft.clipStartSec)}</span>
                      </div>
                      <div
                        ref={clipTrackRef}
                        className="relative rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-3 py-4 touch-none"
                        onPointerDown={handleClipTrackPointerDown}
                        onPointerMove={handleClipTrackPointerMove}
                        onPointerUp={handleClipTrackPointerUp}
                        onPointerCancel={handleClipTrackPointerUp}
                      >
                        <div className="grid grid-cols-12 gap-1">
                          {Array.from({ length: 12 }).map((_, index) => (
                            <div
                              key={index}
                              className="h-14 rounded-xl bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04))]"
                            />
                          ))}
                        </div>
                        <div className="pointer-events-none absolute inset-x-3 top-4 bottom-4">
                          <div
                            className="absolute bottom-0 top-0 rounded-[18px] border border-cyan-200/80 bg-cyan-300/14 shadow-[0_0_0_9999px_rgba(0,0,0,0.36)]"
                            style={{
                              left: `${clipStartPercent}%`,
                              width: `${clipWindowPercent}%`,
                            }}
                          >
                            <div className="absolute inset-y-2 left-2 w-1.5 rounded-full bg-white/85" />
                            <div className="absolute inset-y-2 right-2 w-1.5 rounded-full bg-white/85" />
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex justify-between text-[11px] text-slate-500">
                        <span>0:00</span>
                        <span>{formatDurationClock(videoDraft.durationSec)}</span>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setVideoDraftStart(videoDraft.clipStartSec - 1)}
                      disabled={!needsVideoTrim}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/15 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.08]"
                    >
                      -1s
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoDraftStart(videoDraft.clipStartSec + 1)}
                      disabled={!needsVideoTrim}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/15 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.08]"
                    >
                      +1s
                    </button>
                    <button
                      type="button"
                      onClick={previewVideoDraft}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/15 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.08]"
                    >
                      Preview
                    </button>
                  </div>
                </div>
              </div>
            </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-white/10 px-4 py-4 sm:flex-row sm:justify-end sm:px-5">
              <button
                type="button"
                onClick={closeVideoDraft}
                disabled={uploadingVideo}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.08] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmVideoDraft()}
                disabled={uploadingVideo}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-[#06121a] hover:brightness-110 disabled:opacity-60"
              >
                {uploadingVideo ? (needsVideoTrim ? "Uploading clip..." : "Uploading video...") : needsVideoTrim ? "Use clip" : "Upload video"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <UpgradeModal
        open={open}
        reason={reason}
        onClose={closeUpgradeModal}
        onUpgrade={(planId) => void handleUpgrade(planId)}
      />

      <StripeCheckoutDialog
        open={Boolean(checkoutPlanId)}
        title={checkoutPlanId === "pro" ? "Upgrade to Plus" : "Get Verified"}
        badgeLabel={checkoutPlanId === "pro" ? "Monthly plan" : "One-time trust upgrade"}
        submitLabel={checkoutPlanId === "pro" ? "Start Plus" : "Confirm Verification"}
        onClose={() => setCheckoutPlanId(null)}
        onError={(message) => setError(message)}
        onAlreadyResolved={() => {
          setInfo(checkoutPlanId === "pro" ? "Plus is already active on this account." : "This account is already verified.");
          setCheckoutPlanId(null);
        }}
        loadSession={loadUpgradeCheckoutSession}
      />
    </div>
  );
}
