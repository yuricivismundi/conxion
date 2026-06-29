"use client";

import { TOUR_FLOWS } from "@/lib/tour/flows";
import { useTour } from "./TourContext";

export default function TourWelcome() {
  const { startFlow, closeWelcome } = useTour();

  // Group flows by category preserving order
  const sections: { label: string; flows: typeof TOUR_FLOWS }[] = [];
  for (const flow of TOUR_FLOWS) {
    const existing = sections.find((s) => s.label === flow.category);
    if (existing) {
      existing.flows.push(flow);
    } else {
      sections.push({ label: flow.category, flows: [flow] });
    }
  }

  const categoryAccent: Record<string, string> = {
    Discovery: "from-[#00F5FF]/20 to-[#00F5FF]/5 border-[#00F5FF]/20",
    Teachers: "from-[#a855f7]/20 to-[#ff51fa]/5 border-[#a855f7]/20",
    Trips: "from-[#f59e0b]/20 to-[#f59e0b]/5 border-[#f59e0b]/20",
    Hosting: "from-[#22c55e]/20 to-[#22c55e]/5 border-[#22c55e]/20",
    Profile: "from-[#38bdf8]/20 to-[#38bdf8]/5 border-[#38bdf8]/20",
    Community: "from-[#f472b6]/20 to-[#f472b6]/5 border-[#f472b6]/20",
  };

  const categoryIconColor: Record<string, string> = {
    Discovery: "text-[#00F5FF]",
    Teachers: "text-[#c084fc]",
    Trips: "text-[#fbbf24]",
    Hosting: "text-[#4ade80]",
    Profile: "text-[#38bdf8]",
    Community: "text-[#f472b6]",
  };

  const categoryLabelColor: Record<string, string> = {
    Discovery: "text-[#00F5FF]/70",
    Teachers: "text-[#c084fc]/70",
    Trips: "text-[#fbbf24]/70",
    Hosting: "text-[#4ade80]/70",
    Profile: "text-[#38bdf8]/70",
    Community: "text-[#f472b6]/70",
  };

  return (
    <div className="fixed inset-0 z-[9990] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center px-0 sm:px-4">
      <div className="w-full max-w-lg sm:rounded-3xl rounded-t-3xl border border-white/10 bg-[#0e1014] shadow-[0_32px_80px_rgba(0,0,0,0.6)] overflow-hidden">

        {/* Gradient hero header */}
        <div className="relative px-7 pt-8 pb-6 bg-[linear-gradient(135deg,#0b1825_0%,#0e1014_60%)] overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(0,245,255,0.12),transparent_55%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(168,85,247,0.10),transparent_55%)]" />
          <div className="relative">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#00F5FF]/20 bg-[#00F5FF]/[0.07] px-3 py-1">
              <span className="material-symbols-outlined text-[14px] text-[#00F5FF]">explore</span>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#00F5FF]/80">Interactive tour</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white">Learn ConXion</h2>
            <p className="mt-1.5 text-sm text-white/45">Step-by-step guides to get the most out of the platform.</p>
          </div>
        </div>

        {/* Scrollable sections */}
        <div className="max-h-[58vh] overflow-y-auto px-5 pb-5 space-y-5 pt-4" style={{ scrollbarWidth: "none" }}>
          {sections.map(({ label, flows }) => (
            <div key={label}>
              {/* Section header */}
              <div className="mb-2.5 flex items-center gap-2">
                <span className={`text-[11px] font-bold uppercase tracking-[0.15em] ${categoryLabelColor[label] ?? "text-white/40"}`}>
                  {label}
                </span>
                <div className="h-px flex-1 bg-white/[0.06]" />
              </div>

              {/* Flow cards */}
              <div className="space-y-2">
                {flows.map((flow) => (
                  <button
                    key={flow.id}
                    type="button"
                    onClick={() => startFlow(flow.id)}
                    className={`group flex w-full items-center gap-4 rounded-2xl border bg-gradient-to-br p-4 text-left transition hover:brightness-110 active:scale-[0.98] ${categoryAccent[label] ?? "from-white/[0.04] to-white/[0.02] border-white/[0.07]"}`}
                  >
                    {/* Icon */}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/30">
                      <span className={`material-symbols-outlined text-[22px] ${categoryIconColor[label] ?? "text-white/60"}`}>
                        {flow.icon}
                      </span>
                    </div>

                    {/* Text */}
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-white leading-snug">{flow.title}</p>
                      <p className="mt-0.5 text-xs text-white/50 leading-relaxed line-clamp-2">{flow.description}</p>
                    </div>

                    {/* Step count + arrow */}
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="text-[10px] font-semibold text-white/25">{flow.steps.length} steps</span>
                      <span className="material-symbols-outlined text-[18px] text-white/25 transition group-hover:text-white/60 group-hover:translate-x-0.5">
                        arrow_forward
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-white/[0.06] px-5 py-4 flex items-center justify-between">
          <p className="text-xs text-white/25">{TOUR_FLOWS.length} guides available</p>
          <button
            type="button"
            onClick={closeWelcome}
            className="text-sm text-white/35 transition hover:text-white/65"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
