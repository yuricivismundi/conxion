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
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-[28px] border border-white/10 bg-[#0c0e10] shadow-[0_0_0_1px_rgba(242,13,177,0.12),0_32px_80px_rgba(0,0,0,0.7),0_0_60px_rgba(242,13,177,0.06)]">
        <div className="h-px w-full bg-gradient-to-r from-[#f20db1]/80 via-[#0df2f2]/30 to-[#f20db1]/50" />
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-xl font-bold text-white">{reportFromMessageId ? "Report Message" : "Report Conversation"}</h3>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/50 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
              aria-label="Close report modal"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>

          {reportError ? (
            <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{reportError}</div>
          ) : null}
          {reportFromMessageId ? (
            <div className="rounded-2xl border border-[#0df2f2]/25 bg-[#0df2f2]/10 px-3 py-2 text-xs text-cyan-100">
              Context attached to message <span className="font-semibold">{reportFromMessageId.slice(0, 8)}</span>.
            </div>
          ) : null}

          <div>
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Reason</span>
            <div className="max-h-64 overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-1">
              {reportReasonOptions.map((option) => {
                const selected = reportReason === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setReportReason(option)}
                    className={[
                      "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                      selected
                        ? "bg-[#f20db1]/15 text-white"
                        : "text-slate-300 hover:bg-white/[0.05] hover:text-white",
                    ].join(" ")}
                  >
                    <span>{option}</span>
                    <span className={["material-symbols-outlined text-base transition-colors", selected ? "text-[#f20db1]" : "text-white/30"].join(" ")}>
                      chevron_right
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-xs text-slate-400">
            If someone is in immediate danger, contact local emergency services.
          </div>
          <div className="flex justify-start">
            <Link
              href="/safety-center#reporting-blocking"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0df2f2]/80 transition hover:text-[#0df2f2]"
            >
              <span className="material-symbols-outlined text-[14px]">help</span>
              How reporting works
            </Link>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Details (optional)</span>
            <textarea
              value={reportNote}
              onChange={(event) => setReportNote(event.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-[#f20db1]/30 focus:outline-none resize-none"
              placeholder="Add context for moderators..."
            />
          </label>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={reportBusy}
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-400 transition hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={reportBusy}
              onClick={onSubmit}
              className="rounded-2xl bg-[linear-gradient(135deg,#f20db1,#db2777)] px-6 py-2.5 text-sm font-bold text-white shadow-[0_4px_20px_rgba(242,13,177,0.35)] transition hover:shadow-[0_4px_24px_rgba(242,13,177,0.5)] hover:brightness-110 disabled:opacity-60"
            >
              {reportBusy ? "Sending…" : "Submit Report"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
