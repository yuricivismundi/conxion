"use client";

import React from "react";
import { TourProvider } from "./TourContext";
import TourOverlay from "./TourOverlay";

export default function TourShell({ children }: { children: React.ReactNode }) {
  return (
    <TourProvider>
      {children}
      <TourOverlay />
    </TourProvider>
  );
}
