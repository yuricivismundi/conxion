"use client";

import { useState, useRef } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TeacherManualReference = {
  id: string;
  client_name: string;
  client_context: string | null;
  testimonial: string;
  rating: number | null;
  reference_year: number | null;
  kind: "manual";
};

export type TeacherVerifiedReference = {
  id: string;
  author_display_name: string | null;
  author_avatar_url: string | null;
  body: string;
  rating: number | null;
  created_at: string;
  reply_text: string | null;
  kind: "verified";
};

export type AnyTeacherReference = TeacherManualReference | TeacherVerifiedReference;

type Props = {
  references: AnyTeacherReference[];
  isOwner?: boolean;
  teacherUserId?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Stars({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className={`material-symbols-outlined text-[14px] ${i < rating ? "text-[#0df2f2]" : "text-zinc-700"}`}
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          star
        </span>
      ))}
    </div>
  );
}

function formatYear(iso: string) {
  return new Date(iso).getFullYear();
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function VerifiedReferenceCard({
  ref,
  isOwner,
  teacherUserId,
}: {
  ref: TeacherVerifiedReference;
  isOwner?: boolean;
  teacherUserId?: string;
}) {
  const [replyDraft, setReplyDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [localReply, setLocalReply] = useState<string | null>(ref.reply_text);
  const [error, setError] = useState<string | null>(null);
  const [showReplyBox, setShowReplyBox] = useState(false);

  async function handleReply() {
    if (!replyDraft.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { supabase } = await import("@/lib/supabase/client");
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Not authenticated.");
      const res = await fetch("/api/references", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode: "reply", referenceId: ref.id, replyText: replyDraft.trim() }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Could not save reply.");
      setLocalReply(replyDraft.trim());
      setReplyDraft("");
      setShowReplyBox(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[#0df2f2]/15 bg-white/[0.03] p-5 flex flex-col gap-3 flex-1">
      <div className="flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[14px] text-[#0df2f2]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#0df2f2]/70">Verified via ConXion booking</span>
      </div>

      {ref.rating && <Stars rating={ref.rating} />}

      <p className="text-sm text-zinc-300 leading-relaxed">&ldquo;{ref.body}&rdquo;</p>

      {/* Author row */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/[0.04]">
        <div className="flex items-center gap-2">
          {ref.author_avatar_url ? (
            <img src={ref.author_avatar_url} alt="" className="h-6 w-6 rounded-full object-cover border border-white/10" />
          ) : (
            <div className="h-6 w-6 rounded-full bg-zinc-800 flex items-center justify-center">
              <span className="material-symbols-outlined text-[12px] text-zinc-500">person</span>
            </div>
          )}
          <p className="text-xs font-semibold text-white">{ref.author_display_name ?? "Student"}</p>
        </div>
        <span className="text-[11px] text-zinc-600">{formatYear(ref.created_at)}</span>
      </div>

      {/* Teacher reply */}
      {localReply && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 mt-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 mb-1">Teacher reply</p>
          <p className="text-sm text-zinc-300 italic leading-relaxed">{localReply}</p>
        </div>
      )}

      {/* Reply CTA for owner */}
      {isOwner && !localReply && !showReplyBox && (
        <button
          type="button"
          onClick={() => setShowReplyBox(true)}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 transition text-left underline underline-offset-2 mt-1"
        >
          Reply to this review
        </button>
      )}

      {isOwner && !localReply && showReplyBox && (
        <div className="mt-1 flex flex-col gap-2">
          <textarea
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            placeholder="Write a reply to this student's review…"
            rows={3}
            maxLength={300}
            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#0df2f2]/40 focus:ring-1 focus:ring-[#0df2f2]/20"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleReply()}
              disabled={saving || !replyDraft.trim()}
              className="rounded-full px-4 py-1.5 text-xs font-bold text-[#0A0A0A] disabled:opacity-50 transition"
              style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#ff00ff)" }}
            >
              {saving ? "Saving…" : "Post reply"}
            </button>
            <button
              type="button"
              onClick={() => { setShowReplyBox(false); setReplyDraft(""); }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

function ManualReferenceCard({ ref }: { ref: TeacherManualReference }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 flex flex-col gap-3 flex-1">
      <div className="flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[13px] text-zinc-500">person</span>
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500">Added by teacher</span>
      </div>

      {ref.rating && <Stars rating={ref.rating} />}

      <p className="text-sm text-zinc-300 leading-relaxed">&ldquo;{ref.testimonial}&rdquo;</p>

      <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/[0.04]">
        <div>
          <p className="text-xs font-semibold text-white">{ref.client_name}</p>
          {ref.client_context && (
            <p className="text-[11px] text-zinc-500 mt-0.5">{ref.client_context}</p>
          )}
        </div>
        {ref.reference_year && (
          <span className="text-[11px] text-zinc-600">{ref.reference_year}</span>
        )}
      </div>
    </div>
  );
}

// ── Carousel ──────────────────────────────────────────────────────────────────

function ReferenceCarousel({ children, count }: { children: React.ReactNode[]; count: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  function scroll(dir: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "right" ? 320 : -320, behavior: "smooth" });
  }

  if (count === 0) return null;

  return (
    <div className="relative group">
      {/* Left arrow */}
      <button
        type="button"
        onClick={() => scroll("left")}
        aria-label="Scroll left"
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 z-10 h-8 w-8 rounded-full bg-zinc-900 border border-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-lg hover:border-white/20"
      >
        <span className="material-symbols-outlined text-[16px] text-white">chevron_left</span>
      </button>

      {/* Scrollable row */}
      <div
        ref={scrollRef}
        className="flex items-stretch gap-4 overflow-x-auto scroll-smooth pb-2"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {children}
      </div>

      {/* Right arrow */}
      <button
        type="button"
        onClick={() => scroll("right")}
        aria-label="Scroll right"
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 z-10 h-8 w-8 rounded-full bg-zinc-900 border border-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-lg hover:border-white/20"
      >
        <span className="material-symbols-outlined text-[16px] text-white">chevron_right</span>
      </button>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

export default function TeacherReferencesSection({ references, isOwner, teacherUserId }: Props) {
  const verified = references.filter((r): r is TeacherVerifiedReference => r.kind === "verified");
  const manual = references.filter((r): r is TeacherManualReference => r.kind === "manual");
  const total = references.length;

  if (total === 0 && !isOwner) return null;

  return (
    <section className="mb-12 sm:mb-20">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white tracking-tight">What students say</h2>
        {total > 0 && (
          <span className="text-xs text-zinc-500 font-medium">
            {total} reference{total !== 1 ? "s" : ""}
            {verified.length > 0 && ` · ${verified.length} verified`}
          </span>
        )}
      </div>

      {total === 0 && isOwner && (
        <div className="rounded-2xl border border-dashed border-zinc-800 px-6 py-10 text-center">
          <p className="text-zinc-500 text-sm">No references yet.</p>
          <p className="text-zinc-600 text-xs mt-1">Verified reviews appear automatically after completed bookings. You can also add manual references from previous students.</p>
          <a
            href="/me/edit/teacher-profile?tab=references"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-zinc-500 hover:text-white transition"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
            Add manual reference
          </a>
        </div>
      )}

      {total > 0 && (
        <div className="flex flex-col gap-6">
          {verified.length > 0 && (
            <div>
              <ReferenceCarousel count={verified.length}>
                {verified.map((ref) => (
                  <div key={ref.id} className="flex-none w-[320px] flex flex-col">
                    <VerifiedReferenceCard ref={ref} isOwner={isOwner} teacherUserId={teacherUserId} />
                  </div>
                ))}
              </ReferenceCarousel>
            </div>
          )}

          {manual.length > 0 && (
            <div>
              <ReferenceCarousel count={manual.length}>
                {manual.map((ref) => (
                  <div key={ref.id} className="flex-none w-[320px] flex flex-col">
                    <ManualReferenceCard ref={ref} />
                  </div>
                ))}
              </ReferenceCarousel>
            </div>
          )}

          {isOwner && (
            <div className="text-center">
              <a href="/me/edit/teacher-profile?tab=references" className="text-xs text-zinc-500 hover:text-zinc-300 transition underline underline-offset-2">
                Manage manual references
              </a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
