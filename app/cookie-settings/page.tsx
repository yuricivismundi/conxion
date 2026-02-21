import InfoPageShell from "@/components/InfoPageShell";

export default function CookieSettingsPage() {
  return (
    <InfoPageShell
      title="Cookie Settings"
      description="Manage how ConXion uses cookies and similar technologies for authentication, security, and product analytics."
    >
      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Categories</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
          <li>Essential cookies: required for login and core app security.</li>
          <li>Functional cookies: preferences and UX continuity.</li>
          <li>Analytics cookies: usage insights to improve product quality.</li>
        </ul>
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">MVP Note</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Granular in-app cookie toggles are planned for a later release. Current behavior follows browser/session configuration
          and essential auth/security requirements.
        </p>
      </article>
    </InfoPageShell>
  );
}

