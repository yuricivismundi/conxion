import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — ConXion",
  description: "Compare ConXion plans. Starter is free. Verified is a one-time trust upgrade. Plus is a monthly plan with more reach, events, and visibility.",
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
