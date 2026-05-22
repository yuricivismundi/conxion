import Nav from "@/components/Nav";

export default function PricingLoading() {
  return (
    <div className="min-h-screen bg-[#05070d] text-white">
      <Nav />
      <main className="relative mx-auto w-full max-w-[1080px] px-4 pb-20 pt-12 sm:px-6 lg:px-8">
        <div className="mb-10 text-center">
          <div className="mx-auto h-8 w-48 animate-pulse rounded-full bg-white/10" />
          <div className="mx-auto mt-3 h-4 w-72 animate-pulse rounded-full bg-white/[0.06]" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,17,22,0.94),rgba(8,12,18,0.9))] p-5 shadow-[0_22px_60px_rgba(0,0,0,0.28)] sm:p-6"
            >
              <div className="mb-4 space-y-2">
                <div className="h-6 w-28 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-20 animate-pulse rounded bg-white/[0.06]" />
                <div className="h-3 w-full animate-pulse rounded bg-white/[0.04]" />
              </div>
              <div className="my-5 h-10 animate-pulse rounded-2xl bg-white/[0.06]" />
              <div className="space-y-2">
                {[0, 1, 2, 3].map((j) => (
                  <div key={j} className="flex items-center gap-2">
                    <div className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-white/10" />
                    <div className="h-3 flex-1 animate-pulse rounded bg-white/[0.05]" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
