import Link from "next/link";
import InfoPageShell from "@/components/InfoPageShell";
import { LEGAL_PROFILE, formatPublishedPostalAddress, hasPublishedPostalAddress } from "@/lib/legal-profile";

type PolicySection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

const LAST_UPDATED = "March 28, 2026";
const APP_NAME = LEGAL_PROFILE.brandName;
const DOMAIN = LEGAL_PROFILE.serviceDomain;
const OPERATOR_NAME = LEGAL_PROFILE.operatorName;
const PRIVACY_EMAIL = LEGAL_PROFILE.privacyEmail;

const PRIVACY_SECTIONS: PolicySection[] = [
  {
    title: "Who We Are And Scope",
    paragraphs: [
      `This notice applies to ${APP_NAME}, the operator of ${DOMAIN}, and covers the web app, member discovery, messaging, trips, hosting, events, references, support, billing, moderation, and related community workflows.`,
      `If you need controller or representative details for a regulator, business partner, or formal data request, contact ${PRIVACY_EMAIL} and we will provide the appropriate details that apply to your use of the service.`,
    ],
  },
  {
    title: "Data We Collect And Receive",
    bullets: [
      "Account and authentication data, such as your email address, account identifier, login events, recovery actions, and account status metadata.",
      "Profile and trust data, such as your display name, username, city, country, nationality, roles, dance styles, skills, languages, interests, availability, hosting preferences, verification status, and public or private profile fields.",
      "Community interaction data, such as connection requests, messages, activities, trips, hosting requests or offers, event participation, service inquiries, references, and related thread metadata.",
      "Media and attachment data, such as profile photos, showcase videos, teacher-info attachments, and files you choose to submit in support or careers flows.",
      "Safety, moderation, and support data, such as reports, blocks, moderation logs, dispute history, support tickets, and internal review notes.",
      `Billing and transaction data, such as plan status, verification or subscription metadata, Stripe checkout/session identifiers, customer identifiers, and renewal state. ${APP_NAME} does not intentionally store full payment-card numbers.`,
      "Technical and device data, such as browser-stored preferences, cookie choices, security logs, rate-limit data, device or browser details, and IP-derived anti-abuse signals where needed to secure the service.",
    ],
  },
  {
    title: "Where Data Comes From",
    bullets: [
      "Directly from you when you create an account, build a profile, upload media, send messages, open trips, request hosting, join events, submit references, or contact support.",
      "From other members when they message you, send requests, leave references, report conduct, invite you into event or travel flows, or otherwise interact with you through the product.",
      `From service providers and processors that support ${APP_NAME}, including authentication, storage, video processing, payment, email delivery, and infrastructure providers.`,
      "From your browser or device when you use the app, including cookie and similar-technology preferences, local continuity signals, and security or fraud-prevention indicators.",
    ],
  },
  {
    title: "Why We Use Personal Data And The Main Legal Bases",
    bullets: [
      "To create and run your account, profile, and member tools: contract necessity.",
      "To power discovery, connections, messaging, trips, hosting, events, references, and other member-requested workflows: contract necessity.",
      "To verify payments, apply plan entitlements, keep accounting records, and handle billing issues: contract necessity and legal obligations.",
      `To moderate the community, prevent abuse, investigate fraud, enforce limits, secure the platform, handle disputes, and protect members, ${APP_NAME}, and third parties: legitimate interests and, where relevant, legal obligations or vital interests.`,
      "To send transactional notices such as login links, security alerts, billing notices, support updates, and important service changes: contract necessity and legitimate interests.",
      "To remember optional preferences and, where enabled, run non-essential analytics or similar technologies: consent where required.",
      `To review job applications or similar inbound business submissions: steps at your request before entering a contract and ${APP_NAME}'s legitimate interests in recruiting and operating the business.`,
    ],
  },
  {
    title: "Visibility And Recipients",
    paragraphs: [
      "Some information is public or member-visible by design. For example, profile details, profile media, reference content, trip information, event listings, hosting availability, and selected trust signals may be shown to other users or, where the feature is public, to visitors.",
      "Private request notes, support material, moderation information, billing metadata, and internal risk signals are not intended to be public. Exact event addresses and certain sensitive workflow details may also be limited until login, approval, or another relevant product gate is met.",
    ],
    bullets: [
      "Other members and visitors, according to your visibility settings and the feature you use.",
      `${APP_NAME} personnel, moderators, contractors, or professional advisers who need access for support, trust and safety, operations, billing, security, or legal review.`,
      `Service providers that process data for ${APP_NAME}, including Supabase for authentication, database, and storage; Stripe for payments and subscription processing; Cloudflare Stream for video processing and delivery; Resend or equivalent email providers for transactional email; and mapping or content providers such as OpenStreetMap or Unsplash when those features are used.`,
      "Regulators, courts, law enforcement, insurers, counterparties, or other third parties where disclosure is required by law or reasonably necessary to establish, exercise, or defend legal claims or protect safety.",
    ],
  },
  {
    title: "International Transfers",
    paragraphs: [
      `Some ${APP_NAME} providers may process personal data outside your country, including outside the EEA or UK. When that happens, ${APP_NAME} aims to rely on lawful transfer mechanisms such as adequacy decisions, standard contractual clauses, contractual safeguards, or other recognized protective measures where required.`,
      `You can request more information about relevant transfer safeguards by contacting ${PRIVACY_EMAIL}.`,
    ],
  },
  {
    title: "Retention",
    bullets: [
      `Account, profile, and trust data are generally kept while your account is active and for a reasonable period afterwards so ${APP_NAME} can operate the service, handle reactivation, enforce rules, and respond to disputes or legal obligations.`,
      "Deactivation is not deletion. A deactivated account can be reactivated by signing in again unless or until a separate erasure or deletion request is completed.",
      "Messages, requests, trips, hosting records, event participation, references, support tickets, and moderation material may be retained as long as needed for the relevant member relationship, product integrity, fraud prevention, support handling, safety enforcement, or legal claims.",
      "Billing, tax, and payment-related records are retained for the periods required by accounting, tax, anti-fraud, and financial-reporting obligations.",
      `Media and attachments are generally kept until you remove them, replace them, close your account, or ${APP_NAME} no longer needs them, subject to backups, logs, and legal or safety holds.`,
      `Cookie or similar-technology preferences stored by ${APP_NAME} on your browser are currently set for up to 12 months unless you change or clear them sooner.`,
      "Careers submissions are typically kept for up to 12 months unless a longer period is required by law, needed to resolve a dispute, or separately agreed with the applicant.",
    ],
  },
  {
    title: "Your Rights",
    paragraphs: [
      "Depending on the law that applies to you, you may have rights to access, correct, delete, restrict, object to, or port your personal data, and to withdraw consent where processing depends on consent.",
      `You also have the right to complain to the supervisory authority that covers your place of residence, work, or the alleged infringement. ${APP_NAME} may need to verify your identity before completing certain requests, and some requests may be limited where the law permits, including to protect other people, safety investigations, legal claims, or platform security.`,
    ],
    bullets: [
      `Use Privacy Requests in your account when signed in, or email ${PRIVACY_EMAIL} for privacy, access, deletion, objection, or portability requests.`,
      "If you are signed in, you can also use the Privacy Requests area for formal request tracking and record-keeping.",
      "Cookie and similar-technology choices can be updated at any time in Cookie Settings.",
    ],
  },
  {
    title: "Automated Signals, Safety Checks, And Human Review",
    paragraphs: [
      `${APP_NAME} uses automated rules and system signals for things like plan limits, spam prevention, anti-abuse checks, duplicate detection, ranking, visibility logic, and certain safety or trust workflows.`,
      `${APP_NAME} does not intend to rely on solely automated decision-making that produces legal or similarly significant effects where Article 22 would restrict that use. Where automated flags or risk signals affect moderation or access review, support or moderation escalation can involve human assessment.`,
    ],
  },
  {
    title: "Children, Security, And Sensitive Data",
    bullets: [
      `${APP_NAME} is intended for adults only. You must be at least 18 years old to use the service.`,
      `If ${APP_NAME} learns that personal data was collected from someone under 18 in breach of the rules, ${APP_NAME} may deactivate the account and remove the data where appropriate.`,
      `${APP_NAME} uses technical and organizational security measures designed to reduce unauthorized access, misuse, loss, or alteration of personal data, but no system can guarantee absolute security.`,
      "Do not upload sensitive personal data about yourself or others unless it is genuinely necessary and you have a lawful basis to share it. Do not share third-party personal data, private documents, or exact address details unless the relevant workflow requires it and you are entitled to disclose it.",
    ],
  },
  {
    title: "Cookies, Changes, And Contact",
    paragraphs: [
      `${APP_NAME} uses cookies and similar technologies for security, continuity, preference storage, and optional analytics. Non-essential technologies should only be used with the level of consent required by applicable law. You can review current categories in Cookie Settings.`,
      `${APP_NAME} may update this notice from time to time. Material updates should be reflected in-product with a revised date. For privacy questions, data rights requests, or regulator-facing correspondence, email ${PRIVACY_EMAIL}.`,
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
      description={`This notice explains what personal data ${APP_NAME} uses, why it is used, who can receive it, how long it is kept, and which privacy rights are available.`}
    >
      <article className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/80">Last Updated</p>
            <p className="mt-2 text-lg font-bold text-white">{LAST_UPDATED}</p>
            <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-cyan-50/90">
              {APP_NAME} is a trust-first community platform. That means the product relies on identity, reputation, messaging,
              moderation, payment, and safety signals. This notice is meant to make those flows more explicit.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-cyan-50/80">
              Controller contact: {OPERATOR_NAME} • {PRIVACY_EMAIL}
              {hasPublishedPostalAddress() ? ` • ${formatPublishedPostalAddress()}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/account-settings/data-requests"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/[0.08]"
            >
              Open Privacy Requests
            </Link>
            <Link
              href="/subprocessors"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/[0.08]"
            >
              Subprocessors
            </Link>
            <Link
              href="/cookie-settings"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-cyan-200/25 bg-black/20 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-black/30"
            >
              Cookie Settings
            </Link>
            <Link
              href="/support/articles/privacy-rights-data-requests"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/[0.08]"
            >
              Data Requests Help
            </Link>
          </div>
        </div>
      </article>

      {PRIVACY_SECTIONS.map((section) => (
        <PolicyCard key={section.title} section={section} />
      ))}
    </InfoPageShell>
  );
}
