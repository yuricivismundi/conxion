"use client";

import { useEffect, useRef, useState } from "react";
import type { TeacherInfoBlock, TeacherInfoBlockKind } from "@/lib/teacher-info/types";
import { TEACHER_INFO_KIND_LABELS, getTeacherInfoTemplateText } from "@/lib/teacher-info/types";
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

// ─── Shared scrollable row ────────────────────────────────────────────────────

function ScrollRow({ children, autoScroll }: { children: React.ReactNode; autoScroll: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startScrollRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || !autoScroll) return;
    let raf: number;
    const speed = 0.6;
    function step() {
      if (!pausedRef.current && !draggingRef.current && el) {
        el.scrollLeft += speed;
        if (el.scrollLeft >= el.scrollWidth / 2) el.scrollLeft -= el.scrollWidth / 2;
      }
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [autoScroll]);

  function onPointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startScrollRef.current = ref.current?.scrollLeft ?? 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current || !ref.current) return;
    ref.current.scrollLeft = startScrollRef.current - (e.clientX - startXRef.current);
  }
  function onPointerUp() { draggingRef.current = false; }

  return (
    <div
      ref={ref}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="flex gap-5 overflow-x-hidden pb-2 cursor-grab active:cursor-grabbing select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ scrollBehavior: "auto" }}
    >
      {children}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TeacherExperiencesSection({ infoBlocks, videos, bio, languages }: Props) {
  const showAboutTab = !!(bio || (languages && languages.length > 0));
  const showVideosTab = videos.length > 0;
  const [tab, setTab] = useState<Tab>("about");
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

  // Duplicate blocks for infinite loop
  const loopedBlocks = infoBlocks.length > 0 ? [...infoBlocks, ...infoBlocks] : [];

  return (
    <>
      {/* ── About · Videos (tabbed) ─────────────────────────────────────────── */}
      {showAboutTab && (
        <section className="mb-24">
          {/* Tab header: About + languages left, Videos right */}
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-4 flex-wrap">
              <button
                type="button"
                onClick={() => setTab("about")}
                className={`min-h-[44px] font-black text-4xl tracking-tighter leading-none transition-colors ${
                  tab === "about" ? "text-white" : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                About
              </button>
              {languages && languages.length > 0 && (
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

          {/* About content */}
          {tab === "about" && bio && (
            <div className="max-w-3xl">
              <p className="text-zinc-400 text-lg leading-relaxed whitespace-pre-line">{bio}</p>
            </div>
          )}

          {/* Videos content */}
          {tab === "videos" && showVideosTab && (
            <div className="flex flex-wrap justify-center gap-5">
              {videos.map((video, index) => {
                const duration = formatDuration(video.durationSec);
                const poster = video.thumbnailUrl;
                const isInlinePlaying = inlineVideoId === video.id;
                return (
                  <div
                    key={video.id}
                    className="relative overflow-hidden rounded-2xl border border-white/8 bg-zinc-900/40 w-[300px] h-[400px]"
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
                        className="absolute left-2 top-2 z-[2] inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors">
                        <span className="material-symbols-outlined text-[17px]">play_arrow</span>
                      </button>
                    )}
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
      )}

      {/* ── Services (always shown) ──────────────────────────────────────────── */}
      <section className="mb-24">
        <div className="mb-10">
          <h2 className="font-black text-4xl tracking-tighter leading-none text-white">Services</h2>
        </div>
        {(
          infoBlocks.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(["private_class", "group_class", "workshop"] as TeacherInfoBlockKind[]).map((kind) => (
                <div
                  key={kind}
                  className="bg-zinc-900/20 backdrop-blur-2xl p-8 rounded-2xl border border-white/5 border-dashed flex flex-col items-center justify-center gap-4 min-h-[200px]"
                >
                  <p className="text-zinc-700 text-sm font-bold uppercase tracking-widest">{TEACHER_INFO_KIND_LABELS[kind]}</p>
                </div>
              ))}
            </div>
          ) : (
            <ScrollRow autoScroll>
              {loopedBlocks.map((block, i) => {
                const rawPrice = block.contentJson.priceText ?? null;
                const ctaText = block.contentJson.ctaText;
                const { final: finalPrice, original, saving } = rawPrice ? parsePrice(rawPrice) : { final: "", original: null, saving: null };
                const isPromo = !!original;
                return (
                  <div
                    key={`${block.id}-${i}`}
                    className="bg-zinc-900/40 backdrop-blur-2xl p-7 rounded-2xl border border-white/5 flex-none w-[300px] flex flex-col"
                  >
                    <h3 className="font-bold text-lg mb-2 text-white leading-snug">{block.title}</h3>
                    {block.shortSummary && (
                      <p className="text-zinc-400 text-sm leading-relaxed mb-5 flex-1">
                        {block.shortSummary}
                      </p>
                    )}

                    {/* Price block */}
                    {rawPrice ? (
                      <div className="mt-auto pt-4 border-t border-white/5 space-y-2">
                        {/* Discount badge — above price */}
                        {saving && (
                          <div className="inline-flex items-center gap-1.5 bg-[#ff51fa]/10 border border-[#ff51fa]/25 rounded-full px-3 py-1">
                            <span className="material-symbols-outlined text-[#ff51fa] text-[12px]">sell</span>
                            <span className="text-[#ff51fa] text-[11px] font-bold uppercase tracking-wide">Save {saving}</span>
                          </div>
                        )}
                        {/* Price row */}
                        <div className="flex items-baseline gap-2">
                          <p className="text-[#ff51fa] font-black text-2xl tracking-tighter leading-none">{finalPrice}</p>
                          {isPromo && original && (
                            <p className="text-zinc-500 text-sm line-through">{original}</p>
                          )}
                        </div>
                      </div>
                    ) : ctaText ? (
                      <p className="mt-auto pt-4 border-t border-white/5 text-[#ff51fa] font-black text-lg tracking-tighter">{ctaText}</p>
                    ) : null}
                  </div>
                );
              })}
            </ScrollRow>
          )
        )}

      </section>

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
