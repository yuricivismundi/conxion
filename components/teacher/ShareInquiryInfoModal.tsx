"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getTeacherInfoAttachment, getTeacherInfoTemplateText, type TeacherInfoBlock } from "@/lib/teacher-info/types";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

type ShareInquiryInfoModalProps = {
  open: boolean;
  inquiryLabel: string;
  blocks: TeacherInfoBlock[];
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (payload: { selectedBlockIds: string[]; introNote: string | null }) => void;
};

const INTRO_LIMIT = 220;

export default function ShareInquiryInfoModal({
  open,
  inquiryLabel,
  blocks,
  busy = false,
  error = null,
  onClose,
  onConfirm,
}: ShareInquiryInfoModalProps) {
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [introNote, setIntroNote] = useState("");
  useBodyScrollLock(open);

  /* eslint-disable react-hooks/set-state-in-effect -- reset modal draft state when reopening the sheet. */
  useEffect(() => {
    if (!open) return;
    setIntroNote("");
    setSelectedBlockIds(blocks.filter((block) => block.isActive).slice(0, 1).map((block) => block.id));
  }, [blocks, open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const remaining = useMemo(() => INTRO_LIMIT - introNote.length, [introNote.length]);

  function toggleBlock(blockId: string) {
    setSelectedBlockIds((current) =>
      current.includes(blockId) ? current.filter((item) => item !== blockId) : [...current, blockId]
    );
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 px-3 py-3 backdrop-blur-md sm:items-center">
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/[0.08] shadow-[0_32px_80px_rgba(0,0,0,0.6)] sm:rounded-[32px]"
        style={{
          background:
            "radial-gradient(circle at 15% 0%, rgba(13,204,242,0.08), transparent 45%), radial-gradient(circle at 85% 100%, rgba(217,59,255,0.08), transparent 45%), #080e14",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/40 transition-colors hover:text-white"
          aria-label="Close"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>

        <div className="border-b border-white/[0.07] px-6 pb-5 pt-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-[#0df2f2]/20 via-[#11212f] to-[#d93bff]/18">
              <span className="material-symbols-outlined text-[26px] text-[#0df2f2]">share</span>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Inquiry response</p>
              <h2 className="text-xl font-extrabold tracking-tight text-white">Share information</h2>
              <p className="mt-0.5 text-[11px] text-white/35">
                Choose the templates to share for this {inquiryLabel.toLowerCase()} request.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 px-5 py-5">
          {blocks.length === 0 ? (
            <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-4 text-sm text-amber-100">
              Add at least one active teacher info block first in <Link href="/me/edit/teacher-info" className="font-semibold underline">Teacher info</Link>.
            </div>
          ) : (
            <div className="grid gap-2">
              {blocks.map((block) => {
                const selected = selectedBlockIds.includes(block.id);
                const attachment = getTeacherInfoAttachment(block);
                return (
                  <button
                    key={block.id}
                    type="button"
                    onClick={() => toggleBlock(block.id)}
                    className={[
                      "flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-all duration-150",
                      selected
                        ? "border-[#0df2f2]/40 bg-gradient-to-br from-[#0df2f2]/10 to-[#d93bff]/10 shadow-[0_0_16px_rgba(13,204,242,0.12)]"
                        : "border-white/[0.07] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px]",
                        selected
                          ? "border-[#0df2f2]/40 bg-[#0df2f2]/20 text-cyan-50"
                          : "border-white/15 bg-white/[0.04] text-transparent",
                      ].join(" ")}
                    >
                      ✓
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-white">{block.title}</span>
                      <span className="mt-1 block text-xs text-slate-400">{getTeacherInfoTemplateText(block).slice(0, 120) || "Quick template"}</span>
                      {attachment ? <span className="mt-1 block text-[11px] font-medium text-cyan-100/85">Includes attachment: {attachment.name}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <label className="block">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-white">Intro note</span>
              <span className={`text-xs ${remaining < 0 ? "text-rose-200" : "text-slate-400"}`}>{Math.max(0, remaining)}/{INTRO_LIMIT}</span>
            </div>
            <textarea
              value={introNote}
              onChange={(event) => setIntroNote(event.target.value.slice(0, INTRO_LIMIT))}
              maxLength={INTRO_LIMIT}
              rows={3}
              placeholder="Happy to share the options that fit your request."
              className="mt-2 w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white placeholder:text-white/25 outline-none transition focus:border-[#0df2f2]/30 focus:bg-white/[0.06]"
            />
          </label>

          {error ? <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">{error}</p> : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-white/[0.07] px-5 py-4">
          <button
            type="button"
            onClick={() => onConfirm({ selectedBlockIds, introNote: introNote.trim() || null })}
            disabled={busy || selectedBlockIds.length < 1 || blocks.length === 0}
            className="h-12 w-full rounded-2xl text-sm font-bold tracking-wide text-[#040a0f] transition-all hover:scale-[1.01] hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundImage: "linear-gradient(90deg, #0df2f2 0%, #7c3aff 50%, #ff00ff 100%)" }}
          >
            {busy ? "Sharing..." : "Share information"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-full rounded-2xl border border-white/[0.07] text-sm font-medium text-white/35 transition-colors hover:border-white/15 hover:text-white/60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
