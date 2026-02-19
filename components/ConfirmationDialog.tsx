"use client";

import type { ReactNode } from "react";

type ConfirmationDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  summary?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "danger";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  error?: string | null;
};

export default function ConfirmationDialog({
  open,
  title,
  description,
  summary,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  busy = false,
  onCancel,
  onConfirm,
  error,
}: ConfirmationDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-6" data-testid="confirmation-dialog">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#121414] shadow-[0_30px_60px_rgba(0,0,0,0.45)]">
        <div className="h-px w-full bg-gradient-to-r from-[#0df2f2]/60 via-[#0df2f2]/10 to-[#f20db1]/60" />
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-lg font-bold text-white">{title}</p>
              {description ? <p className="mt-1 text-xs text-white/55">{description}</p> : null}
            </div>
            <button
              type="button"
              className="text-white/50 transition hover:text-white"
              onClick={onCancel}
              aria-label="Close"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          {summary ? <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/75">{summary}</div> : null}
          {error ? <div className="mt-3 text-xs text-red-300">{error}</div> : null}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              data-testid="confirmation-cancel"
              className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/65 transition hover:border-white/30 hover:text-white"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              data-testid="confirmation-confirm"
              className={[
                "rounded-full px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition disabled:opacity-60",
                confirmVariant === "danger"
                  ? "bg-gradient-to-r from-[#f97316] to-[#ef4444] shadow-[0_12px_24px_rgba(239,68,68,0.22)]"
                  : "bg-gradient-to-r from-[#0df2f2] to-[#f20db1] shadow-[0_12px_24px_rgba(13,242,242,0.22)]",
              ].join(" ")}
            >
              {busy ? "Working..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
