"use client";

type BlockDialogProps = {
  blockBusy: boolean;
  blockReason: string;
  blockNote: string;
  setBlockReason: (value: string) => void;
  setBlockNote: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export default function BlockDialog({
  blockBusy,
  blockReason,
  blockNote,
  setBlockReason,
  setBlockNote,
  onClose,
  onConfirm,
}: BlockDialogProps) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#121414]">
        <div className="h-px w-full bg-gradient-to-r from-rose-500/80 via-rose-400/20 to-[#0df2f2]/30" />
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-white">Block Member</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-white/55 hover:text-white"
              aria-label="Close block modal"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-100">
            They won’t be able to message you in this connection. The thread will be archived.
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300">Reason</span>
            <select
              value={blockReason}
              onChange={(event) => setBlockReason(event.target.value)}
              className="w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white focus:border-rose-300/35 focus:outline-none"
            >
              <option>Safety concern</option>
              <option>Harassment / abuse</option>
              <option>Spam / scams</option>
              <option>Boundary violation</option>
              <option>Other</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300">Note (optional)</span>
            <textarea
              value={blockNote}
              onChange={(event) => setBlockNote(event.target.value)}
              rows={3}
              className="w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-rose-300/35 focus:outline-none resize-none"
              placeholder="Add context for moderation logs..."
            />
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={blockBusy}
              onClick={onClose}
              className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/70 hover:text-white disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={blockBusy}
              onClick={onConfirm}
              className="rounded-full bg-rose-500 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-rose-400 disabled:opacity-60"
            >
              {blockBusy ? "Blocking..." : "Confirm block"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
