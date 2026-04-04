export type PricingFaqItem = {
  id: string;
  question: string;
  answer: string;
};

const PRICING_FAQ_ITEMS: PricingFaqItem[] = [
  {
    id: "verified-vs-plus",
    question: "What is the difference between Verified and Plus?",
    answer:
      "Verified is a one-time trust upgrade for requesting hosting, getting hosted with more confidence, and teacher features. Plus is a monthly plan with more visibility, more connection reach, and higher trip and event limits.",
  },
  {
    id: "verification-one-time",
    question: "Is verification a one-time payment?",
    answer: "Yes. You only pay once to get verified.",
  },
  {
    id: "plus-renewal",
    question: "Does Plus renew automatically?",
    answer: "Yes. Plus is a monthly subscription and renews automatically until cancelled.",
  },
  {
    id: "active-chat-thread",
    question: "What counts as an active chat thread?",
    answer: "An active chat thread counts when you start a new conversation. Replies to incoming messages do not open a new thread.",
  },
  {
    id: "service-inquiries",
    question: "Do service inquiries count as active chat threads?",
    answer: "No. Requesting class information or a hosting stay does not count as an active chat thread.",
  },
  {
    id: "connection-requests",
    question: "How many connection requests can I send?",
    answer: "Starter includes 10 connection requests per month, with up to 30 in your first month after joining. Plus includes 30 per month.",
  },
  {
    id: "trip-event-limits",
    question: "How many trips and events can I create?",
    answer: "Starter and Verified include 1 trip per month and 2 public or private events per month. Plus includes 5 trips and 5 events per month.",
  },
  {
    id: "leave-reference",
    question: "How do I leave a reference?",
    answer:
      "References become eligible after an activity is accepted. If the activity has an end date, the prompt appears 24 hours after that end date. If it has one date, the prompt appears 24 hours after that date. If it has no date, the prompt appears 24 hours after acceptance in your References tab and thread history.",
  },
  {
    id: "chat-limit",
    question: "What happens when I reach my active chat thread limit?",
    answer: "You won’t be able to start more chat threads until your monthly limit resets or you upgrade to Plus.",
  },
  {
    id: "host-on-starter",
    question: "Can I host on Starter?",
    answer: "Yes. Offering hosting can stay available on Starter. Verification is only required when you want to request a hosting stay for yourself.",
  },
  {
    id: "hosting-verification",
    question: "Why is verification required to request hosting?",
    answer: "Requesting hosting involves trust and safety. Verification helps protect both hosts and guests.",
  },
  {
    id: "monthly-reset",
    question: "Do limits reset every month?",
    answer: "Yes. Monthly limits for connection requests, active chat threads, trips, and events reset each month.",
  },
  {
    id: "teacher-needs-plus",
    question: "Do I need Plus to be a teacher?",
    answer: "No. You only need Verified to unlock your teacher profile.",
  },
  {
    id: "cancel-plus",
    question: "Can I cancel Plus anytime?",
    answer: "Yes. You can cancel anytime from your account settings.",
  },
];

export function getPricingFaqItems() {
  return PRICING_FAQ_ITEMS;
}
