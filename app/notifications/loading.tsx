export default function NotificationsLoading() {
  return (
    <div className="min-h-screen bg-[#05060a] text-white">
      <div className="h-16 border-b border-[#2A2A2A] bg-[#0A0A0A]/95" />
      <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6">
        <div className="mb-6 h-7 w-40 animate-pulse rounded-full bg-white/[0.07]" />
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex animate-pulse gap-3 rounded-2xl bg-white/[0.04] p-4">
              <div className="h-10 w-10 shrink-0 rounded-xl bg-white/[0.07]" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 rounded-full bg-white/[0.07]" />
                <div className="h-3 w-1/2 rounded-full bg-white/[0.05]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
