"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ProfileError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="material-symbols-outlined text-[48px] text-slate-500">person_off</span>
      <div className="space-y-1">
        <p className="text-base font-semibold text-white">Couldn&apos;t load this profile</p>
        <p className="text-sm text-slate-400">Something went wrong. Try again or go back.</p>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={reset} className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/15">Try again</button>
        <Link href="/connections" className="rounded-full bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/10">Discover</Link>
      </div>
    </div>
  );
}
