"use client";

import Link from "next/link";

type PendingRequestBannerProps = {
  message: string;
  ctaHref?: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  className?: string;
};

export default function PendingRequestBanner({
  message,
  ctaHref = "/messages?tab=requests",
  ctaLabel = "Open in Messages",
  onCtaClick,
  className = "",
}: PendingRequestBannerProps) {
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border border-[#00F5FF]/25 bg-[linear-gradient(135deg,rgba(0,245,255,0.12),rgba(255,0,255,0.08))] px-4 py-3 text-sm text-[#D9FBFF] shadow-[0_10px_30px_rgba(0,245,255,0.08)] ${className}`.trim()}
    >
      <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-[#00F5FF]">info</span>
      <span className="min-w-0">
        {message}{" "}
        {ctaHref ? (
          <Link
            href={ctaHref}
            onClick={onCtaClick}
            className="font-semibold text-[#00F5FF] underline underline-offset-2 transition hover:text-white"
          >
            {ctaLabel}
          </Link>
        ) : null}
      </span>
    </div>
  );
}
