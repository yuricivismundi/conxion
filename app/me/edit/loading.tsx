export default function EditProfileLoading() {
  return (
    <div className="min-h-screen bg-[#07090e] text-white">
      <div className="h-16 border-b border-[#2A2A2A] bg-[#0A0A0A]/95" />
      <div className="mx-auto w-full max-w-[900px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 h-8 w-48 animate-pulse rounded-full bg-white/[0.07]" />
        <div className="space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-2xl border border-white/8 bg-white/[0.03] p-6 space-y-4">
              <div className="h-5 w-32 rounded-full bg-white/[0.07]" />
              <div className="h-12 rounded-xl bg-white/[0.05]" />
              <div className="h-12 rounded-xl bg-white/[0.05]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
