export type PlanId = "starter" | "verified" | "pro";
export type BillingType = "free" | "one_time" | "subscription";

export type PlanDefinition = {
  id: PlanId;
  name: string;
  billingType: BillingType;
  priceLabel: string;
  shortDescription: string;
  ctaLabel: string;
  isRecommended?: boolean;
  featureGroups: Array<{
    title: string;
    items: string[];
  }>;
};

const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
  starter: {
    id: "starter",
    name: "Starter",
    billingType: "free",
    priceLabel: "Free",
    shortDescription: "Discover dancers, travellers, events, and start building your place in the community.",
    ctaLabel: "Get started",
    featureGroups: [
      {
        title: "Discovery",
        items: [
          "Discover social dancers, teachers, organizers, DJs, and artists",
          "10 connection requests per month",
          "10 active chat threads per month",
        ],
      },
      {
        title: "Travelling",
        items: [
          "Find travellers and join their trips",
          "1 accepted trip per month",
          "5 trip requests per month",
          "Create 1 trip per month",
          "Send up to 5 hosting offers to travellers",
        ],
      },
      {
        title: "Events & Activities",
        items: [
          "Create up to 2 events per month",
          "Up to 3 private groups (max 50 messages/day per user, 200 messages/day per group)",
          "5 activity requests per month",
        ],
      },
      {
        title: "Profile",
        items: [
          "Create your profile and personalise it",
          "2 showcase videos",
          "Dance Tools to manage your Growth Path, have a record of your competitions and your goals",
        ],
      },
    ],
  },
  verified: {
    id: "verified",
    name: "Verified",
    billingType: "one_time",
    priceLabel: "€9 one-time",
    shortDescription: "Build trust to request hosting, get hosted with more confidence, and unlock professional opportunities without a monthly bill.",
    ctaLabel: "Get verified",
    featureGroups: [
      {
        title: "Trust",
        items: ["Verified badge", "One-time payment"],
      },
      {
        title: "Travelling",
        items: [
          "Unlock requesting hosting in your dance travel destinations",
          "10 hosting requests per month",
          "Feel more trusted when getting hosted for festivals, competitions, and dance holidays",
        ],
      },
      {
        title: "Professional",
        items: ["Unlock teacher / artist profile", "Unlock service inquiries"],
      },
      {
        title: "Community confidence",
        items: ["Higher trust across the community"],
      },
    ],
  },
  pro: {
    id: "pro",
    name: "Plus",
    billingType: "subscription",
    priceLabel: "€6.99/month",
    shortDescription: "Get more visibility, more trips and events, and more room to grow your profile.",
    ctaLabel: "Upgrade to Plus",
    isRecommended: true,
    featureGroups: [
      {
        title: "Discovery",
        items: [
          "60 connection requests per month",
          "30 active chat threads per month",
          "Appear before free users",
        ],
      },
      {
        title: "Travelling",
        items: [
          "3 accepted trips per month",
          "10 trip requests per month",
          "Create 5 trips per month",
          "10 hosting requests per month",
          "Send up to 10 hosting offers to travellers",
          "Your trips appear before free users",
        ],
      },
      {
        title: "Events & Activities",
        items: [
          "Create up to 5 events per month",
          "Up to 10 private groups (max 100 messages/day per user, 500 messages/day per group)",
          "15 activity requests per month",
          "Your events appear before free users (Ideal for Organisers)",
        ],
      },
      {
        title: "Profile",
        items: [
          "2 showcase videos",
          "3 additional photos on your profile",
        ],
      },
      {
        title: "Privacy",
        items: [
          "Private mode — hide from Discover and search",
        ],
      },
      {
        title: "Extras",
        items: [
          "Priority support for important requests",
          "Early access to featured profile / event boosts",
          "Opportunity to become promoter of the brand in your city",
        ],
      },
    ],
  },
};

const PLAN_ORDER: PlanId[] = ["starter", "verified", "pro"];

export function getPlanDefinition(planId: PlanId) {
  return PLAN_DEFINITIONS[planId];
}

export function getAllPlanDefinitions() {
  return PLAN_ORDER.map((planId) => PLAN_DEFINITIONS[planId]);
}

export function isPaidPlan(planId: PlanId) {
  return PLAN_DEFINITIONS[planId].billingType !== "free";
}

export function isSubscriptionPlan(planId: PlanId) {
  return PLAN_DEFINITIONS[planId].billingType === "subscription";
}

export function isOneTimePlan(planId: PlanId) {
  return PLAN_DEFINITIONS[planId].billingType === "one_time";
}
