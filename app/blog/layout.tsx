import type { ReactNode } from "react";
import Nav from "@/components/Nav";

export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />
      {children}
    </div>
  );
}
