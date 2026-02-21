import InfoPageShell from "@/components/InfoPageShell";

export default function AboutPage() {
  return (
    <InfoPageShell
      title="About ConXion"
      description="ConXion is a trust-first dance networking platform built to help members discover people, trips, events, and sync opportunities with stronger reputation and safety controls."
    >
      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Our Mission</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          We connect dancers through meaningful intent: practice, travel, collaboration, and events. ConXion is designed to
          reduce noise and improve trust with clear request flows, references, moderation, and accountability.
        </p>
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">What Makes It Different</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          <li>Connection and trip request workflows that prioritize consent and relevance.</li>
          <li>Trust mechanics: references, sync confirmations, and visibility controls.</li>
          <li>Event participation models for both public and private access.</li>
          <li>Admin moderation and auditability for safer community operations.</li>
        </ul>
      </article>
    </InfoPageShell>
  );
}

