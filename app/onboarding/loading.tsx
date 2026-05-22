export default function OnboardingLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#07090f]">
      <div className="w-full max-w-[420px] space-y-6 px-6">
        <div className="mx-auto h-8 w-40 animate-pulse rounded-full bg-white/10" />
        <div className="space-y-3">
          <div className="h-11 w-full animate-pulse rounded-2xl bg-white/[0.06]" />
          <div className="h-11 w-full animate-pulse rounded-2xl bg-white/[0.04]" />
          <div className="h-11 w-full animate-pulse rounded-2xl bg-white/[0.04]" />
        </div>
        <div className="h-12 w-full animate-pulse rounded-2xl bg-white/[0.08]" />
      </div>
    </div>
  );
}
