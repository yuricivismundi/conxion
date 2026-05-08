export default function EventLoading() {
  return (
    <div className="min-h-screen bg-[#18191a] text-slate-100">
      <div className="mx-auto w-full max-w-[1220px] animate-pulse px-4 pb-12 pt-5 sm:px-6 lg:px-8">
        {/* Cover skeleton */}
        <div className="overflow-hidden rounded-[20px] border border-white/8 bg-[#1b1d21]">
          <div className="h-[320px] bg-white/[0.05] sm:h-[420px]" />
          <div className="space-y-3 px-6 py-5">
            <div className="h-8 w-2/3 rounded-xl bg-white/[0.06]" />
            <div className="h-4 w-1/3 rounded-lg bg-white/[0.04]" />
            <div className="flex gap-2 pt-1">
              <div className="h-9 w-28 rounded-xl bg-white/[0.05]" />
              <div className="h-9 w-24 rounded-xl bg-white/[0.05]" />
            </div>
          </div>
        </div>

        {/* Body skeleton */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="h-40 rounded-[20px] bg-white/[0.04]" />
            <div className="h-32 rounded-[20px] bg-white/[0.04]" />
          </div>
          <div className="space-y-4">
            <div className="h-48 rounded-[20px] bg-white/[0.04]" />
          </div>
        </div>
      </div>
    </div>
  );
}
