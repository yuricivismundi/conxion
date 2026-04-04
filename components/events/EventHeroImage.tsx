"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";

type EventHeroImageProps = {
  alt: string;
  className: string;
  primarySrc?: string | null;
  fallbackSrc?: string | null;
};

export default function EventHeroImage({
  alt,
  className,
  primarySrc,
  fallbackSrc,
}: EventHeroImageProps) {
  const [mode, setMode] = useState<"primary" | "fallback" | "hidden">(
    primarySrc ? "primary" : fallbackSrc ? "fallback" : "hidden"
  );

  const src =
    mode === "primary"
      ? primarySrc || fallbackSrc || ""
      : mode === "fallback"
        ? fallbackSrc || ""
        : "";

  if (!src) return null;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => {
        if (mode === "primary" && fallbackSrc && fallbackSrc !== primarySrc) {
          setMode("fallback");
          return;
        }
        setMode("hidden");
      }}
    />
  );
}
