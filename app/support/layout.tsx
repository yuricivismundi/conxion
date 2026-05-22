import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support — ConXion",
  description: "Get help with ConXion. Browse FAQ topics on plans, hosting, references, and chat — or open a support case for moderation and account issues.",
};

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
