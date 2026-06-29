"use client";

import { TOUR_FLOWS } from "@/lib/tour/flows";
import { useTour } from "./TourContext";

export default function TourWelcome() {
  const { startFlow, closeWelcome } = useTour();

  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#111318] p-8 shadow-2xl">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-white">ConXion Tour</h2>
          <p className="mt-1 text-sm text-white/55">Pick a flow to get started</p>
        </div>

        {/* Flow cards */}
        <div className="flex flex-col gap-3">
          {TOUR_FLOWS.map((flow) => (
            <button
              key={flow.id}
              type="button"
              onClick={() => startFlow(flow.id)}
              className="flex w-full items-center gap-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.06] cursor-pointer"
            >
              <span className="material-symbols-outlined shrink-0 text-[28px] text-[#00F5FF]">
                {flow.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">{flow.title}</p>
                <p className="mt-0.5 text-sm text-white/55">{flow.description}</p>
              </div>
              <span className="material-symbols-outlined shrink-0 text-[20px] text-white/30">
                arrow_forward
              </span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={closeWelcome}
            className="text-sm text-white/40 transition hover:text-white/70"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
