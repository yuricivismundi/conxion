"use client";

import Link from "next/link";

type ReportDialogProps = {
  reportBusy: boolean;
  reportError: string | null;
  reportFromMessageId: string | null;
  reportReason: string;
  reportNote: string;
  reportReasonOptions: string[];
  setReportReason: (value: string) => void;
  setReportNote: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export default function ReportDialog({
  reportBusy,
  reportError,
  reportFromMessageId,
  reportReason,
  reportNote,
  reportReasonOptions,
  setReportReason,
  setReportNote,
  onClose,
  onSubmit,
}: ReportDialogProps) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#121414]">
        <div className="h-px w-full bg-gradient-to-r from-rose-400/60 via-rose-400/10 to-[#0df2f2]/30" />
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-white">{reportFromMessageId ? "Report Message" : "Report Conversation"}</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-white/55 hover:text-white"
              aria-label="Close report modal"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {reportError ? (
            <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{reportError}</div>
          ) : null}
          {reportFromMessageId ? (
            <div className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
              Context attached to message <span className="font-semibold">{reportFromMessageId.slice(0, 8)}</span>.
            </div>
          ) : null}

          <div className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">Reason</span>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-1">
              {reportReasonOptions.map((option) => {
                const selected = reportReason === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setReportReason(option)}
                    className={[
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      selected ? "bg-rose-500/20 text-rose-100" : "text-slate-200 hover:bg-white/5",
                    ].join(" ")}
                  >
                    <span>{option}</span>
                    <span className="material-symbols-outlined text-base text-white/45">chevron_right</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-xs text-slate-300">
            If someone is in immediate danger, contact local emergency services.
          </div>
          <div className="flex justify-start">
            <Link
              href="/safety-center#reporting-blocking"
              className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-100 hover:text-cyan-50"
            >
              <span className="material-symbols-outlined text-[14px]">help</span>
              How reporting works
            </Link>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300">Details (optional)</span>
            <textarea
              value={reportNote}
              onChange={(event) => setReportNote(event.target.value)}
              rows={3}
              className="w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-rose-300/35 focus:outline-none resize-none"
              placeholder="Add context for moderators..."
            />
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={reportBusy}
              onClick={onClose}
              className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/70 hover:text-white disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={reportBusy}
              onClick={onSubmit}
              className="rounded-full bg-rose-500 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-rose-400 disabled:opacity-60"
            >
              {reportBusy ? "Sending..." : "Submit report"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
