import Link from "next/link";
import InfoPageShell from "@/components/InfoPageShell";

type Section = {
  id: string;
  title: string;
  icon: string;
  body: string;
  bullets: string[];
};

const SECTIONS: Section[] = [
  {
    id: "community-guidelines",
    title: "Community guidelines",
    icon: "groups",
    body: "ConXion is a trust-first network. Every interaction should protect consent, respect, and inclusion.",
    bullets: [
      "Respect boundaries in chat, hosting, trips, events, and syncs.",
      "No harassment, hate speech, coercion, threats, or impersonation.",
      "No scams, spam, or off-platform abuse attempts.",
      "Keep profile and request information accurate.",
    ],
  },
  {
    id: "hosting-safety",
    title: "Hosting safety",
    icon: "home_work",
    body: "Hosting and staying are real-world trust flows. Use clear expectations and confirm details inside ConXion.",
    bullets: [
      "Review references and verification indicators before confirming.",
      "Use request metadata (dates, travelers, flexibility) to align expectations.",
      "For first-time stays, prioritize public meetup handoff and clear check-in rules.",
      "Decline requests that feel inconsistent, incomplete, or unsafe.",
    ],
  },
  {
    id: "reporting-blocking",
    title: "Reporting & Blocking",
    icon: "shield",
    body: "You can report or block directly from conversation and connection flows. Reports are reviewed by moderation with audit context.",
    bullets: [
      "Use Report for abuse, threats, scams, impersonation, or policy violations.",
      "Use Block to stop interaction and archive the thread from your inbox.",
      "Include concise context to speed moderation review.",
      "In immediate danger, contact local emergency services first.",
    ],
  },
  {
    id: "references-trust",
    title: "References & Trust",
    icon: "stars",
    body: "References help members evaluate reliability across hosting, trips, events, and syncs.",
    bullets: [
      "References should be factual, specific, and respectful.",
      "Quality references improve network trust and safer matching.",
      "Trust indicators are signals, not guarantees of outcomes.",
      "Report suspicious reference behavior through Support.",
    ],
  },
  {
    id: "account-security",
    title: "Account security",
    icon: "lock",
    body: "Protect your account access and personal data with strong operational hygiene.",
    bullets: [
      "Use verified login channels only and never share one-time codes.",
      "Review account settings and suspicious activity regularly.",
      "Limit sensitive details in free text fields and chat when unnecessary.",
      "If access is lost, use recovery flow and contact Support.",
    ],
  },
  {
    id: "platform-responsibility-disclaimer",
    title: "Platform responsibility disclaimer",
    icon: "verified_user",
    body: "ConXion provides trust tooling, moderation, and structured request workflows, but cannot guarantee real-world outcomes.",
    bullets: [
      "Members remain responsible for personal decisions and in-person safety.",
      "Moderation actions are based on available evidence and policy scope.",
      "Verification and references reduce risk but do not eliminate risk.",
      "Urgent legal or emergency incidents must use local authorities first.",
    ],
  },
];

export default function SafetyCenterPage() {
  return (
    <InfoPageShell
      title="Safety Center"
      description="Trust, safety, hosting guidance, reporting behavior, and platform responsibility in one place."
    >
      <section className="overflow-hidden rounded-3xl border border-cyan-300/25 bg-[linear-gradient(135deg,rgba(13,242,242,0.12),rgba(219,39,119,0.12),rgba(255,255,255,0.03))] p-5 sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100/90">ConXion Trust Infrastructure</p>
        <h2 className="mt-2 text-2xl font-black text-white sm:text-3xl">Built for Real-World Dance Interactions</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-200/90">
          ConXion combines reputation, structured requests, messaging safeguards, references, and moderation tooling. Review these
          standards before using hosting, trips, or sync flows.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/support"
            className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
          >
            Contact Support
          </Link>
          <Link
            href="/my-space/account"
            className="rounded-lg border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-semibold text-white/85 hover:border-white/35 hover:text-white"
          >
            Open Account Tools
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((section) => (
          <article
            key={section.id}
            id={section.id}
            className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-100">
                <span className="material-symbols-outlined text-[19px]">{section.icon}</span>
              </span>
              <h3 className="text-lg font-bold text-white">{section.title}</h3>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">{section.body}</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-300">
              {section.bullets.map((bullet) => (
                <li key={`${section.id}-${bullet}`}>{bullet}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="rounded-3xl border border-fuchsia-300/30 bg-fuchsia-500/10 p-5 sm:p-6">
        <h2 className="text-lg font-bold text-fuchsia-100">Urgent Safety Note</h2>
        <p className="mt-2 text-sm leading-relaxed text-fuchsia-100/90">
          If you are in immediate danger, contact local emergency services first. In-app reporting is for moderation handling and
          cannot replace emergency response.
        </p>
      </section>
    </InfoPageShell>
  );
}

