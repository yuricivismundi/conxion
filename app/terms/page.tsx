import InfoPageShell from "@/components/InfoPageShell";

export default function TermsPage() {
  return (
    <InfoPageShell
      title="Terms of Service"
      description="These baseline terms describe acceptable usage of ConXion while the platform is in active MVP development."
    >
      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Core Terms</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          <li>You are responsible for your account activity and content.</li>
          <li>You must provide accurate profile and request information.</li>
          <li>Abuse, harassment, fraud, and impersonation are prohibited.</li>
          <li>ConXion may moderate, restrict, or remove content/accounts for policy violations.</li>
        </ul>
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">MVP Scope</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Some product features and policies will evolve during MVP. Continued use means acceptance of updated terms as they are
          published in the app.
        </p>
      </article>
    </InfoPageShell>
  );
}

