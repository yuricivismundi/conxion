export default function GroupLoading() {
  return (
    <div className="min-h-screen bg-[#05060a] text-white">
      <div className="mx-auto w-full max-w-[1220px] animate-pulse px-4 pb-24 pt-5 sm:px-6 lg:px-8">
        {/* Hero skeleton */}
        <div className="overflow-hidden rounded-[20px] border border-white/8 bg-[#1b1d21]">
          <div className="h-[220px] bg-white/[0.05] sm:h-[320px]" />
          <div className="space-y-3 px-6 py-5">
            <div className="h-7 w-1/2 rounded-xl bg-white/[0.06]" />
            <div className="h-4 w-1/4 rounded-lg bg-white/[0.04]" />
          </div>
        </div>

        {/* Body skeleton */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <div className="h-64 rounded-[20px] bg-white/[0.04]" />
            <div className="h-24 rounded-[20px] bg-white/[0.04]" />
          </div>
          <div className="space-y-4">
            <div className="h-48 rounded-[20px] bg-white/[0.04]" />
          </div>
        </div>
      </div>
    </div>
  );
}
