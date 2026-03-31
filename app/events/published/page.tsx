"use client";

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";

function EventPublishedPageContent() {
  const params = useSearchParams();
  const eventId = params.get("event") ?? "";

  const eventHref = useMemo(() => (eventId ? `/events/${encodeURIComponent(eventId)}` : "/events"), [eventId]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(39,78,104,0.34),transparent_28%),radial-gradient(circle_at_top_right,rgba(184,91,255,0.18),transparent_22%),linear-gradient(180deg,#071018_0%,#060b12_48%,#05070c_100%)] text-slate-100">
      <Nav />

      <main className="mx-auto flex w-full max-w-[980px] flex-col items-center px-4 py-16 text-center sm:px-6 lg:px-8">
        <div className="mb-8 inline-flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-[#79dbff] via-[#9cc6ff] to-[#d766ef] text-[#0a1420] shadow-[0_0_44px_rgba(121,219,255,0.24)]">
          <span className="material-symbols-outlined text-5xl">check</span>
        </div>

        <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
          Event <span className="bg-gradient-to-r from-[#72d8ff] via-[#9db7ff] to-[#d766ef] bg-clip-text text-transparent">Published</span>
        </h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Your event is live. You can now share the link, manage requests, and review attendee feedback after the event ends.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={eventHref}
            className="rounded-full bg-[linear-gradient(135deg,#79dbff,#b38cff)] px-6 py-2.5 text-sm font-bold text-[#08121a] hover:opacity-95"
          >
            View Live Event
          </Link>
          <Link
            href="/events"
            className="rounded-full border border-white/20 bg-black/25 px-6 py-2.5 text-sm font-semibold text-slate-200 hover:bg-black/35"
          >
            Back to Explore
          </Link>
        </div>
      </main>
    </div>
  );
}

function EventPublishedPageFallback() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(39,78,104,0.34),transparent_28%),radial-gradient(circle_at_top_right,rgba(184,91,255,0.18),transparent_22%),linear-gradient(180deg,#071018_0%,#060b12_48%,#05070c_100%)] text-slate-100">
      <Nav />
      <main className="mx-auto flex w-full max-w-[980px] flex-col items-center px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-slate-300">Loading event details...</p>
      </main>
    </div>
  );
}

export default function EventPublishedPage() {
  return (
    <Suspense fallback={<EventPublishedPageFallback />}>
      <EventPublishedPageContent />
    </Suspense>
  );
}
