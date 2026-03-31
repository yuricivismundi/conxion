export type CareerRole = {
  id: string;
  title: string;
  team: string;
  theme: string;
  location: string;
  workMode: "Remote" | "Hybrid";
  level: "Mid" | "Senior" | "Lead";
  summary: string;
  responsibilities: string[];
  requirements: string[];
};

export const CAREER_ROLES: CareerRole[] = [
  {
    id: "city-ambassador",
    title: "City Ambassador (Priority)",
    team: "Community",
    theme: "Ambassador Program",
    location: "City-based (global)",
    workMode: "Remote",
    level: "Lead",
    summary:
      "Represent ConXion in your city, onboard dancers, and grow local trust loops with events, studios, and social communities.",
    responsibilities: [
      "Invite and onboard dancers in your city every month.",
      "Build partnerships with local schools, teachers, DJs, and organizers.",
      "Promote ConXion at socials and festivals with community-first messaging.",
      "Collect local feedback and report growth/safety insights to core team.",
    ],
    requirements: [
      "Active social dancer with strong local network presence.",
      "Excellent communication and community-building mindset.",
      "Comfort leading local activations and lightweight reporting.",
      "Commitment to ConXion trust and safety standards.",
    ],
  },
  {
    id: "community-partnerships-lead",
    title: "Community & Partnerships Lead",
    team: "Community",
    theme: "Network Quality",
    location: "Europe / LATAM preferred",
    workMode: "Remote",
    level: "Lead",
    summary:
      "Own partnership growth with schools, festivals, and artists while scaling city-level community quality.",
    responsibilities: [
      "Onboard dance schools, organizers, teachers, and DJs.",
      "Build city ambassador pipelines and local partnership maps.",
      "Coordinate co-marketing with key festivals and event hosts.",
      "Define operational standards for healthy, trusted growth.",
    ],
    requirements: [
      "Experience in partnerships, community ops, or event ecosystems.",
      "Strong communication and relationship management skills.",
      "Ability to execute quickly with lean resources.",
      "Data-informed approach to community and activation goals.",
    ],
  },
  {
    id: "social-media-content",
    title: "Social Media & Content Manager",
    team: "Growth",
    theme: "Brand Storytelling",
    location: "Remote",
    workMode: "Remote",
    level: "Mid",
    summary:
      "Build ConXion’s voice across Instagram/TikTok and turn community moments into high-quality growth content.",
    responsibilities: [
      "Create recurring content formats (dancer stories, festival highlights, role models).",
      "Own weekly publishing calendar and creative direction.",
      "Coordinate with ambassadors and city leads for local story sourcing.",
      "Track engagement-to-signup conversion loops.",
    ],
    requirements: [
      "Hands-on social content creation and editing skills.",
      "Strong understanding of dance/social culture.",
      "Ability to maintain consistent quality and cadence.",
      "Portfolio with examples of short-form growth content.",
    ],
  },
  {
    id: "growth-user-acquisition",
    title: "Growth & User Acquisition Lead",
    team: "Growth",
    theme: "City Expansion",
    location: "Remote",
    workMode: "Remote",
    level: "Lead",
    summary:
      "Design and run acquisition loops for dancers, hosts, travelers, and event participants in target cities.",
    responsibilities: [
      "Execute referral and ambassador-driven acquisition campaigns.",
      "Launch city-specific onboarding and activation experiments.",
      "Partner with product on funnel and lifecycle optimization.",
      "Report measurable growth outcomes across channels.",
    ],
    requirements: [
      "Proven growth execution in consumer/community products.",
      "Strong experimentation mindset and basic analytics fluency.",
      "Ability to prioritize high-impact tests under constraints.",
      "Clear written communication and accountability.",
    ],
  },
  {
    id: "events-festival-partnerships",
    title: "Events & Festival Partnerships Manager",
    team: "Partnerships",
    theme: "Event Ecosystem",
    location: "Europe preferred",
    workMode: "Hybrid",
    level: "Senior",
    summary:
      "Grow ConXion’s event ecosystem by onboarding organizers and activating festival audiences.",
    responsibilities: [
      "Onboard event organizers and maintain partner relationships.",
      "Promote event discovery flows and city activation packs.",
      "Coordinate ambassador support for priority festivals.",
      "Improve organizer feedback loops into product roadmap.",
    ],
    requirements: [
      "Strong event/festival network and operations mindset.",
      "Experience in partnerships or community-led activations.",
      "Comfort with structured planning and deadlines.",
      "Ability to represent ConXion in public-facing contexts.",
    ],
  },
  {
    id: "trust-safety-moderation",
    title: "Trust & Safety / Community Moderation",
    team: "Safety",
    theme: "Trust Infrastructure",
    location: "Remote",
    workMode: "Remote",
    level: "Mid",
    summary:
      "Support moderation workflows, reporting triage, and policy quality as community interactions scale.",
    responsibilities: [
      "Review reports and support safe escalation paths.",
      "Maintain moderation process quality and consistency.",
      "Help refine safety guidelines and response templates.",
      "Collaborate with product on prevention-oriented UX improvements.",
    ],
    requirements: [
      "Experience in trust/safety, moderation, or support operations.",
      "Calm, structured judgment under sensitive scenarios.",
      "Strong written communication and policy interpretation.",
      "High integrity and confidentiality standards.",
    ],
  },
  {
    id: "fullstack-messaging-trust",
    title: "Senior Full-Stack Engineer, Messaging & Trust",
    team: "Product Engineering",
    theme: "Trust Infrastructure",
    location: "Europe timezones preferred",
    workMode: "Remote",
    level: "Senior",
    summary:
      "Own inbox reliability, request timelines, and policy-aware messaging permissions across connections, trips, and hosting.",
    responsibilities: [
      "Ship high-reliability request and messaging flows in Next.js + Supabase.",
      "Design safe write paths with strong auditability and security constraints.",
      "Improve performance and observability for high-traffic inbox surfaces.",
      "Collaborate with product and moderation to convert policy into enforceable behavior.",
    ],
    requirements: [
      "5+ years building production web apps with React/TypeScript.",
      "Strong SQL and data-modeling experience for trust-critical systems.",
      "Comfort owning features end-to-end from schema to UX behavior.",
      "Clear writing and pragmatic decision-making under product ambiguity.",
    ],
  },
  {
    id: "product-designer-dance-tools",
    title: "Product Designer, Dance Tools",
    team: "Design",
    theme: "Growth Experience",
    location: "Europe or LATAM",
    workMode: "Remote",
    level: "Senior",
    summary:
      "Design premium workflows for dance growth, goals, and competitions while keeping interaction cost low and clarity high.",
    responsibilities: [
      "Own UX for move boards, goal systems, and competition tracking flows.",
      "Define interaction patterns that scale from early adoption to advanced usage.",
      "Prototype and validate designs with clear success metrics.",
      "Maintain visual consistency with ConXion dark premium branding.",
    ],
    requirements: [
      "Strong portfolio of shipped product design work (B2C or social platforms).",
      "Expertise in information hierarchy and interaction design.",
      "Comfort with design systems and implementation-ready specs.",
      "Ability to defend decisions with user and business reasoning.",
    ],
  },
  {
    id: "growth-marketing-events",
    title: "Growth Marketing Lead, Events",
    team: "Growth",
    theme: "City Expansion",
    location: "Remote",
    workMode: "Remote",
    level: "Lead",
    summary:
      "Drive city-level growth by activating dancers, organizers, and creators around event discovery and trusted networking.",
    responsibilities: [
      "Plan and run channel strategies for key city launches.",
      "Build acquisition loops around event discovery and referrals.",
      "Partner with product on funnel experiments and lifecycle campaigns.",
      "Track CAC, activation, and retention with clear reporting cadence.",
    ],
    requirements: [
      "Proven growth marketing ownership in consumer or community products.",
      "Strong experimentation mindset and analytics literacy.",
      "Hands-on execution across paid, organic, and partnerships.",
      "Clear narrative skills for campaigns and positioning.",
    ],
  },
];

export const CAREER_ROLE_IDS = new Set(CAREER_ROLES.map((role) => role.id));
export const CAREER_DAILY_SUBMISSION_LIMIT = 3;
export const AMBASSADOR_ROLE_ID = "city-ambassador";
export const AMBASSADOR_CALL_DAY_UTC = 3; // Wednesday
