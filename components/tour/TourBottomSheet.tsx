"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TOUR_STEPS } from "@/lib/tour/steps";
import { useTour } from "./TourContext";

export function TourBottomSheet() {
  const { step, total, next, skip } = useTour();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) return null;

  const currentStep = TOUR_STEPS[step];
  if (!currentStep) return null;

  return createPortal(
    <div
      className="md:hidden"
      role="dialog"
      aria-modal="false"
      aria-label={`Tour step ${step + 1} of ${total}: ${currentStep.title}`}
    >
      {/* Dim overlay */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[9998] bg-black/50"
        onClick={skip}
      />

      {/* Bottom sheet */}
      <div className="fixed inset-x-0 bottom-0 z-[9999] rounded-t-2xl border-t border-white/10 bg-[#1a1d23] p-6 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#00F5FF]/70">
            {step + 1} / {total}
          </p>
          <button
            type="button"
            onClick={skip}
            className="text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            Skip
          </button>
        </div>

        <h3 className="mb-2 text-lg font-bold text-white">{currentStep.title}</h3>
        <p className="mb-6 text-sm leading-relaxed text-white/70">{currentStep.description}</p>

        {/* Progress dots */}
        <div className="mb-6 flex items-center justify-center gap-2">
          {TOUR_STEPS.map((s, i) => (
            <span
              key={s.id}
              className={`h-2 rounded-full transition-all ${
                i === step
                  ? "w-6 bg-[#00F5FF]"
                  : i < step
                  ? "w-2 bg-[#00F5FF]/40"
                  : "w-2 bg-white/20"
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={next}
          className="w-full rounded-full bg-[#00F5FF] py-3 text-base font-bold text-black transition hover:opacity-90 active:scale-[0.98]"
        >
          {step + 1 === total ? "Done" : "Next"}
        </button>
      </div>
    </div>,
    document.body
  );
}
