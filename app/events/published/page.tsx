"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";

export default function EventPublishedPage() {
  const params = useSearchParams();
  const eventId = params.get("event") ?? "";

  const eventHref = useMemo(() => (eventId ? `/events/${encodeURIComponent(eventId)}` : "/events"), [eventId]);
  const inboxHref = useMemo(() => (eventId ? `/events/${encodeURIComponent(eventId)}/inbox` : "/events"), [eventId]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#10272b,_#071316_45%,_#05090b_100%)] text-slate-100">
      <Nav />

      <main className="mx-auto flex w-full max-w-[980px] flex-col items-center px-4 py-16 text-center sm:px-6 lg:px-8">
        <div className="mb-8 inline-flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-400 text-[#062229] shadow-[0_0_40px_rgba(34,211,238,0.35)]">
          <span className="material-symbols-outlined text-5xl">check</span>
        </div>

        <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
          Event <span className="bg-gradient-to-r from-cyan-300 to-fuchsia-400 bg-clip-text text-transparent">Published</span>
        </h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Your event is live. You can now share the link, manage requests, and review attendee feedback after the event ends.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={eventHref}
            className="rounded-full bg-cyan-300 px-6 py-2.5 text-sm font-bold text-[#062229] hover:bg-cyan-200"
          >
            View Live Event
          </Link>
          <Link
            href={inboxHref}
            className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-6 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/25"
          >
            Open Request Inbox
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
