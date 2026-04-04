import Link from "next/link";
import InfoPageShell from "@/components/InfoPageShell";
import { LEGAL_PROFILE, formatPublishedPostalAddress, hasPublishedPostalAddress } from "@/lib/legal-profile";

type PolicySection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

const LAST_UPDATED = "April 3, 2026";
const APP_NAME = LEGAL_PROFILE.brandName;
const DOMAIN = LEGAL_PROFILE.serviceDomain;
const OPERATOR_NAME = LEGAL_PROFILE.operatorName;
const PRIVACY_EMAIL = LEGAL_PROFILE.privacyEmail;

const PRIVACY_SECTIONS: PolicySection[] = [
  {
    title: "Who controls your data",
    paragraphs: [
      `${APP_NAME} is currently operated directly by ${OPERATOR_NAME}, a private individual based in Tallinn, Estonia. At the date of this policy, the service is not yet operated through a separate incorporated company.`,
      `For GDPR purposes, ${OPERATOR_NAME} acts as the controller for personal data processed through ${DOMAIN}, the app, support channels, payments, messaging, events, trips, hosting, references, and related member tools.`,
    ],
  },
  {
    title: "What personal data we collect",
    bullets: [
      "Information you provide directly, including account details, profile content, photos, videos, messages, references, support messages, and any other content you choose to submit.",
      "Activity and relationship data generated through the service, including connections, requests, trips, hosting, events, moderation actions, and safety-related reports.",
      "Billing and subscription metadata such as customer identifiers, purchase status, invoice references, and payment events. Full payment-card numbers are processed by payment providers and are not intentionally stored in the app database.",
      "Technical, device, and security information such as log data, browser details, IP-related metadata, session history, and cookie or similar-technology data used to run and protect the service.",
      "Information received from other members, vendors, or integrations when needed to operate the product, investigate abuse, or comply with legal obligations.",
    ],
  },
  {
    title: "Why we use personal data and legal bases",
    bullets: [
      `To create and run accounts, profiles, messaging, discovery, hosting, trips, events, references, and other member-facing features of ${APP_NAME}.`,
      "To process payments, manage subscriptions or verification purchases, prevent fraud, and maintain accounting, tax, and business records.",
      "To communicate with you about login, support, security, moderation, billing, product updates, and other operational matters.",
      `To review reports, enforce the Terms, investigate abuse, protect members, protect ${APP_NAME}, and comply with legal or regulatory duties.`,
      "To maintain, debug, improve, and secure the product, including internal analytics, abuse detection, and service reliability work.",
    ],
    paragraphs: [
      "Depending on the context, the legal bases relied on include performance of a contract, legitimate interests, consent, compliance with legal obligations, and the establishment, exercise, or defense of legal claims.",
    ],
  },
  {
    title: "Who can receive personal data",
    paragraphs: [
      "Some information is visible to other members or to the public by design, depending on the feature you use and the visibility settings you choose. This can include profile information, media, references, events, trips, hosting-related information, and other content you publish.",
      "Public-facing content may also be visible to search engines or other third parties that can access public pages.",
    ],
    bullets: [
      "With service providers that help operate the platform, such as hosting, storage, authentication, payments, media processing, email delivery, security, and limited analytics providers.",
      "With advisers, insurers, payment partners, regulators, law enforcement, courts, or other third parties where disclosure is necessary to comply with law, respond to claims, or protect safety and rights.",
      "With a future buyer, investor, or successor if the service is reorganized, financed, sold, or transferred, subject to applicable law.",
    ],
  },
  {
    title: "Where data is processed",
    paragraphs: [
      `${APP_NAME} and its providers may process personal data in countries other than your own, including outside the European Economic Area. When required, appropriate transfer safeguards are used, such as contractual protections recognized under applicable law.`,
      "A current overview of the main vendors that may process personal data on the service's behalf is available on the Subprocessors page.",
    ],
  },
  {
    title: "Retention and security",
    bullets: [
      `Personal data is kept for as long as reasonably necessary to operate ${APP_NAME}, protect members, enforce rules, resolve disputes, process payments, and meet legal obligations.`,
      "Deactivation is not the same as deletion. Data may still be retained after deactivation for fraud prevention, safety reviews, backups, legal claims, and compliance records.",
      "Billing, tax, fraud, and payment-related records may be retained for the periods required by law or business recordkeeping obligations.",
      "Reasonable technical and organizational security measures are used, but no system can guarantee complete security.",
    ],
  },
  {
    title: "Your rights and how to exercise them",
    paragraphs: [
      "Depending on where you live and the processing involved, you may have rights of access, rectification, erasure, restriction, objection, portability, and withdrawal of consent where consent is the basis for processing.",
      `Formal privacy requests must be sent to ${PRIVACY_EMAIL}. ${APP_NAME} does not offer instant in-app approval for these requests. To reduce misuse and protect all members, requests are handled manually and may require clarification of scope.`,
      "If there are reasonable doubts about identity, additional information may be requested before data is disclosed, exported, corrected, or erased.",
      "A response is normally sent without undue delay and within one month of receipt. If the request is complex, the response period may be extended by up to two additional months where the law allows, with notice during the first month.",
      "Where permitted by law, a request may be refused, limited, or subject to a reasonable fee if it is manifestly unfounded, excessive, repetitive, or would adversely affect other people's rights, safety investigations, fraud prevention, legal obligations, or legal claims.",
      "You also have the right to complain to the supervisory authority where you live. Because the controller is based in Estonia, you may also complain to the Estonian Data Protection Inspectorate (Andmekaitse Inspektsioon).",
    ],
  },
  {
    title: "Cookies and similar technologies",
    paragraphs: [
      `${APP_NAME} uses cookies and similar technologies for login continuity, security, preferences, and optional analytics or functionality where allowed.`,
      "You can manage browser-level settings directly on your device and can review the current product-level choices on the Cookie Settings page.",
    ],
  },
  {
    title: "Children, changes, and contact",
    bullets: [
      `${APP_NAME} is intended for adults. You must be at least 18 years old to use the service.`,
      `We may update this Privacy Policy from time to time. The latest version will be posted here with a revised date.`,
      `For privacy questions or formal privacy requests, contact ${PRIVACY_EMAIL}.`,
    ],
  },
];

function PolicyCard({ section }: { section: PolicySection }) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <h2 className="text-xl font-bold text-white">{section.title}</h2>
      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph} className="mt-3 text-sm leading-relaxed text-slate-300">
          {paragraph}
        </p>
      ))}
      {section.bullets?.length ? (
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
          {section.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export default function PrivacyPage() {
  return (
    <InfoPageShell
      title="Privacy Policy"
      description={`This policy explains who controls personal data for ${APP_NAME}, what information is processed, why it is used, when it may be shared, and how privacy rights can be exercised.`}
    >
      <article className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/80">Last Updated</p>
        <p className="mt-2 text-lg font-bold text-white">{LAST_UPDATED}</p>
        <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-cyan-50/90">
          This policy follows a controller-first structure: who operates the service, what data is processed, how rights requests
          are handled, and where to contact the operator directly.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-cyan-50/80">
          Contact: {OPERATOR_NAME} • {PRIVACY_EMAIL}
          {hasPublishedPostalAddress() ? ` • ${formatPublishedPostalAddress()}` : ""}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/account-settings/data-requests"
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#071018] hover:bg-cyan-50"
          >
            Privacy Rights Requests
          </Link>
          <Link
            href="/cookie-settings"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/[0.08]"
          >
            Cookie Settings
          </Link>
          <Link
            href="/subprocessors"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/[0.08]"
          >
            Subprocessors
          </Link>
        </div>
      </article>

      {PRIVACY_SECTIONS.map((section) => (
        <PolicyCard key={section.title} section={section} />
      ))}
    </InfoPageShell>
  );
}
