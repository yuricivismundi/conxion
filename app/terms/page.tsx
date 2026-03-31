import Link from "next/link";
import InfoPageShell from "@/components/InfoPageShell";
import { LEGAL_PROFILE, formatPublishedPostalAddress, hasPublishedPostalAddress } from "@/lib/legal-profile";

type TermsSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

const LAST_UPDATED = "March 28, 2026";
const APP_NAME = LEGAL_PROFILE.brandName;
const OPERATOR_NAME = LEGAL_PROFILE.operatorName;
const SUPPORT_EMAIL = LEGAL_PROFILE.supportEmail;
const PRIVACY_EMAIL = LEGAL_PROFILE.privacyEmail;

const TERMS_SECTIONS: TermsSection[] = [
  {
    title: "Eligibility And Authority",
    bullets: [
      `You must be at least 18 years old to use ${APP_NAME}.`,
      "You must be legally capable of entering into binding terms.",
      `If you use ${APP_NAME} on behalf of an organizer, studio, company, collective, or other organization, you confirm that you have authority to bind that organization and that both you and the organization are responsible for activity carried out through the account.`,
    ],
  },
  {
    title: "Accounts And Accurate Information",
    bullets: [
      `You must provide accurate, current, and non-misleading information when you create an account, profile, trip, hosting offer, event, teacher pack, support ticket, or payment record on ${APP_NAME}.`,
      "You are responsible for keeping your login channels, email account, one-time codes, and magic-link access secure.",
      "You may not share your account, impersonate another person or organization, or create accounts to evade enforcement or platform limits.",
      "You are responsible for all activity carried out through your account unless you promptly report unauthorized access.",
    ],
  },
  {
    title: "What ConXion Is And Is Not",
    paragraphs: [
      `${APP_NAME} is a community platform for discovery, messaging, travel coordination, hosting requests, event participation, references, and trust or safety tools in the dance ecosystem.`,
      `${APP_NAME} is not your employer, travel agency, accommodation provider, transportation provider, insurer, booking agent, guarantor of conduct, background-check provider, or a party to offline agreements between members, hosts, travelers, teachers, organizers, studios, or other organizations.`,
    ],
  },
  {
    title: "Your Content And License To Operate The Service",
    bullets: [
      "You keep ownership of the content and personal material you submit, subject to the rights you grant in these terms.",
      `You grant ${APP_NAME} a non-exclusive, worldwide, royalty-free license to host, store, process, reproduce, format, display, distribute, back up, moderate, and otherwise use your content as needed to operate, secure, improve, and enforce the service.`,
      "This license includes using profile content, requests, references, media, support material, and related metadata inside the product, in backups, in moderation workflows, and in communications necessary to run the platform.",
      "You represent that you have the rights and permissions needed to submit the content, including where other people appear in uploads or where you disclose third-party information.",
    ],
  },
  {
    title: "Acceptable Use",
    bullets: [
      "Do not harass, threaten, stalk, abuse, exploit, extort, or discriminate against any person.",
      "Do not post unlawful, fraudulent, defamatory, sexually exploitative, hateful, violent, or misleading content.",
      "Do not scrape the service, reverse engineer protected areas, bypass access controls, evade limits, or interfere with security or anti-abuse systems.",
      "Do not send spam, mass unsolicited outreach, fake requests, manipulated references, or misleading event, hosting, or travel listings.",
      "Do not publish other people's private information, exact location details, or sensitive documents without permission and a lawful basis.",
      `Do not use ${APP_NAME} to facilitate unsafe, illegal, or deceptive offline conduct.`,
    ],
  },
  {
    title: "Offline Interactions, Travel, Hosting, Events, And Professional Services",
    paragraphs: [
      "Any offline meeting, stay, trip, event, class, booking, collaboration, or other real-world arrangement is entered into directly between the relevant users or organizations. You are solely responsible for your decisions, communications, expectations, house rules, contracts, permits, taxes, safety planning, insurance, and legal compliance for those arrangements.",
      `${APP_NAME} does not guarantee the identity, intent, conduct, availability, payment ability, professionalism, legality, or safety of any member, host, traveler, teacher, organizer, or attendee. References, trust indicators, and verification signals are informational tools only and are not a warranty or guarantee.`,
      "If an emergency exists, contact local emergency services first. In-app reporting and support tools are not emergency response services.",
    ],
  },
  {
    title: "Plans, Verification, Billing, And Paid Features",
    bullets: [
      "Starter is free. Verified is currently a one-time paid trust product. Plus is currently a recurring subscription product.",
      "Paid features, quotas, prices, and included limits can change prospectively. Updated pricing or feature descriptions apply once posted or otherwise communicated for future billing periods.",
      "Stripe and related payment providers process payment details. By making a purchase, you authorize the applicable charges, taxes, and fees for the selected plan.",
      "Unless required by law or expressly stated otherwise, payments are non-refundable once the paid entitlement or verification workflow has been provided.",
      `Recurring plans continue until cancelled. If self-service cancellation controls are not available in your account, you must contact ${APP_NAME} support before the next renewal if you do not want future billing.`,
      `${APP_NAME} may suspend or limit paid entitlements where fraud, chargeback abuse, unlawful conduct, or serious policy violations are reasonably suspected.`,
    ],
  },
  {
    title: "Moderation, Safety, And Enforcement",
    bullets: [
      `${APP_NAME} may review content, requests, reports, references, payment status, trust signals, and account behavior to investigate abuse, enforce limits, protect members, or comply with law.`,
      `${APP_NAME} may remove content, reject listings, hide media, restrict features, pause visibility, suspend accounts, block users, or terminate access when it reasonably believes there is abuse, fraud, impersonation, safety risk, legal exposure, or a policy breach.`,
      `${APP_NAME} may preserve and disclose relevant information where reasonably necessary to protect safety, prevent harm, investigate complaints, respond to legal process, or defend legal claims.`,
    ],
  },
  {
    title: "User-Initiated Deactivation And Termination",
    bullets: [
      `You may stop using ${APP_NAME} at any time.`,
      `A deactivated account is not the same as an erased account. Reactivation, deletion, and retention are handled under the ${APP_NAME} Privacy Policy and applicable law.`,
      `${APP_NAME} may suspend or terminate access immediately where continued access creates safety, fraud, legal, or platform-integrity risk.`,
      "Terms that should logically survive termination, including payment obligations already incurred, licenses, indemnities, disclaimers, liability limits, and dispute-related rights, survive termination to the extent permitted by law.",
    ],
  },
  {
    title: "Disclaimers",
    paragraphs: [
      `To the fullest extent permitted by law, ${APP_NAME} is provided on an "as is" and "as available" basis. ${APP_NAME} does not promise uninterrupted availability, error-free operation, successful matches, specific business outcomes, legal compliance by users, or that every piece of content is complete, accurate, safe, or suitable for your purpose.`,
      `${APP_NAME} disclaims warranties of merchantability, fitness for a particular purpose, title, and non-infringement to the fullest extent permitted by law.`,
    ],
  },
  {
    title: "Limitation Of Liability",
    paragraphs: [
      `To the fullest extent permitted by law, ${APP_NAME} will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for loss of profits, revenue, data, goodwill, bookings, travel costs, accommodation costs, or business opportunity arising from or related to the service, user content, member conduct, or offline arrangements.`,
      `To the fullest extent permitted by law, ${APP_NAME}'s total aggregate liability for claims arising out of or relating to the service will not exceed the greater of the amount you paid ${APP_NAME} in the 12 months before the event giving rise to the claim or EUR 100.`,
      "Nothing in these terms excludes or limits liability that cannot legally be excluded, including where mandatory law prohibits a limitation for fraud, intentional misconduct, or certain categories of personal injury or consumer harm.",
    ],
  },
  {
    title: "Indemnity",
    paragraphs: [
      `To the fullest extent permitted by law, you will defend, indemnify, and hold harmless ${APP_NAME} and its operators, personnel, contractors, and affiliates from claims, liabilities, damages, losses, and reasonable costs arising out of or related to your content, your use of the service, your violation of these terms, your infringement of another person's rights, or your offline arrangements or conduct.`,
    ],
  },
  {
    title: "Changes, Interpretation, And Contact",
    paragraphs: [
      `${APP_NAME} may update these terms from time to time. The revised version becomes effective when posted, unless a later date is stated. Continued use after the effective date means you accept the updated terms.`,
      "If any provision is held unenforceable, the remaining provisions continue to the fullest extent allowed. Mandatory consumer-protection rights and other non-waivable rights still apply.",
      `Questions about these terms can be sent through Support or by email to ${SUPPORT_EMAIL}. Privacy and data-rights issues should be directed to ${PRIVACY_EMAIL}.`,
    ],
  },
];

function TermsCard({ section }: { section: TermsSection }) {
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

export default function TermsPage() {
  return (
    <InfoPageShell
      title="Terms of Service"
      description={`These terms define who may use ${APP_NAME}, what conduct is prohibited, how paid features work, and how risk is allocated for offline interactions.`}
    >
      <article className="rounded-3xl border border-fuchsia-300/20 bg-fuchsia-300/10 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-100/80">Last Updated</p>
            <p className="mt-2 text-lg font-bold text-white">{LAST_UPDATED}</p>
            <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-fuchsia-50/90">
              These terms work together with the{" "}
              <Link href="/privacy" className="font-semibold text-white underline underline-offset-4">
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link href="/cookie-settings" className="font-semibold text-white underline underline-offset-4">
                Cookie Settings
              </Link>
              . If you use {APP_NAME}, create an account, or pay for a plan, these terms apply.
            </p>
            <p className="mt-3 max-w-[68ch] text-xs leading-relaxed text-fuchsia-50/80">
              Legal contact: {OPERATOR_NAME} • {SUPPORT_EMAIL}
              {hasPublishedPostalAddress() ? ` • ${formatPublishedPostalAddress()}` : ""}
            </p>
          </div>
          <Link
            href="/support"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/[0.08]"
          >
            Support
          </Link>
        </div>
      </article>

      {TERMS_SECTIONS.map((section) => (
        <TermsCard key={section.title} section={section} />
      ))}
    </InfoPageShell>
  );
}
