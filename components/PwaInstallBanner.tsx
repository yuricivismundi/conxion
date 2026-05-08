"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "cx_pwa_install_dismissed_v1";

export default function PwaInstallBanner() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if already installed (standalone mode) or already dismissed
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (localStorage.getItem(DISMISSED_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!visible || !promptEvent) return null;

  const handleInstall = async () => {
    setVisible(false);
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === "dismissed") localStorage.setItem(DISMISSED_KEY, "1");
  };

  const handleDismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISSED_KEY, "1");
  };

  return (
    <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] left-4 right-4 z-[9400] md:bottom-6 md:left-auto md:right-6 md:max-w-sm">
      <div className="sheet-up flex items-center gap-3 rounded-2xl border border-cyan-300/20 bg-[#0c1118] px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#00F5FF,#FF00FF)]">
          <span className="material-symbols-outlined text-[20px] text-[#071116]">download</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Add ConXion to home screen</p>
          <p className="text-xs text-slate-400">Fast, offline-ready app experience</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleInstall()}
            className="rounded-lg bg-[linear-gradient(135deg,#00F5FF,#FF00FF)] px-3 py-1.5 text-xs font-bold text-[#071116]"
          >
            Install
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:text-white transition"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>
    </div>
  );
}
