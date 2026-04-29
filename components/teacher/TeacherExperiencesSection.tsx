"use client";

import { useEffect, useRef, useState } from "react";
import type { TeacherInfoBlock, TeacherInfoBlockKind } from "@/lib/teacher-info/types";
import { TEACHER_INFO_KIND_LABELS, getTeacherInfoTemplateText } from "@/lib/teacher-info/types";
import type { ProfileMediaItem } from "@/lib/profile-media/types";

// ─── Helpers (duplicated from server page to avoid importing server-only) ─────

function kindToIcon(kind: TeacherInfoBlockKind): string {
  switch (kind) {
    case "private_class":    return "person_book";
    case "group_class":      return "groups";
    case "workshop":         return "school";
    case "show":             return "theater_comedy";
    case "organizer_collab": return "edit_note";
    case "other":
    default:                 return "star";
  }
}

function formatDuration(value: number | null) {
  if (!value || value <= 0) return null;
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "experiences" | "videos";

type Props = {
  infoBlocks: TeacherInfoBlock[];
  videos: ProfileMediaItem[];
};

type ExperienceCard = {
  id: string;
  kind: TeacherInfoBlockKind;
  title: string;
  bodyText: string | null;
  priceText: string | null;
  ctaText: string | null;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function TeacherExperiencesSection({ infoBlocks, videos }: Props) {
  const [tab, setTab] = useState<Tab>("experiences");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [inlineVideoId, setInlineVideoId] = useState<string | null>(null);
  const marqueeRef = useRef<HTMLDivElement | null>(null);

  const showVideosTab = videos.length > 0;
  const experienceCards: ExperienceCard[] =
    infoBlocks.length > 0
      ? infoBlocks.map((block) => ({
          id: block.id,
          kind: block.kind,
          title: block.title,
          bodyText: getTeacherInfoTemplateText(block),
          priceText: block.contentJson.priceText ?? null,
          ctaText: block.contentJson.ctaText ?? null,
        }))
      : (["private_class", "group_class", "workshop"] as TeacherInfoBlockKind[]).map((kind) => ({
          id: `placeholder-${kind}`,
          kind,
          title: TEACHER_INFO_KIND_LABELS[kind],
          bodyText: null,
          priceText: null,
          ctaText: null,
        }));
  const marqueeCards = experienceCards.length > 1 ? [...experienceCards, ...experienceCards] : experienceCards;

  // Lightbox keyboard nav
  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowRight") setLightboxIndex((i) => i === null ? 0 : (i + 1) % videos.length);
      if (e.key === "ArrowLeft")  setLightboxIndex((i) => i === null ? 0 : (i - 1 + videos.length) % videos.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, videos.length]);

  useEffect(() => {
    if (tab !== "experiences") return;
    const el = marqueeRef.current;
    if (!el || marqueeCards.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let lastTs = 0;
    let paused = false;

    const onEnter = () => {
      paused = true;
    };
    const onLeave = () => {
      paused = false;
    };

    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);

    const tick = (ts: number) => {
      if (!lastTs) lastTs = ts;
      const delta = ts - lastTs;
      lastTs = ts;
      const half = el.scrollWidth / 2;
      if (!paused && half > 0) {
        el.scrollLeft += delta * 0.035;
        if (el.scrollLeft >= half) el.scrollLeft -= half;
      }
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(raf);
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [marqueeCards.length, tab]);

  const lightboxItem = lightboxIndex !== null ? (videos[lightboxIndex] ?? null) : null;

  return (
    <>
      <section className="mb-24">
        {/* Tab header */}
        <div className="flex items-center justify-between mb-10">
          {/* Experiences tab */}
          <button
            type="button"
            onClick={() => setTab("experiences")}
            className={`min-h-[44px] font-black text-4xl tracking-tighter leading-none transition-colors ${
              tab === "experiences" ? "text-white" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            Experiences
          </button>

          {/* Videos tab — only shown when there are videos */}
          {showVideosTab && (
            <button
              type="button"
              onClick={() => setTab("videos")}
              className={`min-h-[44px] font-black text-4xl tracking-tighter leading-none transition-colors ${
                tab === "videos" ? "text-white" : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              Videos
            </button>
          )}
        </div>

        {/* ── Experiences content ───────────────────────────────────────────── */}
        {tab === "experiences" && (
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-14 bg-gradient-to-r from-[#0e0e0e] to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-14 bg-gradient-to-l from-[#0e0e0e] to-transparent" />
            <div ref={marqueeRef} className="overflow-x-hidden">
              <div className="flex w-max gap-6 py-2">
                {marqueeCards.map((card, index) => (
                  <div
                    key={`${card.id}-${index}`}
                    className="w-[320px] shrink-0 rounded-[28px] border border-white/6 bg-zinc-900/45 p-8 backdrop-blur-2xl"
                  >
                    <span className="material-symbols-outlined mb-6 block text-4xl text-[#c1fffe]">
                      {kindToIcon(card.kind)}
                    </span>
                    <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                      {TEACHER_INFO_KIND_LABELS[card.kind]}
                    </p>
                    <h3 className="mb-3 text-xl font-bold text-white">{card.title}</h3>
                    {card.bodyText && (
                      <p className="mb-6 text-sm leading-relaxed text-zinc-400">
                        {card.bodyText.slice(0, 150)}
                        {card.bodyText.length > 150 ? "…" : ""}
                      </p>
                    )}
                    {card.priceText ? (
                      <p className="text-xl font-black tracking-tighter text-[#ff51fa]">{card.priceText}</p>
                    ) : card.ctaText ? (
                      <p className="text-xl font-black tracking-tighter text-[#ff51fa]">{card.ctaText}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Videos content ────────────────────────────────────────────────── */}
        {tab === "videos" && showVideosTab && (
          <div className="flex flex-wrap justify-center gap-4">
            {videos.map((video, index) => {
              const duration = formatDuration(video.durationSec);
              const poster = video.thumbnailUrl;
              const isInlinePlaying = inlineVideoId === video.id;
              return (
                <div
                  key={video.id}
                  className="relative overflow-hidden rounded-2xl border border-white/8 bg-zinc-900/40"
                  style={{ width: 160, height: 220 }}
                >
                  {isInlinePlaying && video.streamUid ? (
                    <iframe
                      key={video.id}
                      src={`https://iframe.cloudflarestream.com/${encodeURIComponent(video.streamUid)}?autoplay=true&controls=true&defaultTextTrack=none`}
                      allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                      allowFullScreen
                      className="h-full w-full"
                      title="Video"
                    />
                  ) : (
                    <>
                      {poster ? (
                        <img src={poster} alt="" loading="lazy"
                          className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-600">
                          <span className="material-symbols-outlined text-4xl">movie</span>
                        </div>
                      )}
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    </>
                  )}

                  {/* Play inline */}
                  {!isInlinePlaying && (
                    <button type="button" onClick={() => setInlineVideoId(video.id)}
                      aria-label="Play video"
                      className="absolute left-2 top-2 z-[2] inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors">
                      <span className="material-symbols-outlined text-[17px]">play_arrow</span>
                    </button>
                  )}

                  {/* Expand to lightbox */}
                  <button type="button" onClick={() => { setInlineVideoId(null); setLightboxIndex(index); }}
                    aria-label="Expand"
                    className="absolute right-2 top-2 z-[2] inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 hover:bg-black/80 hover:text-white transition-colors">
                    <span className="material-symbols-outlined text-[13px]">open_in_full</span>
                  </button>

                  {duration && !isInlinePlaying && (
                    <div className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white/90">
                      {duration}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Lightbox ──────────────────────────────────────────────────────── */}
      {lightboxItem && (
        <div className="fixed inset-0 z-[90] bg-black/92">
          <button
            type="button"
            onClick={() => setLightboxIndex(null)}
            className="absolute right-4 top-4 z-[3] inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/12 bg-black/45 text-white hover:bg-black/70"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>

          {videos.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setLightboxIndex((i) => i === null ? 0 : (i - 1 + videos.length) % videos.length)}
                className="absolute left-3 top-1/2 z-[3] inline-flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white/90 hover:bg-black/55"
                aria-label="Previous"
              >
                <span className="material-symbols-outlined text-[24px]">chevron_left</span>
              </button>
              <button
                type="button"
                onClick={() => setLightboxIndex((i) => i === null ? 0 : (i + 1) % videos.length)}
                className="absolute right-3 top-1/2 z-[3] inline-flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white/90 hover:bg-black/55"
                aria-label="Next"
              >
                <span className="material-symbols-outlined text-[24px]">chevron_right</span>
              </button>
            </>
          )}

          <div
            className="flex h-full w-full items-center justify-center p-4 pt-16 pb-14"
            onClick={() => setLightboxIndex(null)}
          >
            <div
              className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#04090f] shadow-[0_30px_90px_rgba(0,0,0,0.45)]"
              style={{ maxWidth: "min(90vw, 480px)", maxHeight: "82vh", width: "100%" }}
              onClick={(e) => e.stopPropagation()}
            >
              {lightboxItem.streamUid ? (
                <iframe
                  key={lightboxItem.id}
                  src={`https://iframe.cloudflarestream.com/${encodeURIComponent(lightboxItem.streamUid)}?autoplay=true&controls=true&defaultTextTrack=none`}
                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                  allowFullScreen
                  className="block w-full bg-black aspect-[9/14]"
                  style={{ maxHeight: "82vh" }}
                  title="Video"
                />
              ) : (
                <video
                  key={lightboxItem.id}
                  src={lightboxItem.playbackUrl ?? undefined}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  poster={lightboxItem.thumbnailUrl ?? undefined}
                  className="block w-full bg-black object-contain aspect-[9/14]"
                  style={{ maxHeight: "82vh" }}
                />
              )}
            </div>
          </div>

          {videos.length > 1 && lightboxIndex !== null && (
            <div className="absolute bottom-5 left-1/2 z-[3] -translate-x-1/2 rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold tracking-[0.16em] text-white/85">
              {lightboxIndex + 1} / {videos.length}
            </div>
          )}
        </div>
      )}
    </>
  );
}
