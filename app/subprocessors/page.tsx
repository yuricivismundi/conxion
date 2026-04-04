import Link from "next/link";
import InfoPageShell from "@/components/InfoPageShell";
import { LEGAL_PROFILE } from "@/lib/legal-profile";

type SubprocessorEntry = {
  name: string;
  services: string;
  purposes: string[];
  dataCategories: string[];
  notes: string;
  website: string;
};

const LAST_UPDATED = "April 3, 2026";
const APP_NAME = LEGAL_PROFILE.brandName;
const PRIVACY_EMAIL = LEGAL_PROFILE.privacyEmail;

const SUBPROCESSORS: SubprocessorEntry[] = [
  {
    name: "Supabase",
    services: "Authentication, database, storage, realtime infrastructure",
    purposes: [
      "Create and manage member accounts",
      "Store profile, messaging, trips, hosting, event, moderation, and support records",
      "Host user-uploaded assets and product data",
    ],
    dataCategories: [
      "Account identifiers and login metadata",
      "Profile data and visibility settings",
      "Messages, requests, support, moderation, and trust records",
      "Uploaded photos, media metadata, and related storage paths",
    ],
    notes: "Primary application backend and data platform.",
    website: "https://supabase.com/subprocessors",
  },
  {
    name: "Stripe",
    services: "Payments, subscriptions, checkout, billing events",
    purposes: [
      "Process plan payments and verification purchases",
      "Manage customer, subscription, and billing lifecycle data",
      "Support payment dispute, refund, and accounting workflows",
    ],
    dataCategories: [
      "Billing identifiers",
      "Plan and subscription metadata",
      "Payment status and transaction references",
    ],
    notes: `${APP_NAME} does not intentionally store full payment-card numbers in its own application database.`,
    website: "https://stripe.com/legal/sub-processors",
  },
  {
    name: "Cloudflare Stream",
    services: "Video upload, processing, and delivery",
    purposes: [
      "Process member showcase or profile video uploads",
      `Deliver video playback through ${APP_NAME} media flows`,
    ],
    dataCategories: [
      "Uploaded video content",
      "Video asset identifiers and processing metadata",
    ],
    notes: "Used for profile-media video workflows.",
    website: "https://www.cloudflare.com/trust-hub/subprocessors/",
  },
  {
    name: "Resend",
    services: "Transactional email delivery",
    purposes: [
      "Send login, onboarding, request, billing, support, and service emails",
      "Deliver product notices and account-related communications",
    ],
    dataCategories: [
      "Email address",
      "Message delivery metadata",
      "Limited message content required for the transaction",
    ],
    notes: "Used for product email delivery where enabled in the active environment.",
    website: "https://resend.com/legal/subprocessors",
  },
];

export default function SubprocessorsPage() {
  return (
    <InfoPageShell
      title="Subprocessors"
      description={`This page lists the main third-party processors ${APP_NAME} currently uses to operate the service.`}
    >
      <article className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/80">Last Updated</p>
            <p className="mt-2 text-lg font-bold text-white">{LAST_UPDATED}</p>
            <p className="mt-3 max-w-[72ch] text-sm leading-relaxed text-cyan-50/90">
              This is a lightweight public subprocessor register for the current MVP. It is meant to help users, partners, and
              procurement teams understand which vendors may process personal data on {APP_NAME}&apos;s behalf.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/privacy"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/[0.08]"
            >
              Privacy Policy
            </Link>
            <Link
              href="/account-settings/data-requests"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-cyan-200/25 bg-black/20 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-black/30"
            >
              Privacy Rights
            </Link>
          </div>
        </div>
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">How To Read This Register</h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-300">
          <p>
            A subprocessor is a vendor that handles personal data on behalf of {APP_NAME} so the product can function. The list
            below focuses on the main processors that support account, billing, media, and email operations.
          </p>
          <p>
            If {APP_NAME} materially changes this list, the page should be updated. You can request more detail about transfers,
            safeguards, or a vendor&apos;s current role by contacting {PRIVACY_EMAIL}.
          </p>
        </div>
      </article>

      <section className="grid gap-5">
        {SUBPROCESSORS.map((entry) => (
          <article key={entry.name} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">{entry.name}</h2>
                <p className="mt-1 text-sm text-slate-400">{entry.services}</p>
              </div>
              <a
                href={entry.website}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-black/20 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-black/30 hover:text-white"
              >
                Vendor details
              </a>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-100/80">Purpose</h3>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
                  {entry.purposes.map((purpose) => (
                    <li key={purpose}>{purpose}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-100/80">Data Categories</h3>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
                  {entry.dataCategories.map((category) => (
                    <li key={category}>{category}</li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="mt-5 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-relaxed text-slate-300">
              {entry.notes}
            </p>
          </article>
        ))}
      </section>
    </InfoPageShell>
  );
}
