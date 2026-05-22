export default function TeacherProfileLoading() {
  return (
    <div className="min-h-screen bg-[#05070c] text-white">
      <div className="hidden md:block h-16 border-b border-[#2A2A2A] bg-[#0A0A0A]/95" />
      <div className="mx-auto w-full max-w-[860px] px-0 sm:px-4 pb-24 pt-0 sm:pt-6">
        {/* Hero image */}
        <div className="relative w-full aspect-[4/3] sm:aspect-[16/9] sm:rounded-3xl overflow-hidden bg-white/[0.05] animate-pulse">
          <div className="absolute bottom-4 right-4 h-8 w-28 rounded-xl bg-white/10" />
        </div>

        {/* Name + tagline + location */}
        <div className="px-5 pt-6 sm:px-2 space-y-3 animate-pulse">
          <div className="h-10 w-56 rounded-xl bg-white/[0.08]" />
          <div className="h-5 w-72 rounded-full bg-white/[0.05]" />
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded-full bg-white/[0.05]" />
            <div className="h-4 w-36 rounded-full bg-white/[0.05]" />
          </div>
        </div>

        {/* CTA buttons */}
        <div className="px-5 pt-5 sm:px-2 space-y-3 animate-pulse">
          <div className="h-14 w-full rounded-full bg-white/[0.07]" />
          <div className="h-14 w-full rounded-full bg-white/[0.04]" />
        </div>

        {/* Content blocks */}
        <div className="px-5 pt-8 sm:px-2 space-y-4 animate-pulse">
          <div className="h-32 rounded-3xl bg-white/[0.04]" />
          <div className="h-48 rounded-3xl bg-white/[0.04]" />
          <div className="h-64 rounded-3xl bg-white/[0.04]" />
        </div>
      </div>
    </div>
  );
}
