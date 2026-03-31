"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { deriveProfileMediaShowcase } from "@/lib/profile-media/read-model";
import type { ProfileMediaItem } from "@/lib/profile-media/types";

type ProfileMediaShowcaseProps = {
  media: ProfileMediaItem[];
  isOwner: boolean;
  onManage?: () => void;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function mediaPoster(item: ProfileMediaItem) {
  return item.kind === "photo" ? item.publicUrl : item.thumbnailUrl;
}

function mediaAspectClass(item: ProfileMediaItem) {
  const width = item.width ?? 0;
  const height = item.height ?? 0;
  return height >= width ? "aspect-[9/14]" : "aspect-[14/9]";
}

function formatDuration(value: number | null) {
  if (!value || value <= 0) return null;
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function tileSpanClass(index: number, total: number) {
  if (total === 1) return "col-span-2 row-span-2 lg:col-span-4 lg:row-span-3";
  if (index === 0) return "col-span-2 row-span-2";
  return "col-span-1 row-span-1";
}

function StatusTile({ item, onManage }: { item: ProfileMediaItem; onManage?: () => void }) {
  const failed = item.status === "failed";

  return (
    <div className="flex h-full flex-col justify-between rounded-[24px] border border-white/10 bg-[linear-gradient(165deg,rgba(255,255,255,0.05),rgba(8,13,19,0.94))] p-4 text-left shadow-[0_18px_40px_rgba(0,0,0,0.24)]">
      <div>
        <div
          className={cx(
            "inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
            failed ? "bg-rose-400/15 text-rose-100" : "bg-cyan-300/15 text-cyan-100"
          )}
        >
          {failed ? "Failed" : "Processing"}
        </div>
        <p className="mt-3 text-sm font-semibold text-white">{failed ? "This media needs attention." : "This media is still processing."}</p>
      </div>

      {onManage ? (
        <button
          type="button"
          onClick={onManage}
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.08]"
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}

export default function ProfileMediaShowcase({ media, isOwner, onManage }: ProfileMediaShowcaseProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const showcase = useMemo(() => deriveProfileMediaShowcase(media), [media]);
  const ownerStatusItems = useMemo(
    () => (isOwner ? [...showcase.processingMedia, ...showcase.failedMedia] : []),
    [isOwner, showcase.failedMedia, showcase.processingMedia]
  );
  const displayItems = useMemo(() => [...showcase.readyMedia, ...ownerStatusItems], [ownerStatusItems, showcase.readyMedia]);
  const readyItems = showcase.readyMedia;

  useEffect(() => {
    if (lightboxIndex === null) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLightboxIndex(null);
      }
      if (event.key === "ArrowRight" && readyItems.length > 1) {
        setLightboxIndex((current) => (current === null ? 0 : (current + 1) % readyItems.length));
      }
      if (event.key === "ArrowLeft" && readyItems.length > 1) {
        setLightboxIndex((current) => (current === null ? 0 : (current - 1 + readyItems.length) % readyItems.length));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, readyItems]);

  if (!displayItems.length) return null;

  const lightboxItem = lightboxIndex === null ? null : readyItems[lightboxIndex] ?? null;

  function openLightbox(itemId: string) {
    const index = readyItems.findIndex((item) => item.id === itemId);
    if (index >= 0) setLightboxIndex(index);
  }

  function moveLightbox(direction: -1 | 1) {
    if (!readyItems.length) return;
    setLightboxIndex((current) => {
      const base = current ?? 0;
      return (base + direction + readyItems.length) % readyItems.length;
    });
  }

  return (
    <>
      <section className="border-t border-white/10 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">Media</h3>
          {isOwner && onManage ? (
            <button
              type="button"
              onClick={onManage}
              className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-50 hover:bg-cyan-300/16"
            >
              Edit
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-2 auto-rows-[136px] gap-3 sm:auto-rows-[168px] lg:grid-cols-4 lg:auto-rows-[178px]">
          {displayItems.map((item, index) => {
            const ready = item.status === "ready";
            const poster = mediaPoster(item);
            const duration = formatDuration(item.durationSec);
            const tileClassName = cx(
              "group relative overflow-hidden rounded-[24px] border border-white/10 bg-[#081118] shadow-[0_16px_34px_rgba(0,0,0,0.24)] transition duration-300 ease-out hover:z-[2] hover:-translate-y-1 hover:scale-[1.02] hover:border-white/20",
              tileSpanClass(index, displayItems.length)
            );

            if (!ready) {
              return (
                <div key={item.id} className={tileClassName}>
                  <StatusTile item={item} onManage={onManage} />
                </div>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openLightbox(item.id)}
                data-testid="profile-media-tile"
                className={tileClassName}
              >
                {poster ? (
                  <img
                    src={poster}
                    alt=""
                    className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-[1.06]"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(160deg,#0d1820,#071116)] text-slate-400">
                    <span className="material-symbols-outlined text-[30px]">{item.kind === "video" ? "movie" : "image"}</span>
                  </div>
                )}

                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />

                {item.kind === "video" ? (
                  <div className="pointer-events-none absolute left-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white shadow-[0_10px_24px_rgba(0,0,0,0.3)]">
                    <span className="material-symbols-outlined text-[19px]">play_arrow</span>
                  </div>
                ) : null}

                {duration ? (
                  <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white/95">
                    {duration}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      {lightboxItem ? (
        <div className="fixed inset-0 z-[90] bg-black/92">
          <button
            type="button"
            onClick={() => setLightboxIndex(null)}
            className="absolute right-4 top-4 z-[3] inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/12 bg-black/45 text-white hover:bg-black/70"
            aria-label="Close media viewer"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>

          {readyItems.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => moveLightbox(-1)}
                className="absolute left-3 top-1/2 z-[3] inline-flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white/90 hover:bg-black/55"
                aria-label="Previous media"
              >
                <span className="material-symbols-outlined text-[24px]">chevron_left</span>
              </button>
              <button
                type="button"
                onClick={() => moveLightbox(1)}
                className="absolute right-3 top-1/2 z-[3] inline-flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white/90 hover:bg-black/55"
                aria-label="Next media"
              >
                <span className="material-symbols-outlined text-[24px]">chevron_right</span>
              </button>
            </>
          ) : null}

          <div className="flex h-full w-full items-center justify-center px-4 py-14">
            <div className="relative flex h-full w-full max-w-[1400px] items-center justify-center" onClick={() => setLightboxIndex(null)}>
              <div
                className="relative max-h-full w-full overflow-hidden rounded-[28px] border border-white/10 bg-[#04090f] shadow-[0_30px_90px_rgba(0,0,0,0.45)]"
                onClick={(event) => event.stopPropagation()}
              >
                {lightboxItem.kind === "video" ? (
                  <video
                    src={lightboxItem.playbackUrl ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    poster={lightboxItem.thumbnailUrl ?? undefined}
                    className={cx("max-h-[82vh] w-full bg-black object-contain", mediaAspectClass(lightboxItem))}
                  />
                ) : (
                  <img
                    src={lightboxItem.publicUrl ?? ""}
                    alt=""
                    className={cx("max-h-[82vh] w-full bg-black object-contain", mediaAspectClass(lightboxItem))}
                  />
                )}
              </div>
            </div>
          </div>

          {readyItems.length > 1 && lightboxIndex !== null ? (
            <div className="absolute bottom-5 left-1/2 z-[3] -translate-x-1/2 rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold tracking-[0.16em] text-white/85">
              {lightboxIndex + 1} / {readyItems.length}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
