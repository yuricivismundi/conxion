"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TOUR_STEPS } from "@/lib/tour/steps";
import { useTour } from "./TourContext";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;

function getTooltipStyle(
  rect: Rect,
  placement: "top" | "bottom" | "left" | "right"
): React.CSSProperties {
  const GAP = 16;
  switch (placement) {
    case "bottom":
      return {
        top: rect.top + rect.height + PAD + GAP,
        left: Math.max(8, rect.left + rect.width / 2 - 160),
      };
    case "top":
      return {
        top: rect.top - PAD - GAP - 140,
        left: Math.max(8, rect.left + rect.width / 2 - 160),
      };
    case "left":
      return {
        top: rect.top + rect.height / 2 - 70,
        left: Math.max(8, rect.left - PAD - GAP - 320),
      };
    case "right":
      return {
        top: rect.top + rect.height / 2 - 70,
        left: rect.left + rect.width + PAD + GAP,
      };
  }
}

export function TourSpotlight() {
  const { step, total, next, skip } = useTour();
  const [rect, setRect] = useState<Rect | null>(null);
  const [mounted, setMounted] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    const currentStep = TOUR_STEPS[step];
    if (!currentStep) return;

    const update = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-tour="${currentStep.id}"]`
      );
      if (el) {
        const r = el.getBoundingClientRect();
        // Only use if actually visible (non-zero size)
        if (r.width > 0 && r.height > 0) {
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        }
      }
      rafRef.current = requestAnimationFrame(update);
    };

    rafRef.current = requestAnimationFrame(update);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [step]);

  if (!mounted) return null;

  const currentStep = TOUR_STEPS[step];
  if (!currentStep) return null;

  const tooltipStyle = rect
    ? getTooltipStyle(rect, currentStep.placement)
    : { top: "50%", left: "50%" };

  return createPortal(
    <div className="hidden md:block">
      {/* Spotlight cutout div */}
      {rect ? (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: 12,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.65)",
            zIndex: 9999,
            pointerEvents: "none",
          }}
        />
      ) : (
        // Full overlay when target not found yet
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            zIndex: 9998,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        role="dialog"
        aria-modal="false"
        aria-label={`Tour step ${step + 1} of ${total}: ${currentStep.title}`}
        style={{
          position: "fixed",
          zIndex: 10000,
          width: 320,
          ...tooltipStyle,
        }}
        className="rounded-2xl border border-white/10 bg-[#1a1d23] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
      >
        <p className="mb-1 text-xs font-semibold text-[#00F5FF]/70 uppercase tracking-widest">
          {step + 1} / {total}
        </p>
        <h3 className="mb-2 text-base font-bold text-white">{currentStep.title}</h3>
        <p className="mb-4 text-sm leading-relaxed text-white/70">{currentStep.description}</p>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={skip}
            className="text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            Skip tour
          </button>
          <button
            type="button"
            onClick={next}
            className="rounded-full bg-[#00F5FF] px-5 py-2 text-sm font-bold text-black transition hover:opacity-90 active:scale-95"
          >
            {step + 1 === total ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
