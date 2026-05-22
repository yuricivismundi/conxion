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
    question: "What is a chat activation?",
    answer:
      "A chat activation is used when you start a new private conversation with someone. Starter includes 10 activations per calendar month, Plus includes 30. Once you activate a chat, it stays open for 30 days from the activation date — independent of the monthly reset. So a chat you activate on May 20 stays open until June 19, and still counts as one of your May activations, not June's.",
  },
  {
    id: "activation-reset",
    question: "When do my chat activations reset?",
    answer:
      "Activations reset on the 1st of every calendar month. For example, if you use 8 of your 10 in May, you get a fresh 10 on June 1 regardless of whether any open chat windows from May are still active.",
  },
  {
    id: "service-inquiries",
    question: "Do activity requests, trips, or hosting count as chat activations?",
    answer:
      "No. When someone accepts your activity request, trip, or hosting offer, a chat window opens automatically for free — it does not consume one of your monthly activations. Only conversations you start directly with someone via 'Start Conversation' use an activation slot.",
  },
  {
    id: "connection-requests",
    question: "How many connection requests can I send?",
    answer: "Starter includes 10 connection requests per month. Plus includes 60 per month.",
  },
  {
    id: "trip-event-limits",
    question: "How many trips and events can I create?",
    answer: "Starter and Verified include 1 trip per month, 2 public/request events per month, and up to 5 private groups total. Plus includes 5 trips per month, 5 events per month, and up to 10 private groups total.",
  },
  {
    id: "leave-reference",
    question: "How do I leave a reference?",
    answer:
      "References become eligible after an activity is accepted. If the activity has an end date, the prompt appears 24 hours after that end date. If it has one date, the prompt appears 24 hours after that date. If it has no date, the prompt appears 24 hours after acceptance in your References tab and thread history.",
  },
  {
    id: "chat-limit",
    question: "What happens when I reach my monthly activation limit?",
    answer:
      "You won’t be able to start new conversations until your activations reset on the 1st of next month, or you upgrade to Plus for 30 activations per month. Chats you already activated stay open — only new starts are blocked.",
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
    answer:
      "Yes. Connection requests, chat activations, trips, and events all reset on the 1st of each calendar month. Chat windows you already opened stay active for 30 days from when they were started — the reset only applies to how many new ones you can start.",
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
  {
    id: "private-mode",
    question: "What is Private mode and who can use it?",
    answer:
      "Private mode is a Plus feature that hides your profile from the Discover dancers feed and search results. When enabled, only people you are already connected with or have an active chat with can see your profile. You can still share your profile link directly and you remain visible to your existing connections. Anyone on Starter or Verified can still be found in Discover.",
  },
  {
    id: "private-mode-connections",
    question: "If I enable Private mode, do my existing connections lose access?",
    answer: "No. Existing connections are never affected. Private mode only prevents new people from finding you in Discover or search. People you are already connected with or chatting with continue to see your profile normally.",
  },
  {
    id: "event-invites-limit",
    question: "How many event invites can I send per month?",
    answer:
      "On the Starter plan you can send up to 10 event invites per month. Plus members get unlimited event invites. You can only invite accepted connections, so the limit is there to keep invites meaningful rather than spammy. The counter resets at the start of each calendar month.",
  },
];

export function getPricingFaqItems() {
  return PRICING_FAQ_ITEMS;
}
