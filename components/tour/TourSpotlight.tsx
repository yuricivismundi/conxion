"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTour } from "./TourContext";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;
const TOOLTIP_W = 288;
const BOTTOM_SHEET_H = 220; // approx height of mobile bottom sheet

function getTooltipStyle(
  rect: Rect,
  placement: "top" | "bottom" | "left" | "right",
  isMobile: boolean
): React.CSSProperties {
  const GAP = 16;

  if (isMobile) {
    // On mobile always position above or below, centered horizontally, respecting sheet space
    const fitsBelow = rect.top + rect.height + PAD + GAP + 160 < window.innerHeight - BOTTOM_SHEET_H;
    const left = Math.max(8, Math.min(window.innerWidth - TOOLTIP_W - 8, rect.left + rect.width / 2 - TOOLTIP_W / 2));
    if (fitsBelow) {
      return { top: rect.top + rect.height + PAD + GAP, left };
    }
    return { top: Math.max(8, rect.top - PAD - GAP - 160), left };
  }

  switch (placement) {
    case "bottom":
      return {
        top: rect.top + rect.height + PAD + GAP,
        left: Math.max(8, Math.min(window.innerWidth - TOOLTIP_W - 8, rect.left + rect.width / 2 - TOOLTIP_W / 2)),
      };
    case "top":
      return {
        top: Math.max(8, rect.top - PAD - GAP - 160),
        left: Math.max(8, Math.min(window.innerWidth - TOOLTIP_W - 8, rect.left + rect.width / 2 - TOOLTIP_W / 2)),
      };
    case "left":
      return {
        top: Math.max(8, rect.top + rect.height / 2 - 80),
        left: Math.max(8, rect.left - PAD - GAP - TOOLTIP_W),
      };
    case "right":
      return {
        top: Math.max(8, rect.top + rect.height / 2 - 80),
        left: Math.min(window.innerWidth - TOOLTIP_W - 8, rect.left + rect.width + PAD + GAP),
      };
  }
}

export default function TourSpotlight() {
  const { step, totalSteps, currentStep, next, skip } = useTour();
  const [rect, setRect] = useState<Rect | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const rafRef = useRef<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => {
      setMounted(false);
      mq.removeEventListener("change", handler);
    };
  }, []);

  useEffect(() => {
    if (!currentStep) {
      setRect(null);
      return;
    }

    const target = currentStep.target;

    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null; }
    setRect(null);
    setNotFound(false);

    let elapsed = 0;
    pollRef.current = setInterval(() => {
      elapsed += 100;
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          clearInterval(pollRef.current!);
          pollRef.current = null;

          el.scrollIntoView({ behavior: "smooth", block: "center" });

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
        setNotFound(true);
      }
    }, 100);

    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [currentStep]);

  if (!mounted || !currentStep) return null;

  const tooltipStyle = rect
    ? getTooltipStyle(rect, currentStep.placement, isMobile)
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  const isLast = step + 1 === totalSteps;

  const fallbackMsg = currentStep.fallbackMessage ?? "Nothing to highlight here yet — this feature becomes available once there's content in your area.";

  // Not-found overlay: full dim + centered card
  if (notFound) {
    return createPortal(
      <>
        <div aria-hidden="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9998, pointerEvents: "none" }} />
        <div
          role="dialog"
          aria-modal="false"
          style={{ position: "fixed", zIndex: 10000, width: TOOLTIP_W, top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
          className="rounded-2xl border border-amber-400/25 bg-[#111318] p-5 shadow-2xl"
        >
          <div className="mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-amber-400">info</span>
            <p className="text-xs font-semibold text-amber-400/80 uppercase tracking-widest">{step + 1} / {totalSteps}</p>
          </div>
          <h3 className="mb-2 text-base font-bold text-white">{currentStep.title}</h3>
          <p className="mb-3 text-sm leading-relaxed text-white/65">{currentStep.description}</p>
          <p className="mb-4 text-xs leading-relaxed text-amber-300/70 border border-amber-400/15 bg-amber-400/[0.06] rounded-xl px-3 py-2">
            {fallbackMsg}
          </p>
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={skip} className="text-sm text-white/40 transition hover:text-white/70">
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
      </>,
      document.body
    );
  }

  return createPortal(
    <>
      {/* Spotlight highlight — shown on all screen sizes */}
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
            transition: "top 200ms ease, left 200ms ease, width 200ms ease, height 200ms ease",
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9998, pointerEvents: "none" }}
        />
      )}

      {/* Tooltip card — desktop only; mobile uses TourBottomSheet */}
      <div
        role="dialog"
        aria-modal="false"
        aria-label={`Tour step ${step + 1} of ${totalSteps}: ${currentStep.title}`}
        style={{ position: "fixed", zIndex: 10000, width: TOOLTIP_W, ...tooltipStyle }}
        className="hidden md:block rounded-2xl border border-white/10 bg-[#111318] p-5 shadow-2xl"
      >
        <p className="mb-1 text-xs font-semibold text-[#00F5FF]/70 uppercase tracking-widest">
          {step + 1} / {totalSteps}
        </p>
        <h3 className="mb-2 text-base font-bold text-white">{currentStep.title}</h3>
        <p className="mb-4 text-sm leading-relaxed text-white/65">{currentStep.description}</p>
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={skip} className="text-sm text-white/40 transition hover:text-white/70">
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
    </>,
    document.body
  );
}
