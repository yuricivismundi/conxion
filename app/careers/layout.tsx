import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Careers — ConXion",
  description: "Build trust-first products for the global dance community. Explore open roles at ConXion and apply with a focused cover letter.",
};

export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
