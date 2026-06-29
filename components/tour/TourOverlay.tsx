"use client";

import { useEffect, useState } from "react";
import { useTour } from "./TourContext";
import TourWelcome from "./TourWelcome";
import TourSpotlight from "./TourSpotlight";
import TourBottomSheet from "./TourBottomSheet";

export function TourOverlay() {
  const { welcomeOpen, active } = useTour();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <>
      {welcomeOpen && <TourWelcome />}
      {active && <TourSpotlight />}
      {active && <TourBottomSheet />}
    </>
  );
}

export default TourOverlay;
