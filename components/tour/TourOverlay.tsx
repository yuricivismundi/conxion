"use client";

import { useTour } from "./TourContext";
import { TourSpotlight } from "./TourSpotlight";
import { TourBottomSheet } from "./TourBottomSheet";

export function TourOverlay() {
  const { active } = useTour();
  if (!active) return null;
  return (
    <>
      <TourSpotlight />
      <TourBottomSheet />
    </>
  );
}
