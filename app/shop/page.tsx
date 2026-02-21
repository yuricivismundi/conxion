import InfoPageShell from "@/components/InfoPageShell";

export default function ShopPage() {
  return (
    <InfoPageShell
      title="ConXion Shop"
      description="Future space for premium plans, event tools, and partner offers aligned with the ConXion ecosystem."
    >
      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Not Live Yet</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Shop and plan-management experiences are not publicly available yet. This page is reserved for MVP-to-growth expansion.
        </p>
      </article>
    </InfoPageShell>
  );
}

