import Link from "next/link";
import InfoPageShell from "@/components/InfoPageShell";
import { LEGAL_PROFILE, formatPublishedPostalAddress, hasPublishedPostalAddress } from "@/lib/legal-profile";

const LAST_UPDATED = "April 3, 2026";
const APP_NAME = LEGAL_PROFILE.brandName;
const PRIVACY_EMAIL = LEGAL_PROFILE.privacyEmail;
const REQUEST_MAILTO = `mailto:${PRIVACY_EMAIL}?subject=Privacy%20rights%20request`;

const WHAT_TO_INCLUDE = [
  "Send the request from the email address linked to your account whenever possible.",
  "State clearly whether you want access, deletion, rectification, restriction, objection, portability, or another privacy action.",
  "Describe the account, feature, message thread, payment, or time period involved so the request can be located accurately.",
  "If you are asking for deletion, say whether you want account erasure or only removal of specific content.",
] as const;

const WHAT_HAPPENS_NEXT = [
  "ConXion reviews requests manually instead of offering instant in-app approval.",
  "If there are reasonable doubts about identity, additional verification can be required before data is released, exported, corrected, or erased.",
  "A response is normally sent without undue delay and within 30 days. If the request is unusually complex, the response period may be extended by up to two additional months where the GDPR allows it, with notice during the first month.",
  "Manifestly unfounded, excessive, or repetitive requests may be refused or charged where the law allows.",
] as const;

const SELF_SERVICE_OPTIONS = [
  "Profile details and many visibility choices can already be updated from your account.",
  "Deactivation is reversible and is not the same as deletion.",
  "Cookie and similar-technology choices can be managed from Cookie Settings and through your browser settings.",
] as const;

export default function DataRequestsPage() {
  return (
    <InfoPageShell
      title="Privacy Rights Requests"
      description={`Formal privacy requests for ${APP_NAME} are handled by email so identity, scope, and legal limits can be reviewed carefully before any action is taken.`}
    >
      <section className="grid gap-5 lg:grid-cols-2">
        <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <h2 className="text-xl font-bold text-white">What to include</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
            {WHAT_TO_INCLUDE.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <h2 className="text-xl font-bold text-white">What happens next</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
            {WHAT_HAPPENS_NEXT.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Before sending a formal request</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
          {SELF_SERVICE_OPTIONS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/account-settings"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-black/20 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-black/30"
          >
            Account Settings
          </Link>
          <Link
            href="/cookie-settings"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-black/20 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-black/30"
          >
            Cookie Settings
          </Link>
        </div>
      </article>

      <article className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-[72ch]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/80">Last Updated</p>
            <p className="mt-2 text-lg font-bold text-white">{LAST_UPDATED}</p>
            <p className="mt-3 text-sm leading-relaxed text-cyan-50/90">
              If you want to exercise your GDPR rights, email{" "}
              <a href={REQUEST_MAILTO} className="font-semibold text-white underline decoration-cyan-200/60 underline-offset-4">
                {PRIVACY_EMAIL}
              </a>
              . This page explains what to include and what happens next.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-cyan-50/80">
              Controller: {LEGAL_PROFILE.operatorName}, private individual based in Tallinn, Estonia
              {hasPublishedPostalAddress() ? ` • ${formatPublishedPostalAddress()}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={REQUEST_MAILTO}
              className="inline-flex min-h-10 items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#071018] hover:bg-cyan-50"
            >
              Email privacy contact
            </a>
            <Link
              href="/privacy"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/[0.08]"
            >
              Privacy Policy
            </Link>
          </div>
        </div>
      </article>
    </InfoPageShell>
  );
}
