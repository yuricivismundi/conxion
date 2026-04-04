"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getTeacherInfoAttachment, getTeacherInfoTemplateText, type TeacherInfoBlock } from "@/lib/teacher-info/types";

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
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 px-3 py-4 backdrop-blur sm:items-center">
      <div className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/12 bg-[#071017] shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-xl font-bold text-white">Share teaching info</h2>
            <p className="mt-1 text-sm text-slate-300">Choose the templates to share for this {inquiryLabel.toLowerCase()} request.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
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
                      "flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
                      selected
                        ? "border-cyan-300/35 bg-cyan-300/14"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px]",
                        selected
                          ? "border-cyan-300/40 bg-cyan-300/20 text-cyan-50"
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
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-white placeholder:text-slate-500 outline-none"
            />
          </label>

          {error ? <div className="rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-white/10 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/12 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ selectedBlockIds, introNote: introNote.trim() || null })}
            disabled={busy || selectedBlockIds.length < 1 || blocks.length === 0}
            className="rounded-2xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-5 py-3 text-sm font-semibold text-[#06121a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Sharing..." : "Share information"}
          </button>
        </div>
      </div>
    </div>
  );
}
