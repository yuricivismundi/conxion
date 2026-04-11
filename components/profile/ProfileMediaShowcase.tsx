"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { deriveProfileMediaShowcase } from "@/lib/profile-media/read-model";
import type { ProfileMediaItem } from "@/lib/profile-media/types";
import { cx } from "@/lib/cx";

type ProfileMediaShowcaseProps = {
  media: ProfileMediaItem[];
  isOwner: boolean;
  onManage?: () => void;
  /**
   * Max showcase photos allowed by plan.
   *   0   = starter (no photos, hero 2-video layout)
   *   N   = pro (up to N photos, full carousel)
   *   null = unlimited
   */
  ownerPhotoLimit?: number | null;
};

function mediaAspectClass(item: ProfileMediaItem) {
  const w = item.width ?? 0;
  const h = item.height ?? 0;
  return h >= w ? "aspect-[9/14]" : "aspect-[14/9]";
}

function formatDuration(value: number | null) {
  if (!value || value <= 0) return null;
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function StatusTile({ item, onManage }: { item: ProfileMediaItem; onManage?: () => void }) {
  const failed = item.status === "failed";
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-3 overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(165deg,rgba(8,13,19,0.96),rgba(7,18,24,0.88))] p-4 text-center">
      {!failed && (
        <div className="pointer-events-none absolute inset-0 opacity-40"
          style={{ background: "radial-gradient(circle at 50% 60%, rgba(13,204,242,0.18), transparent 70%)" }} />
      )}
      {failed ? (
        <span className="material-symbols-outlined text-[28px] text-rose-400">error</span>
      ) : (
        <div className="relative flex items-center justify-center">
          <span className="absolute h-12 w-12 rounded-full border border-[#0df2f2]/20 animate-ping" style={{ animationDuration: "2s" }} />
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#0df2f2]/30 bg-[#0df2f2]/10">
            <span className="material-symbols-outlined text-[18px] text-[#0df2f2] animate-spin" style={{ animationDuration: "3s" }}>
              progress_activity
            </span>
          </div>
        </div>
      )}
      <p className="text-[10px] font-semibold text-white/50">{failed ? "Upload failed" : "Processing…"}</p>
      {onManage && (
        <Link href="/me/edit?tab=media"
          className="mt-1 inline-flex items-center justify-center rounded-lg border border-white/12 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold text-white/70 hover:text-white transition-colors">
          {failed ? "Fix" : "Manage"}
        </Link>
      )}
    </div>
  );
}

// ─── Starter: hero 2-video layout ────────────────────────────────────────────

function StarterVideoCard({
  item,
  onPlay,
  onExpand,
  isPlaying,
  single,
}: {
  item: ProfileMediaItem;
  onPlay: () => void;
  onExpand: () => void;
  isPlaying: boolean;
  single: boolean;
}) {
  const poster = item.thumbnailUrl;
  const duration = formatDuration(item.durationSec);

  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-[24px] border border-white/10 bg-[#060d13]",
        "shadow-[0_20px_50px_rgba(0,0,0,0.4)]",
        single ? "w-full" : "flex-1 min-w-0"
      )}
      style={{ height: 280 }}
    >
      {/* Cyan ambient glow at bottom */}
      {!isPlaying && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-24 opacity-30 rounded-b-[24px]"
          style={{ background: "radial-gradient(ellipse at 50% 120%, rgba(13,204,242,0.35), transparent 70%)" }} />
      )}

      {isPlaying && item.streamUid ? (
        <iframe
          key={item.id}
          src={`https://iframe.cloudflarestream.com/${encodeURIComponent(item.streamUid)}?autoplay=true&controls=true&defaultTextTrack=none`}
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
          allowFullScreen
          className="h-full w-full"
          title="Video"
        />
      ) : (
        <>
          {poster
            ? <img src={poster} alt="" className="h-full w-full object-cover" loading="lazy" />
            : (
              <div className="flex h-full items-center justify-center"
                style={{ background: "linear-gradient(160deg, #0d1820, #060d13)" }}>
                <span className="material-symbols-outlined text-[40px] text-slate-600">movie</span>
              </div>
            )
          }
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

          {/* Centered play button */}
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              onClick={onPlay}
              aria-label="Play video"
              className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white shadow-[0_0_30px_rgba(13,204,242,0.25)] backdrop-blur-sm hover:bg-black/70 hover:border-cyan-300/40 hover:shadow-[0_0_40px_rgba(13,204,242,0.4)] transition-all duration-200"
            >
              <span className="material-symbols-outlined text-[26px]">play_arrow</span>
            </button>
          </div>
        </>
      )}

      {/* Expand button — always top right */}
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand"
        className="absolute right-2.5 top-2.5 z-[2] inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white/70 hover:bg-black/75 hover:text-white transition-colors"
      >
        <span className="material-symbols-outlined text-[14px]">open_in_full</span>
      </button>

      {/* Duration badge */}
      {duration && !isPlaying && (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white/90">
          {duration}
        </div>
      )}
    </div>
  );
}

function StarterLayout({
  videos,
  statusItems,
  onExpand,
  inlineVideoId,
  setInlineVideoId,
  isOwner,
  onManage,
}: {
  videos: ProfileMediaItem[];
  statusItems: ProfileMediaItem[];
  onExpand: (item: ProfileMediaItem) => void;
  inlineVideoId: string | null;
  setInlineVideoId: (id: string | null) => void;
  isOwner: boolean;
  onManage?: () => void;
}) {
  const displayVideos = videos.slice(0, 2);
  const single = displayVideos.length === 1 && statusItems.length === 0;

  if (displayVideos.length === 0 && statusItems.length === 0) {
    // No content yet — show upload nudge for owner
    if (!isOwner) return null;
    return (
      <div className="flex items-center justify-center rounded-[24px] border border-dashed border-white/15 bg-white/[0.02] py-10 text-center">
        <div className="space-y-2">
          <span className="material-symbols-outlined text-[32px] text-slate-500">video_library</span>
          <p className="text-sm font-semibold text-slate-400">No videos yet</p>
          {onManage && (
            <button type="button" onClick={onManage}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-semibold text-cyan-50 hover:bg-cyan-300/16 transition-colors">
              <span className="material-symbols-outlined text-[14px]">add</span>
              Add video
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      {displayVideos.map((video) => (
        <StarterVideoCard
          key={video.id}
          item={video}
          onPlay={() => setInlineVideoId(video.id)}
          onExpand={() => { setInlineVideoId(null); onExpand(video); }}
          isPlaying={inlineVideoId === video.id}
          single={single}
        />
      ))}
      {statusItems.map((item) => (
        <div key={item.id}
          className={cx("overflow-hidden rounded-[24px] border border-white/10 bg-[#060d13]", single && displayVideos.length === 0 ? "w-full" : "flex-1 min-w-0")}
          style={{ height: 280 }}>
          <StatusTile item={item} onManage={onManage} />
        </div>
      ))}
    </div>
  );
}

// ─── Pro: full carousel ───────────────────────────────────────────────────────

const PHOTO_W = 148;
const VIDEO_W = 180;
const CARD_H = 224;

function ProCarousel({
  cards,
  lockedPhotos,
  onExpand,
  inlineVideoId,
  setInlineVideoId,
  onManage,
}: {
  cards: ProfileMediaItem[];
  lockedPhotos: ProfileMediaItem[];
  onExpand: (item: ProfileMediaItem) => void;
  inlineVideoId: string | null;
  setInlineVideoId: (id: string | null) => void;
  onManage?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  function scrollBy(dir: -1 | 1) {
    scrollRef.current?.scrollBy({ left: dir * (VIDEO_W + 10) * 2, behavior: "smooth" });
  }

  return (
    <div className="relative group/carousel">
      <button type="button" onClick={() => scrollBy(-1)} aria-label="Scroll left"
        className="absolute left-0 top-1/2 z-[2] -translate-y-1/2 -translate-x-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-[#0b1520]/90 text-white/70 shadow-lg hover:text-white transition-colors opacity-0 group-hover/carousel:opacity-100 focus:opacity-100">
        <span className="material-symbols-outlined text-[18px]">chevron_left</span>
      </button>
      <button type="button" onClick={() => scrollBy(1)} aria-label="Scroll right"
        className="absolute right-0 top-1/2 z-[2] -translate-y-1/2 translate-x-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-[#0b1520]/90 text-white/70 shadow-lg hover:text-white transition-colors opacity-0 group-hover/carousel:opacity-100 focus:opacity-100">
        <span className="material-symbols-outlined text-[18px]">chevron_right</span>
      </button>

      <div ref={scrollRef}
        className="flex gap-[10px] overflow-x-auto scroll-smooth snap-x snap-mandatory pb-1"
        style={{ scrollbarWidth: "none" }}>
        {cards.map((item) => {
          const isLocked = lockedPhotos.includes(item);
          const isStatus = item.status !== "ready";
          const isInline = item.kind === "video" && inlineVideoId === item.id;
          const poster = item.kind === "photo" ? item.publicUrl : item.thumbnailUrl;
          const duration = formatDuration(item.durationSec);
          const cw = isStatus ? PHOTO_W : item.kind === "video" ? VIDEO_W : PHOTO_W;

          return (
            <div key={item.id}
              className="snap-start shrink-0 overflow-hidden rounded-[22px] border border-white/10 bg-[#081118] shadow-[0_10px_28px_rgba(0,0,0,0.28)]"
              style={{ width: `${cw}px`, height: `${CARD_H}px` }}>
              {isStatus ? (
                <StatusTile item={item} onManage={onManage} />
              ) : isLocked ? (
                <div className="relative h-full w-full">
                  {poster && <img src={poster} alt="" className="h-full w-full object-cover blur-[3px] brightness-[0.35]" loading="lazy" />}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-[22px] text-white/50">lock</span>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Not visible</p>
                    {onManage && (
                      <Link href="/me/edit?tab=media"
                        className="mt-0.5 inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[9px] font-semibold text-white/50 hover:text-white/80 transition-colors">
                        Upgrade
                      </Link>
                    )}
                  </div>
                </div>
              ) : item.kind === "video" ? (
                <div className="relative h-full w-full">
                  {isInline && item.streamUid ? (
                    <iframe key={item.id}
                      src={`https://iframe.cloudflarestream.com/${encodeURIComponent(item.streamUid)}?autoplay=true&controls=true&defaultTextTrack=none`}
                      allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                      allowFullScreen className="h-full w-full" title="Video" />
                  ) : (
                    <>
                      {poster
                        ? <img src={poster} alt="" className="h-full w-full object-cover" loading="lazy" />
                        : <div className="flex h-full items-center justify-center text-slate-500"><span className="material-symbols-outlined text-[28px]">movie</span></div>
                      }
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    </>
                  )}
                  {!isInline && (
                    <button type="button" onClick={() => setInlineVideoId(item.id)} aria-label="Play video"
                      className="absolute left-2 top-2 z-[2] inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors">
                      <span className="material-symbols-outlined text-[17px]">play_arrow</span>
                    </button>
                  )}
                  <button type="button" onClick={() => { setInlineVideoId(null); onExpand(item); }} aria-label="Expand"
                    className="absolute right-2 top-2 z-[2] inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 hover:bg-black/80 hover:text-white transition-colors">
                    <span className="material-symbols-outlined text-[13px]">open_in_full</span>
                  </button>
                  {duration && !isInline && (
                    <div className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white/90">{duration}</div>
                  )}
                </div>
              ) : (
                <button type="button" onClick={() => onExpand(item)}
                  className="group relative h-full w-full overflow-hidden" aria-label="Open photo">
                  {poster
                    ? <img src={poster} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.05]" loading="lazy" />
                    : <div className="flex h-full items-center justify-center text-slate-500"><span className="material-symbols-outlined text-[28px]">image</span></div>
                  }
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProfileMediaShowcase({ media, isOwner, onManage, ownerPhotoLimit }: ProfileMediaShowcaseProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [inlineVideoId, setInlineVideoId] = useState<string | null>(null);
  const [desktopViewer, setDesktopViewer] = useState(false);
  const lightboxRef = useRef<HTMLDivElement | null>(null);

  const showcase = useMemo(() => deriveProfileMediaShowcase(media), [media]);

  const isStarterLayout = ownerPhotoLimit === 0;

  // Split ready items: visible vs locked photos
  const { visibleReady, lockedPhotos } = useMemo(() => {
    if (ownerPhotoLimit == null) return { visibleReady: showcase.readyMedia, lockedPhotos: [] as ProfileMediaItem[] };
    let photoCount = 0;
    const visible: ProfileMediaItem[] = [];
    const locked: ProfileMediaItem[] = [];
    for (const item of showcase.readyMedia) {
      if (item.kind !== "photo") { visible.push(item); continue; }
      photoCount++;
      if (photoCount <= ownerPhotoLimit) visible.push(item);
      else locked.push(item);
    }
    return { visibleReady: visible, lockedPhotos: locked };
  }, [ownerPhotoLimit, showcase.readyMedia]);

  const ownerStatusItems = useMemo(
    () => (isOwner ? [...showcase.processingMedia, ...showcase.failedMedia] : []),
    [isOwner, showcase.failedMedia, showcase.processingMedia]
  );

  // Pro carousel cards: visible + locked (owner only) + status
  const proCards = useMemo(() => [
    ...visibleReady,
    ...(isOwner ? lockedPhotos : []),
    ...ownerStatusItems,
  ], [visibleReady, isOwner, lockedPhotos, ownerStatusItems]);

  // Lightbox navigates only visible ready items
  const lightboxItems = visibleReady;

  // Nothing to show
  const hasContent = isStarterLayout
    ? visibleReady.filter(m => m.kind === "video").length > 0 || ownerStatusItems.length > 0 || (isOwner && visibleReady.length === 0)
    : proCards.length > 0;

  useEffect(() => {
    if (lightboxIndex !== null) {
      window.setTimeout(() => lightboxRef.current?.focus(), 50);
    }
  }, [lightboxIndex]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktopViewer(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener?.("change", sync);
    return () => mediaQuery.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowRight" && lightboxItems.length > 1)
        setLightboxIndex((i) => ((i ?? 0) + 1) % lightboxItems.length);
      if (e.key === "ArrowLeft" && lightboxItems.length > 1)
        setLightboxIndex((i) => (((i ?? 0) - 1) + lightboxItems.length) % lightboxItems.length);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, lightboxItems.length]);

  if (!hasContent && !isOwner) return null;
  if (!isStarterLayout && proCards.length === 0) return null;

  const lightboxItem = lightboxIndex !== null ? (lightboxItems[lightboxIndex] ?? null) : null;

  function openLightbox(item: ProfileMediaItem) {
    const index = lightboxItems.findIndex((m) => m.id === item.id);
    if (index >= 0) {
      setInlineVideoId(null);
      setLightboxIndex(index);
    }
  }

  return (
    <>
      <section className="border-t border-white/10 pt-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">Media</h3>
          {isOwner && onManage ? (
            <button type="button" onClick={onManage}
              className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-50 hover:bg-cyan-300/16">
              Edit
            </button>
          ) : null}
        </div>

        {isStarterLayout ? (
          <StarterLayout
            videos={visibleReady.filter(m => m.kind === "video")}
            statusItems={ownerStatusItems}
            onExpand={openLightbox}
            inlineVideoId={inlineVideoId}
            setInlineVideoId={setInlineVideoId}
            isOwner={isOwner}
            onManage={onManage}
          />
        ) : (
          <ProCarousel
            cards={proCards}
            lockedPhotos={lockedPhotos}
            onExpand={openLightbox}
            inlineVideoId={inlineVideoId}
            setInlineVideoId={setInlineVideoId}
            onManage={onManage}
          />
        )}
      </section>

      {/* Lightbox */}
      {lightboxItem ? (
        <div
          ref={lightboxRef}
          tabIndex={-1}
          role="dialog"
          aria-modal={desktopViewer ? undefined : true}
          aria-label="Media viewer"
          className={cx(
            "fixed inset-0 z-[90] outline-none",
            desktopViewer ? "pointer-events-none bg-transparent" : "bg-black/92"
          )}
          onClick={() => {
            if (!desktopViewer) setLightboxIndex(null);
          }}
        >
          <button type="button" onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
            className={cx(
              "absolute right-4 top-4 z-[3] inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/12 bg-black/45 text-white hover:bg-black/70",
              desktopViewer ? "pointer-events-auto" : ""
            )}
            aria-label="Close">
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>

          {lightboxItems.length > 1 && !desktopViewer && (
            <>
              <button type="button"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (((i ?? 0) - 1) + lightboxItems.length) % lightboxItems.length); }}
                className="absolute left-3 top-1/2 z-[3] inline-flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white/90 hover:bg-black/55"
                aria-label="Previous">
                <span className="material-symbols-outlined text-[24px]">chevron_left</span>
              </button>
              <button type="button"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => ((i ?? 0) + 1) % lightboxItems.length); }}
                className="absolute right-3 top-1/2 z-[3] inline-flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white/90 hover:bg-black/55"
                aria-label="Next">
                <span className="material-symbols-outlined text-[24px]">chevron_right</span>
              </button>
            </>
          )}

          <div
            className={cx(
              "flex h-full w-full p-4 pt-16 pb-14",
              desktopViewer ? "items-start justify-end px-4 pt-24 pb-4 sm:px-6 lg:px-8" : "items-center justify-center"
            )}
            onClick={() => {
              if (!desktopViewer) setLightboxIndex(null);
            }}
          >
            {(() => {
              const isPortrait = (lightboxItem.height ?? 0) >= (lightboxItem.width ?? 1);
              const maxW = desktopViewer
                ? (isPortrait ? "min(34vw, 520px)" : "min(46vw, 760px)")
                : (isPortrait ? "min(90vw, 480px)" : "min(92vw, 1100px)");
              return (
                <div
                  className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#04090f] shadow-[0_30px_90px_rgba(0,0,0,0.45)] pointer-events-auto"
                  style={{ maxWidth: maxW, maxHeight: desktopViewer ? "calc(100vh - 7rem)" : "82vh", width: "100%" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {lightboxItems.length > 1 && desktopViewer ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setLightboxIndex((i) => (((i ?? 0) - 1) + lightboxItems.length) % lightboxItems.length)}
                        className="absolute left-3 top-1/2 z-[3] inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white/90 hover:bg-black/70"
                        aria-label="Previous"
                      >
                        <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setLightboxIndex((i) => ((i ?? 0) + 1) % lightboxItems.length)}
                        className="absolute right-3 top-1/2 z-[3] inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white/90 hover:bg-black/70"
                        aria-label="Next"
                      >
                        <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                      </button>
                    </>
                  ) : null}

                  {lightboxItem.kind === "video" ? (
                    lightboxItem.streamUid ? (
                      <iframe
                        key={lightboxItem.id}
                        src={`https://iframe.cloudflarestream.com/${encodeURIComponent(lightboxItem.streamUid)}?autoplay=true&controls=true&defaultTextTrack=none`}
                        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                        allowFullScreen
                        className={cx("block w-full bg-black", mediaAspectClass(lightboxItem))}
                        style={{ maxHeight: desktopViewer ? "calc(100vh - 7rem)" : "82vh" }}
                        title="Video"
                      />
                    ) : (
                      <video key={lightboxItem.id} src={lightboxItem.playbackUrl ?? undefined}
                        controls autoPlay playsInline preload="metadata"
                        poster={lightboxItem.thumbnailUrl ?? undefined}
                        className={cx("block w-full bg-black object-contain", mediaAspectClass(lightboxItem))}
                        style={{ maxHeight: desktopViewer ? "calc(100vh - 7rem)" : "82vh" }} />
                    )
                  ) : (
                    <img key={lightboxItem.id} src={lightboxItem.publicUrl ?? ""} alt=""
                      className="block w-full bg-black object-contain" style={{ maxHeight: desktopViewer ? "calc(100vh - 7rem)" : "82vh" }} />
                  )}
                </div>
              );
            })()}
          </div>

          {lightboxItems.length > 1 && lightboxIndex !== null && (
            <div className={cx(
              "absolute z-[3] rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold tracking-[0.16em] text-white/85",
              desktopViewer ? "bottom-5 right-8 pointer-events-auto" : "bottom-5 left-1/2 -translate-x-1/2"
            )}
              onClick={(e) => e.stopPropagation()}>
              {lightboxIndex + 1} / {lightboxItems.length}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
