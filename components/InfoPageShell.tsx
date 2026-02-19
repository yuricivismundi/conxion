import type { ReactNode } from "react";
import Nav from "@/components/Nav";

type InfoPageShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export default function InfoPageShell({ title, description, children }: InfoPageShellProps) {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />
      <main className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-8 sm:px-6">
        <header className="mb-8 border-b border-white/10 pb-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">{description}</p>
        </header>
        <section className="space-y-6">{children}</section>
      </main>
    </div>
  );
}

