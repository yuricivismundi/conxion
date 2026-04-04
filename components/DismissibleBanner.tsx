"use client";
import { useEffect, useRef } from "react";

type BannerTone = "error" | "info";

const TONE_CLASSES: Record<BannerTone, string> = {
  error: "border-rose-400/30 bg-rose-500/10 text-rose-100",
  info: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
};

export function DismissibleBanner({
  message,
  tone = "info",
  onDismiss,
}: {
  message: string | null;
  tone?: BannerTone;
  onDismiss: () => void;
}) {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; });

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => onDismissRef.current(), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;

  return (
    <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm ${TONE_CLASSES[tone]}`}>
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
        aria-label="Dismiss"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
}
