export default function ActivityLoading() {
  return (
    <div className="min-h-screen bg-[#05060a] text-white">
      <div className="h-16 border-b border-[#2A2A2A] bg-[#0A0A0A]/95" />
      <div className="mx-auto w-full max-w-[1220px] px-4 pb-24 pt-5 sm:px-6 lg:px-8">
        {/* Tab bar skeleton */}
        <div className="mb-6 flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 w-20 animate-pulse rounded-full bg-white/[0.06]" />
          ))}
        </div>
        {/* Card skeletons */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-[20px] bg-white/[0.04] p-4 space-y-3">
              <div className="h-36 rounded-xl bg-white/[0.06]" />
              <div className="h-5 w-3/4 rounded-full bg-white/[0.06]" />
              <div className="h-4 w-1/2 rounded-full bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
