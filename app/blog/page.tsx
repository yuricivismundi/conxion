import InfoPageShell from "@/components/InfoPageShell";

export default function BlogPage() {
  return (
    <InfoPageShell
      title="ConXion Blog"
      description="Product updates, trust and safety notes, event ecosystem insights, and community best practices."
    >
      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Coming Soon</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          The editorial hub is being prepared. We will publish release notes, roadmap highlights, and trust-system updates here.
        </p>
      </article>
    </InfoPageShell>
  );
}

