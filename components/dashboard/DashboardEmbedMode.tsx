"use client";

import { createContext, useContext, type ReactNode } from "react";

const DashboardEmbedModeContext = createContext<"growth" | null>(null);

export function DashboardEmbedModeProvider({
  value,
  children,
}: {
  value: "growth" | null;
  children: ReactNode;
}) {
  return <DashboardEmbedModeContext.Provider value={value}>{children}</DashboardEmbedModeContext.Provider>;
}

export function useDashboardEmbedMode() {
  return useContext(DashboardEmbedModeContext);
}
