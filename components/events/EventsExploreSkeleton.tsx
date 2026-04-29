import Nav from "@/components/Nav";

function EventCardSkeleton({ index }: { index: number }) {
  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#121212] shadow-[0_6px_20px_rgba(0,0,0,0.3)]">
      <div className="relative h-[108px] overflow-hidden bg-[#0d141a]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,245,255,0.16),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(255,0,255,0.14),transparent_30%),linear-gradient(135deg,rgba(22,31,40,0.95),rgba(8,10,14,0.96))]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-transparent to-transparent" />
        <div className="absolute left-2 top-2 h-5 w-16 rounded-full border border-white/10 bg-white/12" />
        <div className="absolute right-2 top-2 h-5 w-14 rounded-full border border-white/10 bg-black/35" />
        <div
          className="absolute inset-y-0 w-24 bg-white/8 blur-2xl"
          style={{ left: `${(index % 4) * 22}%` }}
        />
      </div>

      <div className="relative flex min-h-[198px] flex-1 flex-col p-2">
        <div className="pointer-events-none absolute right-2 top-1 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-center shadow-[0_8px_20px_rgba(34,211,238,0.1)]">
          <div className="mx-auto h-3 w-6 rounded bg-cyan-100/15" />
          <div className="mx-auto mt-1 h-3 w-7 rounded bg-cyan-100/12" />
          <div className="mx-auto mt-1 h-5 w-8 rounded bg-white/10" />
        </div>

        <div className="space-y-2 pr-[98px]">
          <div className="h-3 w-20 rounded bg-cyan-200/15" />
          <div className="h-4 w-full rounded bg-white/10" />
          <div className="h-4 w-4/5 rounded bg-white/10" />
          <div className="h-3 w-32 rounded bg-cyan-200/10" />
        </div>

        <div className="mt-3 space-y-2">
          <div className="h-4 w-11/12 rounded bg-white/8" />
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full border border-[#121212] bg-white/10" />
            <div className="h-3 w-32 rounded bg-white/8" />
          </div>
        </div>

        <div className="mt-auto flex items-center gap-1.5 border-t border-white/10 pt-2">
          <div className="h-[33px] flex-1 rounded-xl border border-cyan-300/15 bg-white/[0.05]" />
          <div className="h-9 w-9 rounded-xl border border-white/10 bg-white/[0.06]" />
        </div>
      </div>
    </article>
  );
}

export function EventsCardsSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 12 }).map((_, index) => (
        <EventCardSkeleton key={`events-loading-card-${index}`} index={index} />
      ))}
    </section>
  );
}

export default function EventsExploreSkeleton({ showNav = true }: { showNav?: boolean }) {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      {showNav ? <Nav /> : null}
      <main className="mx-auto w-full max-w-[1320px] px-4 pb-12 pt-7 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-5">
          <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:items-center sm:justify-between sm:gap-3">
            <div className="contents sm:flex sm:items-center sm:gap-3">
              <div className="h-10 w-24 rounded-full bg-[#00F5FF]/70 sm:w-28" />
              <div className="hidden h-10 w-[300px] rounded-full border border-white/10 bg-white/[0.05] sm:block" />
              <div className="hidden h-4 w-28 rounded bg-white/8 sm:block" />
            </div>
            <div className="contents sm:flex sm:items-center sm:gap-2">
              <div className="h-10 min-w-0 rounded-full border border-cyan-300/35 bg-cyan-300/20 sm:w-32" />
            </div>
          </header>
          <EventsCardsSkeleton />
        </div>
      </main>
    </div>
  );
}
