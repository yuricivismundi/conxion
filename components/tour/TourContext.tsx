"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { getFlowById } from "@/lib/tour/flows";
import type { TourStep } from "@/lib/tour/types";
import { supabase } from "@/lib/supabase/client";

const TOUR_DONE_KEY = "cx_tour_done";

type TourState = {
  // Welcome screen
  welcomeOpen: boolean;
  openWelcome: () => void;
  closeWelcome: () => void;

  // Active tour
  active: boolean;
  flowId: string | null;
  step: number;
  totalSteps: number;
  currentStep: TourStep | null;

  // Actions
  startFlow: (flowId: string) => void;
  next: () => void;
  skip: () => void;
};

const TourContext = createContext<TourState>({
  welcomeOpen: false,
  openWelcome: () => undefined,
  closeWelcome: () => undefined,

  active: false,
  flowId: null,
  step: 0,
  totalSteps: 0,
  currentStep: null,

  startFlow: () => undefined,
  next: () => undefined,
  skip: () => undefined,
});

export function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  const flow = flowId ? getFlowById(flowId) : null;
  const totalSteps = flow?.steps.length ?? 0;
  const currentStep = flow?.steps[step] ?? null;

  const openWelcome = useCallback(() => setWelcomeOpen(true), []);
  const closeWelcome = useCallback(() => setWelcomeOpen(false), []);

  const finish = useCallback(() => {
    setActive(false);
    setFlowId(null);
  }, []);

  const skip = useCallback(() => finish(), [finish]);

  const startFlow = useCallback(
    (id: string) => {
      const f = getFlowById(id);
      if (!f) return;
      setFlowId(id);
      setStep(0);
      setActive(true);
      setWelcomeOpen(false);
      // Navigate to first step's route if needed
      if (f.steps[0] && pathname !== f.steps[0].route) {
        router.push(f.steps[0].route);
      }
    },
    [pathname, router]
  );

  const next = useCallback(() => {
    if (!flow) return;
    const nextStep = step + 1;
    if (nextStep >= flow.steps.length) {
      finish();
      return;
    }
    const nextStepData = flow.steps[nextStep];
    setStep(nextStep);
    const currentFull = typeof window !== "undefined" ? window.location.pathname + window.location.search : pathname;
    if (nextStepData && currentFull !== nextStepData.route) {
      router.push(nextStepData.route);
    }
  }, [flow, step, finish, pathname, router]);

  // Auto-show welcome on first login
  useEffect(() => {
    // Never auto-open on auth or public pages
    if (pathname.startsWith("/auth") || pathname.startsWith("/pricing") || pathname === "/privacy" || pathname === "/terms") return;

    let cancelled = false;

    const checkAndOpen = async () => {
      try {
        const alreadyDone = localStorage.getItem(TOUR_DONE_KEY);
        if (alreadyDone) return;
      } catch {
        return;
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!sessionData.session?.user) return;

        const timer = setTimeout(() => {
          if (!cancelled) {
            setWelcomeOpen(true);
            try {
              localStorage.setItem(TOUR_DONE_KEY, "1");
            } catch {
              // ignore
            }
          }
        }, 2000);

        return () => clearTimeout(timer);
      } catch {
        // ignore auth errors
      }
    };

    void checkAndOpen();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <TourContext.Provider
      value={{
        welcomeOpen,
        openWelcome,
        closeWelcome,
        active,
        flowId,
        step,
        totalSteps,
        currentStep,
        startFlow,
        next,
        skip,
      }}
    >
      {children}
    </TourContext.Provider>
  );
}

export function useTour(): TourState {
  return useContext(TourContext);
}
