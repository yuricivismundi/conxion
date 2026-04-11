import { LEGAL_PROFILE } from "@/lib/legal-profile";

export type HelpArticle = {
  slug: string;
  title: string;
  summary: string;
  category: HelpCategoryKey;
  updatedAt: string;
  body: string[];
  related: string[];
};

export type HelpCategoryKey =
  | "using-conxion"
  | "activities"
  | "billing-plans"
  | "trust-safety"
  | "references"
  | "trips-hosting"
  | "account-access";

export type HelpCategory = {
  key: HelpCategoryKey;
  title: string;
  description: string;
  icon: string;
  accent: string;
};

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    key: "using-conxion",
    title: "Using ConXion",
    description: "Connections, messages, activities, and how trust flows through the app.",
    icon: "hub",
    accent: "cyan",
  },
  {
    key: "activities",
    title: "Activities",
    description: "Activity types, completion rules, interaction counts, and when references are allowed.",
    icon: "event_note",
    accent: "cyan",
  },
  {
    key: "billing-plans",
    title: "Plans & Upgrades",
    description: "Starter, Verified, Plus, and which access rules apply to travel, hosting, and growth.",
    icon: "workspace_premium",
    accent: "fuchsia",
  },
  {
    key: "trust-safety",
    title: "Trust & Safety",
    description: "Blocking, reporting, emergencies, and what moderation can act on.",
    icon: "verified_user",
    accent: "fuchsia",
  },
  {
    key: "references",
    title: "References",
    description: "How references work, when they unlock, and how disputes are handled.",
    icon: "workspace_premium",
    accent: "slate",
  },
  {
    key: "trips-hosting",
    title: "Trips & Hosting",
    description: "Join trip, offer hosting, and safer coordination in travel flows.",
    icon: "travel_explore",
    accent: "cyan",
  },
  {
    key: "account-access",
    title: "Account & Access",
    description: "Login, recovery, profile access, and support ticket tracking.",
    icon: "manage_accounts",
    accent: "slate",
  },
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "activities-and-reference-rules-by-category",
    title: "How do activity categories and reference rules work?",
    summary: "Each activity category has its own anti-spam rule. Some use cooldowns per pair, while others allow one reference per completed activity.",
    category: "activities",
    updatedAt: "2026-04-09",
    body: [
      "ConXion separates completed interactions from written references. That means repeated real experiences can still count on a profile without letting the same pair farm trust with repeated written references.",
      "Practice and Social Dance: these two share one anti-spam family. Between the same two members, they can only generate one new reference every 120 days.",
      "Example: if you leave a Practice reference today, you cannot leave a Social Dance reference for the same member tomorrow. The 120-day cooldown applies across both.",
      "Classes: this is the reference category used for Private Class. Between the same two members, Classes can only generate one new reference every 90 days.",
      "Event / Festival: one reference is allowed per completed activity. The same completed event cannot create duplicate references from the same author to the same recipient.",
      "Collaborate: one reference is allowed per completed activity. The same collaboration source cannot be used twice by the same author for the same recipient.",
      "Travelling: one reference is allowed per completed trip activity.",
      "Request Hosting: one reference is allowed per completed hosting activity from the guest perspective.",
      "Offer Hosting: one reference is allowed per completed hosting activity from the host perspective.",
      "Completion rule: references are only allowed after the activity is completed. Pending, invited, accepted-only, cancelled, or expired interactions do not qualify.",
      "Public profile rule: profiles limit visible references per member by default. The latest visible reference from that member is shown first, while older ones are collapsed so one person cannot dominate another member's trust section.",
      "Interaction counts: profile trust also shows interaction counts separately. This helps members understand whether someone has practiced, travelled, hosted, attended events, collaborated, or taught multiple times without turning every repeated interaction into another public written reference.",
    ],
    related: ["how-connections-and-activities-work", "how-references-are-unlocked", "reference-guidelines-and-disputes"],
  },
  {
    slug: "how-starter-verified-and-plus-work",
    title: "How do Starter, Verified, and Plus work?",
    summary: "Starter is free, Verified is one-time, and Plus is monthly. They solve different needs and can complement each other.",
    category: "billing-plans",
    updatedAt: "2026-03-28",
    body: [
      "Starter is the free entry plan. It lets you discover social dancers, teachers, organizers, DJs, and artists, send 10 connection requests per month with up to 30 in your first month, keep 10 active chat threads, send 5 hosting offers per month, create 1 trip per month, create 2 public/request events or private groups per month, offer hosting, and use Dance Tools.",
      "Verified is a one-time trust upgrade. It is not a subscription and it does not replace Plus. Verified is for requesting hosting, getting hosted with more confidence, unlocking teacher or artist access, and opening service inquiries.",
      "Plus is the monthly visibility and usage plan. It raises your account to 30 connection requests per month, 30 active chat threads, 10 hosting offers per month, 5 trips per month, 5 events per month, and 3 profile photos while keeping 2 showcase videos. Verified and Plus stay separate products because one is trust access and the other is recurring growth access.",
    ],
    related: ["when-do-i-need-verification-for-hosting", "how-references-are-unlocked"],
  },
  {
    slug: "how-connections-and-activities-work",
    title: "How do connections, chat, and activities work together?",
    summary: "Accepted relationships unlock the thread, and activities are created from that thread over time.",
    category: "using-conxion",
    updatedAt: "2026-04-08",
    body: [
      "Connection requests are the relationship unlock, not the trust event itself. Once a connection is accepted, the same member thread becomes the place where future interactions continue.",
      "Activities such as Practice, Social Dance, Event / Festival, Travelling, Hosting, Private Class, or Collaborate are then started from that accepted thread. Each accepted activity is logged inside the thread history so the relationship timeline remains visible when you scroll.",
      "To keep trust signals clean, the same two members can only log up to 2 accepted activities per month, and those activities must be different types.",
      "References do not come from connection acceptance alone. They become eligible after an activity is accepted by both sides, then unlock 24 hours after the activity ends or 24 hours after acceptance if there is no date range.",
      "Practice and Social Dance share one reference cooldown. Between the same two members, they can only generate one new reference every 120 days. Private Class uses the Classes reference category and can generate one new reference every 90 days.",
      "Travelling, Request Hosting, Offer Hosting, Event / Festival, and Collaborate can each generate one reference per completed activity.",
      "Interaction counts are tracked separately from written references, so repeated real experiences can still show on the profile without inflating public trust with duplicate references.",
      "Once a reference unlocks, each member has 10 days to submit it. Pending references live in your Profile > References area, with a direct link back into the chat if you need to check context before writing.",
    ],
    related: ["how-references-are-unlocked", "how-to-report-a-member-or-reference"],
  },
  {
    slug: "how-to-report-a-member-or-reference",
    title: "How do I report a member or a reference?",
    summary: "Use the in-app report actions so moderation gets the correct context, ticket code, and audit trail.",
    category: "trust-safety",
    updatedAt: "2026-03-22",
    body: [
      "Use Report directly inside the relevant flow whenever possible. For references, use the menu on the reference card. For member-to-member issues, use report actions in the conversation or relationship context where the issue happened.",
      "Every submitted report creates a support ticket code. That code is shown in your Support page and in the moderation console, so case handling stays consistent.",
      "If there is immediate danger, contact local emergency services first. In-app reporting is for moderation handling and cannot replace emergency response.",
    ],
    related: ["what-happens-after-i-submit-a-support-ticket", "reference-guidelines-and-disputes"],
  },
  {
    slug: "reference-guidelines-and-disputes",
    title: "What are the reference guidelines and how do disputes work?",
    summary: "References should be factual, specific, and tied to completed activities or an established relationship context.",
    category: "references",
    updatedAt: "2026-04-08",
    body: [
      "References are meant to document reliability, communication, respect, and trust in real interactions. They should stay specific, factual, and calm.",
      "Practice and Social Dance can only generate one new reference between the same two members every 120 days. Private Class uses the Classes category and can only generate one new reference between the same two members every 90 days.",
      "Travelling, Request Hosting, Offer Hosting, Event / Festival, and Collaborate can generate one reference per completed activity.",
      "ConXion also limits repeated activity logging between the same two members. In one month, the same pair can only create up to 2 accepted activities, and they must be different types.",
      "Interaction counts are tracked separately from written references. That means real repeated experiences can still appear on a profile without letting one pair farm trust with repeated references.",
      "Public profiles only show a limited visible set from each member by default, so one person cannot dominate another member's trust section with repeated posts.",
      "References use a sealed flow. If both members submit, both references are posted to profiles at the same time. If only one member submits, that reference posts automatically 10 days after it was written.",
      "If a reference violates guidelines, use the report flow. Moderation can review, dismiss, or act on the case, but references are not meant to be removed casually from the trust record.",
    ],
    related: ["how-references-are-unlocked", "how-to-report-a-member-or-reference"],
  },
  {
    slug: "how-references-are-unlocked",
    title: "When can I leave a reference?",
    summary: "References unlock after accepted activities, not just after chat starts.",
    category: "references",
    updatedAt: "2026-04-08",
    body: [
      "References become eligible only after an activity is completed. Examples include Practice, Social Dance, Event / Festival, Travelling, Hosting, Private Class, and Collaborate.",
      "If an activity has an end date, the reference prompt unlocks 24 hours after that end date. If the activity has no date range, the prompt unlocks 24 hours after acceptance.",
      "Repeated activity spam is limited. The same pair can only have up to 2 accepted activities in the same month, and they must be different activity types.",
      "Practice and Social Dance share one anti-spam family, so leaving one blocks another Practice or Social Dance reference with the same member for 120 days. Private Class uses the Classes family and blocks another Classes reference with the same member for 90 days.",
      "Travelling, Request Hosting, Offer Hosting, Event / Festival, and Collaborate do not use the long cooldown. Instead, each completed activity can generate one reference.",
      "After a prompt unlocks, you have 10 days to write the reference. Once that window expires, the prompt closes and you cannot submit it later.",
      "Pending references appear in your Profile > References area. You can open the related chat from there if you want to check the conversation before writing.",
      "Once you've both submitted references, they are posted to your profiles at the same time. If only one of you submits, that reference is posted 10 days after it was written.",
      "This keeps trust meaningful while still allowing a clean history of completed activities inside the thread.",
    ],
    related: ["reference-guidelines-and-disputes", "how-starter-verified-and-plus-work"],
  },
  {
    slug: "when-do-i-need-verification-for-hosting",
    title: "When do I need verification for hosting?",
    summary: "You can offer hosting on Starter. Verified is required when you want to request hosting for yourself.",
    category: "trips-hosting",
    updatedAt: "2026-03-27",
    body: [
      "You can offer hosting on Starter, and that stays available if you simply want to host dancers visiting your city or destination.",
      "Verified is required when you want to request a hosting stay for yourself. It also helps others feel more confident hosting you for festivals, competitions, dance holidays, and other travel plans.",
      "Use the in-app hosting request flow so dates, traveler count, and acceptance history stay attached to the thread. That also keeps the future reference flow tied to the right activity context.",
    ],
    related: ["travel-and-hosting-safety-basics", "how-starter-verified-and-plus-work"],
  },
  {
    slug: "travel-and-hosting-safety-basics",
    title: "What are the basics for safer trips and hosting?",
    summary: "Use references, clear expectations, and in-app request flows before committing to real-world travel or stays.",
    category: "trips-hosting",
    updatedAt: "2026-03-27",
    body: [
      "Use Join Trip and Offer to Host inside ConXion so the full request context stays attached to the thread. That gives both members a record of dates, capacity, and acceptance history.",
      "Offering hosting can stay on Starter. If you want to request hosting for yourself, use Verified first so the trust layer is in place before you ask someone to host you.",
      "Before confirming a stay, review references, trust indicators, and profile details. Clarify arrival timing, number of travelers, and any house expectations.",
      "If something feels inconsistent, incomplete, or unsafe, decline the request and report the issue if needed.",
    ],
    related: ["when-do-i-need-verification-for-hosting", "what-happens-after-i-submit-a-support-ticket"],
  },
  {
    slug: "recover-account-and-access-support",
    title: "How do I recover my account and where do I track support?",
    summary: "Use recovery first, then track cases from Support if manual review is needed.",
    category: "account-access",
    updatedAt: "2026-03-22",
    body: [
      "Start with the account recovery flow whenever you lose access. If the issue still requires manual review, support cases are tracked inside the Support page.",
      "Support tickets are notification-driven by email, but the source of truth stays in the app. This avoids split histories and keeps moderation notes aligned to the case state.",
      "For MVP, replying by email is not supported. Any future follow-up should happen from the app UI.",
    ],
    related: ["what-happens-after-i-submit-a-support-ticket", "how-to-report-a-member-or-reference"],
  },
  {
    slug: "privacy-rights-data-requests",
    title: "How do privacy, access, deletion, and portability requests work?",
    summary: "Formal privacy requests are handled by email, with identity review and a usual 30-day GDPR response window.",
    category: "account-access",
    updatedAt: "2026-04-03",
    body: [
      `For access, correction, deletion, objection, restriction, portability, or other privacy issues, email ${LEGAL_PROFILE.privacyEmail}. ConXion does not approve these requests through an instant in-app form.`,
      `${LEGAL_PROFILE.brandName} may ask for additional information to verify identity before releasing, exporting, correcting, or deleting data. Requests can be limited, refused, or charged where the law allows, including when they are repetitive, excessive, or would interfere with other people's rights, safety reviews, fraud prevention, billing or tax records, or legal claims.`,
      "A response is normally sent without undue delay and within one month. If a request is unusually complex, that period can be extended where the GDPR allows it, with notice during the first month.",
      "Deactivation is reversible and is not the same as deletion. If you simply deactivate the account, signing in again can reactivate it. If you want erasure instead, say that clearly in your request.",
      "Cookie and similar-technology preferences can also be managed through your browser or device settings and any in-product controls we may provide.",
    ],
    related: ["recover-account-and-access-support", "what-happens-after-i-submit-a-support-ticket"],
  },
  {
    slug: "what-happens-after-i-submit-a-support-ticket",
    title: "What happens after I submit a support ticket?",
    summary: "You receive a ticket code, moderation reviews the case in admin, and updates are sent by email and shown in Support.",
    category: "account-access",
    updatedAt: "2026-03-22",
    body: [
      "Every report creates a ticket code like CX-000123. That ticket appears in your Support page and in the moderation console.",
      "Moderators review the case in the admin console. Status changes such as open, under review, resolved, or dismissed are sent to you by email and shown in the app.",
      "For MVP, this internal case CRM is enough. Zendesk is not necessary until support volume, SLA management, macros, and multi-agent workflows justify the extra integration cost.",
    ],
    related: ["recover-account-and-access-support", "how-to-report-a-member-or-reference"],
  },
];

export function getHelpArticle(slug: string) {
  return HELP_ARTICLES.find((article) => article.slug === slug) ?? null;
}

export function getHelpCategory(key: HelpCategoryKey) {
  return HELP_CATEGORIES.find((category) => category.key === key) ?? null;
}
