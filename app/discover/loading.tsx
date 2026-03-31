import Nav from "@/components/Nav";

export default function DiscoverLoading() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />
      <main className="mx-auto w-full max-w-[1320px] px-4 pb-10 pt-8 sm:px-6 lg:px-8">
        <section className="border-b border-white/6 pb-4">
          <div className="mx-auto flex w-full max-w-[560px] items-center justify-center gap-8">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`discover-loading-tab-${index}`}
                className="h-11 w-28 animate-pulse rounded-full border border-white/10 bg-white/5"
              />
            ))}
          </div>
        </section>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="h-5 w-32 animate-pulse rounded bg-white/10" />
            <div className="flex items-center gap-3 border-l border-white/10 pl-6">
              <div className="h-10 w-36 animate-pulse rounded-xl border border-white/10 bg-white/5" />
              <div className="h-6 w-36 animate-pulse rounded bg-white/10" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="h-11 w-[320px] animate-pulse rounded-full border border-white/10 bg-white/5" />
            <div className="h-11 w-[144px] animate-pulse rounded-full bg-[#00F5FF]/80" />
          </div>
        </div>

        <div className="relative mt-8">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={`discover-loading-card-${index}`}
                className="flex h-[420px] animate-pulse flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#121212] md:h-64 md:flex-row"
              >
                <div className="h-44 w-full bg-white/5 md:h-full md:w-1/2" />
                <div className="flex h-full w-full flex-col justify-between p-4 md:w-1/2">
                  <div className="min-h-0">
                    <div className="h-6 w-40 rounded bg-white/10" />
                    <div className="mt-3 h-4 w-36 rounded bg-white/10" />
                    <div className="mt-4 h-3 w-40 rounded bg-white/10" />
                    <div className="mt-4 flex gap-2">
                      <div className="h-5 w-16 rounded bg-white/10" />
                      <div className="h-5 w-20 rounded bg-white/10" />
                      <div className="h-5 w-14 rounded bg-white/10" />
                    </div>
                    <div className="mt-3 flex gap-2">
                      <div className="h-5 w-10 rounded bg-white/10" />
                      <div className="h-5 w-10 rounded bg-white/10" />
                      <div className="h-5 w-10 rounded bg-white/10" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-3">
                    <div className="h-10 flex-1 rounded-full bg-white/10" />
                    <div className="h-10 flex-[1.3] rounded-full bg-white/10" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
