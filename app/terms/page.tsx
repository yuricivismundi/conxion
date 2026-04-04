import InfoPageShell from "@/components/InfoPageShell";
import { LEGAL_PROFILE, formatPublishedPostalAddress, hasPublishedPostalAddress } from "@/lib/legal-profile";

type TermsSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

const LAST_UPDATED = "April 3, 2026";
const APP_NAME = LEGAL_PROFILE.brandName;
const OPERATOR_NAME = LEGAL_PROFILE.operatorName;
const SUPPORT_EMAIL = LEGAL_PROFILE.supportEmail;
const PRIVACY_EMAIL = LEGAL_PROFILE.privacyEmail;

const TERMS_SECTIONS: TermsSection[] = [
  {
    title: "Operator, Acceptance, Eligibility, And Accounts",
    paragraphs: [
      `${APP_NAME} is currently operated directly by ${OPERATOR_NAME}, a private individual based in Tallinn, Estonia. At the date of these Terms, the service is not yet operated through a separate incorporated company.`,
      `By creating an account or using ${APP_NAME}, you agree to these Terms.`,
    ],
    bullets: [
      `You must be at least 18 years old and legally able to agree to these Terms.`,
      "You must provide accurate information and keep your account credentials secure.",
      "You are responsible for activity that happens through your account unless you promptly report unauthorized access.",
      `If you use ${APP_NAME} for an organization or business, you confirm that you are authorized to bind that organization or business to these Terms.`,
    ],
  },
  {
    title: "Nature of the service",
    paragraphs: [
      `${APP_NAME} is an online community platform that helps members discover one another, communicate, and arrange trips, hosting, events, references, and similar activities.`,
      `${APP_NAME} is not a travel agency, accommodation provider, event organizer, insurer, employer, background-check service, payment guarantor, or party to any agreement, dispute, interaction, or transaction between members or third parties.`,
      "All offline meetings, stays, events, classes, services, and other real-world arrangements are made directly between the people involved. You are solely responsible for your own decisions, communications, safety, and conduct.",
    ],
  },
  {
    title: "Member content",
    bullets: [
      "You keep ownership of the content you submit, but you grant us a non-exclusive, worldwide, royalty-free license to host, store, reproduce, display, distribute, moderate, and otherwise use that content as needed to operate, secure, and improve the service.",
      "You represent that you have the rights and permissions needed to post the content you submit, including where it includes third-party information, images, or other material.",
      "You are solely responsible for the content you post and the consequences of posting it.",
    ],
  },
  {
    title: "Rules of conduct",
    bullets: [
      "Do not harass, threaten, stalk, exploit, extort, or discriminate against anyone.",
      "Do not post unlawful, fraudulent, misleading, defamatory, sexually exploitative, violent, or hateful content.",
      "Do not impersonate another person or organization, evade enforcement, or create accounts to bypass restrictions.",
      "Do not scrape the service, reverse engineer protected areas, bypass security, disrupt the service, or interfere with other users.",
      "Do not publish other people's private information without permission and a lawful basis.",
      `Do not use ${APP_NAME} for spam, mass unsolicited outreach, or commercial use that we have not authorized.`,
      `Do not use ${APP_NAME} to facilitate illegal, deceptive, or unsafe offline conduct.`,
    ],
  },
  {
    title: "Paid features",
    bullets: [
      "Starter is free. Verified and Plus are paid features, and we may change pricing, features, quotas, and limits prospectively.",
      "Payments are processed by third-party payment providers. By purchasing a paid feature, you authorize the applicable charges, taxes, and fees.",
      "Recurring subscriptions continue until cancelled. If self-service cancellation is not available, you must contact support before the next renewal.",
      `Except where required by law, payments are non-refundable once the paid feature, verification, or subscription access has been provided.`,
      `We may suspend, limit, or revoke paid features where we reasonably suspect fraud, abuse, chargeback misuse, or a serious violation of these Terms.`,
    ],
  },
  {
    title: "Moderation, Suspension, And Termination",
    bullets: [
      `We may review content, reports, requests, references, payment status, and account behavior to enforce these Terms, investigate abuse, protect members, and protect ${APP_NAME}.`,
      "We may remove content, restrict features, suspend accounts, or terminate access at our discretion where we believe there is fraud, abuse, impersonation, safety risk, legal exposure, or a violation of these Terms.",
      `We may preserve and disclose information where reasonably necessary to comply with law, enforce our rights, investigate complaints, respond to legal process, or protect safety.`,
      "You may stop using the service at any time, but provisions that by their nature should survive termination will survive.",
    ],
  },
  {
    title: "Disclaimers",
    paragraphs: [
      `To the fullest extent permitted by law, ${APP_NAME} is provided "as is" and "as available." We do not guarantee uninterrupted availability, successful matches, specific outcomes, member conduct, member identity, legality, safety, or the accuracy or suitability of content.`,
      "Verification, references, profile information, badges, and trust signals are informational only. They are not a warranty, guarantee, endorsement, or certification of any person or arrangement.",
      "If you have an emergency, contact local emergency services. In-app support and reporting tools are not emergency services.",
    ],
  },
  {
    title: "Limitation of liability",
    paragraphs: [
      `To the fullest extent permitted by law, ${APP_NAME} and its operators, contractors, and affiliates will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for loss of profits, revenue, data, goodwill, travel costs, accommodation costs, bookings, or business opportunity arising out of or related to the service, member conduct, content, or offline arrangements.`,
      `To the fullest extent permitted by law, ${APP_NAME}'s total aggregate liability for any claim arising out of or related to the service will not exceed the greater of the amount you paid us in the 12 months before the event giving rise to the claim or EUR 100.`,
      "Nothing in these Terms limits liability that cannot legally be limited or excluded.",
    ],
  },
  {
    title: "Indemnity",
    paragraphs: [
      `To the fullest extent permitted by law, you will defend, indemnify, and hold harmless ${APP_NAME}, its operators, contractors, and affiliates from claims, liabilities, losses, damages, and reasonable costs arising out of or related to your content, your use of the service, your violation of these Terms, your violation of another person's rights, or your offline conduct or arrangements.`,
    ],
  },
  {
    title: "Changes and contact",
    paragraphs: [
      `We may modify, suspend, or discontinue any part of ${APP_NAME} at any time.`,
      "We may update these Terms from time to time by posting a revised version with a new effective date. Continued use after the effective date means you accept the revised Terms.",
      "If the operator changes from an individual to a company or other legal entity, these Terms will be updated to reflect that change.",
      `Questions about these Terms can be sent to ${SUPPORT_EMAIL}. Privacy matters should be sent to ${PRIVACY_EMAIL}.`,
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
      description={`These Terms explain who may use ${APP_NAME}, the rules for using it, and how risk is allocated for member interactions and paid features.`}
    >
      <article className="rounded-3xl border border-fuchsia-300/20 bg-fuchsia-300/10 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-100/80">Last Updated</p>
        <p className="mt-2 text-lg font-bold text-white">{LAST_UPDATED}</p>
        <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-fuchsia-50/90">
          These Terms are written for a member-to-member platform model operated from Estonia. They are intended to protect{" "}
          {APP_NAME} as the operator of the service while making clear that offline arrangements remain the responsibility of the
          people involved.
        </p>
        <p className="mt-3 max-w-[68ch] text-xs leading-relaxed text-fuchsia-50/80">
          Contact: {OPERATOR_NAME} • {SUPPORT_EMAIL}
          {hasPublishedPostalAddress() ? ` • ${formatPublishedPostalAddress()}` : ""}
        </p>
      </article>

      {TERMS_SECTIONS.map((section) => (
        <TermsCard key={section.title} section={section} />
      ))}
    </InfoPageShell>
  );
}
