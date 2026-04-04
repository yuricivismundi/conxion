import Nav from "@/components/Nav";

export default function TripsLoading() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] font-sans text-white">
      <Nav />
      <main className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
        <div className="space-y-8">
          {/* Active Trips section */}
          <div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="h-6 w-28 animate-pulse rounded bg-white/10" />
                <div className="h-5 w-12 animate-pulse rounded-full border border-white/10 bg-white/[0.04]" />
              </div>
              <div className="h-10 w-full animate-pulse rounded-full bg-[#00F5FF]/80 sm:w-32" />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={`trips-loading-active-${index}`}
                  className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04]"
                >
                  <div className="h-40 animate-pulse bg-white/5" />
                  <div className="space-y-3 p-5">
                    <div className="h-5 w-3/4 animate-pulse rounded bg-white/10" />
                    <div className="h-4 w-1/2 animate-pulse rounded bg-white/10" />
                    <div className="h-4 w-2/3 animate-pulse rounded bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Past Trips section */}
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="h-6 w-24 animate-pulse rounded bg-white/10" />
              <div className="h-4 w-20 animate-pulse rounded bg-white/10" />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={`trips-loading-past-${index}`}
                  className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04]"
                >
                  <div className="h-40 animate-pulse bg-white/5" />
                  <div className="space-y-3 p-5">
                    <div className="h-5 w-3/4 animate-pulse rounded bg-white/10" />
                    <div className="h-4 w-1/2 animate-pulse rounded bg-white/10" />
                    <div className="h-4 w-2/3 animate-pulse rounded bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
