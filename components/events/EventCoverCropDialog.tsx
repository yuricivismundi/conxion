"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  EVENT_COVER_ASPECT_RATIO,
  getEventCoverRenderLayout,
  prepareEventCoverFile,
} from "@/lib/events/cover-upload";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

type EventCoverCropDialogProps = {
  file: File | null;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (preparedFile: File) => Promise<void> | void;
};

type DragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Could not prepare this cover image.";
}

export default function EventCoverCropDialog({
  file,
  busy = false,
  onClose,
  onConfirm,
}: EventCoverCropDialogProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  useBodyScrollLock(Boolean(file));

  useEffect(() => {
    dragStateRef.current = null;
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setLocalError(null);
    setNaturalSize(null);

    if (!file) {
      setSourceUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setSourceUrl(objectUrl);

    let cancelled = false;
    const image = new window.Image();
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) return;
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        setLocalError("Could not read this image size.");
        return;
      }
      setNaturalSize({ width, height });
    };
    image.onerror = () => {
      if (cancelled) return;
      setLocalError("Could not read this image.");
    };
    image.src = objectUrl;

    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  useEffect(() => {
    if (!file) return;
    const node = frameRef.current;
    if (!node) return;

    const measure = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      setFrameSize({ width, height });
    };

    measure();

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [file]);

  useEffect(() => {
    if (!file) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !processing && !busy) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, file, onClose, processing]);

  const preview = useMemo(() => {
    if (!naturalSize || !frameSize.width || !frameSize.height) return null;

    return getEventCoverRenderLayout({
      sourceWidth: naturalSize.width,
      sourceHeight: naturalSize.height,
      frameWidth: frameSize.width,
      frameHeight: frameSize.height,
      crop: { zoom, panX, panY },
    });
  }, [frameSize.height, frameSize.width, naturalSize, panX, panY, zoom]);

  if (!file) return null;

  const confirming = busy || processing;

  const stopDragging = () => {
    dragStateRef.current = null;
  };

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!preview || confirming) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: panX,
      startPanY: panY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    const dragState = dragStateRef.current;
    if (!dragState || !preview || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();

    const nextOffsetX = clamp(
      dragState.startPanX * preview.maxOffsetX + (event.clientX - dragState.startClientX),
      -preview.maxOffsetX,
      preview.maxOffsetX
    );
    const nextOffsetY = clamp(
      dragState.startPanY * preview.maxOffsetY + (event.clientY - dragState.startClientY),
      -preview.maxOffsetY,
      preview.maxOffsetY
    );

    setPanX(preview.maxOffsetX > 0 ? nextOffsetX / preview.maxOffsetX : 0);
    setPanY(preview.maxOffsetY > 0 ? nextOffsetY / preview.maxOffsetY : 0);
  };

  const handleClose = () => {
    if (confirming) return;
    onClose();
  };

  const handleConfirm = async () => {
    if (!file) return;

    setProcessing(true);
    setLocalError(null);
    try {
      const preparedFile = await prepareEventCoverFile(file, { zoom, panX, panY });
      await onConfirm(preparedFile);
      onClose();
    } catch (error) {
      setLocalError(normalizeError(error));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/82 px-4 py-2 backdrop-blur-sm sm:items-center sm:px-6 sm:py-4" onClick={handleClose}>
      <div
        className="flex max-h-[calc(100dvh-0.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/12 bg-[#091217] shadow-[0_28px_90px_rgba(0,0,0,0.58)] sm:max-h-[min(94dvh,980px)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
          <div>
            <h3 className="text-lg font-bold text-white sm:text-xl">Adjust event cover</h3>
            <p className="mt-1 text-sm text-slate-300">Drag to reposition, zoom in, then save the 1.91:1 event cover.</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={confirming}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.03] text-slate-200 hover:bg-white/[0.08] disabled:opacity-50"
            aria-label="Close cover editor"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain">
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <div className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,24,29,0.98),rgba(7,11,15,0.98))] p-4 sm:p-5">
              <div
                ref={frameRef}
                className="relative mx-auto w-full max-w-[900px] overflow-hidden rounded-[22px] border border-white/12 bg-black touch-none"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={stopDragging}
                onPointerCancel={stopDragging}
                onLostPointerCapture={stopDragging}
                style={{ aspectRatio: EVENT_COVER_ASPECT_RATIO }}
              >
                {sourceUrl && preview ? (
                  <img
                    src={sourceUrl}
                    alt="Event cover crop preview"
                    className="absolute left-1/2 top-1/2 max-w-none select-none"
                    style={{
                      width: `${preview.renderWidth}px`,
                      height: `${preview.renderHeight}px`,
                      transform: `translate(calc(-50% + ${preview.offsetX}px), calc(-50% + ${preview.offsetY}px))`,
                      cursor: confirming ? "progress" : "grab",
                    }}
                    draggable={false}
                  />
                ) : (
                  <div className="absolute inset-0 animate-pulse bg-white/[0.03]" />
                )}

                <div className="pointer-events-none absolute inset-0 border border-white/18" />
                <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/14" />
                <div className="pointer-events-none absolute inset-x-0 bottom-1/3 border-t border-white/14" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">1.91:1 event cover</span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">Recommended 1920 × 1005</span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">Keep key text centered for mobile</span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">Drag image to reposition</span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">Zoom keeps the exact saved crop</span>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <div className="space-y-5">
              <div>
                <label className="text-sm font-semibold text-white">Zoom</label>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.01}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  className="brand-range mt-3 w-full"
                  disabled={confirming}
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-white">Horizontal position</label>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={Math.round(panX * 100)}
                  onChange={(event) => setPanX(Number(event.target.value) / 100)}
                  className="brand-range mt-3 w-full"
                  disabled={confirming || !preview || preview.maxOffsetX === 0}
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-white">Vertical position</label>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={Math.round(panY * 100)}
                  onChange={(event) => setPanY(Number(event.target.value) / 100)}
                  className="brand-range mt-3 w-full"
                  disabled={confirming || !preview || preview.maxOffsetY === 0}
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPanX(0);
                  setPanY(0);
                }}
                disabled={confirming}
                className="inline-flex items-center justify-center rounded-xl border border-white/12 bg-white/[0.02] px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/[0.08] disabled:opacity-50"
              >
                Reset crop
              </button>

              {localError ? (
                <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{localError}</div>
              ) : null}

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={confirming}
                  className="rounded-xl border border-white/12 bg-black/25 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-black/40 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleConfirm();
                  }}
                  disabled={confirming || !naturalSize}
                  className="rounded-xl bg-gradient-to-r from-cyan-300 to-fuchsia-500 px-5 py-2.5 text-sm font-bold text-[#071018] hover:brightness-110 disabled:opacity-60"
                >
                  {confirming ? "Saving..." : "Save cover"}
                </button>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
