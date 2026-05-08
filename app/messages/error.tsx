"use client";

import { useEffect } from "react";

export default function MessagesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="material-symbols-outlined text-[48px] text-slate-500">chat_error</span>
      <div className="space-y-1">
        <p className="text-base font-semibold text-white">Couldn&apos;t load messages</p>
        <p className="text-sm text-slate-400">Something went wrong. Refresh to try again.</p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/15"
      >
        Try again
      </button>
    </div>
  );
}
