"use client";

import { useTour } from "./TourContext";
import TourWelcome from "./TourWelcome";
import TourSpotlight from "./TourSpotlight";
import TourBottomSheet from "./TourBottomSheet";

export function TourOverlay() {
  const { welcomeOpen, active } = useTour();
  return (
    <>
      {welcomeOpen && <TourWelcome />}
      {active && <TourSpotlight />}
      {active && <TourBottomSheet />}
    </>
  );
}

export default TourOverlay;
