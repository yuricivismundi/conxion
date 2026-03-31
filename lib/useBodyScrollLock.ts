"use client";

import { useEffect } from "react";

type LockedStyles = {
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyWidth: string;
  bodyOverscrollBehavior: string;
  htmlOverflow: string;
  htmlOverscrollBehavior: string;
};

let lockCount = 0;
let lockedScrollY = 0;
let lockedStyles: LockedStyles | null = null;

function applyBodyScrollLock() {
  if (typeof window === "undefined") return;

  const body = document.body;
  const html = document.documentElement;

  lockedScrollY = window.scrollY;
  lockedStyles = {
    bodyOverflow: body.style.overflow,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyWidth: body.style.width,
    bodyOverscrollBehavior: body.style.overscrollBehavior,
    htmlOverflow: html.style.overflow,
    htmlOverscrollBehavior: html.style.overscrollBehavior,
  };

  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${lockedScrollY}px`;
  body.style.width = "100%";
  body.style.overscrollBehavior = "none";
  html.style.overflow = "hidden";
  html.style.overscrollBehavior = "none";
}

function releaseBodyScrollLock() {
  if (typeof window === "undefined" || !lockedStyles) return;

  const body = document.body;
  const html = document.documentElement;

  body.style.overflow = lockedStyles.bodyOverflow;
  body.style.position = lockedStyles.bodyPosition;
  body.style.top = lockedStyles.bodyTop;
  body.style.width = lockedStyles.bodyWidth;
  body.style.overscrollBehavior = lockedStyles.bodyOverscrollBehavior;
  html.style.overflow = lockedStyles.htmlOverflow;
  html.style.overscrollBehavior = lockedStyles.htmlOverscrollBehavior;

  window.scrollTo(0, lockedScrollY);
  lockedStyles = null;
}

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof window === "undefined") return;

    if (lockCount === 0) {
      applyBodyScrollLock();
    }
    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        releaseBodyScrollLock();
      }
    };
  }, [active]);
}
