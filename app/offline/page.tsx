"use client";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#06070b] px-6 text-center text-white">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
        <span className="material-symbols-outlined text-4xl text-white/30">wifi_off</span>
      </div>
      <h1 className="text-2xl font-bold">You&apos;re offline</h1>
      <p className="mt-2 max-w-xs text-sm text-slate-400">
        Check your connection and try again. ConXion will reload automatically when you&apos;re back online.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 rounded-full bg-[linear-gradient(135deg,#00F5FF,#FF00FF)] px-6 py-2.5 text-sm font-bold text-[#071116]"
      >
        Try again
      </button>
    </div>
  );
}
