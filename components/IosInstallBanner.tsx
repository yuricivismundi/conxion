"use client";

import { useEffect, useState } from "react";

const DISMISSED_KEY = "cx_ios_install_dismissed_v1";

export default function IosInstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    const dismissed = Boolean(localStorage.getItem(DISMISSED_KEY));
    if (isIos && !isStandalone && !dismissed) setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] left-4 right-4 z-[9400] md:hidden">
      <div className="sheet-up flex items-start gap-3 rounded-2xl border border-white/10 bg-[#0c1118] px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        <span className="material-symbols-outlined mt-0.5 shrink-0 text-[22px] text-cyan-300">ios_share</span>
        <div className="min-w-0 flex-1 text-sm text-slate-300">
          Install ConXion: tap{" "}
          <span className="inline-flex items-center gap-0.5 font-semibold text-white">
            <span className="material-symbols-outlined text-[14px]">ios_share</span> Share
          </span>{" "}
          then <span className="font-semibold text-white">Add to Home Screen</span>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => { localStorage.setItem(DISMISSED_KEY, "1"); setVisible(false); }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-500 hover:text-white"
        >
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      </div>
    </div>
  );
}
