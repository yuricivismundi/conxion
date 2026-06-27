"use client";

import { useRef, useState, useEffect } from "react";

type TeacherReference = {
  id: string;
  client_name: string;
  client_context: string | null;
  testimonial: string;
  rating: number | null;
  reference_year: number | null;
  verified: boolean;
};

type Props = {
  references: TeacherReference[];
  isOwner?: boolean;
  teacherUserId?: string;
};

export default function TeacherReferencesSection({ references, isOwner, teacherUserId }: Props) {
  if (references.length === 0 && !isOwner) return null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function updateArrows() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  useEffect(() => {
    updateArrows();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", updateArrows); ro.disconnect(); };
  }, [references]);

  function scroll(dir: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "right" ? 380 : -380, behavior: "smooth" });
  }

  return (
    <section className="mb-12 sm:mb-20">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white tracking-tight">What students say</h2>
        <div className="flex items-center gap-3">
          {references.length > 0 && (
            <span className="text-xs text-zinc-500 font-medium">{references.length} reference{references.length !== 1 ? "s" : ""}</span>
          )}
          {(canScrollLeft || canScrollRight) && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => scroll("left")}
                disabled={!canScrollLeft}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/50 transition hover:border-white/20 hover:text-white disabled:opacity-25 disabled:cursor-default"
              >
                <span className="material-symbols-outlined text-[16px]">chevron_left</span>
              </button>
              <button
                type="button"
                onClick={() => scroll("right")}
                disabled={!canScrollRight}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/50 transition hover:border-white/20 hover:text-white disabled:opacity-25 disabled:cursor-default"
              >
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {references.length === 0 && isOwner && (
        <div className="rounded-2xl border border-dashed border-zinc-800 px-6 py-10 text-center">
          <p className="text-zinc-500 text-sm">No references yet.</p>
          <p className="text-zinc-600 text-xs mt-1">Add testimonials from previous students to build trust.</p>
          <a
            href="/me/edit/teacher-profile?tab=references"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-zinc-500 hover:text-white transition"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
            Add references
          </a>
        </div>
      )}

      {references.length > 0 && (
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scroll-smooth no-scrollbar"
        >
          {references.map((ref) => (
            <div
              key={ref.id}
              className="w-[360px] shrink-0 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 flex flex-col gap-3"
            >
              {ref.rating && (
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span
                      key={i}
                      className={`material-symbols-outlined text-[14px] ${i < ref.rating! ? "text-[#0df2f2]" : "text-zinc-700"}`}
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      star
                    </span>
                  ))}
                </div>
              )}
              <p className="text-sm text-zinc-300 leading-relaxed">&ldquo;{ref.testimonial}&rdquo;</p>
              <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/[0.04]">
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-white">{ref.client_name}</p>
                    {ref.verified ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full border border-[#5DD8D8]/30 bg-[#5DD8D8]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#5DD8D8]">
                        <span className="material-symbols-outlined text-[9px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                        Added by User
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/30">
                        Added by Teacher
                      </span>
                    )}
                  </div>
                  {ref.client_context && (
                    <p className="text-[11px] text-zinc-500 mt-0.5">{ref.client_context}</p>
                  )}
                </div>
                {ref.reference_year && (
                  <span className="text-[11px] text-zinc-600">{ref.reference_year}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {isOwner && references.length > 0 && (
        <div className="mt-4 text-center">
          <a
            href="/me/edit/teacher-profile?tab=references"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition underline underline-offset-2"
          >
            Manage references
          </a>
        </div>
      )}
    </section>
  );
}
