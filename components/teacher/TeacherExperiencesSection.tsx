"use client";

import { useEffect, useRef, useState } from "react";
import type { TeacherInfoBlock, TeacherInfoBlockKind } from "@/lib/teacher-info/types";
import { TEACHER_INFO_KIND_LABELS } from "@/lib/teacher-info/types";
import type { ProfileMediaItem } from "@/lib/profile-media/types";

function formatDuration(value: number | null) {
  if (!value || value <= 0) return null;
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Parse "270 EUR (regular 300 EUR — save 30 EUR)" → { final, original, saving }
// Also handles plain "60 EUR / session"
function parsePrice(raw: string): { final: string; original: string | null; saving: string | null } {
  // match "FINAL (regular ORIGINAL — save SAVING)"
  const m = raw.match(/^(.+?)\s*\(regular\s+(.+?)\s*[—–-]\s*save\s+(.+?)\)\s*$/i);
  if (m) return { final: m[1].trim(), original: m[2].trim(), saving: m[3].trim() };
  // match "FINAL (PARENTHETICAL)"  — generic
  const m2 = raw.match(/^(.+?)\s*\((.+?)\)\s*$/);
  if (m2) return { final: m2[1].trim(), original: null, saving: m2[2].trim() };
  return { final: raw, original: null, saving: null };
}

type Tab = "about" | "videos";

type Props = {
  infoBlocks: TeacherInfoBlock[];
  videos: ProfileMediaItem[];
  bio?: string | null;
  languages?: string[];
};

// ─── Services marquee ─────────────────────────────────────────────────────────

function ServiceCard({ block }: { block: TeacherInfoBlock }) {
  const rawPrice = block.contentJson.priceText ?? null;
  const ctaText = block.contentJson.ctaText;
  const { final: finalPrice, original, saving } = rawPrice ? parsePrice(rawPrice) : { final: "", original: null, saving: null };
  const isPromo = !!original;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900/40 p-6 flex flex-col w-[280px] shrink-0 select-none">
      <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: "linear-gradient(90deg,#9333ea,#ff51fa)" }} />
      <h3 className="font-black text-lg mb-2 text-white leading-snug">{block.title}</h3>
      {block.shortSummary && (
        <p className="text-zinc-400 text-sm leading-relaxed flex-1 mb-5">{block.shortSummary}</p>
      )}
      {rawPrice ? (
        <div className="mt-auto pt-4 border-t border-white/[0.06] space-y-1.5">
          {saving && (
            <div className="inline-flex items-center gap-1.5 bg-[#ff51fa]/10 border border-[#ff51fa]/20 rounded-full px-2.5 py-0.5">
              <span className="material-symbols-outlined text-[#ff51fa] text-[11px]">sell</span>
              <span className="text-[#ff51fa] text-[10px] font-bold uppercase tracking-wide">Save {saving}</span>
            </div>
          )}
          <div className="flex items-baseline gap-2">
            <p className="text-[#ff51fa] font-black text-2xl tracking-tighter leading-none">{finalPrice}</p>
            {isPromo && original && <p className="text-zinc-600 text-sm line-through">{original}</p>}
          </div>
        </div>
      ) : ctaText ? (
        <p className="mt-auto pt-4 border-t border-white/[0.06] text-[#ff51fa] font-black text-lg tracking-tighter">{ctaText}</p>
      ) : null}
    </div>
  );
}

function ServicesMarquee({ blocks }: { blocks: TeacherInfoBlock[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  // Repeat enough copies to always fill a wide viewport seamlessly
  const minCopies = Math.max(2, Math.ceil(6 / blocks.length));
  const doubled = Array.from({ length: minCopies }, () => blocks).flat();

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const cardW = 280 + 16; // width + gap
    const half = cardW * blocks.length;

    function step() {
      if (!isDragging.current) {
        offsetRef.current -= 0.5;
        if (offsetRef.current <= -half) offsetRef.current += half;
      }
      if (track) track.style.transform = `translateX(${offsetRef.current}px)`;
      animRef.current = requestAnimationFrame(step);
    }
    animRef.current = requestAnimationFrame(step);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [blocks.length]);

  function onPointerDown(e: React.PointerEvent) {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartOffset.current = offsetRef.current;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStartX.current;
    offsetRef.current = dragStartOffset.current + dx;
  }
  function onPointerUp() { isDragging.current = false; }

  return (
    <section className="mb-12 sm:mb-24 overflow-hidden">
      <div className="mb-6 sm:mb-8">
        <h2 className="font-black text-3xl sm:text-4xl tracking-tighter leading-none text-white">Services</h2>
      </div>
      <div
        className="cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div ref={trackRef} className="flex gap-4 w-max">
          {doubled.map((block, i) => (
            <ServiceCard key={`${block.id}-${i}`} block={block} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TeacherExperiencesSection({ infoBlocks, videos, bio, languages }: Props) {
  const showBioTab = !!(bio || (languages && languages.length > 0));
  const showVideosTab = videos.length > 0;
  const showSection = showBioTab || showVideosTab;
  const defaultTab: Tab = showBioTab ? "about" : "videos";
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [inlineVideoId, setInlineVideoId] = useState<string | null>(null);

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

  const lightboxItem = lightboxIndex !== null ? (videos[lightboxIndex] ?? null) : null;

  return (
    <>
      {/* ── Biography · Videos (tabbed) ─────────────────────────────────────── */}
      {showSection && (
        <section className="mb-12 sm:mb-24">
          {/* Tab header row */}
          <div className="flex items-center justify-between mb-6 sm:mb-8">
            {/* Left: Biography tab */}
            <div className="flex items-center gap-4 flex-wrap">
              {showBioTab && (
                <button
                  type="button"
                  onClick={() => setTab("about")}
                  className={`min-h-[44px] font-black text-2xl sm:text-4xl tracking-tighter leading-none transition-colors ${
                    tab === "about" ? "text-white" : "text-zinc-600 hover:text-zinc-400"
                  }`}
                >
                  Biography
                </button>
              )}
              {languages && languages.length > 0 && tab === "about" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="material-symbols-outlined text-[#ff51fa] text-base">translate</span>
                  {languages.map((l) => (
                    <span key={l} className="px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-300 text-xs font-semibold">
                      {l}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Videos tab */}
            {showVideosTab && (
              <button
                type="button"
                onClick={() => setTab("videos")}
                className={`min-h-[44px] flex items-center gap-2 font-black text-2xl sm:text-4xl tracking-tighter leading-none transition-colors ${
                  tab === "videos" ? "text-white" : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  play_circle
                </span>
                Videos
              </button>
            )}
          </div>

          {/* Active tab indicator bar */}
          <div className="relative mb-8 h-px bg-white/[0.06]">
            <div
              className="absolute top-0 h-px w-24 transition-all duration-300"
              style={{
                background: "linear-gradient(90deg,#0df2f2,#d93bff)",
                left: tab === "about" ? 0 : "auto",
                right: tab === "videos" ? 0 : "auto",
              }}
            />
          </div>

          {/* Biography content */}
          {tab === "about" && (
            <div className="max-w-3xl">
              {bio ? (
                <p className="text-zinc-400 text-lg leading-relaxed whitespace-pre-line">{bio}</p>
              ) : (
                <p className="text-zinc-600 text-sm">No biography added yet.</p>
              )}
            </div>
          )}

          {/* Videos content — 2 per row */}
          {tab === "videos" && showVideosTab && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-[640px] mx-auto">
              {videos.map((video, index) => {
                const duration = formatDuration(video.durationSec);
                const poster = video.thumbnailUrl;
                const isInlinePlaying = inlineVideoId === video.id;
                return (
                  <div
                    key={video.id}
                    className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900/40 aspect-[3/4]"
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
                          <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-600">
                            <span className="material-symbols-outlined text-4xl">movie</span>
                          </div>
                        )}
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                      </>
                    )}
                    {!isInlinePlaying && (
                      <button type="button" onClick={() => setInlineVideoId(video.id)}
                        aria-label="Play video"
                        className="absolute inset-0 z-[2] flex items-center justify-center group">
                        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white transition-all group-hover:scale-110 group-hover:bg-black/70">
                          <span className="material-symbols-outlined text-[26px]" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
                        </span>
                      </button>
                    )}
                    <button type="button" onClick={() => { setInlineVideoId(null); setLightboxIndex(index); }}
                      aria-label="Expand"
                      className="absolute right-2 top-2 z-[3] inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/70 hover:bg-black/80 hover:text-white transition-colors">
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
      )}

      {/* ── Services — infinite auto-scroll marquee ─────────────────────────── */}
      {infoBlocks.length > 0 && <ServicesMarquee blocks={infoBlocks} />}

      {/* ── Lightbox ──────────────────────────────────────────────────────────── */}
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
