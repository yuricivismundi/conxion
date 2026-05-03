"use client";

type BlockDialogProps = {
  blockBusy: boolean;
  displayName?: string;
  onClose: () => void;
  onConfirm: () => void;
  // kept for backwards compatibility — no longer rendered
  blockReason?: string;
  blockNote?: string;
  setBlockReason?: (value: string) => void;
  setBlockNote?: (value: string) => void;
};

const BLOCK_CONSEQUENCES = [
  "See your profile or content",
  "Message you",
  "Invite you to events or groups",
  "Send you connection requests",
];

export default function BlockDialog({
  blockBusy,
  displayName = "this member",
  onClose,
  onConfirm,
}: BlockDialogProps) {
  const firstName = displayName.split(" ")[0] ?? displayName;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-[#0f1214] shadow-[0_32px_80px_rgba(0,0,0,0.6)]">
        <div className="h-px w-full bg-gradient-to-r from-rose-500/70 via-[#0df2f2]/20 to-rose-500/40" />

        <div className="p-6">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-xl font-bold text-white">Block {displayName}?</h3>
            <button
              type="button"
              onClick={onClose}
              disabled={blockBusy}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/8 text-white/55 transition hover:bg-white/12 hover:text-white disabled:opacity-40"
              aria-label="Close"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
            </button>
          </div>

          <p className="mt-4 text-sm text-slate-300">
            <span className="font-semibold text-white">{firstName}</span> will no longer be able to:
          </p>
          <ul className="mt-3 space-y-2">
            {BLOCK_CONSEQUENCES.map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-sm text-slate-300">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400/80" />
                {item}
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={blockBusy}
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-300 transition hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={blockBusy}
              onClick={onConfirm}
              className="rounded-2xl bg-rose-500 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-rose-400 disabled:opacity-60"
            >
              {blockBusy ? "Blocking…" : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
