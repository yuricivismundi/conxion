"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTour } from "./TourContext";

export default function TourBottomSheet() {
  const { step, totalSteps, currentStep, next, skip } = useTour();
  const [mounted, setMounted] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Mirror the same 3s polling to detect not-found on mobile
  useEffect(() => {
    if (!currentStep) return;
    setNotFound(false);
    let elapsed = 0;
    const poll = setInterval(() => {
      elapsed += 100;
      const el = document.querySelector<HTMLElement>(`[data-tour="${currentStep.target}"]`);
      if (el && el.getBoundingClientRect().width > 0) {
        clearInterval(poll);
        return;
      }
      if (elapsed >= 3000) {
        clearInterval(poll);
        setNotFound(true);
      }
    }, 100);
    return () => clearInterval(poll);
  }, [currentStep]);

  if (!mounted || !currentStep) return null;

  const isLast = step + 1 === totalSteps;

  return createPortal(
    <div
      className="md:hidden"
      role="dialog"
      aria-modal="false"
      aria-label={`Tour step ${step + 1} of ${totalSteps}: ${currentStep.title}`}
    >
      {/* Bottom sheet — spotlight handles the dim overlay */}
      <div className="fixed inset-x-0 bottom-0 z-[10000] rounded-t-2xl border-t border-white/10 bg-[#111318] px-6 pt-5 pb-8">
        {/* Progress dots */}
        <div className="mb-4 flex items-center justify-center gap-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span
              key={i}
              className={[
                "rounded-full transition-all",
                i === step ? "h-2 w-6 bg-[#00F5FF]" : i < step ? "h-2 w-2 bg-[#00F5FF]/40" : "h-2 w-2 bg-white/20",
              ].join(" ")}
            />
          ))}
        </div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#00F5FF]/70">
          {step + 1} / {totalSteps}
        </p>
        <h3 className="mb-2 text-lg font-bold text-white">{currentStep.title}</h3>
        <p className="mb-4 text-sm leading-relaxed text-white/65">{currentStep.description}</p>
        {notFound && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.07] px-3 py-2.5">
            <span className="material-symbols-outlined shrink-0 text-[15px] text-amber-400 mt-0.5">info</span>
            <p className="text-xs leading-relaxed text-amber-300/80">
              {currentStep.fallbackMessage ?? "Nothing to highlight here yet — this feature becomes available once there's content in your area."}
            </p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={next}
            className="flex-1 rounded-full bg-[#00F5FF] py-3 text-base font-bold text-black transition hover:opacity-90 active:scale-[0.98]"
          >
            {isLast ? "Done ✓" : "Next →"}
          </button>
          <button type="button" onClick={skip} className="text-sm text-white/40 transition hover:text-white/70">
            Skip
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
