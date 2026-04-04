import Nav from "@/components/Nav";

export default function EventsLoading() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />
      <main className="mx-auto w-full max-w-[1320px] px-4 pb-12 pt-7 sm:px-6 lg:px-8">
        <div className="space-y-4">
          <section className="border-b border-white/6 pb-4">
            <div className="no-scrollbar mx-auto flex w-full max-w-[560px] items-center gap-3 overflow-x-auto pb-1 sm:justify-center sm:gap-8">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`events-loading-tab-${index}`}
                  className="h-11 w-28 shrink-0 animate-pulse rounded-full border border-white/10 bg-white/5"
                />
              ))}
            </div>
          </section>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-5 w-28 animate-pulse rounded bg-white/10" />
              <div className="h-10 w-28 animate-pulse rounded-full border border-white/10 bg-white/5" />
              <div className="h-10 w-28 animate-pulse rounded-full border border-white/10 bg-white/5" />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="h-11 w-full animate-pulse rounded-full border border-white/10 bg-white/5 lg:w-[320px]" />
              <div className="h-11 w-full animate-pulse rounded-full bg-[#00F5FF]/80 sm:w-[144px]" />
            </div>
          </div>

          <section className="rounded-2xl border border-cyan-300/20 bg-[radial-gradient(circle_at_top_left,rgba(37,209,244,0.12),transparent_42%),radial-gradient(circle_at_top_right,rgba(217,70,239,0.1),transparent_46%),#101214] p-3">
            <div className="mb-3 h-5 w-36 animate-pulse rounded bg-white/10" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={`events-loading-featured-${index}`}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-[#121212] animate-pulse"
                >
                  <div className="h-44 bg-white/5" />
                  <div className="space-y-3 p-4">
                    <div className="h-4 w-24 rounded bg-white/10" />
                    <div className="h-6 w-4/5 rounded bg-white/10" />
                    <div className="h-4 w-3/5 rounded bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={`events-loading-card-${index}`}
                className="overflow-hidden rounded-2xl border border-white/10 bg-[#121212] animate-pulse"
              >
                <div className="h-44 bg-white/5" />
                <div className="space-y-3 p-4">
                  <div className="h-4 w-20 rounded bg-white/10" />
                  <div className="h-5 w-11/12 rounded bg-white/10" />
                  <div className="h-4 w-2/3 rounded bg-white/10" />
                  <div className="flex gap-2 pt-1">
                    <div className="h-7 w-16 rounded-full bg-white/10" />
                    <div className="h-7 w-20 rounded-full bg-white/10" />
                  </div>
                </div>
              </div>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}
