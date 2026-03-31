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
          "30 connection requests in your first month after joining",
          "10 active chat threads",
        ],
      },
      {
        title: "Travelling",
        items: [
          "Find travellers and join their trips",
          "Create 1 trip per month",
          "Send 5 hosting offers per month around dance holidays, festivals, and competitions",
        ],
      },
      {
        title: "Events",
        items: ["Create 2 public or private events per month", "Join trips and events across the community"],
      },
      {
        title: "Profile",
        items: ["Create your profile", "2 showcase videos", "1 photo"],
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
    priceLabel: "€5/month",
    shortDescription: "Get more visibility, more trips and events, and more room to grow your profile.",
    ctaLabel: "Upgrade to Plus",
    isRecommended: true,
    featureGroups: [
      {
        title: "Discovery",
        items: ["30 connection requests per month", "30 active chat threads", "Better visibility in discovery", "Appear before free users"],
      },
      {
        title: "Travelling",
        items: [
          "Find travellers and create 5 trips per month",
          "Send 10 hosting offers per month",
          "Keep your dance travel plans visible across the community",
        ],
      },
      {
        title: "Events",
        items: ["Create 5 public or private events per month"],
      },
      {
        title: "Profile",
        items: ["2 showcase videos", "3 photos"],
      },
      {
        title: "Extras",
        items: ["Priority support for important requests", "Early access to featured profile / event boosts"],
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
