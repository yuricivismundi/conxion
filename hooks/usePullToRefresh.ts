"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const THRESHOLD = 72; // px to pull before triggering
const MAX_PULL = 100; // px cap on visual indicator

export function usePullToRefresh(onRefresh: () => Promise<void> | void) {
  const [pullY, setPullY] = useState(0); // 0–MAX_PULL
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pulling = useRef(false);

  const trigger = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setPullY(0);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh, refreshing]);

  useEffect(() => {
    const el = document.documentElement;

    function onTouchStart(e: TouchEvent) {
      // Only pull when scrolled to top
      if (el.scrollTop > 0 || window.scrollY > 0) return;
      startY.current = e.touches[0]!.clientY;
      pulling.current = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!pulling.current || startY.current === null) return;
      const dy = e.touches[0]!.clientY - startY.current;
      if (dy <= 0) { setPullY(0); return; }
      // Resist pull with sqrt easing
      const clamped = Math.min(MAX_PULL, Math.sqrt(dy) * 6);
      setPullY(clamped);
    }

    function onTouchEnd() {
      if (!pulling.current) return;
      pulling.current = false;
      if (pullY >= THRESHOLD) {
        void trigger();
      } else {
        setPullY(0);
      }
      startY.current = null;
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [pullY, trigger]);

  return { pullY, refreshing };
}
