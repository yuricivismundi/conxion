import InfoPageShell from "@/components/InfoPageShell";

export default function SupportPage() {
  return (
    <InfoPageShell
      title="Support"
      description="Need help with account access, requests, events, or moderation concerns? Start here."
    >
      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Contact</h2>
        <p className="mt-3 text-sm text-slate-300">
          Email:{" "}
          <a href="mailto:support@conxion.app" className="text-cyan-200 hover:text-cyan-100">
            support@conxion.app
          </a>
        </p>
        <p className="mt-1 text-xs text-slate-400">Target response time: 1-2 business days for standard requests.</p>
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Common Help Topics</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          <li>Connection requests and trip requests</li>
          <li>Event access (join, request invite, host inbox)</li>
          <li>Messages and blocked conversation visibility</li>
          <li>References, sync completion, and profile trust indicators</li>
          <li>Account and profile edits</li>
        </ul>
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Trust & Safety Escalation</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          For abuse, harassment, impersonation, or safety incidents, use in-app report actions where possible and include
          detailed context. This helps the moderation team process faster and maintain an auditable trail.
        </p>
      </article>
    </InfoPageShell>
  );
}

