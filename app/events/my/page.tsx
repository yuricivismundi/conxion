"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { formatEventRange, mapEventRows, pickEventHeroUrl, type EventRecord } from "@/lib/events/model";
import { supabase } from "@/lib/supabase/client";

function statusTone(status: EventRecord["status"]) {
  if (status === "draft") return "border-amber-300/35 bg-amber-300/12 text-amber-100";
  if (status === "cancelled") return "border-rose-300/35 bg-rose-500/12 text-rose-100";
  return "border-cyan-300/35 bg-cyan-300/12 text-cyan-100";
}

function EventTile({ event }: { event: EventRecord }) {
  const hero = pickEventHeroUrl(event);
  const [renderedAt] = useState(() => Date.now());
  const isPast = new Date(event.endsAt).getTime() < renderedAt;
  const primaryHref = event.status === "draft" ? `/events/${event.id}/edit` : `/events/${event.id}`;

  return (
    <article className="group overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(13,18,26,0.98),rgba(8,10,14,0.98))] transition hover:border-cyan-300/25">
      <div className="relative h-48 overflow-hidden bg-[#0d141a]">
        {hero ? <img src={hero} alt={event.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
        <div className="absolute left-4 top-4 flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${statusTone(event.status)}`}>
            {event.status}
          </span>
          {isPast ? (
            <span className="rounded-full border border-white/15 bg-black/35 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white/80">
              Past
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="space-y-2">
          <Link href={primaryHref} className="block">
            <h2 className="text-2xl font-black tracking-tight text-white">{event.title}</h2>
          </Link>
          <p className="text-sm text-slate-300">{formatEventRange(event.startsAt, event.endsAt)}</p>
          <p className="text-sm text-slate-400">{[event.venueName, event.city, event.country].filter(Boolean).join(", ")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-200">
            {event.eventType}
          </span>
          {event.styles.slice(0, 3).map((style) => (
            <span key={style} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold capitalize text-slate-300">
              {style}
            </span>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
          <Link href={primaryHref} className="inline-flex items-center gap-1 text-cyan-100">
            <span className="material-symbols-outlined text-[18px]">edit</span>
            {event.status === "draft" ? "Continue editing" : "Open event"}
          </Link>
          <Link
            href={`/events/${event.id}/edit`}
            className="inline-flex items-center gap-1 text-slate-300 hover:text-white"
          >
            <span className="material-symbols-outlined text-[18px]">tune</span>
            Edit
          </Link>
        </div>
      </div>
    </article>
  );
}

export default function MyEventsPage() {
  const router = useRouter();
  const [loadedAt] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData.user) {
        router.replace("/auth?next=/events/my");
        return;
      }

      const eventsRes = await supabase
        .from("events")
        .select("*")
        .eq("host_user_id", authData.user.id)
        .order("updated_at", { ascending: false })
        .limit(200);

      if (cancelled) return;

      if (eventsRes.error) {
        setError(eventsRes.error.message);
        setLoading(false);
        return;
      }

      setEvents(mapEventRows((eventsRes.data ?? []) as unknown[]));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const draftEvents = useMemo(() => events.filter((event) => event.status === "draft"), [events]);
  const upcomingEvents = useMemo(
    () => events.filter((event) => event.status !== "draft" && new Date(event.endsAt).getTime() >= loadedAt),
    [events, loadedAt]
  );
  const pastEvents = useMemo(
    () => events.filter((event) => event.status !== "draft" && new Date(event.endsAt).getTime() < loadedAt),
    [events, loadedAt]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070c] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[1180px] px-4 pb-12 pt-7 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-6">
            <div className="h-28 rounded-[28px] bg-white/[0.04]" />
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="h-72 rounded-[28px] bg-white/[0.04]" />
              <div className="h-72 rounded-[28px] bg-white/[0.04]" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05070c] text-white">
      <Nav />

      <main className="mx-auto w-full max-w-[1180px] px-4 pb-12 pt-7 sm:px-6 lg:px-8">
        <section className="mb-6 overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(0,245,255,0.08),transparent_42%),linear-gradient(180deg,rgba(15,19,28,0.98),rgba(8,10,14,0.99))] p-6 sm:p-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/55">Hosted events</p>
              <h1 className="mt-2 text-4xl font-black tracking-tight text-white sm:text-5xl">My Events</h1>
              <p className="mt-3 text-sm leading-6 text-white/68 sm:text-base">
                See your drafts, upcoming events, and past hosted events in one place.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/events"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white/80 hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                Explore events
              </Link>
              <Link
                href="/events/new"
                className="inline-flex items-center gap-2 rounded-full bg-[#00F5FF] px-5 py-2.5 text-sm font-bold text-[#071116] hover:opacity-90"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Create event
              </Link>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Drafts</p>
              <p className="mt-1 text-2xl font-black text-white">{draftEvents.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Upcoming</p>
              <p className="mt-1 text-2xl font-black text-white">{upcomingEvents.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Past</p>
              <p className="mt-1 text-2xl font-black text-white">{pastEvents.length}</p>
            </div>
          </div>
        </section>

        {error ? (
          <div className="mb-5 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        {!events.length ? (
          <section className="rounded-[28px] border border-white/10 bg-[#0c1117] p-7 text-center">
            <h2 className="text-2xl font-bold text-white">No events yet</h2>
            <p className="mt-2 text-sm text-slate-400">Create your first event and drafts will stay here until you publish them.</p>
            <Link
              href="/events/new"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#00F5FF] px-5 py-2.5 text-sm font-bold text-[#071116] hover:opacity-90"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Create event
            </Link>
          </section>
        ) : (
          <div className="space-y-10">
            {draftEvents.length ? (
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-2xl font-bold text-white">Drafts</h2>
                  <p className="text-sm text-slate-400">Continue editing before you publish.</p>
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                  {draftEvents.map((event) => (
                    <EventTile key={event.id} event={event} />
                  ))}
                </div>
              </section>
            ) : null}

            {upcomingEvents.length ? (
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-2xl font-bold text-white">Upcoming</h2>
                  <p className="text-sm text-slate-400">Published events that are still live or ahead.</p>
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                  {upcomingEvents.map((event) => (
                    <EventTile key={event.id} event={event} />
                  ))}
                </div>
              </section>
            ) : null}

            {pastEvents.length ? (
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-2xl font-bold text-white">Past</h2>
                  <p className="text-sm text-slate-400">Your completed hosted events stay here for reference.</p>
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                  {pastEvents.map((event) => (
                    <EventTile key={event.id} event={event} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
