import type { PlanId } from "@/lib/billing/plans";

export type UpgradeReason =
  | "chat_limit_reached"
  | "teacher_feature_locked"
  | "hosting_requires_verification"
  | "media_limit_reached"
  | "soft_request_limit_reached"
  | "verification_recommended";

export type UpgradeReasonContent = {
  title: string;
  body: string;
  recommendedPlan: PlanId;
  ctaLabel: string;
};

const UPGRADE_REASON_CONTENT: Record<UpgradeReason, UpgradeReasonContent> = {
  chat_limit_reached: {
    title: "You’ve reached your monthly active chat limit",
    body: "Upgrade to Plus to keep connecting with more dancers.",
    recommendedPlan: "pro",
    ctaLabel: "Upgrade to Plus",
  },
  teacher_feature_locked: {
    title: "Teacher features require verification",
    body: "Get verified to unlock your teacher profile and professional inquiries.",
    recommendedPlan: "verified",
    ctaLabel: "Get verified",
  },
  hosting_requires_verification: {
    title: "Requesting hosting requires verification",
    body: "Verification helps keep the community safer for both hosts and guests.",
    recommendedPlan: "verified",
    ctaLabel: "Get verified",
  },
  media_limit_reached: {
    title: "Add more media to stand out",
    body: "Upgrade to Plus to add more photos to your profile.",
    recommendedPlan: "pro",
    ctaLabel: "Upgrade to Plus",
  },
  soft_request_limit_reached: {
    title: "You’re sending many requests",
    body: "Please be selective, or upgrade to reach more people.",
    recommendedPlan: "pro",
    ctaLabel: "Upgrade to Plus",
  },
  verification_recommended: {
    title: "Build more trust on your profile",
    body: "Verification helps others feel confident connecting, hosting, or booking you.",
    recommendedPlan: "verified",
    ctaLabel: "Get verified",
  },
};

export function getUpgradeReasonContent(reason: UpgradeReason) {
  return UPGRADE_REASON_CONTENT[reason];
}
