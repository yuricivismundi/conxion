import InfoPageShell from "@/components/InfoPageShell";

export default function PrivacyPage() {
  return (
    <InfoPageShell
      title="Privacy Policy"
      description="ConXion uses personal data to deliver matching, messaging, trust mechanics, and moderation safeguards."
    >
      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Data We Use</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          <li>Account data (email, auth identifiers)</li>
          <li>Profile data (name, city, roles, skills, preferences)</li>
          <li>Interaction data (requests, messages, references, event participation)</li>
          <li>Moderation and safety data (reports, actions, audit logs)</li>
        </ul>
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">How It Is Used</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Data is used for product functionality, abuse prevention, trust scoring inputs, and service improvements. Access is
          limited by role and policy controls where applicable.
        </p>
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Questions</h2>
        <p className="mt-3 text-sm text-slate-300">
          Privacy requests can be sent to{" "}
          <a href="mailto:privacy@conxion.app" className="text-cyan-200 hover:text-cyan-100">
            privacy@conxion.app
          </a>
          .
        </p>
      </article>
    </InfoPageShell>
  );
}

