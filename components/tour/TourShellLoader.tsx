"use client";

import dynamic from "next/dynamic";
import React from "react";

const TourShell = dynamic(() => import("./TourShell"), { ssr: false });

export default function TourShellLoader({ children }: { children: React.ReactNode }) {
  return <TourShell>{children}</TourShell>;
}
