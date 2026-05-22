export default function TeacherProfileLoading() {
  return (
    <div className="min-h-screen bg-[#0e0e0e] text-white overflow-x-hidden">
      {/* Nav placeholder */}
      <div className="hidden md:block h-16 border-b border-white/5 bg-[#0A0A0A]/95" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 pb-32 md:pb-24">
        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="relative grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-10 lg:gap-12 mb-12 sm:mb-20 lg:mb-24">
          {/* Settings + Switch Profile (desktop) */}
          <div className="hidden lg:flex items-center gap-2 absolute top-0 right-0 z-30 animate-pulse">
            <div className="h-7 w-20 rounded-full bg-white/[0.05]" />
            <div className="h-7 w-28 rounded-full bg-white/[0.05]" />
          </div>

          {/* Left: photo column */}
          <div className="lg:col-span-5">
            {/* Mobile Settings + Switcher row */}
            <div className="flex items-center justify-between mb-2 lg:hidden animate-pulse">
              <div className="h-7 w-20 rounded-full bg-white/[0.05]" />
              <div className="h-7 w-28 rounded-full bg-white/[0.05]" />
            </div>

            <div className="relative">
              {/* Outer glow placeholder */}
              <div className="absolute inset-0 rounded-[22px] bg-gradient-to-br from-[#9333ea]/15 to-[#ff51fa]/20 blur-2xl -z-10 scale-110" />

              {/* Gradient border wrapper */}
              <div className="relative rounded-[20px] p-[2px] bg-gradient-to-br from-zinc-800/30 via-[#9333ea]/30 to-[#ff51fa]/40">
                <div className="rounded-[18px] overflow-hidden">
                  <div className="w-full h-[340px] sm:h-[440px] lg:h-[520px] bg-gradient-to-br from-white/[0.04] to-white/[0.02] animate-pulse" />
                </div>

                {/* Verified badge placeholder */}
                <div className="absolute -bottom-4 -right-4 z-20 h-11 w-32 rounded-2xl border border-white/10 bg-zinc-900/80 backdrop-blur-xl animate-pulse" />
              </div>
            </div>
          </div>

          {/* Right: info column */}
          <div className="lg:col-span-7 flex flex-col justify-center animate-pulse">
            {/* Name */}
            <div className="h-12 sm:h-16 lg:h-20 w-3/4 sm:w-2/3 rounded-2xl bg-white/[0.08] mt-3 lg:mt-4" />

            {/* Headline */}
            <div className="mt-3 space-y-2">
              <div className="h-6 w-full max-w-md rounded-full bg-white/[0.05]" />
              <div className="h-6 w-2/3 max-w-sm rounded-full bg-white/[0.05]" />
            </div>

            {/* Location */}
            <div className="flex items-center gap-2 mt-6">
              <div className="h-4 w-4 rounded-full bg-[#c1fffe]/20" />
              <div className="h-4 w-40 rounded-full bg-white/[0.05]" />
            </div>

            {/* CTA buttons (Book Session + Request Info) */}
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 pt-6">
              <div className="h-14 sm:w-48 rounded-full bg-gradient-to-r from-[#c1fffe]/20 to-[#ff51fa]/20" />
              <div className="h-14 sm:w-44 rounded-full bg-white/[0.04] border border-white/10" />
            </div>
          </div>
        </section>

        {/* ── Bio / Services tabs ─────────────────────────────────────────── */}
        <section className="mb-12 sm:mb-20 lg:mb-24 animate-pulse">
          {/* Tab pills */}
          <div className="flex flex-wrap gap-2 mb-6">
            <div className="h-9 w-24 rounded-full bg-white/[0.06]" />
            <div className="h-9 w-20 rounded-full bg-white/[0.03]" />
            <div className="h-9 w-28 rounded-full bg-white/[0.03]" />
          </div>

          {/* Tab content card */}
          <div className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-6 sm:p-8">
            <div className="space-y-3">
              <div className="h-4 w-full rounded bg-white/[0.05]" />
              <div className="h-4 w-11/12 rounded bg-white/[0.05]" />
              <div className="h-4 w-4/5 rounded bg-white/[0.05]" />
              <div className="h-4 w-2/3 rounded bg-white/[0.05]" />
            </div>
          </div>
        </section>

        {/* ── Session Availability ────────────────────────────────────────── */}
        <section className="mb-12 sm:mb-24 animate-pulse">
          <div className="mb-8 sm:mb-10">
            <div className="h-8 sm:h-10 w-72 rounded-xl bg-white/[0.08] mb-3" />
            <div className="h-4 w-96 max-w-full rounded-full bg-white/[0.04]" />
          </div>

          <div className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-6">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              {/* 3 month calendars */}
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-4 w-20 rounded bg-white/[0.06]" />
                    <div className="h-4 w-16 rounded-full bg-white/[0.04]" />
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: 35 }).map((_, j) => (
                      <div key={j} className="aspect-square rounded-md bg-white/[0.03]" />
                    ))}
                  </div>
                </div>
              ))}
              {/* Selected date / slot panel */}
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
                <div className="h-3 w-20 rounded bg-white/[0.06]" />
                <div className="h-7 w-32 rounded-lg bg-white/[0.08]" />
                <div className="h-3 w-48 rounded bg-white/[0.04]" />
                <div className="h-14 rounded-2xl bg-white/[0.04]" />
                <div className="h-3 w-12 rounded bg-white/[0.06] mt-2" />
                <div className="h-24 rounded-2xl bg-white/[0.04]" />
                <div className="h-10 rounded-2xl bg-gradient-to-r from-[#5DD8D8]/15 via-[#7c3aff]/15 to-[#ff00ff]/15 mt-2" />
              </div>
            </div>
          </div>
        </section>

        {/* ── Weekly Classes ──────────────────────────────────────────────── */}
        <section className="mb-12 sm:mb-24 animate-pulse">
          <div className="mb-8 sm:mb-12">
            <div className="h-8 sm:h-10 w-56 rounded-xl bg-white/[0.08] mb-3" />
            <div className="h-4 w-80 max-w-full rounded-full bg-white/[0.04]" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="bg-zinc-900/40 border border-white/5 rounded-2xl p-6 flex items-center justify-between"
              >
                <div className="flex items-center gap-6">
                  <div className="text-center min-w-[64px] space-y-2">
                    <div className="h-7 w-12 rounded bg-white/[0.08] mx-auto" />
                    <div className="h-3 w-14 rounded bg-white/[0.05] mx-auto" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-5 w-48 rounded bg-white/[0.06]" />
                    <div className="h-3 w-36 rounded bg-white/[0.04]" />
                  </div>
                </div>
                <div className="hidden md:flex items-center gap-2">
                  <div className="h-6 w-16 rounded-full bg-white/[0.05]" />
                  <div className="h-6 w-20 rounded-full bg-white/[0.05]" />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Global Stage Presence ───────────────────────────────────────── */}
        <section className="mb-12 sm:mb-24 animate-pulse">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16">
            <div className="lg:col-span-4 space-y-3">
              <div className="h-10 sm:h-14 w-32 rounded-xl bg-white/[0.08]" />
              <div className="h-10 sm:h-14 w-28 rounded-xl bg-white/[0.08]" />
              <div className="h-10 sm:h-14 w-32 rounded-xl bg-white/[0.08]" />
              <div className="space-y-2 mt-4">
                <div className="h-3 w-full rounded bg-white/[0.04]" />
                <div className="h-3 w-5/6 rounded bg-white/[0.04]" />
              </div>
            </div>
            <div className="lg:col-span-8 space-y-8 relative pl-10">
              <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-[#c1fffe]/20 to-transparent" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="relative space-y-2">
                  <div className={`absolute left-[-15px] top-1 w-2.5 h-2.5 rounded-full ${i === 0 ? "bg-[#c1fffe]/40" : "bg-zinc-800"}`} />
                  <div className="h-3 w-24 rounded bg-white/[0.05]" />
                  <div className="h-6 w-72 max-w-full rounded bg-white/[0.06]" />
                  <div className="h-3 w-40 rounded bg-white/[0.04]" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
