"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
        left: Math.max(8, rect.left + rect.width / 2 - 144),
      };
    case "top":
      return {
        top: Math.max(8, rect.top - PAD - GAP - 160),
        left: Math.max(8, rect.left + rect.width / 2 - 144),
      };
    case "left":
      return {
        top: rect.top + rect.height / 2 - 80,
        left: Math.max(8, rect.left - PAD - GAP - 288),
      };
    case "right":
      return {
        top: rect.top + rect.height / 2 - 80,
        left: rect.left + rect.width + PAD + GAP,
      };
  }
}

export default function TourSpotlight() {
  const { step, totalSteps, currentStep, next, skip } = useTour();
  const [rect, setRect] = useState<Rect | null>(null);
  const [mounted, setMounted] = useState(false);
  const rafRef = useRef<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!currentStep) {
      setRect(null);
      return;
    }

    const target = currentStep.target;

    // Clear previous RAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    setRect(null);

    // Poll for element up to 3s
    let elapsed = 0;
    pollRef.current = setInterval(() => {
      elapsed += 100;
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          clearInterval(pollRef.current!);
          pollRef.current = null;

          // Start RAF loop to keep rect synced
          const update = () => {
            const fresh = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
            if (fresh) {
              const fr = fresh.getBoundingClientRect();
              if (fr.width > 0 && fr.height > 0) {
                setRect({ top: fr.top, left: fr.left, width: fr.width, height: fr.height });
              }
            }
            rafRef.current = requestAnimationFrame(update);
          };
          rafRef.current = requestAnimationFrame(update);
        }
      }
      if (elapsed >= 3000 && pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 100);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [currentStep]);

  if (!mounted || !currentStep) return null;

  const tooltipStyle = rect
    ? getTooltipStyle(rect, currentStep.placement)
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  const isLast = step + 1 === totalSteps;

  return createPortal(
    <div className="hidden md:block">
      {/* Spotlight highlight */}
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
            transition: "all 200ms ease",
          }}
        />
      ) : (
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
        aria-label={`Tour step ${step + 1} of ${totalSteps}: ${currentStep.title}`}
        style={{
          position: "fixed",
          zIndex: 10000,
          width: 288,
          ...tooltipStyle,
        }}
        className="rounded-2xl border border-white/10 bg-[#111318] p-5 shadow-2xl"
      >
        <p className="mb-1 text-xs font-semibold text-[#00F5FF]/70 uppercase tracking-widest">
          {step + 1} / {totalSteps}
        </p>
        <h3 className="mb-2 text-base font-bold text-white">{currentStep.title}</h3>
        <p className="mb-4 text-sm leading-relaxed text-white/65">{currentStep.description}</p>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={skip}
            className="text-sm text-white/40 transition hover:text-white/70"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={next}
            className="rounded-full bg-[#00F5FF] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90 active:scale-95"
          >
            {isLast ? "Done ✓" : "Next →"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
