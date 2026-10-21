import type { Metadata } from "next";

import { EARLY_ACCESS_ENABLED } from "@/lib/billing/early-access";

export const metadata: Metadata = EARLY_ACCESS_ENABLED
  ? {
      title: "Free during early access — ConXion",
      description: "Every ConXion feature is free while we build the community. Join as a founding member and build your Dance Page.",
    }
  : {
      title: "Pricing — ConXion",
      description: "Compare ConXion plans. Starter is free. Verified is a one-time trust upgrade. Plus is a monthly plan with more reach, events, and visibility.",
    };

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
