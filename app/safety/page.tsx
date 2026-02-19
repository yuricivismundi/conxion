import InfoPageShell from "@/components/InfoPageShell";

export default function SafetyPage() {
  return (
    <InfoPageShell
      title="Safety Center"
      description="ConXion is built as a trust infrastructure product. Review safety expectations, reporting paths, and best practices before meeting in person."
    >
      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Community Standards</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          <li>Respect boundaries and consent in all interactions.</li>
          <li>No harassment, hate speech, coercion, or threats.</li>
          <li>No spam, scams, or off-platform solicitation abuse.</li>
          <li>Use accurate identity and profile information.</li>
        </ul>
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">How To Stay Safe</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          <li>Use in-app request and messaging flows first.</li>
          <li>Prefer public venues for first meetings and syncs.</li>
          <li>Share event and trip details with someone you trust.</li>
          <li>Report suspicious behavior early.</li>
        </ul>
      </article>

      <article className="rounded-3xl border border-rose-400/35 bg-rose-500/10 p-5 sm:p-6">
        <h2 className="text-xl font-bold text-rose-100">Emergency Disclaimer</h2>
        <p className="mt-3 text-sm leading-relaxed text-rose-100/90">
          If you are in immediate danger, contact local emergency services first. In-app reports are for moderation and cannot
          replace emergency response.
        </p>
      </article>
    </InfoPageShell>
  );
}

