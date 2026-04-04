import Nav from "@/components/Nav";

export default function MessagesLoading() {
  return (
    <div className="font-sans flex h-[100dvh] max-h-[100svh] min-h-[100svh] flex-col overflow-hidden overscroll-none bg-[#08090c] text-white">
      <Nav />
      <main className="flex min-h-0 flex-1 overflow-hidden overscroll-none">
        {/* Sidebar skeleton */}
        <aside className="z-10 flex w-full min-h-0 flex-col overflow-hidden border-r border-white/10 bg-[linear-gradient(180deg,rgba(11,12,16,0.98),rgba(8,9,12,0.99))] md:w-[420px] lg:w-[440px]">
          <div className="flex flex-col gap-4 px-3 pt-4 pb-2 sm:px-4 sm:pt-5">
            <div className="flex items-center justify-between">
              <div className="h-8 w-20 animate-pulse rounded bg-white/10" />
              <div className="h-10 w-10 animate-pulse rounded-full bg-white/[0.04]" />
            </div>
            <div className="h-11 w-full animate-pulse rounded-full bg-black/30" />
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={`msg-loading-tab-${i}`} className="h-10 w-20 animate-pulse rounded-full border border-white/15 bg-white/[0.04]" />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="h-10 w-40 animate-pulse rounded-full border border-white/10 bg-white/[0.03]" />
              <div className="h-10 w-24 animate-pulse rounded-full border border-white/10 bg-white/[0.03]" />
            </div>
          </div>
          <div className="flex-1 space-y-2 overflow-hidden p-2">
            {Array.from({ length: 7 }).map((_, index) => (
              <div
                key={`msg-loading-thread-${index}`}
                className="flex min-h-[98px] animate-pulse items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-3"
              >
                <div className="h-12 w-12 shrink-0 rounded-full bg-white/10" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="h-4 w-28 rounded bg-white/10" />
                    <div className="h-3 w-12 rounded bg-white/10" />
                  </div>
                  <div className="h-3 w-24 rounded bg-white/10" />
                  <div className="h-3 w-3/4 rounded bg-white/10" />
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Main pane skeleton */}
        <section className="hidden min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(10,11,15,0.99),rgba(7,8,11,0.99))] md:flex">
          <div className="flex h-full flex-col items-center justify-center p-8">
            <div className="mx-auto w-full max-w-2xl animate-pulse space-y-6">
              <div className="mx-auto h-28 w-28 rounded-full bg-white/10" />
              <div className="mx-auto h-8 w-52 rounded bg-white/10" />
              <div className="mx-auto h-4 w-80 max-w-full rounded bg-white/10" />
              <div className="mx-auto h-12 w-56 rounded-full bg-white/10" />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
