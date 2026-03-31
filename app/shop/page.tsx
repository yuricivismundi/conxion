import InfoPageShell from "@/components/InfoPageShell";
import Link from "next/link";

export default function ShopPage() {
  return (
    <InfoPageShell
      title="ConXion Shop"
      description="Upgrade your Plan now lives in its own billing page. The shop route remains available for future partner offers and extras."
    >
      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Plans moved to Upgrade your Plan</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Verified and Plus now have a dedicated billing experience with upgrade flows and plan details.
        </p>
        <Link
          href="/pricing"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-300 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-[#06121a] hover:brightness-110"
        >
          Open Upgrade your Plan
        </Link>
      </article>
    </InfoPageShell>
  );
}
