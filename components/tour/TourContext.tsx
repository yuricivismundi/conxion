"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { TOUR_STEPS } from "@/lib/tour/steps";
import { supabase } from "@/lib/supabase/client";

const TOUR_DONE_KEY = "cx_tour_done";

type TourContextValue = {
  active: boolean;
  step: number;
  total: number;
  next: () => void;
  skip: () => void;
  start: () => void;
};

const TourContext = createContext<TourContextValue>({
  active: false,
  step: 0,
  total: TOUR_STEPS.length,
  next: () => undefined,
  skip: () => undefined,
  start: () => undefined,
});

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);

  const finish = useCallback(() => {
    setActive(false);
    try {
      localStorage.setItem(TOUR_DONE_KEY, "1");
    } catch {
      // ignore storage errors
    }
  }, []);

  const next = useCallback(() => {
    setStep((prev) => {
      const nextStep = prev + 1;
      if (nextStep >= TOUR_STEPS.length) {
        finish();
        return prev;
      }
      return nextStep;
    });
  }, [finish]);

  const skip = useCallback(() => {
    finish();
  }, [finish]);

  const start = useCallback(() => {
    setStep(0);
    setActive(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkAndStart = async () => {
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
          if (!cancelled) start();
        }, 1500);

        return () => clearTimeout(timer);
      } catch {
        // ignore auth errors
      }
    };

    void checkAndStart();

    return () => {
      cancelled = true;
    };
  }, [start]);

  return (
    <TourContext.Provider value={{ active, step, total: TOUR_STEPS.length, next, skip, start }}>
      {children}
    </TourContext.Provider>
  );
}

export function useTour(): TourContextValue {
  return useContext(TourContext);
}
