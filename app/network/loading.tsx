import Nav from "@/components/Nav";

export default function NetworkLoading() {
  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <Nav />
      <main className="flex flex-1 justify-center px-4 py-5 sm:px-6 md:py-6 lg:px-12 xl:px-20">
        <div className="flex w-full max-w-[1200px] flex-col gap-5">
          <section className="border-b border-white/6 pb-3">
            <div className="no-scrollbar mx-auto flex w-full max-w-[860px] flex-nowrap items-center gap-2 overflow-x-auto pb-1 sm:justify-center">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`net-loading-tab-${index}`}
                  className="inline-flex h-10 w-32 shrink-0 animate-pulse rounded-full border border-white/10 bg-white/[0.03]"
                />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex justify-end">
              <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="h-[46px] w-full animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] sm:flex-1 md:max-w-[340px]" />
              <div className="h-[46px] w-full animate-pulse rounded-full bg-[#00F5FF]/80 sm:w-28" />
            </div>
          </section>

          <section>
            <div className="grid grid-cols-1 justify-items-center gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={`net-loading-card-${index}`}
                  className="flex w-full max-w-[252px] animate-pulse flex-col items-center rounded-2xl border border-white/10 bg-white/[0.03] px-2 py-3"
                >
                  <div className="mb-1.5 h-[78px] w-[78px] rounded-2xl bg-white/10" />
                  <div className="mt-1 h-4 w-28 rounded bg-white/10" />
                  <div className="mt-1.5 h-3 w-24 rounded bg-white/10" />
                  <div className="mt-1 h-3 w-20 rounded bg-white/10" />
                  <div className="mt-3 flex gap-2">
                    <div className="h-8 w-20 rounded-xl bg-white/10" />
                    <div className="h-8 w-8 rounded-xl bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
