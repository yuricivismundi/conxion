import Nav from "@/components/Nav";

export default function ConnectionsLoading() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />
      <main className="mx-auto w-full max-w-[1320px] px-4 pb-10 pt-8 sm:px-6 lg:px-8">
        <section className="border-b border-white/6 pb-3 sm:pb-4">
          <div className="mx-auto flex w-full max-w-none grid-cols-3 gap-2 px-0 pb-1 sm:max-w-[560px] sm:items-center sm:justify-center sm:gap-8">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`cx-loading-tab-${index}`}
                className="h-12 w-28 animate-pulse rounded-full border border-white/10 bg-white/5"
              />
            ))}
          </div>
        </section>

        <div className="mt-6 flex flex-col gap-4 md:mt-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="h-5 w-32 animate-pulse rounded bg-white/10" />
            <div className="hidden md:flex md:items-center md:gap-3 md:border-l md:border-white/10 md:pl-6">
              <div className="h-10 w-36 animate-pulse rounded-xl border border-white/10 bg-white/5" />
              <div className="h-5 w-28 animate-pulse rounded bg-white/10" />
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="h-11 w-full animate-pulse rounded-full border border-white/10 bg-white/5 sm:w-[240px]" />
            <div className="h-11 w-full animate-pulse rounded-full bg-[#00F5FF]/80 sm:w-[144px]" />
          </div>
        </div>

        <div className="relative mt-8">
          <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={`cx-loading-card-${index}`}
                className="flex min-h-[196px] animate-pulse flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#121212] md:h-64 md:min-h-0 md:flex-row"
              >
                <div className="h-44 w-full bg-white/5 md:h-full md:w-1/2" />
                <div className="flex h-full w-full flex-col justify-between p-4 md:w-1/2">
                  <div className="min-h-0">
                    <div className="h-5 w-40 rounded bg-white/10" />
                    <div className="mt-3 h-4 w-44 rounded bg-white/10" />
                    <div className="mt-4 h-3 w-52 rounded bg-white/10" />
                    <div className="mt-4 flex gap-2">
                      <div className="h-3 w-8 rounded bg-white/10" />
                      <div className="h-3 w-14 rounded bg-white/10" />
                      <div className="h-3 w-10 rounded bg-white/10" />
                    </div>
                    <div className="mt-4 flex gap-2">
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
