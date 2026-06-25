"use client";

import { useState } from "react";

type Props = {
  displayName: string;
  size?: "default" | "compact";
};

export default function ShareTeacherProfileButton({ displayName, size = "compact" }: Props) {
  const [copied, setCopied] = useState(false);

  function handleShare() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (navigator.share) {
      void navigator.share({ title: `${displayName} — Teacher on ConXion`, url });
    } else {
      void navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  const isCompact = size === "compact";

  return (
    <button
      type="button"
      onClick={handleShare}
      title="Share teacher profile"
      className={
        isCompact
          ? "inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-full border border-white/15 bg-white/[0.04] text-white/60 transition hover:bg-white/[0.08] hover:border-white/25 hover:text-white text-[10px] font-medium uppercase tracking-wider"
          : "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full border border-white/20 bg-white/[0.04] text-white/70 transition hover:bg-white/[0.08] hover:border-white/30 hover:text-white text-xs font-semibold uppercase tracking-widest"
      }
    >
      <span className={isCompact ? "material-symbols-outlined text-[13px]" : "material-symbols-outlined text-[18px]"}>
        {copied ? "check" : "share"}
      </span>
      <span>{copied ? "Copied!" : "Share"}</span>
    </button>
  );
}
