export default function ProfileLoading() {
  return (
    <div className="min-h-screen bg-[#05070c] text-white">
      <div className="h-16 border-b border-[#2A2A2A] bg-[#0A0A0A]/95" />
      <div className="mx-auto w-full max-w-[1280px] px-4 pt-6 pb-16 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[34px] bg-[#181818] animate-pulse">
          {/* Cover */}
          <div className="h-[96px] bg-white/[0.04] sm:h-[128px]" />
          {/* Avatar placeholder */}
          <div className="absolute left-1/2 top-[48px] z-10 h-28 w-28 -translate-x-1/2 rounded-full border-[5px] border-[#171717] bg-white/10 sm:left-8 sm:top-[64px] sm:h-[144px] sm:w-[144px] sm:translate-x-0" />
          <div className="bg-[#171717] px-4 pb-6 pt-[80px] sm:px-8 sm:pl-[192px] sm:pt-4">
            <div className="h-8 w-52 rounded-full bg-white/[0.08] sm:h-10 sm:w-72" />
            <div className="mt-2 h-5 w-36 rounded-full bg-white/[0.06]" />
            <div className="mt-4 flex gap-2">
              <div className="h-10 w-32 rounded-full bg-white/[0.06]" />
              <div className="h-10 w-28 rounded-full bg-white/[0.06]" />
            </div>
          </div>
        </section>
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-4">
            <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />
            <div className="h-56 animate-pulse rounded-2xl bg-white/[0.04]" />
          </div>
          <div className="space-y-4">
            <div className="h-32 animate-pulse rounded-2xl bg-white/[0.04]" />
            <div className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />
          </div>
        </div>
      </div>
    </div>
  );
}
