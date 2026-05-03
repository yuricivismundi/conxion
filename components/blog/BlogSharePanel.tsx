"use client";

import { useState } from "react";

type BlogSharePanelProps = {
  title: string;
  url: string;
};

export default function BlogSharePanel({ title, url }: BlogSharePanelProps) {
  const [copied, setCopied] = useState(false);
  const encodedTitle = encodeURIComponent(title);
  const encodedUrl = encodeURIComponent(url);
  const shareLinks = [
    {
      label: "Share on X",
      href: `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`,
    },
    {
      label: "Share on LinkedIn",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    },
    {
      label: "Share on Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    },
    {
      label: "Share on WhatsApp",
      href: `https://wa.me/?text=${encodedTitle}%20${encodedUrl}`,
    },
  ];

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-[28px] border border-white/10 bg-black/20 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Share article</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">Share in your favorite social media or copy the direct article link.</p>

      <div className="mt-4 grid gap-3">
        {shareLinks.map((item) => (
          <a
            key={item.label}
            href={item.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.08]"
          >
            {item.label}
          </a>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Direct link</p>
        <div className="mt-3 flex flex-col gap-3">
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-slate-300 break-all">
            {url}
          </div>
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-300/15"
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>
      </div>
    </section>
  );
}
